import * as path from "node:path";
import type { SwarmConfig } from "./config.js";

/** Root .swarm directory. */
export function swarmRoot(config: SwarmConfig): string {
  return path.join(config.repoRoot, config.swarmDir);
}

/** Per-run directory: .swarm/runs/<runId>/ */
export function runDir(config: SwarmConfig): string {
  return path.join(swarmRoot(config), "runs", config.runId);
}

/** Role summaries inside a run: .swarm/runs/<runId>/roles/ */
export function rolesDir(config: SwarmConfig): string {
  return path.join(runDir(config), "roles");
}

/** Plans directory: .swarm/plans/ */
export function plansDir(config: SwarmConfig): string {
  return path.join(swarmRoot(config), "plans");
}

/** Analysis directory: .swarm/analysis/ */
export function analysisDir(config: SwarmConfig): string {
  return path.join(swarmRoot(config), "analysis");
}

/** Path to the repo analysis file: .swarm/analysis/repo-analysis.md */
export function analysisFilePath(config: SwarmConfig): string {
  return path.join(analysisDir(config), "repo-analysis.md");
}

/** Pointer to the latest run directory: .swarm/latest */
export function latestPointerPath(config: SwarmConfig): string {
  return path.join(swarmRoot(config), "latest");
}
