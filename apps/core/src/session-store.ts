/**
 * Session management for grouping related runs (analyze, plan, run, review)
 * under a single logical feature/project.
 *
 * Structure:
 *   .swarm/
 *     sessions/
 *       <sessionId>/
 *         session.json          # metadata
 *         runs/<runId>/         # run directories (same layout as before)
 *         plans/                # plan outputs
 *         analysis/             # analysis outputs
 *         latest                # latest run pointer within session
 *     active-session            # pointer to the active session ID
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";

export interface SwarmSession {
  id: string;
  name: string;
  created: string;
  description?: string;
}

const SESSIONS_DIR = "sessions";
const ACTIVE_SESSION_FILE = "active-session";

function sessionsRoot(config: SwarmConfig): string {
  return path.join(config.repoRoot, config.swarmDir, SESSIONS_DIR);
}

function activeSessionPath(config: SwarmConfig): string {
  return path.join(config.repoRoot, config.swarmDir, ACTIVE_SESSION_FILE);
}

function sessionDir(config: SwarmConfig, sessionId: string): string {
  return path.join(sessionsRoot(config), sessionId);
}

function sessionJsonPath(config: SwarmConfig, sessionId: string): string {
  return path.join(sessionDir(config, sessionId), "session.json");
}

/** Create a new session and set it as active. */
export async function createSession(config: SwarmConfig, name: string, description?: string): Promise<SwarmSession> {
  const id = generateSessionId();
  const session: SwarmSession = {
    id,
    name,
    created: new Date().toISOString(),
    description,
  };

  const dir = sessionDir(config, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(sessionJsonPath(config, id), JSON.stringify(session, null, 2));

  // Set as active
  await setActiveSession(config, id);

  return session;
}

/** List all sessions, sorted by creation date (newest first). */
export async function listSessions(config: SwarmConfig): Promise<SwarmSession[]> {
  const root = sessionsRoot(config);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const sessions: SwarmSession[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jsonPath = path.join(root, entry.name, "session.json");
      try {
        const content = await fs.readFile(jsonPath, "utf-8");
        sessions.push(JSON.parse(content) as SwarmSession);
      } catch {
        // Skip invalid session directories
      }
    }
    sessions.sort((a, b) => b.created.localeCompare(a.created));
    return sessions;
  } catch {
    return [];
  }
}

/** Get a session by ID. */
export async function getSession(config: SwarmConfig, sessionId: string): Promise<SwarmSession | null> {
  try {
    const content = await fs.readFile(sessionJsonPath(config, sessionId), "utf-8");
    return JSON.parse(content) as SwarmSession;
  } catch {
    return null;
  }
}

/** Get the active session ID. */
export async function getActiveSessionId(config: SwarmConfig): Promise<string | null> {
  try {
    return (await fs.readFile(activeSessionPath(config), "utf-8")).trim();
  } catch {
    return null;
  }
}

/** Set the active session. */
export async function setActiveSession(config: SwarmConfig, sessionId: string): Promise<void> {
  const root = path.join(config.repoRoot, config.swarmDir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(activeSessionPath(config), sessionId);
}

/**
 * Resolve the effective session ID for the current command.
 * Priority: CLI --session flag > active-session file > auto-create default.
 */
export async function resolveSessionId(config: SwarmConfig): Promise<string> {
  // 1. Explicit CLI flag
  if (config.sessionId) {
    const session = await getSession(config, config.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${config.sessionId}`);
    }
    return config.sessionId;
  }

  // 2. Active session pointer
  const activeId = await getActiveSessionId(config);
  if (activeId) {
    const session = await getSession(config, activeId);
    if (session) return activeId;
  }

  // 3. Auto-create a default session, migrating legacy runs if present
  return migrateOrCreateDefault(config);
}

/**
 * If legacy .swarm/runs/ exists, migrate into a "default" session.
 * Otherwise, create a fresh default session.
 */
async function migrateOrCreateDefault(config: SwarmConfig): Promise<string> {
  const swarmRootPath = path.join(config.repoRoot, config.swarmDir);
  const legacyRunsDir = path.join(swarmRootPath, "runs");
  const legacyPlansDir = path.join(swarmRootPath, "plans");
  const legacyAnalysisDir = path.join(swarmRootPath, "analysis");
  const legacyLatest = path.join(swarmRootPath, "latest");

  const session = await createSession(config, "default", "Auto-created default session");

  // Migrate legacy directories if they exist
  const sDir = sessionDir(config, session.id);
  for (const [src, dest] of [
    [legacyRunsDir, path.join(sDir, "runs")],
    [legacyPlansDir, path.join(sDir, "plans")],
    [legacyAnalysisDir, path.join(sDir, "analysis")],
    [legacyLatest, path.join(sDir, "latest")],
  ]) {
    try {
      await fs.access(src);
      await fs.rename(src, dest);
    } catch {
      // Source doesn't exist — skip
    }
  }

  return session.id;
}

function generateSessionId(): string {
  // Short readable ID: 8 hex chars
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
