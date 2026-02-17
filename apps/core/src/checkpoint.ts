import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import { latestPointerPath, runDir, swarmRoot } from "./paths.js";

/** Snapshot of a single review/QA iteration's progress. */
export interface IterationSnapshot {
  content: string;
  completedIterations: number;
}

/** A question-answer pair from an interactive clarification round. */
export interface QAPair {
  question: string;
  answer: string;
}

export interface PipelineCheckpoint {
  completedPhases: string[];
  spec: string;
  tasks: string[];
  designSpec: string;
  streamResults: string[];
  issueBody: string;
  runId: string;
  /** Distinguishes run-mode, plan-mode, or analyze-mode checkpoints. */
  mode?: "run" | "plan" | "analyze";
  /** Phase key that was actively executing when the checkpoint was saved. */
  activePhase?: string;
  /** Draft content produced by the main agent before review loops began. */
  phaseDraft?: string;
  /** Iteration progress within review/QA loops, keyed by stable identifiers. */
  iterationProgress?: Record<string, IterationSnapshot>;
  /** Plan-mode: refined engineering decisions. */
  engDecisions?: string;
  /** Plan-mode: refined design decisions. */
  designDecisions?: string;
  /** Plan-mode: technical analysis output. */
  analysis?: string;
  /** Answered Q&A pairs from interactive clarification rounds, keyed by phase. */
  answeredQuestions?: Record<string, QAPair[]>;
}

/** Resolve checkpoint path — inside the run dir for new runs, or from latest pointer on resume. */
async function checkpointPath(config: SwarmConfig): Promise<string> {
  if (config.resume) {
    const latestRunId = await resolveLatestRunId(config);
    if (latestRunId) {
      return path.join(swarmRoot(config), "runs", latestRunId, "checkpoint.json");
    }
  }
  return path.join(runDir(config), "checkpoint.json");
}

async function resolveLatestRunId(config: SwarmConfig): Promise<string | null> {
  try {
    return (await fs.readFile(latestPointerPath(config), "utf-8")).trim();
  } catch {
    return null;
  }
}

export async function saveCheckpoint(config: SwarmConfig, checkpoint: PipelineCheckpoint): Promise<void> {
  const dir = runDir(config);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "checkpoint.json");
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));

  // Update latest pointer
  const root = swarmRoot(config);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(latestPointerPath(config), config.runId);
}

export async function loadCheckpoint(config: SwarmConfig): Promise<PipelineCheckpoint | null> {
  const filePath = await checkpointPath(config);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as PipelineCheckpoint;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(config: SwarmConfig): Promise<void> {
  const filePath = await checkpointPath(config);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist
  }
}
