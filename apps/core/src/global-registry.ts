/**
 * Global session registry — stores session records across all repos
 * in a central config directory (~/.config/copilot-swarm/sessions.json).
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface GlobalSessionRecord {
  sessionId: string;
  name: string;
  repoRoot: string;
  swarmDir: string;
  created: string;
  finished?: string;
}

interface RegistryData {
  sessions: GlobalSessionRecord[];
}

function registryDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg !== "" ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "copilot-swarm");
}

function registryPath(): string {
  return path.join(registryDir(), "sessions.json");
}

async function readRegistry(): Promise<RegistryData> {
  try {
    const content = await fs.readFile(registryPath(), "utf-8");
    return JSON.parse(content) as RegistryData;
  } catch {
    return { sessions: [] };
  }
}

async function writeRegistry(data: RegistryData): Promise<void> {
  const dir = registryDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(registryPath(), JSON.stringify(data, null, 2));
}

/** Register a new session in the global registry. */
export async function registerSession(record: GlobalSessionRecord): Promise<void> {
  const data = await readRegistry();
  // Deduplicate by sessionId + repoRoot
  data.sessions = data.sessions.filter((s) => !(s.sessionId === record.sessionId && s.repoRoot === record.repoRoot));
  data.sessions.unshift(record); // Newest first
  await writeRegistry(data);
}

/** Mark a session as finished in the global registry. */
export async function markRegistryFinished(sessionId: string, repoRoot: string): Promise<void> {
  const data = await readRegistry();
  for (const s of data.sessions) {
    if (s.sessionId === sessionId && s.repoRoot === repoRoot) {
      s.finished = new Date().toISOString();
      break;
    }
  }
  await writeRegistry(data);
}

/** List all sessions from the global registry, newest first. */
export async function listGlobalSessions(): Promise<GlobalSessionRecord[]> {
  const data = await readRegistry();
  return data.sessions;
}
