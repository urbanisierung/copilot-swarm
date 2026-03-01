/**
 * Digest command — show a concise highlights summary of a completed run.
 * Reads the latest (or specified) run's checkpoint/summary and uses the
 * fast model to produce a human-readable overview printed to stdout.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PipelineCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { latestPointerPath, sessionScopedRoot } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import { SessionManager } from "./session.js";

const DIGEST_INSTRUCTIONS = `You are a technical writer producing a concise run digest.

Given the artifacts from a completed swarm run (spec, tasks, stream results, verification status),
produce a SHORT highlights summary for a human reader. Focus on:

1. **What was done** — the goal and key changes (2-3 sentences max)
2. **Key decisions** — any notable design or implementation choices
3. **Files changed** — list the most important files modified
4. **Status** — whether verification passed, any issues remaining

Rules:
- Be concise — the entire summary should be under 30 lines
- Use bullet points, not prose
- Do NOT repeat the full spec or task list — summarize them
- Highlight anything surprising or noteworthy
- If verification failed, call that out prominently`;

/** Resolve the run ID to digest — from --run flag or latest pointer. */
async function resolveRunId(config: SwarmConfig): Promise<string | null> {
  if (config.reviewRunId) return config.reviewRunId;

  const pointerPath = latestPointerPath(config);
  try {
    return (await fs.readFile(pointerPath, "utf-8")).trim();
  } catch {
    return null;
  }
}

/** Collect run artifacts into a single text block for the digest agent. */
async function collectRunArtifacts(config: SwarmConfig, runId: string): Promise<string | null> {
  const dir = path.join(sessionScopedRoot(config), "runs", runId);
  const parts: string[] = [];

  parts.push(`# Run: ${runId}\n`);

  // Try checkpoint for structured data
  const cpPath = path.join(dir, "checkpoint.json");
  try {
    const content = await fs.readFile(cpPath, "utf-8");
    const cp = JSON.parse(content) as PipelineCheckpoint;

    if (cp.spec) {
      parts.push(`## Spec\n\n${truncate(cp.spec, 1500)}\n`);
    }
    if (cp.tasks.length > 0) {
      parts.push(`## Tasks (${cp.tasks.length})\n\n${cp.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`);
    }
    if (cp.completedPhases.length > 0) {
      parts.push(`## Completed Phases\n\n${cp.completedPhases.join(", ")}\n`);
    }
    if (cp.streamResults.length > 0) {
      parts.push(
        `## Stream Results\n\n${cp.streamResults.map((r, i) => `### Stream ${i + 1}\n\n${truncate(r, 800)}`).join("\n\n")}\n`,
      );
    }
  } catch {
    // No checkpoint — try summary.md
  }

  // Also try summary.md
  const summaryPath = path.join(dir, "summary.md");
  try {
    const summary = await fs.readFile(summaryPath, "utf-8");
    parts.push(`## Summary\n\n${truncate(summary, 2000)}\n`);
  } catch {
    // No summary file
  }

  // Try role files
  const rolesPath = path.join(dir, "roles");
  try {
    const entries = await fs.readdir(rolesPath);
    const roleFiles = entries.filter((f) => f.endsWith(".md")).sort();
    for (const file of roleFiles) {
      const content = await fs.readFile(path.join(rolesPath, file), "utf-8");
      const role = file.replace(/\.md$/, "");
      parts.push(`## Role: ${role}\n\n${truncate(content, 500)}\n`);
    }
  } catch {
    // No roles directory
  }

  if (parts.length <= 1) return null;
  return parts.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.substring(0, maxLen)}…`;
}

export async function runDigest(config: SwarmConfig, pipeline: PipelineConfig, logger: Logger): Promise<void> {
  const runId = await resolveRunId(config);
  if (!runId) {
    console.error(msg.digestNoRun);
    process.exit(1);
  }

  const artifacts = await collectRunArtifacts(config, runId);
  if (!artifacts) {
    console.error(msg.digestNoRun);
    process.exit(1);
  }

  logger.info(msg.digestStart);

  const sessions = new SessionManager(config, pipeline, logger);
  await sessions.start();

  try {
    const digest = await sessions.callIsolatedWithInstructions(
      DIGEST_INSTRUCTIONS,
      `Produce a concise highlights digest for this run:\n\n${artifacts}`,
      "Generating digest…",
      pipeline.fastModel,
      "digest",
      "digest-agent",
    );

    console.log("");
    console.log("─".repeat(48));
    console.log(`📋 Run Digest — ${runId}`);
    console.log("─".repeat(48));
    console.log("");
    console.log(digest);
    console.log("");
    console.log("─".repeat(48));
    logger.info(msg.digestComplete);
  } finally {
    await sessions.stop();
  }
}
