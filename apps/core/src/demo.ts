/**
 * Interactive Copilot Swarm demo — guided walkthrough of CLI modes.
 * Drives ProgressTracker + TuiRenderer with mock data, no AI backend needed.
 */

import * as crypto from "node:crypto";
import * as readline from "node:readline";
import type { SwarmConfig } from "./config.js";
import { ProgressTracker } from "./progress-tracker.js";
import { formatStats, loadStats, recordAgentInvocation, recordRunStart } from "./stats.js";
import { TuiRenderer } from "./tui-renderer.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sid = () => crypto.randomUUID();
const SPEED = 0.5;
const dur = (ms: number) => ms * SPEED;

const MODELS = { primary: "claude-sonnet-4", review: "gpt-4.1", fast: "claude-haiku-4.5" };

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

function ask(question: string, choices: { key: string; label: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("");
    console.log(`  ${question}`);
    console.log("");
    for (const c of choices) {
      console.log(`    ${c.key})  ${c.label}`);
    }
    console.log("");

    const validKeys = choices.map((c) => c.key);
    const prompt = () => {
      rl.question("  ▸ ", (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (validKeys.includes(trimmed)) {
          rl.close();
          resolve(trimmed);
        } else {
          console.log(`    Invalid choice. Pick one of: ${validKeys.join(", ")}`);
          prompt();
        }
      });
    };
    prompt();
  });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let tracker: ProgressTracker;
let tui: TuiRenderer;
let cfg: SwarmConfig;

async function mockAgent(label: string, model: string, durationMs: number): Promise<void> {
  const id = sid();
  tracker.addActiveAgent(id, label, model);
  tracker.addLog(`${label} started (${model})`);
  await sleep(durationMs);
  tracker.removeActiveAgent(id);
  tracker.addLog(`${label} finished`);
  await recordAgentInvocation(cfg, label, model, durationMs);
}

function initTracker() {
  tracker = new ProgressTracker();
  tracker.runId = "intro-demo";
  tracker.primaryModel = MODELS.primary;
  tracker.reviewModel = MODELS.review;
  tracker.version = "0.0.34-demo";
  tracker.cwd = process.cwd();
  tui = new TuiRenderer(tracker);
}

