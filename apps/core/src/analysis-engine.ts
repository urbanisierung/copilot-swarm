import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearCheckpoint, type IterationSnapshot, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { responseContains } from "./utils.js";

const MAX_REVIEW_ITERATIONS = 3;
const APPROVAL_KEYWORD = "ANALYSIS_APPROVED";

const ARCHITECT_INSTRUCTIONS = `You are a Senior Software Architect producing a concise repository context document.
Your goal is to explore the repository thoroughly and create a structured analysis that gives an LLM everything it needs to understand and contribute to this codebase.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the repository exhaustively. Read key config files, entry points, and representative source files.
2. Produce a Markdown document with EXACTLY these sections:

## Overview
One paragraph: what this project does, who it's for, and its current state.

## Tech Stack
Bullet list: language(s), runtime, framework(s), package manager, build system, test framework, linter/formatter, CI/CD.

## Repository Structure
- Type: monorepo / single-package / multi-package
- Directory tree (top 2 levels) with one-line descriptions for each key directory
- Entry points and their roles

## Architecture
- High-level component diagram (describe in text: what components exist and how they interact)
- Key abstractions and patterns (e.g., dependency injection, event-driven, pipeline pattern)
- Data flow: how does a request/command flow through the system?

## Key Files Reference
Table: file path | purpose | key exports/interfaces (only the most important 10-15 files)

## Commands
Table: command | description (build, test, lint, format, typecheck, dev, etc.)

## Patterns & Conventions
- Naming conventions (files, variables, types)
- Testing patterns (where tests live, naming, utilities)
- Error handling approach
- Documentation conventions
- Import/module conventions

## How to Implement a New Feature
Step-by-step guide specific to this repo: where to add files, what to update, how to test, what conventions to follow. Reference actual file paths and patterns from the codebase.

## Dependencies
Key runtime dependencies and what they're used for (not devDependencies).

3. Be precise and factual. Every claim must be based on files you actually read.
4. Keep it concise — this document should be under 500 lines. Prioritize the most important information.
5. Do NOT include code snippets longer than 3 lines. Reference file paths instead.`;

const REVIEWER_INSTRUCTIONS = `You are a Senior Software Engineer reviewing a repository analysis document.
Your goal is to verify the analysis is accurate, complete, and useful for an LLM that needs to understand this codebase.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to independently verify claims in the document. Spot-check at least 5 specific claims.
2. Check for:
   - **Accuracy:** Are file paths, command names, and descriptions correct?
   - **Completeness:** Are critical files, patterns, or conventions missing?
   - **Clarity:** Would an LLM be able to implement a feature using only this document as context?
   - **"How to Implement" section:** Is the step-by-step guide actionable and complete?
   - **Conciseness:** Is there unnecessary detail that bloats the document?
3. Decision:
   - If the analysis is accurate, complete, and useful, respond with **${APPROVAL_KEYWORD}**.
   - If there are issues, provide a numbered list of specific corrections or additions needed. Be precise about what's wrong and what the fix should be.`;

