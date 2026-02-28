#!/usr/bin/env npx tsx
/**
 * Mock Fleet TUI demo — simulates a multi-repo fleet pipeline run
 * without connecting to any AI backend.
 *
 * Usage:
 *   npx tsx apps/core/scripts/demo-fleet.ts              # full fleet simulation
 *   npx tsx apps/core/scripts/demo-fleet.ts --fast        # 2× speed
 *   npx tsx apps/core/scripts/demo-fleet.ts --stats-only  # just print stats
 *
 * Or from the repo root:
 *   pnpm demo:fleet
 */

import * as crypto from "node:crypto";
import { ProgressTracker } from "../src/progress-tracker.js";
import { formatStats, loadStats, recordAgentInvocation, recordRunStart } from "../src/stats.js";
import { TuiRenderer } from "../src/tui-renderer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sid = () => crypto.randomUUID();

const fast = process.argv.includes("--fast");
const statsOnly = process.argv.includes("--stats-only");
const SPEED = fast ? 0.5 : 1;

const dur = (ms: number) => ms * SPEED;

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
// Fleet repos
// ---------------------------------------------------------------------------

const REPOS = [
  { name: "api-gateway", role: "API Gateway (Node.js)" },
  { name: "user-service", role: "User microservice (Go)" },
  { name: "billing-service", role: "Billing microservice (Python)" },
  { name: "web-dashboard", role: "React frontend" },
  { name: "shared-types", role: "Shared TypeScript types" },
];

const MODELS = {
  primary: "claude-sonnet-4",
  review: "gpt-4.1",
  fast: "claude-haiku-4.5",
};

// Fleet phases mirror fleet-engine.ts
const FLEET_PHASES = [
  { phase: "fleet-analyze" },
  { phase: "fleet-strategize" },
  { phase: "fleet-wave-1" },
  { phase: "fleet-wave-2" },
  { phase: "fleet-cross-review" },
  { phase: "fleet-summary" },
];

// Add fleet phase names to tracker's display
const FLEET_PHASE_NAMES: Record<string, string> = {
  "fleet-analyze": "Analyze Repos",
  "fleet-strategize": "Cross-Repo Strategy",
  "fleet-wave-1": "Wave 1 — Foundation",
  "fleet-wave-2": "Wave 2 — Consumers",
  "fleet-cross-review": "Cross-Repo Review",
  "fleet-summary": "Summary",
};

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const tracker = new ProgressTracker();
tracker.runId = "fleet-demo-mock";
tracker.primaryModel = MODELS.primary;
tracker.reviewModel = MODELS.review;
tracker.version = "0.0.34-demo";
tracker.cwd = process.cwd();

// Inject fleet phase names
for (const [key, name] of Object.entries(FLEET_PHASE_NAMES)) {
  // Patch phase names via initPhases override
  (tracker as unknown as Record<string, unknown>)[`_fleetName_${key}`] = name;
}

const tui = new TuiRenderer(tracker);

/** Simulate an agent session. */
async function mockAgent(label: string, model: string, durationMs: number): Promise<void> {
  const id = sid();
  tracker.addActiveAgent(id, label, model);
  tracker.addLog(`${label} started (${model})`);
  await sleep(durationMs);
  tracker.removeActiveAgent(id);
  tracker.addLog(`${label} finished`);
  await recordAgentInvocation(mockConfig, label, model, durationMs);
}

