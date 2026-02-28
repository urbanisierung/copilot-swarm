#!/usr/bin/env node
import * as path from "node:path";
import { loadConfig, readVersion, type SwarmConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { analysisDir, brainstormsDir, plansDir } from "./paths.js";
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

// Handle list command — show all sessions across repos
if (config.command === "list") {
  const { listGlobalSessions } = await import("./global-registry.js");
  const sessions = await listGlobalSessions();
  if (sessions.length === 0) {
    console.log("No sessions found.");
  } else {
    console.log(
      `\n  ${"Session".padEnd(12)} ${"Name".padEnd(30)} ${"Repository".padEnd(40)} ${"Status".padEnd(10)} Created`,
    );
    console.log(`  ${"─".repeat(12)} ${"─".repeat(30)} ${"─".repeat(40)} ${"─".repeat(10)} ${"─".repeat(20)}`);
    for (const s of sessions) {
      const status = s.finished ? "finished" : "active";
      const repo = s.repoRoot.replace(/^\/home\/[^/]+\//, "~/");
      const date = s.created.replace("T", " ").replace(/\.\d+Z$/, "");
      console.log(
        `  ${s.sessionId.padEnd(12)} ${(s.name || "—").padEnd(30)} ${repo.padEnd(40)} ${status.padEnd(10)} ${date}`,
      );
    }
    console.log("");
  }
  process.exit(0);
}

// Handle stats command
if (config.command === "stats") {
  const { loadStats, formatStats } = await import("./stats.js");
  const stats = await loadStats(config);
  console.log(formatStats(stats));
  process.exit(0);
}

// Handle finish command before resolving session (resolves its own)
if (config.command === "finish") {
  const { resolveSessionId, getSession } = await import("./session-store.js");
  const { buildChangelogEntry, appendChangelog, cleanupCheckpoints, markSessionFinished } = await import("./finish.js");

  let sessionId: string;
  try {
    sessionId = await resolveSessionId(config);
  } catch {
    console.error(msg.finishNoSession);
    process.exit(1);
  }

  const session = await getSession(config, sessionId);
  if (!session) {
    console.error(msg.finishNoSession);
    process.exit(1);
  }

  console.log(msg.finishStart(sessionId, session.name));

  const entry = await buildChangelogEntry(config, sessionId);
  if (entry) {
    const changelogPath = await appendChangelog(config, entry);
    console.log(msg.finishChangelogSaved(path.relative(config.repoRoot, changelogPath)));
  }

  const cleaned = await cleanupCheckpoints(config, sessionId);
  if (cleaned > 0) {
    console.log(msg.finishCheckpointsCleaned(cleaned));
  }

  await markSessionFinished(config, sessionId);
  console.log(msg.finishComplete);
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

// Graceful shutdown — stop active engine/sessions on Ctrl+C or kill
let activeShutdown: (() => Promise<void>) | null = null;

function handleSignal(signal: string) {
  if (activeShutdown) {
    const fn = activeShutdown;
    activeShutdown = null;
    fn().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  } else {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

if (config.command === "plan" || config.command === "auto") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    tracker.primaryModel = pipeline.primaryModel;
    tracker.reviewModel = pipeline.reviewModel;
    tracker.version = readVersion();
    tracker.cwd = config.repoRoot;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const startMs = Date.now();

  // Auto mode: run analyze first to generate repo context
  if (config.command === "auto") {
    const { AnalysisEngine } = await import("./analysis-engine.js");
    const analyzer = new AnalysisEngine(config, pipeline, logger, tracker);
    activeShutdown = async () => {
      renderer?.stop();
      await analyzer.stop();
    };
    renderer?.start();
    await analyzer.start();
    await analyzer.execute();
    await analyzer.stop();
    logger.info(msg.summaryAutoPhaseSwitch);
    // Reset tracker for the plan phase
    if (tracker) {
      tracker.phases = [];
      tracker.streams = [];
      tracker.activeAgent = null;
    }
  }

  const planner = new PlanningEngine(config, pipeline, logger, tracker, renderer);
  activeShutdown = async () => {
    renderer?.stop();
    await planner.stop();
  };
  if (config.command !== "auto") renderer?.start();
  planner
    .start()
    .then((v) => planner.execute().then((plan) => ({ started: v, plan })))
    .then(async ({ plan }) => {
      await planner.stop();

      if (config.command !== "auto") return;

      // Auto mode phase 3: run with the plan
      logger.info(msg.summaryAutoPhaseSwitch);

      // Reset tracker for the run phase
      if (tracker) {
        tracker.phases = [];
        tracker.streams = [];
        tracker.activeAgent = null;
      }

      const runConfig = { ...config, command: "run" as const, issueBody: plan, planProvided: true };
      const swarm = new SwarmOrchestrator(runConfig, logger);
      activeShutdown = async () => {
        renderer?.stop();
        await swarm.stop();
      };
      await swarm.start();
      await swarm.execute();
      await swarm.stop();
    })
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      planner.stop();
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      const outDir = path.relative(config.repoRoot, plansDir(config));
      const heading = config.command === "auto" ? msg.summaryAutoComplete(elapsed) : msg.summaryPlanComplete(elapsed);
      printSummary(heading, outDir, tracker);
    });
} else if (config.command === "task") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { TaskEngine } = await import("./task-engine.js");
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    tracker.primaryModel = pipeline.primaryModel;
    tracker.reviewModel = pipeline.reviewModel;
    tracker.version = readVersion();
    tracker.cwd = config.repoRoot;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const startMs = Date.now();
  const taskEngine = new TaskEngine(config, pipeline, logger, tracker);
  activeShutdown = async () => {
    renderer?.stop();
    await taskEngine.stop();
  };
  renderer?.start();
  taskEngine
    .start()
    .then(() => taskEngine.execute())
    .then(async (spec) => {
      await taskEngine.stop();

      // Phase 2: run pipeline with the refined spec
      logger.info(msg.summaryAutoPhaseSwitch);
      if (tracker) {
        tracker.phases = [];
        tracker.streams = [];
        tracker.activeAgent = null;
      }

      const runConfig = { ...config, command: "run" as const, issueBody: spec, planProvided: true };
      const swarm = new SwarmOrchestrator(runConfig, logger);
      activeShutdown = async () => {
        renderer?.stop();
        await swarm.stop();
      };
      await swarm.start();
      await swarm.execute();
      await swarm.stop();
    })
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      taskEngine.stop();
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      printSummary(msg.summaryTaskComplete(elapsed), "", tracker);
    });
} else if (config.command === "analyze") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { AnalysisEngine } = await import("./analysis-engine.js");
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    tracker.primaryModel = pipeline.primaryModel;
    tracker.reviewModel = pipeline.reviewModel;
    tracker.version = readVersion();
    tracker.cwd = config.repoRoot;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const startMs = Date.now();
  let analyzer = new AnalysisEngine(config, pipeline, logger, tracker);
  activeShutdown = async () => {
    renderer?.stop();
    await analyzer.stop();
  };
  renderer?.start();

  const executeWithRetries = async () => {
    await analyzer.start();
    let lastError: unknown;
    try {
      await analyzer.execute();
      return;
    } catch (error) {
      lastError = error;
    }

    // Auto-resume loop: retry from checkpoint up to maxAutoResume times
    const max = config.maxAutoResume;
    for (let attempt = 1; attempt <= max; attempt++) {
      logger.warn(`⚠️  Analysis failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      logger.info(msg.autoResumeAttempt(attempt, max));

      await analyzer.stop();
      const resumeConfig: SwarmConfig = { ...config, resume: true };
      analyzer = new AnalysisEngine(resumeConfig, pipeline, logger, tracker);
      activeShutdown = async () => {
        renderer?.stop();
        await analyzer.stop();
      };
      await analyzer.start();

      try {
        await analyzer.execute();
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }

    logger.error(msg.autoResumeExhausted(max));
    throw lastError;
  };

  executeWithRetries()
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      analyzer.stop();
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      const outDir = path.relative(config.repoRoot, analysisDir(config));
      printSummary(msg.summaryAnalyzeComplete(elapsed), outDir, tracker);
    });
} else if (config.command === "brainstorm") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { BrainstormEngine } = await import("./brainstorm-engine.js");
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    tracker.primaryModel = pipeline.primaryModel;
    tracker.reviewModel = pipeline.reviewModel;
    tracker.version = readVersion();
    tracker.cwd = config.repoRoot;
    renderer = new TuiRenderer(tracker);
    logger.setTracker(tracker);
  }
  const startMs = Date.now();
  const brainstormer = new BrainstormEngine(config, pipeline, logger, tracker, renderer);
  activeShutdown = async () => {
    renderer?.stop();
    await brainstormer.stop();
  };
  renderer?.start();
  brainstormer
    .start()
    .then(() => brainstormer.execute())
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      brainstormer.stop();
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      const outDir = path.relative(config.repoRoot, brainstormsDir(config));
      printSummary(msg.summaryBrainstormComplete(elapsed), outDir, tracker);
    });
} else if (config.command === "fleet") {
  const { FleetEngine } = await import("./fleet-engine.js");
  const { fleetConfigFromArgs, loadFleetConfig } = await import("./fleet-config.js");

  const fleetConfig = config.fleetRepos
    ? fleetConfigFromArgs(config.fleetRepos)
    : loadFleetConfig(config.fleetConfigPath);

  const startMs = Date.now();
  const fleet = new FleetEngine(config, fleetConfig, logger);

  activeShutdown = async () => {
    await fleet.stop();
  };

  fleet
    .start()
    .then(() => fleet.execute())
    .catch(showLogOnError)
    .finally(() => {
      fleet.stop();
      const sec = Math.floor((Date.now() - startMs) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      console.log("");
      console.log(msg.summaryDivider);
      console.log(`✅ Fleet completed in ${elapsed}`);
      console.log(`   Repos: ${fleetConfig.repos.length}`);
      if (logger.logFilePath) {
        console.log(msg.logFileHint(logger.logFilePath));
      }
      console.log(msg.summaryDivider);
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
  activeShutdown = async () => {
    await swarm.stop();
  };
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
} else {
  logger.info(msg.startingSwarm);
  const swarm = new SwarmOrchestrator(config, logger);
  activeShutdown = async () => {
    await swarm.stop();
  };
  swarm
    .start()
    .then(() => swarm.execute())
    .catch(showLogOnError)
    .finally(() => swarm.stop());
}