export class AnalysisEngine {
  private readonly sessions: SessionManager;
  private activePhaseKey: string | null = null;
  private iterationProgress: Record<string, IterationSnapshot> = {};

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
  ) {
    this.sessions = new SessionManager(config, pipeline, logger);
    if (tracker) this.sessions.setTracker(tracker);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.analyzeStart);

    const useCrossModel = this.pipeline.reviewModel !== this.pipeline.primaryModel;

    const phases: { phase: string }[] = [{ phase: "analyze-architect" }, { phase: "analyze-review" }];
    if (useCrossModel) {
      phases.push({ phase: "analyze-architect" }, { phase: "analyze-review" });
    }
    this.tracker?.initPhases(phases);

    // State
    const completedPhases = new Set<string>();
    let analysis = "";
    let resumedPhaseKey: string | null = null;

    // Resume from checkpoint
    if (this.config.resume) {
      const cp = await loadCheckpoint(this.config);
      if (cp?.mode === "analyze") {
        this.logger.info(msg.resuming(cp.completedPhases.length));
        for (const p of cp.completedPhases) {
          completedPhases.add(p);
          this.tracker?.completePhase(p);
        }
        analysis = cp.analysis || "";
        if (cp.activePhase) {
          resumedPhaseKey = cp.activePhase;
          this.iterationProgress = cp.iterationProgress ?? {};
          if (cp.sessionLog) {
            Object.assign(this.sessions.sessionLog, cp.sessionLog);
          }
        }
      } else {
        this.logger.info(msg.noCheckpoint);
      }
    }

    const saveProgress = async () => {
      await saveCheckpoint(this.config, {
        mode: "analyze",
        completedPhases: [...completedPhases],
        analysis,
        issueBody: "",
        runId: this.config.runId,
        spec: "",
        tasks: [],
        designSpec: "",
        streamResults: [],
        activePhase: this.activePhaseKey ?? undefined,
        iterationProgress: Object.keys(this.iterationProgress).length > 0 ? this.iterationProgress : undefined,
        sessionLog: Object.keys(this.sessions.sessionLog).length > 0 ? this.sessions.sessionLog : undefined,
      });
    };

    // Phase 1: Primary model — architect drafts, senior engineer reviews
    const archKey0 = "analyze-architect-0";
    const reviewKey1 = "analyze-review-1";
    if (completedPhases.has(archKey0)) {
      this.logger.info(msg.phaseSkipped("analyze-architect"));
    } else {
      this.tracker?.activatePhase(archKey0);
      this.activePhaseKey = archKey0;
      if (archKey0 !== resumedPhaseKey) this.iterationProgress = {};
      analysis = await this.runArchitectReviewLoop(this.pipeline.primaryModel, archKey0, saveProgress);
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(archKey0);
      completedPhases.add(reviewKey1);
      this.tracker?.completePhase(archKey0);
      this.tracker?.completePhase(reviewKey1);
      await saveProgress();
    }

    // Phase 2: Cross-model — same flow with the review model
    if (useCrossModel) {
      const archKey2 = "analyze-architect-2";
      const reviewKey3 = "analyze-review-3";
      if (completedPhases.has(archKey2)) {
        this.logger.info(msg.phaseSkipped("analyze-architect"));
      } else {
        this.tracker?.activatePhase(archKey2);
        this.activePhaseKey = archKey2;
        if (archKey2 !== resumedPhaseKey) this.iterationProgress = {};
        analysis = await this.runArchitectReviewLoop(this.pipeline.reviewModel, archKey2, saveProgress, analysis);
        this.activePhaseKey = null;
        this.iterationProgress = {};
        completedPhases.add(archKey2);
        completedPhases.add(reviewKey3);
        this.tracker?.completePhase(archKey2);
        this.tracker?.completePhase(reviewKey3);
        await saveProgress();
      }
    }

    // Save result
    const dir = analysisDir(this.config);
    await fs.mkdir(dir, { recursive: true });
    const outputPath = path.join(dir, "repo-analysis.md");
    await fs.writeFile(outputPath, analysis);

    // Clear checkpoint on success
    await clearCheckpoint(this.config);

    this.logger.info(msg.analyzeComplete);
    this.logger.info(msg.analyzeSaved(path.relative(this.config.repoRoot, outputPath)));
  }

  private async runArchitectReviewLoop(
    model: string,
    phaseKey: string,
    saveProgress: () => Promise<void>,
    existingAnalysis?: string,
  ): Promise<string> {
    // Architect produces or refines the analysis
    this.logger.info(msg.analyzeArchitectPhase(model));

    // Resume: check for draft from a previous run
    const draftProgress = this.iterationProgress[`${phaseKey}-draft`];
    let analysis: string;

    if (draftProgress) {
      analysis = draftProgress.content;
      this.logger.info(msg.iterationResumed(0, MAX_REVIEW_ITERATIONS));
    } else {
      const architectSession = await this.sessions.createSessionWithInstructions(ARCHITECT_INSTRUCTIONS, model);
      try {
        if (existingAnalysis) {
          analysis = await this.sessions.send(
            architectSession,
            "Here is a repository analysis produced by a different model. " +
              "Independently explore the repository and verify, correct, and improve this analysis. " +
              "Produce the final revised document.\n\n" +
              `Existing analysis:\n\n${existingAnalysis}`,
            `Architect is analyzing repository (${model})…`,
          );
        } else {
          analysis = await this.sessions.send(
            architectSession,
            "Explore this repository thoroughly and produce a complete repository analysis document following your instructions.",
            `Architect is analyzing repository (${model})…`,
          );
        }
      } finally {
        await architectSession.destroy();
      }

      // Save draft checkpoint
      this.iterationProgress[`${phaseKey}-draft`] = { content: analysis, completedIterations: 0 };
      await saveProgress();
    }

    // Review loop
    this.logger.info(msg.analyzeReviewPhase(model));

    const reviewProgressKey = `${phaseKey}-review`;
    const progress = this.iterationProgress[reviewProgressKey];
    let startIteration = 1;
    if (progress) {
      analysis = progress.content;
      startIteration = progress.completedIterations + 1;
      this.logger.info(msg.iterationResumed(progress.completedIterations, MAX_REVIEW_ITERATIONS));
    }

    for (let i = startIteration; i <= MAX_REVIEW_ITERATIONS; i++) {
      this.logger.info(msg.analyzeIteration(i, MAX_REVIEW_ITERATIONS));

      const feedback = await this.sessions.callIsolatedWithInstructions(
        REVIEWER_INSTRUCTIONS,
        `Review this repository analysis document:\n\n${analysis}`,
        `Senior engineer is reviewing (${model})…`,
        model,
        `${reviewProgressKey}/reviewer-${i}`,
      );

      if (responseContains(feedback, APPROVAL_KEYWORD)) {
        this.logger.info(msg.analyzeApproved);
        break;
      }

      this.logger.info(msg.analyzeFeedback(feedback.substring(0, 80)));

      const revision = await this.sessions.callIsolatedWithInstructions(
        ARCHITECT_INSTRUCTIONS +
          "\n\n**CRITICAL:** You are revising an existing analysis based on reviewer feedback. " +
          "Output the COMPLETE revised document — do NOT output a summary or changelog.",
        `Current analysis:\n\n${analysis}\n\nReviewer feedback:\n\n${feedback}\n\nRevise the analysis to address all issues. Output the COMPLETE document.`,
        `Architect is revising analysis (${model})…`,
        model,
        `${reviewProgressKey}/revision-${i}`,
      );

      analysis = revision;

      // Save iteration progress
      this.iterationProgress[reviewProgressKey] = { content: analysis, completedIterations: i };
      await saveProgress();
    }

    return analysis;
  }
}
