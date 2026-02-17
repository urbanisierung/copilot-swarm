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

/** Record of a Copilot SDK session used during a phase or stream. */
export interface SessionRecord {
  sessionId: string;
  agent: string;
  /** The phase/stream role, e.g. "spec", "implement", "review", "qa". */
  role: string;
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
  mode?: "run" | "plan" | "analyze" | "review";
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
  /** Copilot SDK session IDs used during the run, keyed by phase/stream key. */
  sessionLog?: Record<string, SessionRecord>;
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

/** Context loaded from a previous run's output files. */
export interface PreviousRunContext {
  runId: string;
  spec: string;
  tasks: string[];
  designSpec: string;
  streamResults: string[];
}

/**
 * Load context from a previous run directory.
 * Reads the summary.md and individual role files to reconstruct the pipeline context.
 * If runId is not provided, reads from the latest pointer.
 */
export async function loadPreviousRun(config: SwarmConfig, runId?: string): Promise<PreviousRunContext | null> {
  const resolvedRunId = runId ?? (await resolveLatestRunId(config));
  if (!resolvedRunId) return null;

  const dir = path.join(swarmRoot(config), "runs", resolvedRunId);
  const rolesPath = path.join(dir, "roles");

  // Try to load the checkpoint first — it has structured data
  const checkpointFile = path.join(dir, "checkpoint.json");
  try {
    const content = await fs.readFile(checkpointFile, "utf-8");
    const cp = JSON.parse(content) as PipelineCheckpoint;
    return {
      runId: resolvedRunId,
      spec: cp.spec,
      tasks: cp.tasks,
      designSpec: cp.designSpec,
      streamResults: cp.streamResults,
    };
  } catch {
    // No checkpoint — reconstruct from output files
  }

  // Reconstruct from role summary files
  const readRole = async (name: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(rolesPath, `${name}.md`), "utf-8");
    } catch {
      return "";
    }
  };

  const spec = await readRole("pm");
  const designSpec = await readRole("designer");

  // Read stream results
  const streamResults: string[] = [];
  for (let i = 1; ; i++) {
    const content = await readRole(`engineer-stream-${i}`);
    if (!content) break;
    streamResults.push(content);
  }

  // Try to reconstruct tasks from decompose output
  const decomposeContent = await readRole("decompose-agent-tasks");
  const tasks: string[] = [];
  if (decomposeContent) {
    const lines = decomposeContent.split("\n");
    for (const line of lines) {
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) tasks.push(match[1]);
    }
  }
  // Ensure tasks array matches streamResults length
  while (tasks.length < streamResults.length) {
    tasks.push(`Task ${tasks.length + 1}`);
  }

  if (!spec && streamResults.length === 0) return null;

  return { runId: resolvedRunId, spec, tasks, designSpec, streamResults };
}
