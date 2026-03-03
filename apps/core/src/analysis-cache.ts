/**
 * Central analysis cache — stores repo analysis results independently of sessions/runs.
 * Keyed by git remote origin, with tree-hash-based staleness detection.
 *
 * Storage: ~/.config/copilot-swarm/analysis/<repo-key>/
 *   repo-analysis.md  — the cached analysis
 *   meta.json          — { remoteOrigin, treeHash, analyzedAt }
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface AnalysisMeta {
  remoteOrigin: string;
  treeHash: string;
  analyzedAt: string;
}

function cacheBaseDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg !== "" ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "copilot-swarm", "analysis");
}

/** Normalize a git remote URL into a filesystem-safe key. */
function repoKeyFromOrigin(origin: string): string {
  return origin
    .replace(/^(https?:\/\/|git@|ssh:\/\/)/, "")
    .replace(/\.git$/, "")
    .replace(/:/g, "-")
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function gitExec(args: string, cwd: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/** Get the remote origin URL for a repo (returns null if not a git repo or no remote). */
function getRemoteOrigin(repoPath: string): string | null {
  return gitExec("remote get-url origin", repoPath);
}

/** Get the tree hash of HEAD — captures the actual content state of the repo. */
function getTreeHash(repoPath: string): string | null {
  return gitExec("rev-parse HEAD^{tree}", repoPath);
}

/** Derive a stable cache key for a repo path. Uses remote origin when available, falls back to absolute path. */
export function getRepoKey(repoPath: string): string | null {
  const origin = getRemoteOrigin(repoPath);
  if (origin) return repoKeyFromOrigin(origin);
  // No remote — not cacheable across machines, but still useful locally
  return repoKeyFromOrigin(path.resolve(repoPath));
}

function cacheDirForKey(key: string): string {
  return path.join(cacheBaseDir(), key);
}

function loadMeta(cacheDir: string): AnalysisMeta | null {
  const metaPath = path.join(cacheDir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as AnalysisMeta;
  } catch {
    return null;
  }
}

/** Check if a cached analysis exists and is still fresh (tree hash matches). */
export function isCacheFresh(repoPath: string): boolean {
  const key = getRepoKey(repoPath);
  if (!key) return false;

  const cacheDir = cacheDirForKey(key);
  const meta = loadMeta(cacheDir);
  if (!meta) return false;

  const currentTree = getTreeHash(repoPath);
  if (!currentTree) return false;

  return meta.treeHash === currentTree;
}

/**
 * Get cached analysis content if it exists and is fresh.
 * Returns null if no cache, cache is stale, or repo has no remote origin.
 */
export function getCachedAnalysis(repoPath: string): string | null {
  const key = getRepoKey(repoPath);
  if (!key) return null;

  const cacheDir = cacheDirForKey(key);
  const meta = loadMeta(cacheDir);
  if (!meta) return null;

  const currentTree = getTreeHash(repoPath);
  if (!currentTree || meta.treeHash !== currentTree) return null;

  const analysisPath = path.join(cacheDir, "repo-analysis.md");
  if (!fs.existsSync(analysisPath)) return null;

  return fs.readFileSync(analysisPath, "utf-8");
}

/** Save analysis content to the central cache. */
export function saveToCentralCache(repoPath: string, content: string): void {
  const key = getRepoKey(repoPath);
  if (!key) return;

  const treeHash = getTreeHash(repoPath);
  if (!treeHash) return;

  const cacheDir = cacheDirForKey(key);
  fs.mkdirSync(cacheDir, { recursive: true });

  const origin = getRemoteOrigin(repoPath) ?? path.resolve(repoPath);
  const meta: AnalysisMeta = {
    remoteOrigin: origin,
    treeHash,
    analyzedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(cacheDir, "repo-analysis.md"), content, "utf-8");
  fs.writeFileSync(path.join(cacheDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
}
