import * as path from "node:path";
import type { SwarmConfig } from "./config.js";

/** Root .swarm directory. */
export function swarmRoot(config: SwarmConfig): string {
  return path.join(config.repoRoot, config.swarmDir);
}

/** Session-scoped root. Falls back to swarmRoot if no session. */
export function sessionScopedRoot(config: SwarmConfig): string {
  if (config.resolvedSessionId) {
    return path.join(swarmRoot(config), "sessions", config.resolvedSessionId);
  }
  return swarmRoot(config);
}

/** Per-run directory: .swarm/sessions/<sid>/runs/<runId>/ (or .swarm/runs/<runId>/ legacy) */
export function runDir(config: SwarmConfig): string {
  return path.join(sessionScopedRoot(config), "runs", config.runId);
}

/** Role summaries inside a run: .swarm/sessions/<sid>/runs/<runId>/roles/ */
export function rolesDir(config: SwarmConfig): string {
  return path.join(runDir(config), "roles");
}

/** Plans directory: .swarm/sessions/<sid>/plans/ */
export function plansDir(config: SwarmConfig): string {
  return path.join(sessionScopedRoot(config), "plans");
}

/** Analysis directory: .swarm/sessions/<sid>/analysis/ */
export function analysisDir(config: SwarmConfig): string {
  return path.join(sessionScopedRoot(config), "analysis");
}

/** Brainstorms directory: .swarm/sessions/<sid>/brainstorms/ */
export function brainstormsDir(config: SwarmConfig): string {
  return path.join(sessionScopedRoot(config), "brainstorms");
}

/** Path to the repo analysis file: .swarm/sessions/<sid>/analysis/repo-analysis.md */
export function analysisFilePath(config: SwarmConfig): string {
  return path.join(analysisDir(config), "repo-analysis.md");
}

/** Chunk analysis directory: .swarm/sessions/<sid>/analysis/chunks/ */
export function analysisChunksDir(config: SwarmConfig): string {
  return path.join(analysisDir(config), "chunks");
}

/** Pointer to the latest run directory: .swarm/sessions/<sid>/latest */
export function latestPointerPath(config: SwarmConfig): string {
  return path.join(sessionScopedRoot(config), "latest");
}
