/**
 * Finish command — finalize a session (logical feature).
 *
 * Collects all run/plan/analysis artifacts from the session,
 * writes a summary entry to the central `.swarm/changelog.md`,
 * cleans up checkpoint files, and marks the session as finished.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PipelineCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import { swarmRoot } from "./paths.js";
import { getSession, type SwarmSession } from "./session-store.js";

/** A single entry appended to the changelog. */
export interface ChangelogEntry {
  sessionId: string;
  sessionName: string;
  finishedAt: string;
  originalRequest: string;
  phases: PhaseRecord[];
  runCount: number;
}

interface PhaseRecord {
  mode: string;
  runId: string;
  summary: string;
}

/** Collect all context from a session's artifacts and produce a changelog entry. */
export async function buildChangelogEntry(config: SwarmConfig, sessionId: string): Promise<ChangelogEntry | null> {
  const session = await getSession(config, sessionId);
  if (!session) return null;

  const sessionDir = path.join(swarmRoot(config), "sessions", sessionId);
  const phases: PhaseRecord[] = [];
  let originalRequest = "";

  // Collect plan artifacts
  const plansPath = path.join(sessionDir, "plans");
  const latestPlan = path.join(plansPath, "plan-latest.md");
  try {
    const content = await fs.readFile(latestPlan, "utf-8");
    const reqMatch = content.match(/## Original Request\n\n([\s\S]*?)(?=\n##|\n#[^#]|$)/);
    if (reqMatch) originalRequest = reqMatch[1].trim();
    phases.push({ mode: "plan", runId: "plan", summary: extractPlanSummary(content) });
  } catch {
    // No plan
  }

  // Collect analysis artifacts
  const analysisPath = path.join(sessionDir, "analysis", "repo-analysis.md");
  try {
    const content = await fs.readFile(analysisPath, "utf-8");
    phases.push({ mode: "analyze", runId: "analysis", summary: truncate(content, 500) });
  } catch {
    // No analysis
  }

  // Collect run artifacts (sorted chronologically)
  const runsPath = path.join(sessionDir, "runs");
  const runs = await listRunDirs(runsPath);
  for (const runId of runs) {
    const record = await collectRunRecord(runsPath, runId);
    if (record) {
      if (!originalRequest && record.issueBody) originalRequest = record.issueBody;
      phases.push(record);
    }
  }

  if (!originalRequest) originalRequest = "(no prompt recorded)";

  return {
    sessionId,
    sessionName: session.name,
    finishedAt: new Date().toISOString(),
    originalRequest,
    phases,
    runCount: runs.length,
  };
}

/** Remove checkpoint.json files from all runs in the session. */
export async function cleanupCheckpoints(config: SwarmConfig, sessionId: string): Promise<number> {
  const runsPath = path.join(swarmRoot(config), "sessions", sessionId, "runs");
  const runs = await listRunDirs(runsPath);
  let cleaned = 0;
  for (const runId of runs) {
    const cp = path.join(runsPath, runId, "checkpoint.json");
    try {
      await fs.unlink(cp);
      cleaned++;
    } catch {
      // Already gone
    }
  }
  return cleaned;
}

/** Mark session as finished by adding a `finished` timestamp to session.json. */
export async function markSessionFinished(config: SwarmConfig, sessionId: string): Promise<void> {
  const jsonPath = path.join(swarmRoot(config), "sessions", sessionId, "session.json");
  try {
    const content = await fs.readFile(jsonPath, "utf-8");
    const session = JSON.parse(content) as SwarmSession & { finished?: string };
    session.finished = new Date().toISOString();
    await fs.writeFile(jsonPath, JSON.stringify(session, null, 2));
  } catch {
    // Ignore if session file missing
  }
}

/** Append a changelog entry to .swarm/changelog.md */
export async function appendChangelog(config: SwarmConfig, entry: ChangelogEntry): Promise<string> {
  const changelogPath = path.join(swarmRoot(config), "changelog.md");

  const section = formatChangelogEntry(entry);

  let existing = "";
  try {
    existing = await fs.readFile(changelogPath, "utf-8");
  } catch {
    // First entry — write header
    existing = "# Copilot Swarm Changelog\n\nCompleted features and sessions.\n\n";
  }

  // Insert new entry after the header (newest first)
  const headerEnd = existing.indexOf("\n\n", existing.indexOf("\n\n") + 1);
  const before = existing.substring(0, headerEnd + 2);
  const after = existing.substring(headerEnd + 2);
  await fs.writeFile(changelogPath, `${before}${section}\n${after}`);

  return changelogPath;
}

// --- Internal helpers ---

function formatChangelogEntry(entry: ChangelogEntry): string {
  const date = entry.finishedAt.split("T")[0];
  const lines: string[] = [];

  lines.push(`## ${entry.sessionName}`);
  lines.push("");
  lines.push(`- **Session:** \`${entry.sessionId}\``);
  lines.push(`- **Finished:** ${date}`);
  lines.push(`- **Runs:** ${entry.runCount}`);
  lines.push("");
  lines.push("### Request");
  lines.push("");
  lines.push(truncate(entry.originalRequest, 500));
  lines.push("");

  if (entry.phases.length > 0) {
    lines.push("### Activity");
    lines.push("");
    for (const phase of entry.phases) {
      lines.push(`#### ${phase.mode} (${phase.runId})`);
      lines.push("");
      lines.push(phase.summary);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function listRunDirs(runsPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(runsPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function collectRunRecord(
  runsPath: string,
  runId: string,
): Promise<(PhaseRecord & { issueBody?: string }) | null> {
  const dir = path.join(runsPath, runId);

  // Try checkpoint first for structured data
  const cpPath = path.join(dir, "checkpoint.json");
  try {
    const content = await fs.readFile(cpPath, "utf-8");
    const cp = JSON.parse(content) as PipelineCheckpoint;
    return {
      mode: cp.mode ?? "run",
      runId,
      summary: buildRunSummary(cp),
      issueBody: cp.issueBody,
    };
  } catch {
    // Fall through
  }

  // Reconstruct from role files
  const rolesPath = path.join(dir, "roles");
  const roleSummaries = await collectRoleSummaries(rolesPath);
  if (roleSummaries.length === 0) return null;

  return {
    mode: "run",
    runId,
    summary: roleSummaries.join("\n\n"),
  };
}

function buildRunSummary(cp: PipelineCheckpoint): string {
  const parts: string[] = [];

  if (cp.completedPhases.length > 0) {
    parts.push(`**Completed phases:** ${cp.completedPhases.join(", ")}`);
  }

  if (cp.spec) {
    parts.push(`**Spec:** ${truncate(cp.spec, 200)}`);
  }

  if (cp.tasks.length > 0) {
    parts.push(`**Tasks:** ${cp.tasks.length} task(s)`);
    for (const task of cp.tasks) {
      parts.push(`  - ${truncate(task, 120)}`);
    }
  }

  if (cp.designSpec) {
    parts.push(`**Design spec:** ${truncate(cp.designSpec, 150)}`);
  }

  if (cp.streamResults.length > 0) {
    parts.push(`**Streams:** ${cp.streamResults.length} completed`);
  }

  return parts.join("\n");
}

async function collectRoleSummaries(rolesPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rolesPath);
    const summaries: string[] = [];
    for (const file of entries.filter((f) => f.endsWith(".md")).sort()) {
      const content = await fs.readFile(path.join(rolesPath, file), "utf-8");
      const role = file.replace(/\.md$/, "");
      summaries.push(`**${role}:** ${truncate(content, 200)}`);
    }
    return summaries;
  } catch {
    return [];
  }
}

function extractPlanSummary(planContent: string): string {
  // Try to extract the refined requirements section
  const refinedMatch = planContent.match(/## Refined Requirements\n\n([\s\S]*?)(?=\n##|\n#[^#]|$)/);
  if (refinedMatch) return truncate(refinedMatch[1].trim(), 500);
  // Fall back to truncated content (skip header)
  const bodyStart = planContent.indexOf("\n\n");
  return truncate(planContent.substring(bodyStart + 2), 500);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.substring(0, maxLen)}…`;
}