function printDemoSummary(mode: string) {
  const sec = Math.floor(tracker.elapsedMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const done = tracker.phases.filter((p) => p.status === "done").length;
  console.log("");
  console.log("─".repeat(60));
  console.log(`  ✅ Demo complete: ${mode} (${elapsed})`);
  console.log(`     Phases: ${done}/${tracker.totalPhaseCount}`);
  console.log("─".repeat(60));
}

// ---------------------------------------------------------------------------
// Scenario: Analyze
// ---------------------------------------------------------------------------

async function runAnalyze() {
  initTracker();
  tracker.initPhases([
    { phase: "analyze-scout" },
    { phase: "analyze-chunk" },
    { phase: "analyze-synthesis" },
    { phase: "analyze-architect" },
    { phase: "analyze-review" },
  ]);
  tui.start();
  await recordRunStart(cfg);

  const scoutKey = "analyze-scout-0";
  tracker.activatePhase(scoutKey);
  tracker.setActiveAgent("scanning repository structure…");
  tracker.addLog("Scanning files and directory structure");
  await mockAgent("scout", MODELS.fast, dur(2000));
  tracker.addLog("Found 847 files across 42 directories");
  tracker.setActiveAgent(null);
  tracker.completePhase(scoutKey);

  const chunkKey = "analyze-chunk-1";
  tracker.activatePhase(chunkKey);
  tracker.setActiveAgent("analyzing code chunks…");
  tracker.addLog("Partitioned into 4 analysis chunks");
  tracker.initStreams([
    "src/core/** — Core modules",
    "src/api/** — API endpoints",
    "src/models/** — Data models",
    "src/utils/** — Utilities & helpers",
  ]);
  const chunkWork = [0, 1, 2, 3].map(async (idx) => {
    tracker.updateStream(idx, "engineering");
    tracker.updateStreamModel(idx, MODELS.primary);
    tracker.updateStreamDetail(idx, "Analyzing code chunk…");
    await mockAgent(`chunk-analyzer-${idx + 1}`, MODELS.primary, dur(3000 + Math.random() * 2000));
    tracker.updateStreamDetail(idx, "Complete");
    tracker.updateStream(idx, "done");
  });
  await Promise.all(chunkWork);
  tracker.setActiveAgent(null);
  tracker.completePhase(chunkKey);

  const synthKey = "analyze-synthesis-2";
  tracker.activatePhase(synthKey);
  tracker.setActiveAgent("synthesizing analysis results…");
  await mockAgent("synthesis", MODELS.primary, dur(2500));
  tracker.setActiveAgent(null);
  tracker.completePhase(synthKey);

  const archKey = "analyze-architect-3";
  tracker.activatePhase(archKey);
  tracker.setActiveAgent("architecture analysis…");
  tracker.streams = [];
  await mockAgent("architect", MODELS.primary, dur(3000));
  tracker.setActiveAgent(null);
  tracker.completePhase(archKey);

  const revKey = "analyze-review-4";
  tracker.activatePhase(revKey);
  tracker.setActiveAgent("peer reviewing analysis…");
  await mockAgent("review-analyst", MODELS.review, dur(2000));
  tracker.setActiveAgent(null);
  tracker.completePhase(revKey);

  tracker.addLog("🐝 Analysis complete — repo-analysis.md written");
  await sleep(dur(1500));
  tui.stop();
  printDemoSummary("analyze");
}

// ---------------------------------------------------------------------------
// Scenario: Single-repo run with auto-model
// ---------------------------------------------------------------------------

async function runSingleRepoAutoModel() {
  initTracker();
  tracker.initPhases([{ phase: "spec" }, { phase: "decompose" }, { phase: "implement" }, { phase: "verify" }]);
  tui.start();
  await recordRunStart(cfg);

  const specKey = "spec-0";
  tracker.activatePhase(specKey);
  tracker.setActiveAgent("pm drafting specification…");
  await mockAgent("pm", MODELS.primary, dur(2500));
  await mockAgent("pm-reviewer", MODELS.primary, dur(1200));
  tracker.setActiveAgent(null);
  tracker.completePhase(specKey);

  const decompKey = "decompose-1";
  tracker.activatePhase(decompKey);
  tracker.setActiveAgent("breaking down tasks…");
  await mockAgent("decompose-agent", MODELS.fast, dur(1000));
  tracker.setActiveAgent(null);
  tracker.completePhase(decompKey);

  const implKey = "implement-2";
  tracker.activatePhase(implKey);
  tracker.setActiveAgent(null);
  const tasks = [
    { desc: "[DB] Add index on users.email column", model: MODELS.fast },
    { desc: "[API] Implement OAuth2 PKCE flow with token rotation", model: MODELS.primary },
    { desc: "[CONFIG] Update environment variables documentation", model: MODELS.fast },
  ];
  tracker.initStreams(tasks.map((t) => t.desc));

  const streamWork = tasks.map(async (task, idx) => {
    // Auto-model classification step
    tracker.addLog(`🤖 Stream ${idx + 1}: classifying → ${task.model === MODELS.fast ? "FAST" : "PRIMARY"}`);
    await mockAgent("model-classifier", MODELS.fast, dur(500));
    tracker.addLog(`   → Selected: ${task.model}`);
    tracker.updateStreamModel(idx, task.model);

    tracker.updateStream(idx, "engineering");
    tracker.updateStreamDetail(idx, "Implementing task…");
    await mockAgent("engineer", task.model, dur(2500 + Math.random() * 2000));
    tracker.updateStream(idx, "reviewing");
    tracker.updateStreamDetail(idx, "Code review by reviewer");
    await mockAgent("code-reviewer", MODELS.primary, dur(1200 + Math.random() * 800));
    tracker.updateStreamDetail(idx, "Complete");
    tracker.updateStream(idx, "done");
  });
  await Promise.all(streamWork);
  tracker.completePhase(implKey);

  const verifyKey = "verify-3";
  tracker.activatePhase(verifyKey);
  tracker.setActiveAgent("running verification…");
  await sleep(dur(800));
  tracker.addLog("✅ Build passed");
  await sleep(dur(600));
  tracker.addLog("✅ Tests passed");
  tracker.setActiveAgent(null);
  tracker.completePhase(verifyKey);

  tracker.addLog("🐝 Swarm run complete (auto-model enabled)");
  await sleep(dur(1500));
  tui.stop();
  printDemoSummary("single-repo run (auto-model)");
}

// ---------------------------------------------------------------------------
// Scenario: Digest
// ---------------------------------------------------------------------------

async function runDigestDemo() {
  console.log("");
  console.log("─".repeat(48));
  console.log("📋 Run Digest — 2026-03-01T07-00-00-000Z");
  console.log("─".repeat(48));
  console.log("");
  console.log("## What was done");
  console.log("");
  console.log("Implemented OAuth2 PKCE authentication flow with");
  console.log("token rotation, added database index for user");
  console.log("lookups, and updated environment documentation.");
  console.log("");
  console.log("## Key decisions");
  console.log("");
  console.log("- Used fast model for simple tasks (DB index,");
  console.log("  docs update), primary model for complex OAuth flow");
  console.log("- PKCE flow stores code verifier in httpOnly cookie");
  console.log("- Token rotation uses sliding window expiry");
  console.log("");
  console.log("## Files changed");
  console.log("");
  console.log("- src/auth/oauth2-pkce.ts (new)");
  console.log("- src/auth/token-rotation.ts (new)");
  console.log("- migrations/003_add_email_index.sql (new)");
  console.log("- docs/environment.md (updated)");
  console.log("- src/auth/index.ts (updated)");
  console.log("");
  console.log("## Status");
  console.log("");
  console.log("✅ Build passed  ✅ Tests passed (3 new, 247 total)");
  console.log("");
  console.log("─".repeat(48));
  console.log("✅ Digest complete.");
}

// ---------------------------------------------------------------------------
// Scenario: Single-repo run
// ---------------------------------------------------------------------------

async function runSingleRepo() {
  initTracker();
  tracker.initPhases([
    { phase: "spec" },
    { phase: "decompose" },
    { phase: "design" },
    { phase: "implement" },
    { phase: "cross-model-review" },
    { phase: "verify" },
  ]);
  tui.start();
  await recordRunStart(cfg);

  const specKey = "spec-0";
  tracker.activatePhase(specKey);
  tracker.setActiveAgent("pm drafting specification…");
  await mockAgent("pm", MODELS.primary, dur(2500));
  await mockAgent("pm-reviewer", MODELS.primary, dur(1500));
  await mockAgent("spec-reviewer", MODELS.primary, dur(1500));
  tracker.setActiveAgent(null);
  tracker.completePhase(specKey);

  const decompKey = "decompose-1";
  tracker.activatePhase(decompKey);
  tracker.setActiveAgent("breaking down tasks…");
  await mockAgent("decompose-agent", MODELS.fast, dur(1200));
  tracker.setActiveAgent(null);
  tracker.completePhase(decompKey);

  const designKey = "design-2";
  tracker.activatePhase(designKey);
  tracker.setActiveAgent("designing solution…");
  await mockAgent("designer", MODELS.primary, dur(2500));
  await mockAgent("design-reviewer", MODELS.primary, dur(1200));
  tracker.setActiveAgent(null);
  tracker.completePhase(designKey);

  const implKey = "implement-3";
  tracker.activatePhase(implKey);
  tracker.setActiveAgent(null);
  const tasks = [
    "[AUTH] Implement JWT refresh token rotation",
    "[API] Add rate limiting middleware with Redis backing",
    "[DB] Create migration for user_sessions table",
  ];
  tracker.initStreams(tasks);
  const streamWork = tasks.map(async (_task, idx) => {
    tracker.updateStream(idx, "engineering");
    tracker.updateStreamDetail(idx, "Implementing task…");
    await mockAgent("engineer", MODELS.primary, dur(3500 + Math.random() * 2000));
    tracker.updateStream(idx, "reviewing");
    tracker.updateStreamDetail(idx, "Code review by reviewer");
    await mockAgent("code-reviewer", MODELS.primary, dur(1500 + Math.random() * 1000));
    tracker.updateStream(idx, "testing");
    tracker.updateStreamDetail(idx, "QA testing by tester");
    await mockAgent("qa", MODELS.primary, dur(1500 + Math.random() * 1000));
    tracker.updateStreamDetail(idx, "Complete");
    tracker.updateStream(idx, "done");
  });
  await Promise.all(streamWork);
  tracker.completePhase(implKey);

  const cmrKey = "cross-model-review-4";
  tracker.activatePhase(cmrKey);
  tracker.setActiveAgent("cross-model review…");
  tracker.streams = [];
  await mockAgent("cross-model-reviewer", MODELS.review, dur(2500));
  await mockAgent("engineer", MODELS.primary, dur(1500));
  tracker.setActiveAgent(null);
  tracker.completePhase(cmrKey);

  const verifyKey = "verify-5";
  tracker.activatePhase(verifyKey);
  tracker.setActiveAgent("running verification…");
  await sleep(dur(1000));
  tracker.addLog("✅ Build passed");
  await sleep(dur(800));
  tracker.addLog("✅ Tests passed (247 passed, 0 failed)");
  await sleep(dur(600));
  tracker.addLog("✅ Lint passed");
  tracker.setActiveAgent(null);
  tracker.completePhase(verifyKey);

  tracker.addLog("🐝 Swarm run complete");
  await sleep(dur(1500));
  tui.stop();
  printDemoSummary("single-repo run");
}

// ---------------------------------------------------------------------------
// Scenario: Fleet (multi-repo)
// ---------------------------------------------------------------------------

async function runFleet() {
  initTracker();

  const repos = [
    { name: "acme-corp/api-gateway-service", role: "API Gateway" },
    { name: "acme-corp/user-auth-service", role: "Auth microservice" },
    { name: "acme-corp/billing-service", role: "Billing microservice" },
    { name: "acme-corp/web-dashboard", role: "React frontend" },
    { name: "acme-corp/shared-types", role: "Shared TypeScript types" },
  ];

  const phaseNames: Record<string, string> = {
    "fleet-analyze": "Analyze Repositories",
    "fleet-strategize": "Cross-Repo Strategy",
    "fleet-wave-1": "Wave 1 — Foundation",
    "fleet-wave-2": "Wave 2 — Consumers",
    "fleet-cross-review": "Cross-Repo Review",
    "fleet-summary": "Summary",
  };

  tracker.phases = [
    "fleet-analyze",
    "fleet-strategize",
    "fleet-wave-1",
    "fleet-wave-2",
    "fleet-cross-review",
    "fleet-summary",
  ].map((p, i) => ({
    key: `${p}-${i}`,
    name: phaseNames[p] ?? p,
    status: "pending" as const,
  }));

  tui.start();
  await recordRunStart(cfg);

  // Analyze
  const analyzeKey = "fleet-analyze-0";
  tracker.activatePhase(analyzeKey);
  tracker.setActiveAgent("analyzing repositories…");
  tracker.addLog(`Analyzing ${repos.length} repositories in parallel`);
  await Promise.all(
    repos.map(async (repo) => {
      await mockAgent(`scout:${repo.name}`, MODELS.fast, dur(2000 + Math.random() * 1500));
    }),
  );
  tracker.setActiveAgent(null);
  tracker.completePhase(analyzeKey);

  // Strategize
  const stratKey = "fleet-strategize-1";
  tracker.activatePhase(stratKey);
  tracker.setActiveAgent("planning cross-repo approach…");
  await mockAgent("fleet-strategist", MODELS.primary, dur(3500));
  tracker.addLog("Strategy: 2 waves, shared API contract");
  tracker.setActiveAgent(null);
  tracker.completePhase(stratKey);

  // Wave 1
  const wave1Key = "fleet-wave-1-2";
  const wave1 = [repos[4], repos[1], repos[2]];
  tracker.activatePhase(wave1Key);
  tracker.addLog(`🌊 Wave 1: ${wave1.map((r) => r.name).join(", ")}`);
  tracker.initStreams(wave1.map((r) => `${r.name} — ${r.role}`));
  await Promise.all(
    wave1.map(async (repo, idx) => {
      tracker.updateStream(idx, "engineering");
      tracker.updateStreamModel(idx, MODELS.primary);
      tracker.updateStreamDetail(idx, "PM drafting specification…");
      await mockAgent(`pm:${repo.name}`, MODELS.primary, dur(1500 + Math.random() * 1000));
      tracker.updateStreamDetail(idx, "Implementing changes…");
      await mockAgent(`engineer:${repo.name}`, MODELS.primary, dur(3000 + Math.random() * 2000));
      tracker.updateStream(idx, "reviewing");
      tracker.updateStreamDetail(idx, "Code review…");
      await mockAgent(`reviewer:${repo.name}`, MODELS.primary, dur(1500 + Math.random() * 1000));
      tracker.updateStream(idx, "testing");
      tracker.updateStreamDetail(idx, "Running tests…");
      await sleep(dur(1000));
      tracker.updateStreamDetail(idx, "Complete");
      tracker.updateStream(idx, "done");
    }),
  );
  tracker.completePhase(wave1Key);

  // Wave 2
  const wave2Key = "fleet-wave-2-3";
  const wave2 = [repos[0], repos[3]];
  tracker.activatePhase(wave2Key);
  tracker.addLog(`🌊 Wave 2: ${wave2.map((r) => r.name).join(", ")}`);
  tracker.initStreams(wave2.map((r) => `${r.name} — ${r.role}`));
  await Promise.all(
    wave2.map(async (repo, idx) => {
      tracker.updateStream(idx, "engineering");
      tracker.updateStreamModel(idx, MODELS.primary);
      tracker.updateStreamDetail(idx, "PM drafting specification…");
      await mockAgent(`pm:${repo.name}`, MODELS.primary, dur(1500 + Math.random() * 1000));
      tracker.updateStreamDetail(idx, "Implementing changes…");
      await mockAgent(`engineer:${repo.name}`, MODELS.primary, dur(3500 + Math.random() * 2000));
      tracker.updateStream(idx, "reviewing");
      tracker.updateStreamDetail(idx, "Code review…");
      await mockAgent(`reviewer:${repo.name}`, MODELS.primary, dur(1500 + Math.random() * 1000));
      tracker.updateStream(idx, "testing");
      tracker.updateStreamDetail(idx, "Running tests…");
      await sleep(dur(1000));
      tracker.updateStreamDetail(idx, "Complete");
      tracker.updateStream(idx, "done");
    }),
  );
  tracker.completePhase(wave2Key);

  // Cross-repo review
  const reviewKey = "fleet-cross-review-4";
  tracker.activatePhase(reviewKey);
  tracker.setActiveAgent("checking cross-repo consistency…");
  tracker.streams = [];
  await mockAgent("fleet-reviewer", MODELS.review, dur(3000));
  tracker.addLog("Cross-repo review: FLEET_APPROVED");
  tracker.setActiveAgent(null);
  tracker.completePhase(reviewKey);

  // Summary
  const summaryKey = "fleet-summary-5";
  tracker.activatePhase(summaryKey);
  tracker.setActiveAgent("generating summary…");
  await sleep(dur(800));
  tracker.setActiveAgent(null);
  tracker.completePhase(summaryKey);

  tracker.addLog("🐝 Fleet run complete");
  await sleep(dur(1500));
  tui.stop();
  printDemoSummary("fleet (multi-repo)");
}

// ---------------------------------------------------------------------------
// Scenario: Plan
// ---------------------------------------------------------------------------

async function runPlan() {
  initTracker();
  tracker.initPhases([
    { phase: "plan-prereqs" },
    { phase: "plan-analyze" },
    { phase: "plan-clarify" },
    { phase: "plan-eng-clarify" },
    { phase: "plan-design-clarify" },
    { phase: "plan-review" },
    { phase: "plan-cross-review" },
  ]);
  tui.start();
  await recordRunStart(cfg);

  const prereqKey = "plan-prereqs-0";
  tracker.activatePhase(prereqKey);
  tracker.setActiveAgent("pre-analyzing codebase…");
  await mockAgent("scout", MODELS.fast, dur(1500));
  tracker.setActiveAgent(null);
  tracker.completePhase(prereqKey);

  const analyzeKey = "plan-analyze-1";
  tracker.activatePhase(analyzeKey);
  tracker.setActiveAgent("analyzing technical requirements…");
  await mockAgent("tech-analyst", MODELS.primary, dur(2500));
  tracker.setActiveAgent(null);
  tracker.completePhase(analyzeKey);

  const clarifyKey = "plan-clarify-2";
  tracker.activatePhase(clarifyKey);
  tracker.setActiveAgent("clarifying requirements…");
  await mockAgent("pm", MODELS.primary, dur(2000));
  tracker.setActiveAgent(null);
  tracker.completePhase(clarifyKey);

  const engKey = "plan-eng-clarify-3";
  tracker.activatePhase(engKey);
  tracker.setActiveAgent("engineer reviewing feasibility…");
  await mockAgent("engineer", MODELS.primary, dur(2000));
  tracker.setActiveAgent(null);
  tracker.completePhase(engKey);

  const designKey = "plan-design-clarify-4";
  tracker.activatePhase(designKey);
  tracker.setActiveAgent("designer reviewing UX approach…");
  await mockAgent("designer", MODELS.primary, dur(1800));
  tracker.setActiveAgent(null);
  tracker.completePhase(designKey);

  const reviewKey = "plan-review-5";
  tracker.activatePhase(reviewKey);
  tracker.setActiveAgent("reviewing plan…");
  await mockAgent("plan-reviewer", MODELS.primary, dur(1500));
  tracker.setActiveAgent(null);
  tracker.completePhase(reviewKey);

  const crossKey = "plan-cross-review-6";
  tracker.activatePhase(crossKey);
  tracker.setActiveAgent("cross-model plan validation…");
  await mockAgent("cross-model-reviewer", MODELS.review, dur(2000));
  tracker.setActiveAgent(null);
  tracker.completePhase(crossKey);

  tracker.addLog("🐝 Plan complete — implementation-plan.md written");
  await sleep(dur(1500));
  tui.stop();
  printDemoSummary("plan");
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runDemo(config: SwarmConfig): Promise<void> {
  cfg = config;

  console.log("");
  console.log("  ╔══════════════════════════════════════════════════╗");
  console.log("  ║            🐝  Copilot Swarm — Intro            ║");
  console.log("  ╚══════════════════════════════════════════════════╝");
  console.log("");
  console.log("  This walkthrough shows how the TUI looks for each");
  console.log("  mode. All demos run in fast-forward with mock data.");

  let running = true;
  while (running) {
    const choice = await ask("What would you like to see?", [
      { key: "1", label: "Analyze — deep codebase analysis" },
      { key: "2", label: "Plan — multi-agent planning pipeline" },
      { key: "3", label: "Run — full single-repo implementation" },
      { key: "4", label: "Run (auto-model) — smart model selection per task" },
      { key: "5", label: "Digest — concise highlights of a completed run" },
      { key: "6", label: "Fleet — multi-repo orchestration" },
      { key: "7", label: "Stats — view agent usage statistics" },
      { key: "q", label: "Quit" },
    ]);

    switch (choice) {
      case "1": {
        console.log("\n  ▶ Starting Analyze demo…\n");
        await sleep(500);
        await runAnalyze();
        break;
      }
      case "2": {
        console.log("\n  ▶ Starting Plan demo…\n");
        await sleep(500);
        await runPlan();
        break;
      }
      case "3": {
        console.log("\n  ▶ Starting single-repo Run demo…\n");
        await sleep(500);
        await runSingleRepo();
        break;
      }
      case "4": {
        console.log("\n  ▶ Starting Run (auto-model) demo…\n");
        await sleep(500);
        await runSingleRepoAutoModel();
        break;
      }
      case "5": {
        console.log("\n  ▶ Showing Digest demo…\n");
        await sleep(500);
        await runDigestDemo();
        break;
      }
      case "6": {
        console.log("\n  ▶ Starting Fleet (multi-repo) demo…\n");
        await sleep(500);
        await runFleet();
        break;
      }
      case "7": {
        const stats = await loadStats(cfg);
        console.log("");
        console.log(formatStats(stats));
        break;
      }
      case "q": {
        running = false;
        break;
      }
    }
  }

  console.log("\n  👋 Bye!\n");
}
