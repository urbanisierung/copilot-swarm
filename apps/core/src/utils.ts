import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import { FRONTEND_KEYWORDS, FRONTEND_MARKER } from "./constants.js";
import { rolesDir } from "./paths.js";
import type { DecomposedTask } from "./pipeline-types.js";

/** Extract a JSON array from a response that may contain surrounding prose. */
export function parseJsonArray(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON array in response:\n${raw.substring(0, 200)}...`);
  }
  const parsed: unknown = JSON.parse(raw.substring(start, end + 1));
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new Error("Parsed JSON is not an array of strings.");
  }
  return parsed;
}

/** Write a timestamped role summary to the run's roles directory. */
export async function writeRoleSummary(config: SwarmConfig, role: string, content: string): Promise<void> {
  const dir = rolesDir(config);
  const timestamp = new Date().toISOString();
  const summary = `# ${role} Summary\n\n**Timestamp:** ${timestamp}\n\n${content}\n`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${role}.md`), summary);
}

/** Check whether any task in the list involves frontend work. */
export function hasFrontendWork(tasks: readonly string[]): boolean {
  return tasks.some((task) => {
    const lower = task.toLowerCase();
    return FRONTEND_KEYWORDS.some((kw) => lower.includes(kw));
  });
}

/** Check whether a task is marked as frontend work. */
export function isFrontendTask(task: string): boolean {
  return task.includes(FRONTEND_MARKER);
}

/** Check whether a response contains the given keyword (case-insensitive). */
export function responseContains(response: string, keyword: string): boolean {
  return response.toUpperCase().includes(keyword);
}

/**
 * Parse decomposed tasks with optional dependency info from PM response.
 * Accepts both flat string arrays (backward compat) and object arrays with id/task/dependsOn.
 */
export function parseDecomposedTasks(raw: string): DecomposedTask[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON array in response:\n${raw.substring(0, 200)}...`);
  }
  const parsed: unknown = JSON.parse(raw.substring(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Parsed JSON is not an array.");
  }
  if (parsed.length === 0) return [];

  // Flat string array → convert to DecomposedTask with no deps
  if (parsed.every((item): item is string => typeof item === "string")) {
    return parsed.map((task, i) => ({ id: i + 1, task, dependsOn: [] }));
  }

  // Object array with id/task/dependsOn
  return parsed.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Invalid task entry at index ${i}`);
    }
    const obj = item as Record<string, unknown>;
    return {
      id: typeof obj.id === "number" ? obj.id : i + 1,
      task: String(obj.task ?? ""),
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is number => typeof d === "number") : [],
    };
  });
}

/** Group task indices into execution waves based on dependency graph (topological sort). */
export function topologicalWaves(tasks: DecomposedTask[]): number[][] {
  if (tasks.length === 0) return [];

  const idToIdx = new Map<number, number>();
  for (let i = 0; i < tasks.length; i++) idToIdx.set(tasks[i].id, i);

  // Build per-index dependency sets
  const deps = tasks.map(
    (t) => new Set(t.dependsOn.map((id) => idToIdx.get(id)).filter((idx): idx is number => idx !== undefined)),
  );

  const waves: number[][] = [];
  const placed = new Set<number>();

  while (placed.size < tasks.length) {
    const wave: number[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (placed.has(i)) continue;
      if ([...deps[i]].every((d) => placed.has(d))) wave.push(i);
    }
    if (wave.length === 0) {
      // Circular dependency — place all remaining in final wave
      for (let i = 0; i < tasks.length; i++) {
        if (!placed.has(i)) wave.push(i);
      }
    }
    for (const idx of wave) placed.add(idx);
    waves.push(wave);
  }

  return waves;
}

// ---------------------------------------------------------------------------
// Token estimation & context budgeting
// ---------------------------------------------------------------------------

/** Estimate token count from character length (~4 chars per token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Group items into batches where each batch's total estimated tokens stays
 * within the given budget. Items are added greedily in order.
 * An item that exceeds the budget on its own gets its own single-item batch.
 */
export function batchByTokenBudget<T>(items: T[], getText: (item: T) => string, budget: number): T[][] {
  if (items.length === 0) return [];
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const tokens = estimateTokens(getText(item));
    if (current.length > 0 && currentTokens + tokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
