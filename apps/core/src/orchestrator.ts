/**
 * SwarmOrchestrator — wraps PipelineEngine with auto-resume on failure.
 * On error, automatically retries from the last checkpoint up to maxAutoResume times.
 */
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { loadPipelineConfig } from "./pipeline-config.js";
import { PipelineEngine } from "./pipeline-engine.js";

export class SwarmOrchestrator {
  private engine: PipelineEngine;
  private readonly pipeline;

  constructor(
    private readonly config: SwarmConfig,
    private readonly logger: Logger,
  ) {
    this.pipeline = loadPipelineConfig(config.repoRoot);
    this.engine = new PipelineEngine(config, this.pipeline, logger);
  }

  async start(): Promise<void> {
    await this.engine.start();
  }

  async stop(): Promise<void> {
    await this.engine.stop();
  }

  async execute(): Promise<void> {
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
      this.engine = new PipelineEngine(resumeConfig, this.pipeline, this.logger);
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
}
