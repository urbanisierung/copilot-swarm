import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import { FRONTEND_KEYWORDS, FRONTEND_MARKER } from "./constants.js";
import { rolesDir } from "./paths.js";

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
