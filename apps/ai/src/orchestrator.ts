/**
 * AgencyOrchestrator — thin wrapper that loads pipeline config and delegates to the engine.
 * Kept for backward compatibility; new code can use PipelineEngine directly.
 */
import type { AgencyConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { loadPipelineConfig } from "./pipeline-config.js";
import { PipelineEngine } from "./pipeline-engine.js";

export class AgencyOrchestrator {
  private readonly engine: PipelineEngine;

  constructor(config: AgencyConfig, logger: Logger) {
    const pipeline = loadPipelineConfig(config.repoRoot);
    this.engine = new PipelineEngine(config, pipeline, logger);
  }

  async start(): Promise<void> {
    await this.engine.start();
  }

  async stop(): Promise<void> {
    await this.engine.stop();
  }

  async execute(): Promise<void> {
    await this.engine.execute();
  }
}
