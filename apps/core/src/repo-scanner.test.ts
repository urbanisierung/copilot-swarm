import { describe, expect, it } from "vitest";
import { partitionChunks, type ScoutResult } from "./repo-scanner.js";

function makeScout(overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    totalFiles: 100,
    readme: "# Test Project",
    topLevelDirs: [],
    rootFiles: ["package.json", "README.md"],
    ...overrides,
  };
}

describe("partitionChunks", () => {
  it("returns empty array when no directories exist", () => {
    const scout = makeScout({ topLevelDirs: [] });
    expect(partitionChunks(scout, 300)).toEqual([]);
  });

  it("groups small directories into a single chunk", () => {
    const scout = makeScout({
      topLevelDirs: [
        { name: "src", fileCount: 50, children: ["utils", "lib"] },
        { name: "tests", fileCount: 20, children: [] },
      ],
    });
    const chunks = partitionChunks(scout, 300);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].directories).toContain(".");
    expect(chunks[0].directories).toContain("src");
    expect(chunks[0].directories).toContain("tests");
  });

  it("splits directories into multiple chunks when exceeding max", () => {
    const scout = makeScout({
      topLevelDirs: [
        { name: "apps", fileCount: 200, children: ["frontend", "backend"] },
        { name: "packages", fileCount: 200, children: ["shared", "ui"] },
        { name: "docs", fileCount: 50, children: [] },
      ],
      rootFiles: [],
    });
    const chunks = partitionChunks(scout, 250);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // All directories should be covered
    const allDirs = chunks.flatMap((c) => c.directories);
    expect(allDirs).toContain("apps");
    expect(allDirs).toContain("packages");
    expect(allDirs).toContain("docs");
  });

  it("splits a single large directory by its children", () => {
    const scout = makeScout({
      topLevelDirs: [{ name: "src", fileCount: 600, children: ["auth", "api", "db", "utils", "models", "services"] }],
      rootFiles: [],
    });
    const chunks = partitionChunks(scout, 300);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // All chunks should reference src/ subdirectories
    for (const chunk of chunks) {
      for (const dir of chunk.directories) {
        expect(dir).toMatch(/^src\//);
      }
    }
  });

  it("includes root files in the first chunk", () => {
    const scout = makeScout({
      topLevelDirs: [{ name: "src", fileCount: 50, children: [] }],
      rootFiles: ["package.json", "tsconfig.json"],
    });
    const chunks = partitionChunks(scout, 300);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].directories).toContain(".");
    expect(chunks[0].fileCount).toBe(52); // 50 + 2 root files
  });

  it("handles monorepo structure with apps and packages", () => {
    const scout = makeScout({
      topLevelDirs: [
        { name: "apps", fileCount: 150, children: ["web", "api", "admin"] },
        { name: "packages", fileCount: 120, children: ["ui", "config", "shared"] },
        { name: ".github", fileCount: 10, children: ["workflows"] },
        { name: "docs", fileCount: 30, children: [] },
      ],
      rootFiles: ["package.json"],
    });
    const chunks = partitionChunks(scout, 200);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("produces chunks with human-readable IDs", () => {
    const scout = makeScout({
      topLevelDirs: [
        { name: "apps", fileCount: 100, children: [] },
        { name: "packages", fileCount: 100, children: [] },
      ],
      rootFiles: [],
    });
    const chunks = partitionChunks(scout, 300);
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.id).not.toContain("/");
      expect(chunk.id).not.toContain(".");
    }
  });

  it("does not lose any directory in partitioning", () => {
    const dirs = [
      { name: "a", fileCount: 100, children: [] },
      { name: "b", fileCount: 100, children: [] },
      { name: "c", fileCount: 100, children: [] },
      { name: "d", fileCount: 100, children: [] },
      { name: "e", fileCount: 100, children: [] },
    ];
    const scout = makeScout({ topLevelDirs: dirs, rootFiles: [] });
    const chunks = partitionChunks(scout, 250);

    const allDirs = chunks.flatMap((c) => c.directories);
    for (const dir of dirs) {
      expect(allDirs).toContain(dir.name);
    }
  });

  it("handles deeply nested large directory with many children", () => {
    const children = Array.from({ length: 20 }, (_, i) => `module-${i}`);
    const scout = makeScout({
      topLevelDirs: [{ name: "src", fileCount: 2000, children }],
      rootFiles: [],
    });
    const chunks = partitionChunks(scout, 300);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Every chunk should have src/ prefixed directories
    for (const chunk of chunks) {
      for (const dir of chunk.directories) {
        expect(dir).toMatch(/^src\//);
      }
    }
  });
});
