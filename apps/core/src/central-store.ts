/**
 * Central backup store — mirrors repo-local `.swarm/` artifacts to a
 * central location so they can be restored if the local copy is lost.
 *
 * Layout:
 *   ~/.config/copilot-swarm/backups/<repo-key>/
 *     sessions/<sessionId>/...   (mirrors .swarm/sessions/)
 *     stats.json                  (mirrors .swarm/stats.json)
 *
 * The repo-key is derived from the absolute repo path (slashes → dashes,
 * leading dash stripped) to keep it filesystem-safe and human-readable.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import { swarmRoot } from "./paths.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function centralBase(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg !== "" ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "copilot-swarm", "backups");
}

/** Derive a filesystem-safe key from the repo root path. */
export function repoKey(repoRoot: string): string {
  // /home/adam/github.com/org/repo → home-adam-github.com-org-repo
  return repoRoot.replace(/^\//, "").replace(/\\/g, "-").replace(/\//g, "-");
}

/** Central backup directory for a given repo. */
export function centralRepoDir(repoRoot: string): string {
  return path.join(centralBase(), repoKey(repoRoot));
}

// ---------------------------------------------------------------------------
// Sync (repo → central)
// ---------------------------------------------------------------------------

/**
 * Sync a single session directory to the central store.
 * Copies the entire `<swarmRoot>/sessions/<sessionId>/` subtree.
 */
export async function syncSession(config: SwarmConfig, sessionId: string): Promise<void> {
  const src = path.join(swarmRoot(config), "sessions", sessionId);
  const dest = path.join(centralRepoDir(config.repoRoot), "sessions", sessionId);
  await copyDirRecursive(src, dest);
}

/**
 * Sync the stats file to the central store.
 */
export async function syncStats(config: SwarmConfig): Promise<void> {
  const src = path.join(swarmRoot(config), "stats.json");
  const dest = path.join(centralRepoDir(config.repoRoot), "stats.json");
  try {
    await fs.access(src);
  } catch {
    return; // no stats file yet
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

/**
 * Full sync: all sessions + stats + changelog.
 */
export async function syncAll(config: SwarmConfig): Promise<number> {
  const root = swarmRoot(config);
  let count = 0;

  // Sync sessions
  const sessionsDir = path.join(root, "sessions");
  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await syncSession(config, entry.name);
        count++;
      }
    }
  } catch {
    // No sessions dir
  }

  // Sync stats.json
  await syncStats(config);

  // Sync changelog.md
  for (const file of ["changelog.md", "active-session"]) {
    const src = path.join(root, file);
    const dest = path.join(centralRepoDir(config.repoRoot), file);
    try {
      await fs.access(src);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    } catch {
      // File doesn't exist
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Restore (central → repo)
// ---------------------------------------------------------------------------

/**
 * Restore all backed-up files from the central store into the repo's `.swarm/`.
 * Returns the number of sessions restored.
 */
export async function restoreAll(config: SwarmConfig): Promise<number> {
  const centralDir = centralRepoDir(config.repoRoot);
  const root = swarmRoot(config);
  let count = 0;

  // Restore sessions
  const centralSessions = path.join(centralDir, "sessions");
  try {
    const entries = await fs.readdir(centralSessions, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const src = path.join(centralSessions, entry.name);
        const dest = path.join(root, "sessions", entry.name);
        await copyDirRecursive(src, dest);
        count++;
      }
    }
  } catch {
    // No central backup
  }

  // Restore individual files
  for (const file of ["stats.json", "changelog.md", "active-session"]) {
    const src = path.join(centralDir, file);
    const dest = path.join(root, file);
    try {
      await fs.access(src);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    } catch {
      // File doesn't exist in backup
    }
  }

  return count;
}

/**
 * List all repos that have central backups.
 */
export async function listBackedUpRepos(): Promise<Array<{ key: string; path: string; sessionCount: number }>> {
  const base = centralBase();
  const results: Array<{ key: string; path: string; sessionCount: number }> = [];
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionsDir = path.join(base, entry.name, "sessions");
      let sessionCount = 0;
      try {
        const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });
        sessionCount = sessions.filter((s) => s.isDirectory()).length;
      } catch {
        // No sessions
      }
      // Reconstruct path from key: home-adam-... → /home/adam/...
      const reconstructed = `/${entry.name.replace(/-/g, "/")}`;
      results.push({ key: entry.name, path: reconstructed, sessionCount });
    }
  } catch {
    // No backups dir
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively copy a directory, creating destination dirs as needed. */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  try {
    await fs.access(src);
  } catch {
    return; // source doesn't exist
  }

  const stat = await fs.stat(src);
  if (!stat.isDirectory()) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return;
  }

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = path.join(src, entry.name);
    const destChild = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcChild, destChild);
    } else {
      await fs.copyFile(srcChild, destChild);
    }
  }
}
