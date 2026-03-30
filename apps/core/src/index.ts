#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, readVersion, type SwarmConfig } from "./config.js";
import { ContextLengthError } from "./errors.js";
import { classifyError, Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";
import { analysisDir, brainstormsDir, plansDir } from "./paths.js";
import { PlanningEngine } from "./planning-engine.js";
import { ProgressTracker } from "./progress-tracker.js";
import { resolveSessionId } from "./session-store.js";
import { TuiRenderer } from "./tui-renderer.js";

/** Return actionable guidance for known error types. */
function actionableHint(err: unknown): string {
  if (err instanceof ContextLengthError) {
    const parts = [`\n\n💡 Prompt exceeded token limit by ${err.overage} tokens (${err.promptTokens}/${err.limit}).`];
    parts.push(
      "   Try: reduce prompt size, split complex tasks, or set MODEL_CONTEXT_LIMIT to a higher value if your model supports it.",
    );
    return parts.join("\n");
  }
  const classification = classifyError(err);
  switch (classification.type) {
    case "auth":
      return "\n\n💡 Authentication failed. Try: `gh auth login` or check your GITHUB_TOKEN.";
    case "rate_limit":
      return "\n\n💡 Rate limit hit. Wait a few minutes and retry, or reduce parallel streams.";
    case "network":
      return "\n\n💡 Network error. Check your internet connection and try again.";
    case "context_length":
      return "\n\n💡 Prompt too large. Try splitting the task or reducing the spec/design size.";
    default:
      return "";
  }
}

// Global error handler — prevent unhandled exceptions from showing stack traces
function handleFatalError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const hint = actionableHint(err);
  console.error(`\nError: ${message}${hint}\n`);
  process.exit(1);
}
process.on("uncaughtException", handleFatalError);
process.on("unhandledRejection", handleFatalError);

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

// Handle logs command — show recent log files
if (config.command === "logs") {
  const { listRecentLogs } = await import("./logger.js");
  const logs = listRecentLogs();
  if (logs.length === 0) {
    console.log("No log files found.");
  } else {
    console.log("Recent log files:\n");
    for (const log of logs) {
      console.log(`  ${log.name}  (${log.size})`);
    }
    console.log(`\nLatest: ${logs[0].path}`);
    console.log(`\nTip: Use 'jq' to explore structured logs:`);
    console.log(`  cat "${logs[0].path}" | jq .`);
    console.log(`  cat "${logs[0].path}" | jq 'select(.level == "error")'`);
  }
  process.exit(0);
}

// Handle demo command
if (config.command === "demo") {
  const { runDemo } = await import("./demo.js");
  await runDemo(config);
  process.exit(0);
}

// Handle backup command
if (config.command === "backup") {
  const { syncAll } = await import("./central-store.js");
  const count = await syncAll(config);
  console.log(`✅ Backed up ${count} session(s) to central store.`);
  process.exit(0);
}

// Handle restore command
if (config.command === "restore") {
  const { restoreAll, centralRepoDir } = await import("./central-store.js");
  const dir = centralRepoDir(config.repoRoot);
  try {
    await import("node:fs/promises").then((f) => f.access(dir));
  } catch {
    console.log("No central backup found for this repository.");
    process.exit(0);
  }
  const count = await restoreAll(config);
  console.log(`✅ Restored ${count} session(s) from central store.`);
  process.exit(0);
}

// Handle digest command
if (config.command === "digest") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const logger = new Logger(config.verbose, config.runId, config.logLevel);
  const { runDigest } = await import("./digest.js");

  // Resolve session so paths work
  try {
    config.resolvedSessionId = await resolveSessionId(config);
  } catch {
    // No session — digest will use unsessioned paths
  }

  await runDigest(config, pipeline, logger);
  process.exit(0);
}

