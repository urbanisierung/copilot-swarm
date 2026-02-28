#!/usr/bin/env npx tsx
/**
 * Mock TUI demo — exercises the TUI renderer and stats system
 * without connecting to any AI backend.
 *
 * Usage:
 *   npx tsx apps/core/scripts/demo-tui.ts              # full pipeline simulation
 *   npx tsx apps/core/scripts/demo-tui.ts --fast        # 2× speed
 *   npx tsx apps/core/scripts/demo-tui.ts --stats-only  # just print stats
 *
 * Or from the repo root:
 *   pnpm demo
 */

import * as crypto from "node:crypto";
import { ProgressTracker } from "../src/progress-tracker.js";
import { formatStats, loadStats, recordAgentInvocation, recordRunStart, type SwarmStats } from "../src/stats.js";
import { TuiRenderer } from "../src/tui-renderer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sid = () => crypto.randomUUID();

const fast = process.argv.includes("--fast");
const statsOnly = process.argv.includes("--stats-only");
const SPEED = fast ? 0.5 : 1;

/** Scale a duration by the current speed factor. */
const dur = (ms: number) => ms * SPEED;

// Minimal SwarmConfig stub — only the fields stats/paths need.
const mockConfig = {
  repoRoot: process.cwd(),
  swarmDir: ".swarm",
} as import("../src/config.js").SwarmConfig;

// ---------------------------------------------------------------------------
// Stats-only mode
// ---------------------------------------------------------------------------

