#!/usr/bin/env node
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { analysisDir, plansDir } from "./paths.js";
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

function fmtElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function printSummary(heading: string, outputDir: string, tracker: ProgressTracker | undefined): void {
  console.log("");
  console.log(msg.summaryDivider);
  console.log(heading);

  if (tracker) {
    const done = tracker.phases.filter((p) => p.status === "done").length;
    const skipped = tracker.phases.filter((p) => p.status === "skipped").length;
    console.log(msg.summaryPhases(done, tracker.totalPhaseCount, skipped));
  }

  console.log(msg.summaryOutput(outputDir));
  if (logger.logFilePath) {
    console.log(msg.logFileHint(logger.logFilePath));
  }
  console.log(msg.summaryDivider);
}

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
  const startMs = Date.now();
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
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      const outDir = path.relative(config.repoRoot, plansDir(config));
      printSummary(msg.summaryPlanComplete(elapsed), outDir, tracker);
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
  const startMs = Date.now();
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
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      const outDir = path.relative(config.repoRoot, analysisDir(config));
      printSummary(msg.summaryAnalyzeComplete(elapsed), outDir, tracker);
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
