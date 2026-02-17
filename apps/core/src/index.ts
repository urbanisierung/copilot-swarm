#!/usr/bin/env node
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { analysisDir, plansDir } from "./paths.js";
import { PlanningEngine } from "./planning-engine.js";
import { ProgressTracker } from "./progress-tracker.js";
import { resolveSessionId } from "./session-store.js";
import { TuiRenderer } from "./tui-renderer.js";

const config = await loadConfig();

// Handle session subcommand before resolving session
if (config.command === "session") {
  const { createSession, listSessions, setActiveSession, getActiveSessionId, getSession } = await import(
    "./session-store.js"
  );
  const subcommand = config.issueBody.split(" ")[0];
  const args = config.issueBody.substring(subcommand.length).trim();

  if (subcommand === "create") {
    const name = args || "Unnamed session";
    const session = await createSession(config, name);
    console.log(`✅ Created session: ${session.id} — "${session.name}"`);
    console.log(`   Active session set to: ${session.id}`);
  } else if (subcommand === "list") {
    const sessions = await listSessions(config);
    const activeId = await getActiveSessionId(config);
    if (sessions.length === 0) {
      console.log("No sessions found.");
    } else {
      for (const s of sessions) {
        const marker = s.id === activeId ? " (active)" : "";
        console.log(`  ${s.id}  ${s.name}${marker}  — ${s.created}`);
      }
    }
  } else if (subcommand === "use") {
    if (!args) {
      console.error("Error: session use requires a session ID");
      process.exit(1);
    }
    const session = await getSession(config, args);
    if (!session) {
      console.error(`Error: Session not found: ${args}`);
      process.exit(1);
    }
    await setActiveSession(config, args);
    console.log(`✅ Active session: ${session.id} — "${session.name}"`);
  } else {
    console.error(`Unknown session subcommand: "${subcommand}". Use: create, list, use`);
    process.exit(1);
  }
  process.exit(0);
}

// Resolve session for all other commands
config.resolvedSessionId = await resolveSessionId(config);

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
} else if (config.command === "review") {
  const { loadPreviousRun } = await import("./checkpoint.js");
  const prevRun = await loadPreviousRun(config, config.reviewRunId);
  if (!prevRun) {
    console.error(msg.reviewNoPreviousRun);
    process.exit(1);
  }
  logger.info(msg.reviewStart);
  const swarm = new SwarmOrchestrator(config, logger, prevRun);
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
} else {
  logger.info(msg.startingSwarm);
  const swarm = new SwarmOrchestrator(config, logger);
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
}
