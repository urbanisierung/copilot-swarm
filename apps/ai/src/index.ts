import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { AgencyOrchestrator } from "./orchestrator.js";

const config = loadConfig();
const logger = new Logger(config.verbose);

logger.info(msg.startingAgency);

const agency = new AgencyOrchestrator(config, logger);
agency
  .start()
  .then(() => agency.execute())
  .finally(() => agency.stop());