if (statsOnly) {
  const stats = await loadStats(mockConfig);
  console.log(formatStats(stats));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Mock pipeline definition (matches the default swarm.config.yaml)
// ---------------------------------------------------------------------------

const PIPELINE = [
  { phase: "spec" },
  { phase: "decompose" },
  { phase: "design" },
  { phase: "implement" },
  { phase: "cross-model-review" },
  { phase: "verify" },
];

const TASKS = [
  "[FRONTEND] Add dark-mode toggle component",
  "Create theme persistence in localStorage",
  "Add CSS custom properties for theming",
];

const MODELS = {
  primary: "claude-sonnet-4",
  review: "gpt-4.1",
  fast: "claude-haiku-4.5",
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const tracker = new ProgressTracker();
tracker.runId = "demo-mock";
tracker.primaryModel = MODELS.primary;
tracker.reviewModel = MODELS.review;
tracker.version = "0.0.34-demo";
tracker.cwd = process.cwd();

const tui = new TuiRenderer(tracker);

/** Simulate an agent session: add → sleep → record stats → remove. */
async function mockAgent(label: string, model: string, durationMs: number): Promise<void> {
  const id = sid();
  tracker.addActiveAgent(id, label, model);
  tracker.addLog(`${label} started (${model})`);

  await sleep(durationMs);

  tracker.removeActiveAgent(id);
  tracker.addLog(`${label} finished`);

  // Record stats just like the real SessionManager does
  await recordAgentInvocation(mockConfig, label, model, durationMs);
}

async function run() {
  tracker.initPhases(PIPELINE);
  tui.start();

  // Record a run start
  await recordRunStart(mockConfig);

  // ── Phase 1: Spec ──
  const specKey = "spec-0";
  tracker.activatePhase(specKey);
  tracker.setActiveAgent("pm is drafting specification…");
  tracker.addLog("Starting PM specification");

  await mockAgent("pm", MODELS.primary, dur(3000));

  // review loop
  tracker.addLog("PM-reviewer reviewing specification");
  await mockAgent("pm-reviewer", MODELS.primary, dur(2000));

  tracker.addLog("Spec-reviewer reviewing specification");
  await mockAgent("spec-reviewer", MODELS.primary, dur(2000));

  tracker.setActiveAgent(null);
  tracker.completePhase(specKey);
  tracker.addLog("Specification complete");

  // ── Phase 2: Decompose ──
  const decompKey = "decompose-1";
  tracker.activatePhase(decompKey);
  tracker.setActiveAgent("decompose-agent is breaking down tasks…");
  tracker.addLog("Decomposing specification into tasks");

  await mockAgent("decompose-agent", MODELS.fast, dur(1500));

  tracker.setActiveAgent(null);
  tracker.completePhase(decompKey);
  tracker.addLog(`Decomposed into ${TASKS.length} tasks`);

  // ── Phase 3: Design ──
  const designKey = "design-2";
  tracker.activatePhase(designKey);
  tracker.setActiveAgent("designer is creating UI specification…");
  tracker.addLog("Starting design phase");

  await mockAgent("designer", MODELS.primary, dur(3000));

  tracker.addLog("Design-reviewer reviewing");
  await mockAgent("design-reviewer", MODELS.primary, dur(1500));

  tracker.setActiveAgent(null);
  tracker.completePhase(designKey);
  tracker.addLog("Design phase complete");

  // ── Phase 4: Implement ──
  const implKey = "implement-3";
  tracker.activatePhase(implKey);
  tracker.setActiveAgent(null);
  tracker.initStreams(TASKS);
  tracker.addLog("Launching implementation streams");

  // Run streams in parallel
  const streamWork = TASKS.map(async (task, idx) => {
    const label = `S${idx + 1}`;

    // Engineering
    tracker.updateStream(idx, "engineering");
    tracker.addLog(`${label}: engineering started`);
    await mockAgent("engineer", MODELS.primary, dur(4000 + Math.random() * 2000));

    // Code review
    tracker.updateStream(idx, "reviewing");
    tracker.addLog(`${label}: code review`);
    await mockAgent("code-reviewer", MODELS.primary, dur(2000 + Math.random() * 1000));

    // QA
    tracker.updateStream(idx, "testing");
    tracker.addLog(`${label}: QA testing`);
    await mockAgent("qa", MODELS.primary, dur(2000 + Math.random() * 1000));

    tracker.updateStream(idx, "done");
    tracker.addLog(`${label}: complete`);
  });

  await Promise.all(streamWork);

  tracker.completePhase(implKey);
  tracker.addLog("All streams complete");

  // ── Phase 5: Cross-model review ──
  const cmrKey = "cross-model-review-4";
  tracker.activatePhase(cmrKey);
  tracker.setActiveAgent("cross-model reviewer checking…");
  tracker.addLog("Cross-model review (different model)");

  await mockAgent("cross-model-reviewer", MODELS.review, dur(3000));
  await mockAgent("engineer", MODELS.primary, dur(2000));

  tracker.setActiveAgent(null);
  tracker.completePhase(cmrKey);
  tracker.addLog("Cross-model review complete");

  // ── Phase 6: Verify ──
  const verifyKey = "verify-5";
  tracker.activatePhase(verifyKey);
  tracker.setActiveAgent("running verification commands…");
  tracker.addLog("Running build verification");

  await sleep(dur(1500));
  tracker.addLog("✅ Build passed");
  await sleep(dur(1000));
  tracker.addLog("✅ Tests passed");
  await sleep(dur(800));
  tracker.addLog("✅ Lint passed");

  tracker.setActiveAgent(null);
  tracker.completePhase(verifyKey);
  tracker.addLog("Verification complete");

  // ── Done ──
  tracker.addLog("🐝 Swarm run complete");
  await sleep(dur(2000));

  tui.stop();

  // Print post-TUI summary
  const sec = Math.floor(tracker.elapsedMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const done = tracker.phases.filter((p) => p.status === "done").length;

  console.log("");
  console.log("─".repeat(60));
  console.log(`✅ Mock run completed in ${elapsed}`);
  console.log(`   Phases: ${done}/${tracker.totalPhaseCount}`);
  console.log(`   Streams: ${TASKS.length}/${TASKS.length} done`);
  console.log("─".repeat(60));

  // Show stats
  console.log("");
  const stats = await loadStats(mockConfig);
  console.log(formatStats(stats));
}

run().catch((err) => {
  tui.stop();
  console.error(err);
  process.exit(1);
});
