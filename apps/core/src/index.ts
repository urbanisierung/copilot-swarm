#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { PlanningEngine } from "./planning-engine.js";

const config = loadConfig();
const logger = new Logger(config.verbose, config.runId);

const showLogOnError = (err: unknown) => {
  if (logger.logFilePath) {
    console.error(msg.logFileHint(logger.logFilePath));
  }
  throw err;
};

if (config.command === "plan") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const planner = new PlanningEngine(config, pipeline, logger);
  planner
    .start()
    .then(() => planner.execute())
    .catch(showLogOnError)
    .finally(() => planner.stop());
} else if (config.command === "analyze") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { AnalysisEngine } = await import("./analysis-engine.js");
  const analyzer = new AnalysisEngine(config, pipeline, logger);
  analyzer
    .start()
    .then(() => analyzer.execute())
    .catch(showLogOnError)
    .finally(() => analyzer.stop());
} else {
  logger.info(msg.startingSwarm);
  const swarm = new SwarmOrchestrator(config, logger);
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
}
