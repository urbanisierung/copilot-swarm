import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Summary of a top-level directory. */
export interface DirSummary {
  readonly name: string;
  readonly fileCount: number;
  /** Immediate subdirectory names (one level deep). */
  readonly children: string[];
}

/** Result of scanning the repository structure. */
export interface ScoutResult {
  readonly totalFiles: number;
  readonly readme: string;
  readonly topLevelDirs: DirSummary[];
  /** Files that live at the repo root (not in any directory). */
  readonly rootFiles: string[];
}

/** A chunk of directories to analyze together. */
export interface Chunk {
  readonly id: string;
  readonly label: string;
  readonly directories: string[];
  readonly fileCount: number;
}

/**
 * Scan the repository structure using `git ls-files` (respects .gitignore).
 * Returns total file count, root README content, and per-directory summaries.
 */
export async function scoutRepo(repoRoot: string): Promise<ScoutResult> {
  const raw = execSync("git ls-files", { cwd: repoRoot, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  const files = raw.split("\n").filter(Boolean);

  const rootFiles: string[] = [];
  const dirFiles = new Map<string, number>();
  const dirChildren = new Map<string, Set<string>>();

  for (const file of files) {
    const sep = file.indexOf("/");
    if (sep === -1) {
      rootFiles.push(file);
      continue;
    }
    const topDir = file.substring(0, sep);
    dirFiles.set(topDir, (dirFiles.get(topDir) ?? 0) + 1);

    // Track immediate children (second-level dirs)
    const rest = file.substring(sep + 1);
    const nextSep = rest.indexOf("/");
    if (nextSep !== -1) {
      const child = rest.substring(0, nextSep);
      if (!dirChildren.has(topDir)) dirChildren.set(topDir, new Set());
      dirChildren.get(topDir)?.add(child);
    }
  }

  const topLevelDirs: DirSummary[] = [...dirFiles.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, fileCount]) => ({
      name,
      fileCount,
      children: [...(dirChildren.get(name) ?? [])].sort(),
    }));

  let readme = "";
  try {
    readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf-8");
  } catch {
    // No README — that's fine
  }

  return { totalFiles: files.length, readme, topLevelDirs, rootFiles };
}

/**
 * Deterministically partition directories into chunks for parallel analysis.
 * Groups top-level directories respecting natural boundaries, capping each chunk
 * at `maxFilesPerChunk`. Small directories are merged together.
 */
export function partitionChunks(scout: ScoutResult, maxFilesPerChunk: number): Chunk[] {
  const { topLevelDirs, rootFiles } = scout;
  if (topLevelDirs.length === 0) return [];

  const chunks: Chunk[] = [];

  // Large directories get their own chunk (or are split by subdirectory)
  const pending: { name: string; fileCount: number }[] = [];

  for (const dir of topLevelDirs) {
    if (dir.fileCount > maxFilesPerChunk && dir.children.length > 1) {
      // Split large directory by its children
      flushPending(pending, chunks, maxFilesPerChunk);
      splitLargeDir(dir, chunks, maxFilesPerChunk);
    } else {
      pending.push({ name: dir.name, fileCount: dir.fileCount });
    }
  }

  flushPending(pending, chunks, maxFilesPerChunk);

  // Add root files to the first chunk (or create one if needed)
  if (rootFiles.length > 0) {
    if (chunks.length > 0) {
      const first = chunks[0];
      chunks[0] = {
        ...first,
        directories: [".", ...first.directories],
        fileCount: first.fileCount + rootFiles.length,
      };
    } else {
      chunks.push({
        id: "root",
        label: "Root files",
        directories: ["."],
        fileCount: rootFiles.length,
      });
    }
  }

  return chunks;
}

/** Flush accumulated small directories into chunks. */
function flushPending(pending: { name: string; fileCount: number }[], chunks: Chunk[], maxFiles: number): void {
  let currentDirs: string[] = [];
  let currentCount = 0;

  for (const dir of pending) {
    if (currentCount + dir.fileCount > maxFiles && currentDirs.length > 0) {
      chunks.push(buildChunk(currentDirs, currentCount));
      currentDirs = [];
      currentCount = 0;
    }
    currentDirs.push(dir.name);
    currentCount += dir.fileCount;
  }

  if (currentDirs.length > 0) {
    chunks.push(buildChunk(currentDirs, currentCount));
  }

  pending.length = 0;
}

/** Split a large directory into sub-chunks based on its children. */
function splitLargeDir(dir: DirSummary, chunks: Chunk[], maxFiles: number): void {
  // Approximate: distribute files evenly across children
  const perChild = Math.max(1, Math.floor(dir.fileCount / dir.children.length));
  let currentChildren: string[] = [];
  let currentCount = 0;

  for (const child of dir.children) {
    if (currentCount + perChild > maxFiles && currentChildren.length > 0) {
      const dirs = currentChildren.map((c) => `${dir.name}/${c}`);
      chunks.push({
        id: toChunkId(dirs),
        label: `${dir.name}/ (${currentChildren.join(", ")})`,
        directories: dirs,
        fileCount: currentCount,
      });
      currentChildren = [];
      currentCount = 0;
    }
    currentChildren.push(child);
    currentCount += perChild;
  }

  if (currentChildren.length > 0) {
    const dirs = currentChildren.map((c) => `${dir.name}/${c}`);
    chunks.push({
      id: toChunkId(dirs),
      label: `${dir.name}/ (${currentChildren.join(", ")})`,
      directories: dirs,
      fileCount: currentCount,
    });
  }
}

function buildChunk(dirs: string[], fileCount: number): Chunk {
  return {
    id: toChunkId(dirs),
    label: dirs.length === 1 ? `${dirs[0]}/` : `${dirs[0]}/ + ${dirs.length - 1} more`,
    directories: dirs,
    fileCount,
  };
}

function toChunkId(dirs: string[]): string {
  return dirs
    .map((d) => d.replace(/[/.]/g, "-"))
    .join("_")
    .replace(/^-+|-+$/g, "");
}
