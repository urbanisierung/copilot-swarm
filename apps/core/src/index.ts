#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";

const config = loadConfig();
const logger = new Logger(config.verbose);

logger.info(msg.startingSwarm);

const swarm = new SwarmOrchestrator(config, logger);
swarm
  .start()
  .then(() => swarm.execute())
  .finally(() => swarm.stop());
