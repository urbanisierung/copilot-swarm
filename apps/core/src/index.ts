#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { PlanningEngine } from "./planning-engine.js";

const config = loadConfig();
const logger = new Logger(config.verbose);

if (config.command === "plan") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const planner = new PlanningEngine(config, pipeline, logger);
  planner
    .start()
    .then(() => planner.execute())
    .finally(() => planner.stop());
} else {
  logger.info(msg.startingSwarm);
  const swarm = new SwarmOrchestrator(config, logger);
  swarm
    .start()
    .then(() => swarm.execute())
    .finally(() => swarm.stop());
}
