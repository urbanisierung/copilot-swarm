import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";

const CHECKPOINT_FILE = ".swarm-checkpoint.json";

export interface PipelineCheckpoint {
  completedPhases: string[];
  spec: string;
  tasks: string[];
  designSpec: string;
  streamResults: string[];
  issueBody: string;
}

function checkpointPath(config: SwarmConfig): string {
  return path.join(config.repoRoot, CHECKPOINT_FILE);
}

export async function saveCheckpoint(config: SwarmConfig, checkpoint: PipelineCheckpoint): Promise<void> {
  await fs.writeFile(checkpointPath(config), JSON.stringify(checkpoint, null, 2));
}

export async function loadCheckpoint(config: SwarmConfig): Promise<PipelineCheckpoint | null> {
  const filePath = checkpointPath(config);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as PipelineCheckpoint;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(config: SwarmConfig): Promise<void> {
  try {
    await fs.unlink(checkpointPath(config));
  } catch {
    // File may not exist
  }
}
