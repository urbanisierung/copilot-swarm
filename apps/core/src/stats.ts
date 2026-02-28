import * as fs from "node:fs/promises";
import type { SwarmConfig } from "./config.js";
import { statsFilePath } from "./paths.js";

/** Stats for a single agent. */
export interface AgentStats {
  invocations: number;
  totalElapsedMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  models: Record<string, number>;
}

/** Top-level stats structure stored in .swarm/stats.json. */
export interface SwarmStats {
  agents: Record<string, AgentStats>;
  totalRuns: number;
  lastUpdated: string;
}

function emptyStats(): SwarmStats {
  return { agents: {}, totalRuns: 0, lastUpdated: new Date().toISOString() };
}

export async function loadStats(config: SwarmConfig): Promise<SwarmStats> {
  try {
    const content = await fs.readFile(statsFilePath(config), "utf-8");
    return JSON.parse(content) as SwarmStats;
  } catch {
    return emptyStats();
  }
}

export async function saveStats(config: SwarmConfig, stats: SwarmStats): Promise<void> {
  const filePath = statsFilePath(config);
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(stats, null, 2));
}

/** Record a single agent invocation. */
export async function recordAgentInvocation(
  config: SwarmConfig,
  agentLabel: string,
  model: string,
  elapsedMs: number,
  inputTokens?: number,
  outputTokens?: number,
): Promise<void> {
  const stats = await loadStats(config);
  if (!stats.agents[agentLabel]) {
    stats.agents[agentLabel] = {
      invocations: 0,
      totalElapsedMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: {},
    };
  }
  const agent = stats.agents[agentLabel];
  agent.invocations += 1;
  agent.totalElapsedMs += elapsedMs;
  agent.totalInputTokens += inputTokens ?? 0;
  agent.totalOutputTokens += outputTokens ?? 0;
  agent.models[model] = (agent.models[model] ?? 0) + 1;
  stats.lastUpdated = new Date().toISOString();
  await saveStats(config, stats);
}

/** Increment the total runs counter. */
export async function recordRunStart(config: SwarmConfig): Promise<void> {
  const stats = await loadStats(config);
  stats.totalRuns += 1;
  stats.lastUpdated = new Date().toISOString();
  await saveStats(config, stats);
}

/** Format stats for CLI display. */
export function formatStats(stats: SwarmStats): string {
  const lines: string[] = [];
  lines.push("📊 Copilot Swarm Stats\n");
  lines.push(`Total runs: ${stats.totalRuns}`);
  lines.push(`Last updated: ${stats.lastUpdated}\n`);

  const agents = Object.entries(stats.agents);
  if (agents.length === 0) {
    lines.push("No agent invocations recorded yet.");
    return lines.join("\n");
  }

  // Sort by invocation count descending
  agents.sort((a, b) => b[1].invocations - a[1].invocations);

  const nameW = Math.max(8, ...agents.map(([n]) => n.length));
  const header = `  ${"Agent".padEnd(nameW)}  ${"Calls".padStart(6)}  ${"Total Time".padStart(11)}  ${"Avg Time".padStart(9)}  ${"Tokens In".padStart(10)}  ${"Tokens Out".padStart(11)}  Models`;
  lines.push(header);
  lines.push(
    `  ${"─".repeat(nameW)}  ${"─".repeat(6)}  ${"─".repeat(11)}  ${"─".repeat(9)}  ${"─".repeat(10)}  ${"─".repeat(11)}  ${"─".repeat(20)}`,
  );

  for (const [name, a] of agents) {
    const avgMs = a.invocations > 0 ? Math.round(a.totalElapsedMs / a.invocations) : 0;
    const models = Object.entries(a.models)
      .map(([m, c]) => `${m}(${c})`)
      .join(", ");
    const tokIn = a.totalInputTokens > 0 ? String(a.totalInputTokens) : "—";
    const tokOut = a.totalOutputTokens > 0 ? String(a.totalOutputTokens) : "—";
    lines.push(
      `  ${name.padEnd(nameW)}  ${String(a.invocations).padStart(6)}  ${fmtMs(a.totalElapsedMs).padStart(11)}  ${fmtMs(avgMs).padStart(9)}  ${tokIn.padStart(10)}  ${tokOut.padStart(11)}  ${models}`,
    );
  }

  return lines.join("\n");
}

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
