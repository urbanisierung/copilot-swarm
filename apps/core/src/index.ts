#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { PlanningEngine } from "./planning-engine.js";
import { ProgressTracker } from "./progress-tracker.js";
import { TuiRenderer } from "./tui-renderer.js";

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
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const planner = new PlanningEngine(config, pipeline, logger, tracker, renderer);
  renderer?.start();
  planner
    .start()
    .then(() => planner.execute())
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      planner.stop();
    });
} else if (config.command === "analyze") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { AnalysisEngine } = await import("./analysis-engine.js");
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const analyzer = new AnalysisEngine(config, pipeline, logger, tracker);
  renderer?.start();
  analyzer
    .start()
    .then(() => analyzer.execute())
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      analyzer.stop();
    });
} else {
  logger.info(msg.startingSwarm);
  const swarm = new SwarmOrchestrator(config, logger);
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
}