// Handle compare command — compare multiple PRs side-by-side
if (config.command === "compare") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.compareRepos[0] ?? process.cwd());
  const cLogger = new Logger(config.verbose, config.runId, config.logLevel);
  const { CompareEngine } = await import("./compare-engine.js");

  if (config.compareRepos.length < 2) {
    console.error("Error: At least 2 repository paths are required for the compare command.");
    console.error("Usage: swarm compare ./pr-a ./pr-b [./pr-c ...] [-f requirements.md]");
    process.exit(1);
  }

  const startMs = Date.now();
  let tracker: ProgressTracker | undefined;
  let renderer: TuiRenderer | undefined;
  if (config.tui) {
    tracker = new ProgressTracker();
    tracker.runId = config.runId;
    tracker.primaryModel = pipeline.primaryModel;
    tracker.reviewModel = pipeline.reviewModel;
    tracker.version = readVersion();
    tracker.cwd = process.cwd();
    renderer = new TuiRenderer(tracker);
    cLogger.setTracker(tracker);
  }

  const engine = new CompareEngine(config, pipeline, cLogger, tracker);
  renderer?.start();
  try {
    await engine.start();
    await engine.execute();
    await engine.stop();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}\n`);
    process.exit(1);
  } finally {
    renderer?.stop();
    if (tracker) cLogger.setTracker(null);
  }

  const sec = Math.floor((Date.now() - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  console.log(msg.compareComplete(elapsed));
  console.log(`📄 Report: ${path.resolve(config.compareOutput)}`);
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

const logger = new Logger(config.verbose, config.runId, config.logLevel);

const showLogOnError = (err: unknown) => {
  // Log the full error with stack trace to the structured log file
  logger.error("Fatal error", err);
  const hint = actionableHint(err);
  if (hint) console.error(hint);
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
      const ctx = { phase: "auto-resume-analysis", attempt, maxAttempts: max };
      logger.error("Analysis failed, attempting auto-resume", lastError, ctx);
      logger.info(msg.autoResumeAttempt(attempt, max), ctx);

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

    logger.error(msg.autoResumeExhausted(max), lastError, { phase: "auto-resume-analysis" });
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
} else if (config.command === "prepare") {
  const pipeline = (await import("./pipeline-config.js")).loadPipelineConfig(config.repoRoot);
  const { PrepareEngine } = await import("./prepare-engine.js");
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
  const preparer = new PrepareEngine(config, pipeline, logger, tracker);
  activeShutdown = async () => {
    renderer?.stop();
    await preparer.stop();
  };
  renderer?.start();
  preparer
    .start()
    .then(() => {
      if (config.prepareMode === "dirs") {
        if (!config.preparePath) {
          logger.error("Error: Missing path. Usage: swarm prepare dirs <path>");
          process.exit(1);
        }
        return preparer.executeDirs(config.preparePath);
      }
      return preparer.execute();
    })
    .catch(showLogOnError)
    .finally(() => {
      renderer?.stop();
      if (tracker) logger.setTracker(null);
      preparer.stop();
      const elapsed = fmtElapsed(tracker?.elapsedMs ?? Date.now() - startMs);
      printSummary(`✅ Copilot instructions generated in ${elapsed}`, ".github/instructions", tracker);
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
  const { fleetConfigFromArgs, loadFleetConfig, discoverGitRepos, selectReposInteractively } = await import(
    "./fleet-config.js"
  );

  let fleetConfig: import("./fleet-types.js").FleetConfig;
  try {
    if (config.fleetRepos) {
      fleetConfig = fleetConfigFromArgs(config.fleetRepos);
    } else if (config.fleetConfigPath || fs.existsSync(path.resolve("fleet.config.yaml"))) {
      fleetConfig = loadFleetConfig(config.fleetConfigPath);
    } else {
      // Auto-discover git repos in current directory
      const discovered = discoverGitRepos(process.cwd());
      if (discovered.length === 0) {
        console.error(
          "\nNo git repositories found in the current directory.\n\n" +
            "Provide repositories using one of:\n" +
            '  swarm fleet "prompt" ./repo1 ./repo2\n' +
            '  swarm fleet "prompt" --repos ./repo1 --repos ./repo2\n' +
            "  swarm fleet --fleet-config config.yaml\n",
        );
        process.exit(1);
      }
      const selected = await selectReposInteractively(discovered);
      fleetConfig = fleetConfigFromArgs(selected);
    }
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const startMs = Date.now();

  let fleetTracker: ProgressTracker | undefined;
  let fleetRenderer: TuiRenderer | undefined;
  if (config.tui && config.fleetMode !== "cleanup") {
    fleetTracker = new ProgressTracker();
    fleetTracker.runId = config.runId;
    fleetTracker.version = readVersion();
    fleetTracker.cwd = config.repoRoot;
    fleetTracker.primaryModel = "";
    fleetTracker.reviewModel = "";
    fleetRenderer = new TuiRenderer(fleetTracker);
    logger.setTracker(fleetTracker);
  }

  const fleet = new FleetEngine(config, fleetConfig, logger, fleetTracker, fleetRenderer);

  activeShutdown = async () => {
    await fleet.stop();
    if (config.fleetMode !== "cleanup" && config.fleetMode !== "analyze") {
      console.log("");
      console.log(msg.summaryDivider);
      console.log("⚠️  Fleet interrupted");
      console.log(`   Cleanup: ${fleet.buildCleanupCommand()}`);
      console.log(msg.summaryDivider);
    }
  };

  fleet
    .start()
    .then(() => fleet.execute())
    .catch(showLogOnError)
    .finally(() => {
      fleet.stop();
      fleetRenderer?.stop();
      if (fleetTracker) logger.setTracker(null);
      const sec = Math.floor((Date.now() - startMs) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      console.log("");
      console.log(msg.summaryDivider);
      const modeLabel = config.fleetMode ? `Fleet ${config.fleetMode}` : "Fleet";
      console.log(`✅ ${modeLabel} completed in ${elapsed}`);
      console.log(`   Repos: ${fleetConfig.repos.length}`);
      if (logger.logFilePath) {
        console.log(msg.logFileHint(logger.logFilePath));
      }
      if (config.fleetMode !== "cleanup" && config.fleetMode !== "analyze") {
        console.log(`   Cleanup: ${fleet.buildCleanupCommand()}`);
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
