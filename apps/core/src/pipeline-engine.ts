import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { latestPointerPath, runDir, swarmRoot } from "./paths.js";
import type {
  CrossModelReviewPhaseConfig,
  DecomposePhaseConfig,
  DesignPhaseConfig,
  ImplementPhaseConfig,
  PipelineConfig,
  ReviewStepConfig,
  SpecPhaseConfig,
} from "./pipeline-types.js";
import { SessionManager } from "./session.js";
import { hasFrontendWork, isFrontendTask, parseJsonArray, responseContains, writeRoleSummary } from "./utils.js";

/** Shared context that flows between phases. */
interface PipelineContext {
  spec: string;
  tasks: string[];
  designSpec: string;
  streamResults: string[];
}

export class PipelineEngine {
  private readonly sessions: SessionManager;
  private effectiveConfig: SwarmConfig;

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
  ) {
    this.effectiveConfig = config;
    this.sessions = new SessionManager(config, pipeline, logger);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.configLoaded(this.pipeline.primaryModel, this.pipeline.reviewModel, this.config.verbose));

    let ctx: PipelineContext = { spec: "", tasks: [], designSpec: "", streamResults: [] };
    let completedPhases: Set<string> = new Set();

    // Resume from checkpoint if requested
    if (this.config.resume) {
      const checkpoint = await loadCheckpoint(this.config);
      if (checkpoint) {
        // Use the same runId so files go to the same run directory
        if (checkpoint.runId) {
          this.effectiveConfig = { ...this.config, runId: checkpoint.runId };
        }
        ctx = {
          spec: checkpoint.spec,
          tasks: checkpoint.tasks,
          designSpec: checkpoint.designSpec,
          streamResults: checkpoint.streamResults,
        };
        completedPhases = new Set(checkpoint.completedPhases);
        this.logger.info(msg.resuming(completedPhases.size));
      } else {
        this.logger.warn(msg.noCheckpoint);
      }
    }

    for (const phase of this.pipeline.pipeline) {
      const phaseKey = `${phase.phase}-${this.pipeline.pipeline.indexOf(phase)}`;

      if (completedPhases.has(phaseKey)) {
        this.logger.info(msg.phaseSkipped(phase.phase));
        continue;
      }

      switch (phase.phase) {
        case "spec":
          ctx.spec = await this.executeSpec(phase);
          break;
        case "decompose":
          ctx.tasks = await this.executeDecompose(phase, ctx);
          break;
        case "design":
          ctx.designSpec = await this.executeDesign(phase, ctx);
          break;
        case "implement":
          ctx.streamResults = await this.executeImplement(phase, ctx);
          break;
        case "cross-model-review":
          ctx.streamResults = await this.executeCrossModelReview(phase, ctx);
          break;
      }

      completedPhases.add(phaseKey);
      await saveCheckpoint(this.effectiveConfig, {
        completedPhases: [...completedPhases],
        spec: ctx.spec,
        tasks: ctx.tasks,
        designSpec: ctx.designSpec,
        streamResults: ctx.streamResults,
        issueBody: this.effectiveConfig.issueBody,
        runId: this.effectiveConfig.runId,
      });
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

  private async executeSpec(phase: SpecPhaseConfig): Promise<string> {
    this.logger.info(msg.pmPhaseStart);
    this.logger.info(msg.pmDrafting);

    let spec = await this.sessions.callIsolated(phase.agent, this.config.issueBody);

    for (const review of phase.reviews) {
      this.logger.info(msg.reviewPhase(review.agent));
      spec = await this.runReviewLoop(review, spec, phase.agent, (content) => `Review this specification:\n${content}`);
    }

    await writeRoleSummary(this.effectiveConfig, phase.agent, `## Final Specification\n\n${spec}`);
    return spec;
  }

  // --- DECOMPOSE PHASE ---

  private async executeDecompose(phase: DecomposePhaseConfig, ctx: PipelineContext): Promise<string[]> {
    this.logger.info(msg.taskDecomposition);
    const marker = phase.frontendMarker;
    const prompt =
      `Break this spec into 2-3 independent JSON tasks. Mark frontend tasks with ${marker}. ` +
      `Respond with ONLY a JSON array, no other text. Format: ["${marker} Task 1", "Task 2"]\nSpec:\n${ctx.spec}`;
    const raw = await this.sessions.callIsolated(phase.agent, prompt);
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

  private async executeDesign(phase: DesignPhaseConfig, ctx: PipelineContext): Promise<string> {
    if (phase.condition === "hasFrontendTasks" && !hasFrontendWork(ctx.tasks)) {
      return ctx.designSpec;
    }

    this.logger.info(msg.designPhaseStart);
    const session = await this.sessions.createAgentSession(phase.agent);

    try {
      this.logger.info(msg.designPhase);
      let design = await this.sessions.send(
        session,
        `Create a detailed UI/UX design specification based on this spec:\n${ctx.spec}\n\n` +
          `Include: component hierarchy, layout, interactions, states, and accessibility considerations.`,
        `${phase.agent} is designing…`,
      );

      if (phase.clarificationAgent && responseContains(design, "CLARIFICATION_NEEDED")) {
        this.logger.info(msg.designerClarification);
        const clarification = await this.sessions.callIsolated(
          phase.clarificationAgent,
          `The designer needs clarification:\n${design}`,
        );
        design = await this.sessions.send(
          session,
          `PM Clarification:\n${clarification}\n\nRevise the design.`,
          `${phase.agent} is revising…`,
        );
      }

      for (const review of phase.reviews) {
        this.logger.info(msg.reviewPhase(review.agent));
        const maxIter = review.maxIterations;
        for (let i = 1; i <= maxIter; i++) {
          this.logger.info(msg.reviewIteration(i, maxIter));
          const feedback = await this.sessions.callIsolated(
            review.agent,
            `Review this design specification:\n${design}`,
          );
          if (responseContains(feedback, review.approvalKeyword)) {
            this.logger.info(msg.approved(review.agent));
            break;
          }
          if (review.clarificationKeyword && responseContains(feedback, review.clarificationKeyword)) {
            const clarAgent = review.clarificationAgent ?? phase.clarificationAgent;
            if (clarAgent) {
              this.logger.info(msg.reviewerClarification);
              const clar = await this.sessions.callIsolated(
                clarAgent,
                `The design reviewer needs clarification:\n${feedback}`,
              );
              design = await this.sessions.send(
                session,
                `Review feedback:\n${feedback}\n\nPM Clarification:\n${clar}\n\nRevise the design.`,
                `${phase.agent} is revising…`,
              );
            }
          } else {
            this.logger.info(msg.codeFeedback(feedback.substring(0, 80)));
            design = await this.sessions.send(
              session,
              `Review feedback:\n${feedback}\n\nRevise the design.`,
              `${phase.agent} is revising…`,
            );
          }
        }
      }

      await writeRoleSummary(this.effectiveConfig, phase.agent, design);
      return design;
    } finally {
      await session.destroy();
    }
  }

  // --- IMPLEMENT PHASE ---

  private async executeImplement(phase: ImplementPhaseConfig, ctx: PipelineContext): Promise<string[]> {
    this.logger.info(msg.launchingStreams(ctx.tasks.length));

    // Pre-fill with any existing partial results from a previous run
    const results: string[] =
      ctx.streamResults.length === ctx.tasks.length ? [...ctx.streamResults] : new Array(ctx.tasks.length).fill("");

    const runStream = async (task: string, idx: number): Promise<string> => {
      // Skip streams that already have results (from a resumed checkpoint)
      if (results[idx]) {
        this.logger.info(msg.streamSkipped(msg.streamLabel(idx)));
        return results[idx];
      }

      const label = msg.streamLabel(idx);
      this.logger.info(msg.streamStart(label, task));

      const session = await this.sessions.createAgentSession(phase.agent);
      try {
        this.logger.info(msg.streamEngineering(label));
        const engineeringPrompt = isFrontendTask(task)
          ? `Spec:\n${ctx.spec}\n\nDesign:\n${ctx.designSpec}\n\nTask:\n${task}\n\nImplement this task.`
          : `Spec:\n${ctx.spec}\n\nTask:\n${task}\n\nImplement this task.`;
        let code = await this.sessions.send(session, engineeringPrompt, `${phase.agent} (${label}) is implementing…`);

        // Reviews
        for (const review of phase.reviews) {
          this.logger.info(msg.streamCodeReview(label, review.agent));
          const maxIter = review.maxIterations;
          for (let i = 1; i <= maxIter; i++) {
            this.logger.info(msg.reviewIteration(i, maxIter));
            const feedback = await this.sessions.callIsolated(review.agent, `Review this implementation:\n${code}`);
            if (responseContains(feedback, review.approvalKeyword)) {
              this.logger.info(msg.codeApproved);
              break;
            }
            this.logger.info(msg.codeFeedback(feedback.substring(0, 80)));
            code = await this.sessions.send(
              session,
              `Code review feedback:\n${feedback}\n\nFix all issues.`,
              `${phase.agent} (${label}) is fixing…`,
            );
          }
        }

        // QA
        if (phase.qa) {
          this.logger.info(msg.streamQa(label));
          const maxQa = phase.qa.maxIterations;
          for (let i = 1; i <= maxQa; i++) {
            this.logger.info(msg.qaIteration(i, maxQa));
            const testReport = await this.sessions.callIsolated(
              phase.qa.agent,
              `Spec:\n${ctx.spec}\n\nImplementation:\n${code}\n\nValidate the implementation against the spec.`,
            );
            if (responseContains(testReport, phase.qa.approvalKeyword)) {
              this.logger.info(msg.allTestsPassed);
              break;
            }
            this.logger.info(msg.defectsFound);
            code = await this.sessions.send(
              session,
              `QA Report:\n${testReport}\n\nFix all reported issues.`,
              `${phase.agent} (${label}) is fixing defects…`,
            );
          }
        }

        await writeRoleSummary(this.effectiveConfig, `engineer-stream-${idx + 1}`, code);

        // Save intermediate progress so completed streams survive a crash
        results[idx] = code;
        await saveCheckpoint(this.effectiveConfig, {
          completedPhases: [],
          spec: ctx.spec,
          tasks: ctx.tasks,
          designSpec: ctx.designSpec,
          streamResults: results,
          issueBody: this.effectiveConfig.issueBody,
          runId: this.effectiveConfig.runId,
        });

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
        // Save partial results before re-throwing so --resume can pick up completed streams
        await saveCheckpoint(this.effectiveConfig, {
          completedPhases: [],
          spec: ctx.spec,
          tasks: ctx.tasks,
          designSpec: ctx.designSpec,
          streamResults: results,
          issueBody: this.effectiveConfig.issueBody,
          runId: this.effectiveConfig.runId,
        });
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

  private async executeCrossModelReview(phase: CrossModelReviewPhaseConfig, ctx: PipelineContext): Promise<string[]> {
    if (phase.condition === "differentReviewModel" && this.pipeline.reviewModel === this.pipeline.primaryModel) {
      this.logger.info(msg.crossModelSkipped);
      return ctx.streamResults;
    }

    this.logger.info(msg.crossModelStart(this.pipeline.reviewModel));
    const maxIter = phase.maxIterations;

    const reviewed = await Promise.all(
      ctx.streamResults.map(async (code, idx) => {
        const label = msg.streamLabel(idx);
        this.logger.info(msg.crossModelStreamReview(label));

        let current = code;
        for (let i = 1; i <= maxIter; i++) {
          this.logger.info(msg.crossModelIteration(i, maxIter, this.pipeline.reviewModel));
          const feedback = await this.sessions.callIsolated(
            phase.agent,
            `Spec:\n${ctx.spec}\n\nReview this implementation from scratch. ` +
              `You are using a different model than the one that wrote this code — look for blind spots.\n\n` +
              `Implementation:\n${current}`,
            this.pipeline.reviewModel,
          );
          if (responseContains(feedback, phase.approvalKeyword)) {
            this.logger.info(msg.crossModelApproved);
            break;
          }
          this.logger.info(msg.crossModelIssues);
          current = await this.sessions.callIsolated(
            phase.fixAgent,
            `Cross-model review feedback:\n${feedback}\n\nOriginal implementation:\n${current}\n\nFix all reported issues.`,
          );
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
  ): Promise<string> {
    const maxIter = review.maxIterations;
    let current = content;

    for (let i = 1; i <= maxIter; i++) {
      this.logger.info(msg.reviewIteration(i, maxIter));
      const feedback = await this.sessions.callIsolated(review.agent, buildPrompt(current));
      if (responseContains(feedback, review.approvalKeyword)) {
        this.logger.info(msg.approved(review.agent));
        break;
      }
      this.logger.info(msg.feedbackReceived(feedback.substring(0, 80)));
      current = await this.sessions.callIsolated(
        authorAgent,
        `Previous content:\n${current}\n\nReview feedback:\n${feedback}\n\nRevise accordingly.`,
      );
    }
    return current;
  }
}