async function run() {
  // Init phases with fleet-specific names
  tracker.phases = FLEET_PHASES.map((p, i) => ({
    key: `${p.phase}-${i}`,
    name: FLEET_PHASE_NAMES[p.phase] ?? p.phase,
    status: "pending" as const,
  }));

  tui.start();
  await recordRunStart(mockConfig);

  // ── Phase 1: Analyze all repos in parallel ──
  const analyzeKey = "fleet-analyze-0";
  tracker.activatePhase(analyzeKey);
  tracker.setActiveAgent("analyzing repositories…");
  tracker.addLog(`Analyzing ${REPOS.length} repositories in parallel`);

  // Spawn parallel analysis agents — one per repo
  const analyzeWork = REPOS.map(async (repo) => {
    tracker.addLog(`📂 Analyzing ${repo.name}…`);
    await mockAgent(`scout:${repo.name}`, MODELS.fast, dur(2000 + Math.random() * 2000));
    tracker.addLog(`📂 ${repo.name} analysis complete`);
  });
  await Promise.all(analyzeWork);

  tracker.setActiveAgent(null);
  tracker.completePhase(analyzeKey);
  tracker.addLog("All repo analyses complete");

  // ── Phase 2: Strategize — single strategist agent ──
  const stratKey = "fleet-strategize-1";
  tracker.activatePhase(stratKey);
  tracker.setActiveAgent("strategist planning cross-repo approach…");
  tracker.addLog("Fleet strategist analyzing dependencies");

  await mockAgent("fleet-strategist", MODELS.primary, dur(5000));

  tracker.addLog("Strategy: 2 waves, shared API contract identified");
  tracker.setActiveAgent(null);
  tracker.completePhase(stratKey);

  // ── Phase 3: Wave 1 — Foundation repos (shared-types, user-service, billing-service) ──
  const wave1Key = "fleet-wave-1-2";
  const wave1Repos = [REPOS[4], REPOS[1], REPOS[2]]; // shared-types, user-service, billing-service
  tracker.activatePhase(wave1Key);
  tracker.setActiveAgent(null);
  tracker.addLog(`🌊 Wave 1: ${wave1Repos.map((r) => r.name).join(", ")}`);

  // Show repos as streams
  tracker.initStreams(wave1Repos.map((r) => `${r.name} — ${r.role}`));

  const wave1Work = wave1Repos.map(async (repo, idx) => {
    // Each repo goes through: PM → implement → review
    tracker.updateStream(idx, "engineering");
    tracker.addLog(`${repo.name}: PM drafting spec`);
    await mockAgent(`pm:${repo.name}`, MODELS.primary, dur(2000 + Math.random() * 1000));

    tracker.addLog(`${repo.name}: engineering`);
    await mockAgent(`engineer:${repo.name}`, MODELS.primary, dur(4000 + Math.random() * 3000));

    tracker.updateStream(idx, "reviewing");
    tracker.addLog(`${repo.name}: code review`);
    await mockAgent(`reviewer:${repo.name}`, MODELS.primary, dur(2000 + Math.random() * 1000));

    tracker.updateStream(idx, "testing");
    tracker.addLog(`${repo.name}: verification`);
    await sleep(dur(1500 + Math.random() * 1000));
    tracker.addLog(`${repo.name}: ✅ build/test passed`);

    tracker.updateStream(idx, "done");
    tracker.addLog(`${repo.name}: complete`);
  });
  await Promise.all(wave1Work);

  tracker.completePhase(wave1Key);
  tracker.addLog("Wave 1 complete — foundation repos done");

  // ── Phase 4: Wave 2 — Consumer repos (api-gateway, web-dashboard) ──
  const wave2Key = "fleet-wave-2-3";
  const wave2Repos = [REPOS[0], REPOS[3]]; // api-gateway, web-dashboard
  tracker.activatePhase(wave2Key);
  tracker.setActiveAgent(null);
  tracker.addLog(`🌊 Wave 2: ${wave2Repos.map((r) => r.name).join(", ")}`);

  // Replace streams for wave 2
  tracker.initStreams(wave2Repos.map((r) => `${r.name} — ${r.role}`));

  const wave2Work = wave2Repos.map(async (repo, idx) => {
    tracker.updateStream(idx, "engineering");
    tracker.addLog(`${repo.name}: PM drafting spec (with wave 1 context)`);
    await mockAgent(`pm:${repo.name}`, MODELS.primary, dur(2500 + Math.random() * 1000));

    tracker.addLog(`${repo.name}: engineering`);
    await mockAgent(`engineer:${repo.name}`, MODELS.primary, dur(5000 + Math.random() * 3000));

    tracker.updateStream(idx, "reviewing");
    tracker.addLog(`${repo.name}: code review`);
    await mockAgent(`reviewer:${repo.name}`, MODELS.primary, dur(2500 + Math.random() * 1000));

    tracker.updateStream(idx, "testing");
    tracker.addLog(`${repo.name}: verification`);
    await sleep(dur(1500 + Math.random() * 1000));
    tracker.addLog(`${repo.name}: ✅ build/test passed`);

    tracker.updateStream(idx, "done");
    tracker.addLog(`${repo.name}: complete`);
  });
  await Promise.all(wave2Work);

  tracker.completePhase(wave2Key);
  tracker.addLog("Wave 2 complete — consumer repos done");

  // ── Phase 5: Cross-repo review ──
  const reviewKey = "fleet-cross-review-4";
  tracker.activatePhase(reviewKey);
  tracker.setActiveAgent("fleet-reviewer checking cross-repo consistency…");
  tracker.addLog("Cross-repo reviewer validating consistency");

  // Clear streams for review phase
  tracker.streams = [];

  await mockAgent("fleet-reviewer", MODELS.review, dur(4000));
  tracker.addLog("Cross-repo review: FLEET_APPROVED");

  tracker.setActiveAgent(null);
  tracker.completePhase(reviewKey);

  // ── Phase 6: Summary ──
  const summaryKey = "fleet-summary-5";
  tracker.activatePhase(summaryKey);
  tracker.setActiveAgent("generating fleet summary…");
  tracker.addLog("Generating fleet summary");

  await sleep(dur(1000));
  tracker.addLog("Summary written to .swarm/fleet/fleet-summary.md");

  tracker.setActiveAgent(null);
  tracker.completePhase(summaryKey);
  tracker.addLog("🐝 Fleet run complete");
  await sleep(dur(2000));

  tui.stop();

  // Post-TUI summary
  const sec = Math.floor(tracker.elapsedMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const elapsed = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const done = tracker.phases.filter((p) => p.status === "done").length;

  console.log("");
  console.log("─".repeat(60));
  console.log(`✅ Fleet mock run completed in ${elapsed}`);
  console.log(`   Phases: ${done}/${tracker.totalPhaseCount}`);
  console.log(`   Repos:  ${REPOS.length} (${REPOS.map((r) => r.name).join(", ")})`);
  console.log(`   Waves:  2`);
  console.log("─".repeat(60));

  console.log("");
  const stats = await loadStats(mockConfig);
  console.log(formatStats(stats));
}

run().catch((err) => {
  tui.stop();
  console.error(err);
  process.exit(1);
});
