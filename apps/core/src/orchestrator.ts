/**
 * SwarmOrchestrator — wraps PipelineEngine with auto-resume on failure.
 * On error, automatically retries from the last checkpoint up to maxAutoResume times.
 */
import * as path from "node:path";
import type { PreviousRunContext } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import { readVersion } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { runDir } from "./paths.js";
import { loadPipelineConfig } from "./pipeline-config.js";
import { PipelineEngine } from "./pipeline-engine.js";
import { ProgressTracker } from "./progress-tracker.js";
import { TuiRenderer } from "./tui-renderer.js";

export class SwarmOrchestrator {
  private engine: PipelineEngine;
  private readonly pipeline;
  private readonly tracker: ProgressTracker | null;
  private readonly renderer: TuiRenderer | null;

  constructor(
    private readonly config: SwarmConfig,
    private readonly logger: Logger,
    private readonly reviewContext?: PreviousRunContext,
  ) {
    this.pipeline = loadPipelineConfig(config.repoRoot);

    if (config.tui) {
      this.tracker = new ProgressTracker();
      this.tracker.runId = config.runId;
      this.tracker.primaryModel = this.pipeline.primaryModel;
      this.tracker.reviewModel = this.pipeline.reviewModel;
      this.tracker.version = readVersion();
      this.tracker.cwd = config.repoRoot;
      this.renderer = new TuiRenderer(this.tracker);
      logger.setTracker(this.tracker);
    } else {
      this.tracker = null;
      this.renderer = null;
    }

    this.engine = new PipelineEngine(config, this.pipeline, logger, this.tracker ?? undefined, reviewContext);
  }

  async start(): Promise<void> {
    await this.engine.start();
  }

  async stop(): Promise<void> {
    await this.engine.stop();
  }

  async execute(): Promise<void> {
    this.renderer?.start();
    let success = false;
    try {
      await this.executeWithRetries();
      success = true;
    } finally {
      this.renderer?.stop();
      if (this.tracker) this.logger.setTracker(null);
      this.printPostTuiSummary(success);
    }
  }

  private async executeWithRetries(): Promise<void> {
    let lastError: unknown;
    try {
      await this.engine.execute();
      return;
    } catch (error) {
      lastError = error;
    }

    // Auto-resume loop: retry from checkpoint up to maxAutoResume times
    const max = this.config.maxAutoResume;
    for (let attempt = 1; attempt <= max; attempt++) {
      this.logger.warn(`⚠️  Pipeline failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      this.logger.info(msg.autoResumeAttempt(attempt, max));

      // Tear down old engine and create a fresh one with resume enabled
      await this.engine.stop();
      const resumeConfig: SwarmConfig = { ...this.config, resume: true };
      this.engine = new PipelineEngine(
        resumeConfig,
        this.pipeline,
        this.logger,
        this.tracker ?? undefined,
        this.reviewContext,
      );
      await this.engine.start();

      try {
        await this.engine.execute();
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }

    this.logger.error(msg.autoResumeExhausted(max));
    throw lastError;
  }

  private printPostTuiSummary(success: boolean): void {
    const elapsed = this.fmtElapsed(this.tracker?.elapsedMs ?? 0);
    const outputDir = path.relative(this.config.repoRoot, runDir(this.config));

    console.log("");
    console.log(msg.summaryDivider);
    const successMsg =
      this.config.command === "review" ? msg.summaryReviewComplete(elapsed) : msg.summaryRunSuccess(elapsed);
    console.log(success ? successMsg : msg.summaryRunFailed(elapsed));

    if (this.tracker) {
      const done = this.tracker.phases.filter((p) => p.status === "done").length;
      const skipped = this.tracker.phases.filter((p) => p.status === "skipped").length;
      console.log(msg.summaryPhases(done, this.tracker.totalPhaseCount, skipped));

      if (this.tracker.streams.length > 0) {
        const sDone = this.tracker.streams.filter((s) => s.status === "done").length;
        const sFailed = this.tracker.streams.filter((s) => s.status === "failed").length;
        console.log(msg.summaryStreams(sDone, sFailed, this.tracker.streams.length));
      }
    }

    console.log(msg.summaryOutput(outputDir));
    if (this.logger.logFilePath) {
      console.log(msg.logFileHint(this.logger.logFilePath));
    }
    console.log(msg.summaryDivider);
  }

  private fmtElapsed(ms: number): string {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
