/**
 * SwarmOrchestrator — wraps PipelineEngine with auto-resume on failure.
 * On error, automatically retries from the last checkpoint up to maxAutoResume times.
 */
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
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
  ) {
    this.pipeline = loadPipelineConfig(config.repoRoot);

    if (config.tui) {
      this.tracker = new ProgressTracker();
      this.tracker.runId = config.runId;
      this.renderer = new TuiRenderer(this.tracker);
      logger.setTracker(this.tracker);
    } else {
      this.tracker = null;
      this.renderer = null;
    }

    this.engine = new PipelineEngine(config, this.pipeline, logger, this.tracker ?? undefined);
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
      if (this.tracker) {
        this.logger.setTracker(null);
        this.printPostTuiSummary(success);
      }
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
      this.engine = new PipelineEngine(resumeConfig, this.pipeline, this.logger, this.tracker ?? undefined);
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
    if (!this.tracker) return;
    const elapsed = this.fmtElapsed(this.tracker.elapsedMs);
    const outputDir = path.relative(this.config.repoRoot, runDir(this.config));
    if (success) {
      console.log(`\n✅ Copilot Swarm completed in ${elapsed}`);
      console.log(`📁 Output: ${outputDir}`);
    } else {
      console.log(`\n❌ Copilot Swarm failed after ${elapsed}`);
      console.log(`📁 Partial output: ${outputDir}`);
    }
    if (this.logger.logFilePath) {
      console.log(msg.logFileHint(this.logger.logFilePath));
    }
  }

  private fmtElapsed(ms: number): string {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
