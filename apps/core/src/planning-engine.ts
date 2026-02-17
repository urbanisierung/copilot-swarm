import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearCheckpoint, type IterationSnapshot, loadCheckpoint, type QAPair, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import { ResponseKeyword } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { plansDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { openSplitEditor } from "./textarea.js";
import type { TuiRenderer } from "./tui-renderer.js";
import { responseContains } from "./utils.js";

const MAX_CLARIFICATION_ROUNDS = 10;

const PLANNER_INSTRUCTIONS = `You are a Senior Product Manager conducting a requirements clarification session with a user.
Your goal is to fully understand the user's request before any engineering work begins.

**Rules:**
1. Read the user's request carefully. Use \`list_dir\` and \`read_file\` to understand the existing project structure if it helps you ask better questions.
2. If the request is vague or incomplete, ask targeted clarifying questions:
   - Scope boundaries (what's included, what's not)
   - Expected behavior, user flows, and edge cases
   - Technical constraints or preferences
   - Priority and phasing (if the request is large)
3. Ask at most 3–5 questions at a time. Number them clearly.
4. After the user answers, assess whether you have enough information. Ask follow-up questions only if genuinely needed.
5. When you have sufficient clarity to write a complete specification, respond with **REQUIREMENTS_CLEAR** on its own line, followed by a structured summary of the requirements including:
   - Problem statement
   - Acceptance criteria (testable)
   - Technical requirements
   - Edge cases
   - Out-of-scope items`;

const ANALYST_INSTRUCTIONS = `You are a Senior Software Architect conducting a technical feasibility analysis.
Given a set of requirements, analyze the codebase and produce a structured assessment.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the codebase thoroughly.
2. Assess and report:
   - **Complexity:** Low / Medium / High — with justification
   - **Affected files/modules:** List every file or module that needs changes
   - **Approach:** Concise description of the implementation strategy
   - **Risks & blockers:** Anything that could cause problems (breaking changes, missing dependencies, performance concerns)
   - **Estimated scope:** Number of files to change, new files to create, tests to write
3. Be specific. Reference actual file paths and code structures you found in the repo.
4. Do not implement anything — analysis only.`;

const ENGINEER_CLARIFIER_INSTRUCTIONS = `You are a Senior Software Engineer reviewing requirements before implementation.
Your goal is to identify and resolve any technical ambiguities, missing details, or potential blockers BEFORE implementation begins.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the codebase and understand the current state.
2. Think about what you would need to know to implement this. Ask about:
   - API contracts, data models, or interfaces that aren't specified
   - Error handling and edge cases
   - Integration points with existing code
   - Testing expectations (unit, integration, e2e)
   - Performance or security requirements
3. Ask at most 3–5 focused questions at a time. Number them clearly.
4. After the user answers, assess whether you have enough clarity. Ask follow-ups only if genuinely needed.
5. When you have sufficient information to implement, respond with **ENGINEERING_CLEAR** on its own line, followed by a summary of the technical decisions and assumptions.
6. Do NOT identify "blockers" that prevent implementation — your job is to resolve ambiguities so implementation can proceed without hesitation.`;

const DESIGNER_CLARIFIER_INSTRUCTIONS = `You are a Senior UI/UX Designer reviewing requirements before design work begins.
Your goal is to clarify visual, interaction, and accessibility details.

**Rules:**
1. Use \`list_dir\` and \`read_file\` to understand the existing UI patterns, components, and design system in use.
2. Ask about:
   - Layout and component hierarchy preferences
   - Interaction patterns (hover, click, drag, etc.)
   - Responsive behavior and breakpoints
   - Accessibility requirements
   - Visual style (match existing patterns, or new direction?)
3. Ask at most 3–5 focused questions at a time. Number them clearly.
4. After the user answers, assess whether you have enough clarity. Ask follow-ups only if genuinely needed.
5. When you have sufficient information, respond with **DESIGN_CLEAR** on its own line, followed by a summary of the design decisions and assumptions.`;

const ENGINEERING_CLEAR_KEYWORD = "ENGINEERING_CLEAR";
const DESIGN_CLEAR_KEYWORD = "DESIGN_CLEAR";
const PLAN_APPROVED_KEYWORD = "PLAN_APPROVED";
const MAX_REVIEW_ITERATIONS = 3;

const STEP_REVIEWER_INSTRUCTIONS = `You are a Senior Technical Reviewer evaluating one section of a project plan.
Your goal is to verify the section is clear, complete, and actionable enough for implementation.

**Rules:**
1. Read the section carefully. Check for:
   - **Clarity:** Would an engineer know exactly what to build from this alone?
   - **Completeness:** Are acceptance criteria testable? Are edge cases covered?
   - **Consistency:** Does it contradict other sections or make conflicting assumptions?
   - **Actionability:** Are there vague phrases like "as appropriate", "if needed", or "etc." that should be specified?
2. Decision:
   - If the section is clear, complete, and actionable, respond with **PLAN_APPROVED**.
   - If there are issues, provide a numbered list of specific improvements needed. Be precise about what's wrong and what the fix should be.
3. Do NOT rewrite the section yourself. Only provide feedback.`;

const CROSS_MODEL_PLAN_REVIEWER_INSTRUCTIONS = `You are a Senior Technical Reviewer performing a final quality check on a complete project plan.
You are a different AI model from the one that produced this plan. Your fresh perspective helps catch blind spots.

**Rules:**
1. Use \`list_dir\` and \`read_file\` to verify claims about the codebase.
2. Check the ENTIRE plan for:
   - **Accuracy:** Are file paths, component names, and technical details correct?
   - **Feasibility:** Can this actually be implemented as described?
   - **Completeness:** Are there missing requirements, edge cases, or integration points?
   - **Conflicts:** Do different sections contradict each other?
   - **Implementation readiness:** Could an engineer start implementing from this plan without further clarification?
3. Decision:
   - If the plan is ready for implementation, respond with **PLAN_APPROVED**.
   - If there are issues, provide a numbered list of specific improvements. Be precise.`;

/** Section headers that must be present in a valid assembled plan. */
const PLAN_SECTION_HEADERS = [
  "## Refined Requirements",
  "## Engineering Decisions",
  "## Design Decisions",
  "## Technical Analysis",
];

/** Minimum ratio of revised-to-original length before we consider the revision suspicious. */
const MIN_REVISION_LENGTH_RATIO = 0.3;

export class PlanningEngine {
  private readonly sessions: SessionManager;
  private activePhaseKey: string | null = null;
  private iterationProgress: Record<string, IterationSnapshot> = {};
  private answeredQuestions: Record<string, QAPair[]> = {};

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
    private readonly renderer?: TuiRenderer,
  ) {
    this.sessions = new SessionManager(config, pipeline, logger);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.planningStart);

    const useCrossModel = this.pipeline.reviewModel !== this.pipeline.primaryModel;

    const phases: { phase: string }[] = [
      { phase: "plan-clarify" },
      { phase: "plan-review" },
      { phase: "plan-eng-clarify" },
      { phase: "plan-review" },
      { phase: "plan-design-clarify" },
      { phase: "plan-review" },
      { phase: "plan-analyze" },
    ];
    if (useCrossModel) {
      phases.push({ phase: "plan-cross-review" });
    }
    this.tracker?.initPhases(phases);

    // State
    const completedPhases = new Set<string>();
    let spec = "";
    let engDecisions = "";
    let designDecisions = "";
    let analysis = "";
    let resumedPhaseKey: string | null = null;
    let effectiveIssueBody = this.config.issueBody;

    // Resume from checkpoint
    if (this.config.resume) {
      const cp = await loadCheckpoint(this.config);
      if (cp?.mode === "plan") {
        this.logger.info(msg.resuming(cp.completedPhases.length));
        for (const p of cp.completedPhases) {
          completedPhases.add(p);
          this.tracker?.completePhase(p);
        }
        spec = cp.spec || "";
        engDecisions = cp.engDecisions || "";
        designDecisions = cp.designDecisions || "";
        analysis = cp.analysis || "";
        effectiveIssueBody = cp.issueBody || this.config.issueBody;
        if (cp.activePhase) {
          resumedPhaseKey = cp.activePhase;
          this.iterationProgress = cp.iterationProgress ?? {};
        }
        this.answeredQuestions = cp.answeredQuestions ?? {};
      } else {
        this.logger.info(msg.noCheckpoint);
      }
    }

    const saveProgress = async () => {
      await saveCheckpoint(this.config, {
        mode: "plan",
        completedPhases: [...completedPhases],
        spec,
        engDecisions,
        designDecisions,
        analysis,
        issueBody: effectiveIssueBody,
        runId: this.config.runId,
        tasks: [],
        designSpec: "",
        streamResults: [],
        activePhase: this.activePhaseKey ?? undefined,
        iterationProgress: Object.keys(this.iterationProgress).length > 0 ? this.iterationProgress : undefined,
        answeredQuestions: Object.keys(this.answeredQuestions).length > 0 ? this.answeredQuestions : undefined,
      });
    };

    let phaseIdx = 0;

    // Phase 1: PM clarifies requirements interactively
    const clarifyKey = `plan-clarify-${phaseIdx}`;
    if (completedPhases.has(clarifyKey)) {
      this.logger.info(msg.phaseSkipped("plan-clarify"));
    } else {
      this.tracker?.activatePhase(clarifyKey);
      spec = await this.clarifyRequirements(effectiveIssueBody, clarifyKey, saveProgress);
      completedPhases.add(clarifyKey);
      this.tracker?.completePhase(clarifyKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 2: Review PM output
    const pmReviewKey = `plan-review-${phaseIdx}`;
    if (completedPhases.has(pmReviewKey)) {
      this.logger.info(msg.phaseSkipped("plan-review"));
    } else {
      this.tracker?.activatePhase(pmReviewKey);
      this.activePhaseKey = pmReviewKey;
      if (pmReviewKey !== resumedPhaseKey) this.iterationProgress = {};
      spec = await this.reviewStep(
        spec,
        "Refined Requirements",
        "PM is revising requirements…",
        pmReviewKey,
        saveProgress,
      );
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(pmReviewKey);
      this.tracker?.completePhase(pmReviewKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 3: Engineer clarifies technical questions
    const engClarifyKey = `plan-eng-clarify-${phaseIdx}`;
    if (completedPhases.has(engClarifyKey)) {
      this.logger.info(msg.phaseSkipped("plan-eng-clarify"));
    } else {
      this.tracker?.activatePhase(engClarifyKey);
      engDecisions = await this.clarifyWithRole(
        ENGINEER_CLARIFIER_INSTRUCTIONS,
        ENGINEERING_CLEAR_KEYWORD,
        spec,
        "Engineer is reviewing requirements…",
        msg.planningEngClarifyPhase,
        engClarifyKey,
        saveProgress,
      );
      completedPhases.add(engClarifyKey);
      this.tracker?.completePhase(engClarifyKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 4: Review engineer output
    const engReviewKey = `plan-review-${phaseIdx}`;
    if (completedPhases.has(engReviewKey)) {
      this.logger.info(msg.phaseSkipped("plan-review"));
    } else {
      this.tracker?.activatePhase(engReviewKey);
      this.activePhaseKey = engReviewKey;
      if (engReviewKey !== resumedPhaseKey) this.iterationProgress = {};
      engDecisions = await this.reviewStep(
        engDecisions,
        "Engineering Decisions",
        "Engineer is revising decisions…",
        engReviewKey,
        saveProgress,
      );
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(engReviewKey);
      this.tracker?.completePhase(engReviewKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 5: Designer clarifies UI/UX
    const designClarifyKey = `plan-design-clarify-${phaseIdx}`;
    if (completedPhases.has(designClarifyKey)) {
      this.logger.info(msg.phaseSkipped("plan-design-clarify"));
    } else {
      this.tracker?.activatePhase(designClarifyKey);
      designDecisions = await this.clarifyWithRole(
        DESIGNER_CLARIFIER_INSTRUCTIONS,
        DESIGN_CLEAR_KEYWORD,
        spec,
        "Designer is reviewing requirements…",
        msg.planningDesignClarifyPhase,
        designClarifyKey,
        saveProgress,
      );
      completedPhases.add(designClarifyKey);
      this.tracker?.completePhase(designClarifyKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 6: Review designer output
    const designReviewKey = `plan-review-${phaseIdx}`;
    if (completedPhases.has(designReviewKey)) {
      this.logger.info(msg.phaseSkipped("plan-review"));
    } else {
      this.tracker?.activatePhase(designReviewKey);
      this.activePhaseKey = designReviewKey;
      if (designReviewKey !== resumedPhaseKey) this.iterationProgress = {};
      designDecisions = await this.reviewStep(
        designDecisions,
        "Design Decisions",
        "Designer is revising decisions…",
        designReviewKey,
        saveProgress,
      );
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(designReviewKey);
      this.tracker?.completePhase(designReviewKey);
      await saveProgress();
    }
    phaseIdx++;

    // Phase 7: Engineering analyst assesses codebase
    const analyzeKey = `plan-analyze-${phaseIdx}`;
    if (completedPhases.has(analyzeKey)) {
      this.logger.info(msg.phaseSkipped("plan-analyze"));
    } else {
      this.tracker?.activatePhase(analyzeKey);
      analysis = await this.analyzeCodebase(spec);
      completedPhases.add(analyzeKey);
      this.tracker?.completePhase(analyzeKey);
      await saveProgress();
    }
    phaseIdx++;

    // Assemble full plan
    let plan =
      `## Refined Requirements\n\n${spec}\n\n` +
      `## Engineering Decisions\n\n${engDecisions}\n\n` +
      `## Design Decisions\n\n${designDecisions}\n\n` +
      `## Technical Analysis\n\n${analysis}`;

    // Phase 8: Cross-model review of the full plan
    if (useCrossModel) {
      const crossKey = `plan-cross-review-${phaseIdx}`;
      if (completedPhases.has(crossKey)) {
        this.logger.info(msg.phaseSkipped("plan-cross-review"));
      } else {
        this.tracker?.activatePhase(crossKey);
        this.activePhaseKey = crossKey;
        if (crossKey !== resumedPhaseKey) this.iterationProgress = {};
        plan = await this.crossModelReview(plan, crossKey, saveProgress);
        this.activePhaseKey = null;
        this.iterationProgress = {};
        completedPhases.add(crossKey);
        this.tracker?.completePhase(crossKey);
        await saveProgress();
      }
    }

    // Save plan output
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const fullPlan = `# Plan\n\n**Timestamp:** ${timestamp}\n\n## Original Request\n\n${effectiveIssueBody}\n\n${plan}\n`;

    const dir = plansDir(this.config);
    await fs.mkdir(dir, { recursive: true });

    const timestampedPath = path.join(dir, `plan-${fileTimestamp}.md`);
    const latestPath = path.join(dir, "plan-latest.md");
    await fs.writeFile(timestampedPath, fullPlan);
    await fs.copyFile(timestampedPath, latestPath);

    // Clear checkpoint on success
    await clearCheckpoint(this.config);

    this.logger.info(msg.planningComplete);
    this.logger.info(msg.planSaved(path.relative(this.config.repoRoot, timestampedPath)));
    this.logger.info(`📌 Latest plan: ${path.relative(this.config.repoRoot, latestPath)}`);
    this.logger.info(`\n💡 Run the pipeline with: swarm --plan ${path.relative(this.config.repoRoot, latestPath)}`);
  }

  /**
   * Review a plan section with a reviewer agent. If issues found, send feedback
   * back to the original agent (via isolated session) for revision.
   */
  private async reviewStep(
    content: string,
    sectionName: string,
    reviseSpinner: string,
    phaseKey: string,
    saveProgress: () => Promise<void>,
  ): Promise<string> {
    this.logger.info(msg.planningReviewPhase(sectionName));
    let revised = content;

    // Resume: skip completed iterations
    const progress = this.iterationProgress[phaseKey];
    let startIteration = 1;
    if (progress) {
      revised = progress.content;
      startIteration = progress.completedIterations + 1;
      this.logger.info(msg.iterationResumed(progress.completedIterations, MAX_REVIEW_ITERATIONS));
    }

    for (let i = startIteration; i <= MAX_REVIEW_ITERATIONS; i++) {
      this.logger.info(msg.planReviewIteration(i, MAX_REVIEW_ITERATIONS));

      const feedback = await this.sessions.callIsolatedWithInstructions(
        STEP_REVIEWER_INSTRUCTIONS,
        `Review this "${sectionName}" section of a project plan:\n\n${revised}`,
        `Reviewing ${sectionName} (${i}/${MAX_REVIEW_ITERATIONS})…`,
      );

      if (responseContains(feedback, PLAN_APPROVED_KEYWORD)) {
        this.logger.info(msg.planReviewApproved(sectionName));
        break;
      }

      this.logger.info(msg.planReviewFeedback(feedback.substring(0, 80)));

      // Have the original role revise based on feedback
      const revision = await this.sessions.callIsolatedWithInstructions(
        `You are the author of a "${sectionName}" section in a project plan. ` +
          "A reviewer has provided feedback. Revise the section to address all issues.\n\n" +
          "**CRITICAL:** Output the COMPLETE revised section — every requirement, criterion, " +
          "and detail. Do NOT output a summary, changelog, or description of your changes. " +
          "The output must be the full section content, ready to replace the original.",
        `Original section:\n\n${revised}\n\nReviewer feedback:\n\n${feedback}\n\nRevise the section to address all feedback. Output the COMPLETE revised section.`,
        reviseSpinner,
      );

      // Guard: if revision is suspiciously short, keep original
      if (revision.length >= revised.length * MIN_REVISION_LENGTH_RATIO) {
        revised = revision;
      } else {
        this.logger.info("  ⚠️  Revision too short — keeping previous version");
      }

      // Save iteration progress
      this.iterationProgress[phaseKey] = { content: revised, completedIterations: i };
      await saveProgress();
    }

    return revised;
  }

  /**
   * Cross-model review of the full assembled plan using the review model.
   */
  private async crossModelReview(plan: string, phaseKey: string, saveProgress: () => Promise<void>): Promise<string> {
    this.logger.info(msg.planCrossModelPhase(this.pipeline.reviewModel));
    let revised = plan;

    // Resume: skip completed iterations
    const progress = this.iterationProgress[phaseKey];
    let startIteration = 1;
    if (progress) {
      revised = progress.content;
      startIteration = progress.completedIterations + 1;
      this.logger.info(msg.iterationResumed(progress.completedIterations, MAX_REVIEW_ITERATIONS));
    }

    for (let i = startIteration; i <= MAX_REVIEW_ITERATIONS; i++) {
      this.logger.info(msg.planReviewIteration(i, MAX_REVIEW_ITERATIONS));

      const feedback = await this.sessions.callIsolatedWithInstructions(
        CROSS_MODEL_PLAN_REVIEWER_INSTRUCTIONS,
        `Review this complete project plan:\n\n${revised}`,
        `Cross-model review (${this.pipeline.reviewModel}, ${i}/${MAX_REVIEW_ITERATIONS})…`,
        this.pipeline.reviewModel,
      );

      if (responseContains(feedback, PLAN_APPROVED_KEYWORD)) {
        this.logger.info(msg.planCrossModelApproved);
        break;
      }

      this.logger.info(msg.planReviewFeedback(feedback.substring(0, 80)));

      // Revise with the primary model
      const revision = await this.sessions.callIsolatedWithInstructions(
        "You are revising a project plan based on feedback from a cross-model reviewer. " +
          "Address all issues raised.\n\n" +
          "**CRITICAL:** Output the COMPLETE revised plan with ALL sections preserved:\n" +
          "## Refined Requirements\n## Engineering Decisions\n## Design Decisions\n## Technical Analysis\n\n" +
          "Do NOT output a summary, changelog, or description of your changes. " +
          "The output must be the full plan document, ready to replace the original.",
        `Current plan:\n\n${revised}\n\nCross-model reviewer feedback:\n\n${feedback}\n\nRevise the plan. Output the COMPLETE plan with all sections.`,
        "Revising plan…",
      );

      // Guard: verify the revision preserves plan structure
      const hasAllSections = PLAN_SECTION_HEADERS.every((h) => revision.includes(h));
      const isLongEnough = revision.length >= revised.length * MIN_REVISION_LENGTH_RATIO;
      if (hasAllSections && isLongEnough) {
        revised = revision;
      } else {
        this.logger.info("  ⚠️  Revision lost plan structure — keeping previous version");
      }

      // Save iteration progress
      this.iterationProgress[phaseKey] = { content: revised, completedIterations: i };
      await saveProgress();
    }

    return revised;
  }

  private async clarifyRequirements(
    issueBody: string,
    phaseKey: string,
    saveProgress: () => Promise<void>,
  ): Promise<string> {
    this.logger.info(msg.planningPmPhase);

    const session = await this.sessions.createSessionWithInstructions(PLANNER_INSTRUCTIONS);
    const savedQA = this.answeredQuestions[phaseKey] ?? [];

    try {
      let response: string;

      // Replay previously answered questions on resume
      if (savedQA.length > 0) {
        this.logger.info(`  ⏭️  Replaying ${savedQA.length} previously answered question(s)`);
        // Send initial request
        response = await this.sessions.send(
          session,
          `Here is the user's request:\n\n${issueBody}\n\n` +
            "Analyze this request. If it's clear enough, respond with REQUIREMENTS_CLEAR followed by the structured summary. " +
            "If you need more information, ask your clarifying questions.",
          "PM is analyzing requirements…",
        );

        // Replay each saved Q&A
        for (const qa of savedQA) {
          if (responseContains(response, ResponseKeyword.REQUIREMENTS_CLEAR)) break;
          response = await this.sessions.send(
            session,
            `User's answers:\n\n${qa.answer}`,
            "PM is processing saved answers…",
          );
        }
      } else {
        response = await this.sessions.send(
          session,
          `Here is the user's request:\n\n${issueBody}\n\n` +
            "Analyze this request. If it's clear enough, respond with REQUIREMENTS_CLEAR followed by the structured summary. " +
            "If you need more information, ask your clarifying questions.",
          "PM is analyzing requirements…",
        );
      }

      for (let round = savedQA.length; round < MAX_CLARIFICATION_ROUNDS; round++) {
        if (responseContains(response, ResponseKeyword.REQUIREMENTS_CLEAR)) {
          break;
        }

        // Open split editor with agent questions on the right
        this.renderer?.pause();
        const answer = await openSplitEditor(response, {
          editorTitle: "Your Answer",
          contextTitle: "PM Questions",
        });
        this.renderer?.resume();

        if (answer === undefined) {
          // User cancelled — let the agent finalize
          response = await this.sessions.send(
            session,
            "The user cancelled. Use your best judgment for any open questions and produce the final requirements. Respond with REQUIREMENTS_CLEAR followed by the structured summary.",
            "PM is finalizing requirements…",
          );
        } else if (!answer.trim()) {
          // User skipped
          response = await this.sessions.send(
            session,
            "The user skipped this round. Use your best judgment for any open questions and produce the final requirements. Respond with REQUIREMENTS_CLEAR followed by the structured summary.",
            "PM is finalizing requirements…",
          );
        } else {
          // Save Q&A pair
          if (!this.answeredQuestions[phaseKey]) this.answeredQuestions[phaseKey] = [];
          this.answeredQuestions[phaseKey].push({ question: response, answer });
          await saveProgress();

          response = await this.sessions.send(
            session,
            `User's answers:\n\n${answer}`,
            "PM is processing your answers…",
          );
        }
      }

      // Extract everything after REQUIREMENTS_CLEAR keyword
      const marker = "REQUIREMENTS_CLEAR";
      const idx = response.toUpperCase().indexOf(marker);
      const spec = idx !== -1 ? response.substring(idx + marker.length).trim() : response;

      this.renderer?.pause();
      console.log("\n📋 Refined Requirements:\n");
      console.log(spec);
      this.renderer?.resume();

      return spec;
    } finally {
      await session.destroy();
    }
  }

  /**
   * Generic interactive clarification round for any role.
   * The agent asks questions, user answers, until the agent signals the keyword.
   */
  private async clarifyWithRole(
    instructions: string,
    clearKeyword: string,
    spec: string,
    spinnerLabel: string,
    phaseLabel: string,
    phaseKey: string,
    saveProgress: () => Promise<void>,
  ): Promise<string> {
    this.logger.info(phaseLabel);

    const session = await this.sessions.createSessionWithInstructions(instructions);
    const savedQA = this.answeredQuestions[phaseKey] ?? [];

    try {
      let response: string;

      // Replay previously answered questions on resume
      if (savedQA.length > 0) {
        this.logger.info(`  ⏭️  Replaying ${savedQA.length} previously answered question(s)`);
        response = await this.sessions.send(
          session,
          `Here are the refined requirements:\n\n${spec}\n\n` +
            `Review these requirements from your perspective. If everything is clear, respond with ${clearKeyword} followed by your summary. ` +
            "If you need more information, ask your clarifying questions.",
          spinnerLabel,
        );

        for (const qa of savedQA) {
          if (responseContains(response, clearKeyword)) break;
          response = await this.sessions.send(session, `User's answers:\n\n${qa.answer}`, spinnerLabel);
        }
      } else {
        response = await this.sessions.send(
          session,
          `Here are the refined requirements:\n\n${spec}\n\n` +
            `Review these requirements from your perspective. If everything is clear, respond with ${clearKeyword} followed by your summary. ` +
            "If you need more information, ask your clarifying questions.",
          spinnerLabel,
        );
      }

      for (let round = savedQA.length; round < MAX_CLARIFICATION_ROUNDS; round++) {
        if (responseContains(response, clearKeyword)) {
          break;
        }

        this.renderer?.pause();
        const roleName = phaseLabel.replace(/[^a-zA-Z ]/g, "").trim();
        const answer = await openSplitEditor(response, {
          editorTitle: "Your Answer",
          contextTitle: `${roleName} Questions`,
        });
        this.renderer?.resume();

        if (answer === undefined) {
          response = await this.sessions.send(
            session,
            `The user cancelled. Use your best judgment for any open questions and produce your final summary. Respond with ${clearKeyword} followed by the summary.`,
            spinnerLabel,
          );
        } else if (!answer.trim()) {
          response = await this.sessions.send(
            session,
            `The user skipped this round. Use your best judgment for any open questions and produce your final summary. Respond with ${clearKeyword} followed by the summary.`,
            spinnerLabel,
          );
        } else {
          if (!this.answeredQuestions[phaseKey]) this.answeredQuestions[phaseKey] = [];
          this.answeredQuestions[phaseKey].push({ question: response, answer });
          await saveProgress();

          response = await this.sessions.send(session, `User's answers:\n\n${answer}`, spinnerLabel);
        }
      }

      const idx = response.toUpperCase().indexOf(clearKeyword);
      const result = idx !== -1 ? response.substring(idx + clearKeyword.length).trim() : response;

      this.renderer?.pause();
      console.log(`\n${phaseLabel}\n`);
      console.log(result);
      this.renderer?.resume();

      return result;
    } finally {
      await session.destroy();
    }
  }

  private async analyzeCodebase(spec: string): Promise<string> {
    this.logger.info(msg.planningEngPhase);

    const session = await this.sessions.createSessionWithInstructions(ANALYST_INSTRUCTIONS);
    try {
      const analysis = await this.sessions.send(
        session,
        `Analyze the codebase against these requirements and produce a technical assessment:\n\n${spec}`,
        "Engineer is analyzing codebase…",
      );

      this.renderer?.pause();
      console.log("\n🔍 Technical Analysis:\n");
      console.log(analysis);
      this.renderer?.resume();

      return analysis;
    } finally {
      await session.destroy();
    }
  }
}
