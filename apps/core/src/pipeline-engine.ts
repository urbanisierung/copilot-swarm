import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IterationSnapshot, PreviousRunContext } from "./checkpoint.js";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisFilePath, latestPointerPath, runDir, swarmRoot } from "./paths.js";
import type {
  CrossModelReviewPhaseConfig,
  DecomposePhaseConfig,
  DesignPhaseConfig,
  ImplementPhaseConfig,
  PipelineConfig,
  ReviewStepConfig,
  SpecPhaseConfig,
  VerifyConfig,
  VerifyPhaseConfig,
} from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { hasFrontendWork, isFrontendTask, parseJsonArray, responseContains, writeRoleSummary } from "./utils.js";
import { detectVerifyCommands } from "./verify-detect.js";

/** Shared context that flows between phases. */
interface PipelineContext {
  repoAnalysis: string;
  spec: string;
  tasks: string[];
  designSpec: string;
  streamResults: string[];
}

export class PipelineEngine {
  private readonly sessions: SessionManager;
  private effectiveConfig: SwarmConfig;

  // Iteration-level checkpoint state
  private activePhaseKey: string | null = null;
  private phaseDraft: string | null = null;
  private iterationProgress: Record<string, IterationSnapshot> = {};

  /** Previous run context — set for review mode. */
  private readonly reviewContext: PreviousRunContext | null;
  private readonly reviewFeedback: string;

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
    reviewContext?: PreviousRunContext,
  ) {
    this.effectiveConfig = config;
    this.sessions = new SessionManager(config, pipeline, logger);
    this.reviewContext = reviewContext ?? null;
    this.reviewFeedback = config.command === "review" ? config.issueBody : "";
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.configLoaded(this.pipeline.primaryModel, this.pipeline.reviewModel, this.config.verbose));

    let ctx: PipelineContext = { repoAnalysis: "", spec: "", tasks: [], designSpec: "", streamResults: [] };
    let completedPhases: Set<string> = new Set();
    let resumedPhaseKey: string | null = null;

    // Load repo analysis if available — provides context for all phases
    try {
      ctx.repoAnalysis = await fs.readFile(analysisFilePath(this.config), "utf-8");
      this.logger.info(msg.repoAnalysisLoaded);
    } catch {
      // No analysis file — agents will explore the repo themselves
    }

    // Resume from checkpoint if requested
    if (this.config.resume) {
      const checkpoint = await loadCheckpoint(this.config);
      if (checkpoint) {
        // Use the same runId so files go to the same run directory
        if (checkpoint.runId) {
          this.effectiveConfig = { ...this.config, runId: checkpoint.runId };
        }
        ctx = {
          repoAnalysis: ctx.repoAnalysis,
          spec: checkpoint.spec,
          tasks: checkpoint.tasks,
          designSpec: checkpoint.designSpec,
          streamResults: checkpoint.streamResults,
        };
        completedPhases = new Set(checkpoint.completedPhases);
        this.logger.info(msg.resuming(completedPhases.size));

        // Restore iteration-level progress for the phase that was active
        if (checkpoint.activePhase) {
          resumedPhaseKey = checkpoint.activePhase;
          this.phaseDraft = checkpoint.phaseDraft ?? null;
          this.iterationProgress = checkpoint.iterationProgress ?? {};
          // Restore previous session log entries
          if (checkpoint.sessionLog) {
            Object.assign(this.sessions.sessionLog, checkpoint.sessionLog);
          }
        }
      } else {
        this.logger.warn(msg.noCheckpoint);
      }
    }

    // Review mode: pre-fill context from previous run, skip spec/decompose/design
    if (this.reviewContext) {
      this.logger.info(msg.reviewLoadedContext(this.reviewContext.runId));
      ctx.spec = this.reviewContext.spec;
      ctx.tasks = this.reviewContext.tasks;
      ctx.designSpec = this.reviewContext.designSpec;
      // streamResults are kept empty — implement phase will re-run with feedback + previous output
      // Mark all phases before implement as completed so they're skipped
      for (let i = 0; i < this.pipeline.pipeline.length; i++) {
        const p = this.pipeline.pipeline[i];
        if (p.phase === "implement") break;
        completedPhases.add(`${p.phase}-${i}`);
      }
    }

    // Closure that saves the full checkpoint including iteration state
    const saveProgress = async () => {
      await saveCheckpoint(this.effectiveConfig, {
        completedPhases: [...completedPhases],
        spec: ctx.spec,
        tasks: ctx.tasks,
        designSpec: ctx.designSpec,
        streamResults: ctx.streamResults,
        issueBody: this.effectiveConfig.issueBody,
        runId: this.effectiveConfig.runId,
        mode: this.reviewContext ? "review" : "run",
        activePhase: this.activePhaseKey ?? undefined,
        phaseDraft: this.phaseDraft ?? undefined,
        iterationProgress: Object.keys(this.iterationProgress).length > 0 ? this.iterationProgress : undefined,
        sessionLog: Object.keys(this.sessions.sessionLog).length > 0 ? this.sessions.sessionLog : undefined,
      });
    };

    // Initialize progress tracker with pipeline phases
    this.tracker?.initPhases(this.pipeline.pipeline);
    for (const key of completedPhases) {
      this.tracker?.skipPhase(key);
    }

    for (const phase of this.pipeline.pipeline) {
      const phaseKey = `${phase.phase}-${this.pipeline.pipeline.indexOf(phase)}`;

      if (completedPhases.has(phaseKey)) {
        this.logger.info(msg.phaseSkipped(phase.phase));
        this.tracker?.skipPhase(phaseKey);
        continue;
      }

      this.activePhaseKey = phaseKey;

      // Only use saved iteration state for the phase that was active when checkpoint was saved
      if (phaseKey !== resumedPhaseKey) {
        this.phaseDraft = null;
        this.iterationProgress = {};
      }

      this.tracker?.activatePhase(phaseKey);

      switch (phase.phase) {
        case "spec":
          if (phase.condition === "noPlanProvided" && this.config.planProvided) {
            this.logger.info(msg.specSkippedPlan);
            ctx.spec = this.config.issueBody;
            this.tracker?.skipPhase(phaseKey);
            completedPhases.add(phaseKey);
            await saveProgress();
            continue;
          }
          ctx.spec = await this.executeSpec(phase, ctx, saveProgress);
          break;
        case "decompose":
          ctx.tasks = await this.executeDecompose(phase, ctx);
          break;
        case "design":
          ctx.designSpec = await this.executeDesign(phase, ctx, saveProgress);
          break;
        case "implement":
          ctx.streamResults = await this.executeImplement(phase, ctx, saveProgress);
          break;
        case "cross-model-review":
          ctx.streamResults = await this.executeCrossModelReview(phase, ctx, saveProgress);
          break;
        case "verify":
          await this.executeVerify(phase, ctx, saveProgress);
          break;
      }

      // Phase complete — clear iteration state and save phase-level checkpoint
      this.activePhaseKey = null;
      this.phaseDraft = null;
      this.iterationProgress = {};
      completedPhases.add(phaseKey);
      this.tracker?.completePhase(phaseKey);
      await saveProgress();
      this.logger.info(msg.checkpointSaved(phase.phase));
    }

    // Final summary
    this.logger.info(msg.swarmComplete);
    const timestamp = new Date().toISOString();
    const summary =
      `# Swarm Run Summary\n\n**Timestamp:** ${timestamp}\n**Tasks:** ${ctx.tasks.length}\n\n` +
      `${ctx.streamResults.map((r, i) => `## Stream ${i + 1}\n\n${r}`).join("\n\n---\n\n")}\n`;
    const dir = runDir(this.effectiveConfig);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "summary.md"), summary);

    // Update latest pointer
    const root = swarmRoot(this.effectiveConfig);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(latestPointerPath(this.effectiveConfig), this.effectiveConfig.runId);

    // Clean up checkpoint on successful completion
    await clearCheckpoint(this.effectiveConfig);
  }

  // --- SPEC PHASE ---

  private async executeSpec(phase: SpecPhaseConfig, ctx: PipelineContext, save: () => Promise<void>): Promise<string> {
    this.logger.info(msg.pmPhaseStart);
    this.logger.info(msg.pmDrafting);

    let spec: string;
    if (this.phaseDraft !== null) {
      spec = this.phaseDraft;
      this.logger.info(msg.draftResumed);
    } else {
      const prompt = ctx.repoAnalysis
        ? `## Repository Context\n\n${ctx.repoAnalysis}\n\n## Task\n\n${this.config.issueBody}`
        : this.config.issueBody;
      spec = await this.sessions.callIsolated(phase.agent, prompt, undefined, `spec`);
      this.phaseDraft = spec;
      await save();
    }

    for (let ri = 0; ri < phase.reviews.length; ri++) {
      const review = phase.reviews[ri];
      this.logger.info(msg.reviewPhase(review.agent));
      spec = await this.runReviewLoop(
        review,
        spec,
        phase.agent,
        (content) => `Review this specification:\n${content}`,
        `review-${ri}`,
        save,
      );
    }

    await writeRoleSummary(this.effectiveConfig, phase.agent, `## Final Specification\n\n${spec}`);
    return spec;
  }

  // --- DECOMPOSE PHASE ---

  private async executeDecompose(phase: DecomposePhaseConfig, ctx: PipelineContext): Promise<string[]> {
    this.logger.info(msg.taskDecomposition);
    const marker = phase.frontendMarker;
    const prompt =
      `Break this spec into independent, parallelizable JSON tasks. Use as many or as few tasks as the spec requires — ` +
      `a simple bug fix may be 1 task, a complex feature may be 5+. Each task should be self-contained and implementable ` +
      `independently. Mark frontend tasks with ${marker}. ` +
      `Respond with ONLY a JSON array, no other text. Format: ["${marker} Task 1", "Task 2"]\nSpec:\n${ctx.spec}`;
    const raw = await this.sessions.callIsolated(phase.agent, prompt, undefined, `decompose`);
    const tasks = parseJsonArray(raw);
    this.logger.info(msg.tasksResult(tasks));

    await writeRoleSummary(
      this.effectiveConfig,
      `${phase.agent}-tasks`,
      `## Decomposed Tasks\n\n${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    );
    return tasks;
  }

  // --- DESIGN PHASE ---

  private async executeDesign(
    phase: DesignPhaseConfig,
    ctx: PipelineContext,
    save: () => Promise<void>,
  ): Promise<string> {
    if (phase.condition === "hasFrontendTasks" && !hasFrontendWork(ctx.tasks)) {
      return ctx.designSpec;
    }

    this.logger.info(msg.designPhaseStart);
    const session = await this.sessions.createAgentSession(phase.agent, undefined, `design`);
    let sessionPrimed = false;

    try {
      let design: string;
      if (this.phaseDraft !== null) {
        design = this.phaseDraft;
        this.logger.info(msg.draftResumed);
      } else {
        this.logger.info(msg.designPhase);
        design = await this.sessions.send(
          session,
          `Create a detailed UI/UX design specification based on this spec:\n${ctx.spec}\n\n` +
            `Include: component hierarchy, layout, interactions, states, and accessibility considerations.`,
          `${phase.agent} is designing…`,
        );
        sessionPrimed = true;

        if (phase.clarificationAgent && responseContains(design, "CLARIFICATION_NEEDED")) {
          this.logger.info(msg.designerClarification);
          const clarification = await this.sessions.callIsolated(
            phase.clarificationAgent,
            `The designer needs clarification:\n${design}`,
            undefined,
            `design/clarify`,
          );
          design = await this.sessions.send(
            session,
            `PM Clarification:\n${clarification}\n\nRevise the design.`,
            `${phase.agent} is revising…`,
          );
        }

        this.phaseDraft = design;
        await save();
      }

      for (let ri = 0; ri < phase.reviews.length; ri++) {
        const review = phase.reviews[ri];
        this.logger.info(msg.reviewPhase(review.agent));
        const reviewKey = `review-${ri}`;
        const savedReview = this.iterationProgress[reviewKey];
        let startIter = 1;
        if (savedReview) {
          design = savedReview.content;
          startIter = savedReview.completedIterations + 1;
          this.logger.info(msg.iterationResumed(savedReview.completedIterations, review.maxIterations));
        }

        const maxIter = review.maxIterations;
        for (let i = startIter; i <= maxIter; i++) {
          this.logger.info(msg.reviewIteration(i, maxIter));
          const feedback = await this.sessions.callIsolated(
            review.agent,
            `Review this design specification:\n${design}`,
            undefined,
            `design/review-${ri}-${i}`,
          );
          if (responseContains(feedback, review.approvalKeyword)) {
            this.logger.info(msg.approved(review.agent));
            break;
          }

          // Build fix prompt — include current design if session has no prior context
          const contextPrefix = sessionPrimed ? "" : `Current design:\n${design}\n\n`;

          if (review.clarificationKeyword && responseContains(feedback, review.clarificationKeyword)) {
            const clarAgent = review.clarificationAgent ?? phase.clarificationAgent;
            if (clarAgent) {
              this.logger.info(msg.reviewerClarification);
              const clar = await this.sessions.callIsolated(
                clarAgent,
                `The design reviewer needs clarification:\n${feedback}`,
                undefined,
                `design/review-${ri}-${i}/clarify`,
              );
              design = await this.sessions.send(
                session,
                `${contextPrefix}Review feedback:\n${feedback}\n\nPM Clarification:\n${clar}\n\nRevise the design.`,
                `${phase.agent} is revising…`,
              );
            }
          } else {
            this.logger.info(msg.codeFeedback(feedback.substring(0, 80)));
            design = await this.sessions.send(
              session,
              `${contextPrefix}Review feedback:\n${feedback}\n\nRevise the design.`,
              `${phase.agent} is revising…`,
            );
          }
          sessionPrimed = true;

          this.iterationProgress[reviewKey] = { content: design, completedIterations: i };
          await save();
        }
      }

      await writeRoleSummary(this.effectiveConfig, phase.agent, design);
      return design;
    } finally {
      await session.destroy();
    }
  }

  // --- IMPLEMENT PHASE ---

  private async executeImplement(
    phase: ImplementPhaseConfig,
    ctx: PipelineContext,
    save: () => Promise<void>,
  ): Promise<string[]> {
    this.logger.info(msg.launchingStreams(ctx.tasks.length));
    this.tracker?.initStreams(ctx.tasks);

    // Pre-fill with any existing partial results from a previous run
    const results: string[] =
      ctx.streamResults.length === ctx.tasks.length ? [...ctx.streamResults] : new Array(ctx.tasks.length).fill("");

    const runStream = async (task: string, idx: number): Promise<string> => {
      // Skip streams that already have results (from a resumed checkpoint)
      if (results[idx]) {
        this.logger.info(msg.streamSkipped(msg.streamLabel(idx)));
        this.tracker?.updateStream(idx, "skipped");
        return results[idx];
      }

      const label = msg.streamLabel(idx);
      const streamKey = `stream-${idx}`;
      this.logger.info(msg.streamStart(label, task));

      const session = await this.sessions.createAgentSession(phase.agent, undefined, `implement/${streamKey}`);
      let sessionPrimed = false;

      try {
        let code: string;
        const savedCode = this.iterationProgress[`${streamKey}-code`];
        if (savedCode) {
          code = savedCode.content;
          this.logger.info(msg.draftResumed);
        } else {
          this.logger.info(msg.streamEngineering(label));
          this.tracker?.updateStream(idx, "engineering");

          let engineeringPrompt: string;
          const prevOutput = this.reviewContext?.streamResults[idx] ? this.reviewContext.streamResults[idx] : "";

          if (prevOutput) {
            // Review mode: engineer sees previous output + user feedback
            const base = isFrontendTask(task)
              ? `Spec:\n${ctx.spec}\n\nDesign:\n${ctx.designSpec}\n\nTask:\n${task}`
              : `Spec:\n${ctx.spec}\n\nTask:\n${task}`;
            engineeringPrompt =
              `${base}\n\n## Previous Implementation\n\n${prevOutput}\n\n` +
              `## Review Feedback\n\n${this.reviewFeedback}\n\n` +
              "Fix the issues described in the review feedback. Keep everything that works correctly, " +
              "only change what needs to be fixed or improved.";
          } else {
            engineeringPrompt = isFrontendTask(task)
              ? `Spec:\n${ctx.spec}\n\nDesign:\n${ctx.designSpec}\n\nTask:\n${task}\n\nImplement this task.`
              : `Spec:\n${ctx.spec}\n\nTask:\n${task}\n\nImplement this task.`;
          }
          code = await this.sessions.send(session, engineeringPrompt, `${phase.agent} (${label}) is implementing…`);
          sessionPrimed = true;

          // Engineer-to-PM clarification: if the engineer signals ambiguity, consult the PM
          if (
            phase.clarificationAgent &&
            phase.clarificationKeyword &&
            responseContains(code, phase.clarificationKeyword)
          ) {
            this.logger.info(msg.streamClarification(label));
            const clarification = await this.sessions.callIsolated(
              phase.clarificationAgent,
              `Spec:\n${ctx.spec}\n\nThe engineer working on task "${task}" needs clarification:\n\n${code}`,
              undefined,
              `implement/${streamKey}/clarify`,
            );
            code = await this.sessions.send(
              session,
              `PM Clarification:\n${clarification}\n\nProceed with the implementation using this clarification.`,
              `${phase.agent} (${label}) is implementing with clarification…`,
            );
          }

          this.iterationProgress[`${streamKey}-code`] = { content: code, completedIterations: 0 };
          await save();
        }

        // Reviews
        for (let ri = 0; ri < phase.reviews.length; ri++) {
          const review = phase.reviews[ri];
          const reviewKey = `${streamKey}-review-${ri}`;
          const savedReview = this.iterationProgress[reviewKey];
          let startIter = 1;
          if (savedReview) {
            code = savedReview.content;
            startIter = savedReview.completedIterations + 1;
            this.logger.info(msg.iterationResumed(savedReview.completedIterations, review.maxIterations));
          }

          this.logger.info(msg.streamCodeReview(label, review.agent));
          this.tracker?.updateStream(idx, "reviewing");
          const maxIter = review.maxIterations;
          for (let i = startIter; i <= maxIter; i++) {
            this.logger.info(msg.reviewIteration(i, maxIter));
            const feedback = await this.sessions.callIsolated(
              review.agent,
              `Review this implementation:\n${code}`,
              undefined,
              `implement/${streamKey}/review-${ri}-${i}`,
            );
            if (responseContains(feedback, review.approvalKeyword)) {
              this.logger.info(msg.codeApproved);
              break;
            }
            this.logger.info(msg.codeFeedback(feedback.substring(0, 80)));
            const contextPrefix = sessionPrimed ? "" : `Current implementation:\n${code}\n\n`;
            code = await this.sessions.send(
              session,
              `${contextPrefix}Code review feedback:\n${feedback}\n\nFix all issues.`,
              `${phase.agent} (${label}) is fixing…`,
            );
            sessionPrimed = true;

            this.iterationProgress[reviewKey] = { content: code, completedIterations: i };
            await save();
          }
        }

        // QA
        if (phase.qa) {
          const qaKey = `${streamKey}-qa`;
          const savedQa = this.iterationProgress[qaKey];
          let startQa = 1;
          if (savedQa) {
            code = savedQa.content;
            startQa = savedQa.completedIterations + 1;
            this.logger.info(msg.iterationResumed(savedQa.completedIterations, phase.qa.maxIterations));
          }

          this.logger.info(msg.streamQa(label));
          this.tracker?.updateStream(idx, "testing");
          const maxQa = phase.qa.maxIterations;
          for (let i = startQa; i <= maxQa; i++) {
            this.logger.info(msg.qaIteration(i, maxQa));
            const testReport = await this.sessions.callIsolated(
              phase.qa.agent,
              `Spec:\n${ctx.spec}\n\nImplementation:\n${code}\n\nValidate the implementation against the spec.`,
              undefined,
              `implement/${streamKey}/qa-${i}`,
            );
            if (responseContains(testReport, phase.qa.approvalKeyword)) {
              this.logger.info(msg.allTestsPassed);
              break;
            }
            this.logger.info(msg.defectsFound);
            const contextPrefix = sessionPrimed ? "" : `Current implementation:\n${code}\n\n`;
            code = await this.sessions.send(
              session,
              `${contextPrefix}QA Report:\n${testReport}\n\nFix all reported issues.`,
              `${phase.agent} (${label}) is fixing defects…`,
            );
            sessionPrimed = true;

            this.iterationProgress[qaKey] = { content: code, completedIterations: i };
            await save();
          }
        }

        await writeRoleSummary(this.effectiveConfig, `engineer-stream-${idx + 1}`, code);
        this.tracker?.updateStream(idx, "done");

        // Save completed stream result
        results[idx] = code;
        await save();

        return code;
      } finally {
        await session.destroy();
      }
    };

    if (phase.parallel) {
      const settled = await Promise.allSettled(ctx.tasks.map((task, idx) => runStream(task, idx)));
      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failures.length > 0) {
        this.logger.warn(msg.partialStreamFailure(failures.length, settled.length));
        await save();
        throw new Error(`${failures.length}/${settled.length} streams failed. Use --resume to retry failed streams.`);
      }
      return results;
    }
    for (let i = 0; i < ctx.tasks.length; i++) {
      results[i] = await runStream(ctx.tasks[i], i);
    }
    return results;
  }

  // --- CROSS-MODEL REVIEW ---

  private async executeCrossModelReview(
    phase: CrossModelReviewPhaseConfig,
    ctx: PipelineContext,
    save: () => Promise<void>,
  ): Promise<string[]> {
    if (phase.condition === "differentReviewModel" && this.pipeline.reviewModel === this.pipeline.primaryModel) {
      this.logger.info(msg.crossModelSkipped);
      return ctx.streamResults;
    }

    this.logger.info(msg.crossModelStart(this.pipeline.reviewModel));
    const maxIter = phase.maxIterations;

    const reviewed = await Promise.all(
      ctx.streamResults.map(async (code, idx) => {
        const label = msg.streamLabel(idx);
        const cmKey = `cross-model-${idx}`;
        const savedCm = this.iterationProgress[cmKey];
        let startIter = 1;
        if (savedCm) {
          code = savedCm.content;
          startIter = savedCm.completedIterations + 1;
          this.logger.info(msg.iterationResumed(savedCm.completedIterations, maxIter));
        }

        this.logger.info(msg.crossModelStreamReview(label));

        let current = code;
        for (let i = startIter; i <= maxIter; i++) {
          this.logger.info(msg.crossModelIteration(i, maxIter, this.pipeline.reviewModel));
          const feedback = await this.sessions.callIsolated(
            phase.agent,
            `Spec:\n${ctx.spec}\n\n` +
              `Review this implementation for bugs, security issues, and spec compliance. ` +
              `You are using a different model than the one that wrote this code — focus on catching real problems, ` +
              `not style preferences.\n\n` +
              `Implementation:\n${current}`,
            this.pipeline.reviewModel,
            `cross-model/stream-${idx}/review-${i}`,
          );
          if (responseContains(feedback, phase.approvalKeyword)) {
            this.logger.info(msg.crossModelApproved);
            break;
          }
          this.logger.info(msg.crossModelIssues);
          current = await this.sessions.callIsolated(
            phase.fixAgent,
            `You are fixing specific issues found during a cross-model code review. ` +
              `Do NOT rewrite or restructure the code. Only fix the exact issues listed below.\n\n` +
              `Spec:\n${ctx.spec}\n\n` +
              `Cross-model review feedback:\n${feedback}\n\n` +
              `Current implementation:\n${current}\n\n` +
              `Fix ONLY the issues listed in the review feedback above. ` +
              `Keep everything that works correctly — do not refactor, rename, or reorganize anything beyond what is needed to address the reported issues.`,
            undefined,
            `cross-model/stream-${idx}/fix-${i}`,
          );

          this.iterationProgress[cmKey] = { content: current, completedIterations: i };
          await save();
        }
        return current;
      }),
    );

    await writeRoleSummary(
      this.effectiveConfig,
      "cross-model-review",
      reviewed.map((r, i) => `## Stream ${i + 1}\n\n${r}`).join("\n\n---\n\n"),
    );
    return reviewed;
  }

  // --- GENERIC REVIEW LOOP ---

  private async runReviewLoop(
    review: ReviewStepConfig,
    content: string,
    authorAgent: string,
    buildPrompt: (content: string) => string,
    progressKey: string,
    save: () => Promise<void>,
  ): Promise<string> {
    const maxIter = review.maxIterations;
    let current = content;

    const saved = this.iterationProgress[progressKey];
    let startIter = 1;
    if (saved) {
      current = saved.content;
      startIter = saved.completedIterations + 1;
      this.logger.info(msg.iterationResumed(saved.completedIterations, maxIter));
    }

    for (let i = startIter; i <= maxIter; i++) {
      this.logger.info(msg.reviewIteration(i, maxIter));
      const feedback = await this.sessions.callIsolated(
        review.agent,
        buildPrompt(current),
        undefined,
        `${progressKey}/reviewer`,
      );
      if (responseContains(feedback, review.approvalKeyword)) {
        this.logger.info(msg.approved(review.agent));
        break;
      }
      this.logger.info(msg.feedbackReceived(feedback.substring(0, 80)));
      current = await this.sessions.callIsolated(
        authorAgent,
        `Previous content:\n${current}\n\nReview feedback:\n${feedback}\n\nRevise accordingly.`,
        undefined,
        `${progressKey}/revision-${i}`,
      );

      this.iterationProgress[progressKey] = { content: current, completedIterations: i };
      await save();
    }
    return current;
  }

  // --- VERIFY PHASE ---

  /**
   * Resolve verification commands with priority: CLI flags > YAML config > auto-detect.
   * For greenfield projects, re-detects after implementation.
   */
  private resolveVerifyCommands(): VerifyConfig | null {
    const cli = this.config.verifyOverrides;
    const yaml = this.pipeline.verify;
    const detected = detectVerifyCommands(this.config.repoRoot);

    // Merge with priority: CLI > YAML > auto-detect
    const build = cli?.build ?? yaml?.build ?? detected?.build;
    const test = cli?.test ?? yaml?.test ?? detected?.test;
    const lint = cli?.lint ?? yaml?.lint ?? detected?.lint;

    if (!build && !test && !lint) return null;
    return { build, test, lint };
  }

  /**
   * Run a shell command and return { success, output }.
   * Captures both stdout and stderr.
   */
  private runShellCommand(command: string): { success: boolean; output: string } {
    try {
      const output = execSync(command, {
        cwd: this.config.repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 300_000, // 5 minute timeout per command
      });
      return { success: true, output };
    } catch (err: unknown) {
      const execError = err as { stdout?: string; stderr?: string; message?: string };
      const output = [execError.stdout ?? "", execError.stderr ?? ""].filter(Boolean).join("\n");
      return { success: false, output: output || execError.message || "Command failed" };
    }
  }

  private async executeVerify(
    phase: VerifyPhaseConfig,
    ctx: PipelineContext,
    save: () => Promise<void>,
  ): Promise<void> {
    // Resolve commands — for greenfield, project files now exist after implement
    const commands = this.resolveVerifyCommands();
    if (!commands) {
      this.logger.info(msg.verifySkipped);
      return;
    }

    this.logger.info(msg.verifyStart);

    const savedVerify = this.iterationProgress.verify;
    let startIter = 1;
    if (savedVerify) {
      startIter = savedVerify.completedIterations + 1;
      this.logger.info(msg.iterationResumed(savedVerify.completedIterations, phase.maxIterations));
    }

    for (let i = startIter; i <= phase.maxIterations; i++) {
      this.logger.info(msg.verifyIteration(i, phase.maxIterations));

      // Run all configured commands and collect failures
      const failures: { command: string; label: string; output: string }[] = [];

      for (const [label, cmd] of Object.entries(commands) as [string, string | undefined][]) {
        if (!cmd) continue;
        this.logger.info(msg.verifyRunning(label, cmd));
        const result = this.runShellCommand(cmd);
        if (result.success) {
          this.logger.info(msg.verifyCommandPassed(label));
        } else {
          this.logger.warn(msg.verifyCommandFailed(label));
          failures.push({ command: cmd, label, output: result.output });
        }
      }

      if (failures.length === 0) {
        this.logger.info(msg.verifyAllPassed);
        return;
      }

      // Last iteration — report failures but don't try to fix
      if (i === phase.maxIterations) {
        this.logger.warn(msg.verifyExhausted(phase.maxIterations));
        await writeRoleSummary(
          this.effectiveConfig,
          "verify-failures",
          `## Verification Failures (after ${phase.maxIterations} attempts)\n\n` +
            failures.map((f) => `### ${f.label}: \`${f.command}\`\n\`\`\`\n${f.output}\n\`\`\``).join("\n\n"),
        );
        return;
      }

      // Feed errors to fix agent
      this.logger.info(msg.verifyFixing(failures.length));
      const errorReport = failures
        .map((f) => `## ${f.label}: \`${f.command}\`\n\`\`\`\n${f.output}\n\`\`\``)
        .join("\n\n");

      const allCode = ctx.streamResults.join("\n\n---\n\n");
      await this.sessions.callIsolated(
        phase.fixAgent,
        `The following verification commands failed after implementing the spec.\n\n` +
          `Spec:\n${ctx.spec}\n\n` +
          `Implementation:\n${allCode}\n\n` +
          `## Failures\n\n${errorReport}\n\n` +
          `Fix the issues causing these failures. Only change what is needed to make the commands pass.`,
        undefined,
        `verify/fix-${i}`,
      );

      this.iterationProgress.verify = { content: "fix-attempted", completedIterations: i };
      await save();
    }
  }
}
