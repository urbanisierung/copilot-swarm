import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
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

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
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
    this.logger.info(msg.configLoaded(this.pipeline.primaryModel, this.pipeline.reviewModel, this.config.verbose));

    const ctx: PipelineContext = { spec: "", tasks: [], designSpec: "", streamResults: [] };

    for (const phase of this.pipeline.pipeline) {
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
    }

    // Final summary
    this.logger.info(msg.swarmComplete);
    const timestamp = new Date().toISOString();
    const summary =
      `# Swarm Run Summary\n\n**Timestamp:** ${timestamp}\n**Tasks:** ${ctx.tasks.length}\n\n` +
      `${ctx.streamResults.map((r, i) => `## Stream ${i + 1}\n\n${r}`).join("\n\n---\n\n")}\n`;
    const docPath = path.join(this.config.repoRoot, this.config.docDir);
    await fs.mkdir(docPath, { recursive: true });
    await fs.writeFile(path.join(docPath, this.config.summaryFileName), summary);
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

    await writeRoleSummary(this.config, phase.agent, `## Final Specification\n\n${spec}`);
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
      this.config,
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

      await writeRoleSummary(this.config, phase.agent, design);
      return design;
    } finally {
      await session.destroy();
    }
  }

  // --- IMPLEMENT PHASE ---

  private async executeImplement(phase: ImplementPhaseConfig, ctx: PipelineContext): Promise<string[]> {
    this.logger.info(msg.launchingStreams(ctx.tasks.length));

    const runStream = async (task: string, idx: number): Promise<string> => {
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

        await writeRoleSummary(this.config, `engineer-stream-${idx + 1}`, code);
        return code;
      } finally {
        await session.destroy();
      }
    };

    if (phase.parallel) {
      return Promise.all(ctx.tasks.map((task, idx) => runStream(task, idx)));
    }
    const results: string[] = [];
    for (let i = 0; i < ctx.tasks.length; i++) {
      results.push(await runStream(ctx.tasks[i], i));
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
      this.config,
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
