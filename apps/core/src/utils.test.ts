import { describe, expect, it } from "vitest";
import {
  batchByTokenBudget,
  estimateTokens,
  hasFrontendWork,
  isFrontendTask,
  parseDecomposedTasks,
  parseJsonArray,
  responseContains,
  topologicalWaves,
} from "./utils.js";

describe("parseJsonArray", () => {
  it("extracts a JSON array from clean input", () => {
    expect(parseJsonArray('["task1", "task2"]')).toEqual(["task1", "task2"]);
  });

  it("extracts a JSON array surrounded by prose", () => {
    expect(parseJsonArray('Here are the tasks:\n["task1", "task2"]\nDone.')).toEqual(["task1", "task2"]);
  });

  it("throws on missing brackets", () => {
    expect(() => parseJsonArray("no array here")).toThrow("Could not find JSON array");
  });

  it("throws on non-string array elements", () => {
    expect(() => parseJsonArray("[1, 2, 3]")).toThrow("not an array of strings");
  });

  it("throws on mixed array", () => {
    expect(() => parseJsonArray('["ok", 42]')).toThrow("not an array of strings");
  });

  it("handles empty array", () => {
    expect(parseJsonArray("[]")).toEqual([]);
  });

  it("handles nested brackets in strings", () => {
    expect(parseJsonArray('["a [b]", "c"]')).toEqual(["a [b]", "c"]);
  });
});

describe("responseContains", () => {
  it("finds keyword case-insensitively", () => {
    expect(responseContains("The spec is APPROVED.", "APPROVED")).toBe(true);
    expect(responseContains("the spec is approved.", "APPROVED")).toBe(true);
  });

  it("returns false when keyword is absent", () => {
    expect(responseContains("Needs revision.", "APPROVED")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(responseContains("", "APPROVED")).toBe(false);
    expect(responseContains("APPROVED", "")).toBe(true);
  });
});

describe("hasFrontendWork", () => {
  it("detects frontend keywords", () => {
    expect(hasFrontendWork(["Build a React component"])).toBe(true);
    expect(hasFrontendWork(["Create a UI layout"])).toBe(true);
    expect(hasFrontendWork(["Add a new page"])).toBe(true);
  });

  it("returns false for backend-only tasks", () => {
    expect(hasFrontendWork(["Add API endpoint", "Fix database query"])).toBe(false);
  });

  it("handles empty array", () => {
    expect(hasFrontendWork([])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasFrontendWork(["FRONTEND task"])).toBe(true);
  });
});

describe("isFrontendTask", () => {
  it("detects [FRONTEND] marker", () => {
    expect(isFrontendTask("[FRONTEND] Build login form")).toBe(true);
  });

  it("returns false without marker", () => {
    expect(isFrontendTask("Add API endpoint")).toBe(false);
  });

  it("returns false for lowercase marker", () => {
    expect(isFrontendTask("[frontend] Build login form")).toBe(false);
  });
});

describe("parseDecomposedTasks", () => {
  it("parses flat string array as tasks with no deps", () => {
    const result = parseDecomposedTasks('["task A", "task B"]');
    expect(result).toEqual([
      { id: 1, task: "task A", dependsOn: [] },
      { id: 2, task: "task B", dependsOn: [] },
    ]);
  });

  it("parses object array with dependencies", () => {
    const input = JSON.stringify([
      { id: 1, task: "Create models", dependsOn: [] },
      { id: 2, task: "Build API", dependsOn: [1] },
    ]);
    const result = parseDecomposedTasks(input);
    expect(result).toEqual([
      { id: 1, task: "Create models", dependsOn: [] },
      { id: 2, task: "Build API", dependsOn: [1] },
    ]);
  });

  it("handles surrounding prose", () => {
    const result = parseDecomposedTasks('Here are the tasks:\n[{"id":1,"task":"A","dependsOn":[]}]\nDone.');
    expect(result).toEqual([{ id: 1, task: "A", dependsOn: [] }]);
  });

  it("handles empty array", () => {
    expect(parseDecomposedTasks("[]")).toEqual([]);
  });

  it("assigns sequential IDs when missing", () => {
    const input = JSON.stringify([
      { task: "A", dependsOn: [] },
      { task: "B", dependsOn: [] },
    ]);
    const result = parseDecomposedTasks(input);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });

  it("filters non-numeric dependsOn values", () => {
    const input = JSON.stringify([{ id: 1, task: "A", dependsOn: [1, "bad", null] }]);
    const result = parseDecomposedTasks(input);
    expect(result[0].dependsOn).toEqual([1]);
  });

  it("throws on missing brackets", () => {
    expect(() => parseDecomposedTasks("no array here")).toThrow("Could not find JSON array");
  });

  it("throws on invalid entry", () => {
    expect(() => parseDecomposedTasks("[42]")).toThrow("Invalid task entry");
  });
});

describe("topologicalWaves", () => {
  it("puts all independent tasks in one wave", () => {
    const tasks = [
      { id: 1, task: "A", dependsOn: [] as number[] },
      { id: 2, task: "B", dependsOn: [] as number[] },
      { id: 3, task: "C", dependsOn: [] as number[] },
    ];
    expect(topologicalWaves(tasks)).toEqual([[0, 1, 2]]);
  });

  it("creates sequential waves for linear deps", () => {
    const tasks = [
      { id: 1, task: "A", dependsOn: [] as number[] },
      { id: 2, task: "B", dependsOn: [1] },
      { id: 3, task: "C", dependsOn: [2] },
    ];
    expect(topologicalWaves(tasks)).toEqual([[0], [1], [2]]);
  });

  it("groups independent tasks in the same wave", () => {
    const tasks = [
      { id: 1, task: "Base", dependsOn: [] as number[] },
      { id: 2, task: "API", dependsOn: [1] },
      { id: 3, task: "Validation", dependsOn: [1] },
      { id: 4, task: "UI", dependsOn: [2, 3] },
    ];
    const waves = topologicalWaves(tasks);
    expect(waves).toEqual([[0], [1, 2], [3]]);
  });

  it("handles circular deps by dumping remainder", () => {
    const tasks = [
      { id: 1, task: "A", dependsOn: [2] },
      { id: 2, task: "B", dependsOn: [1] },
    ];
    // Both depend on each other — should be placed in a single wave
    expect(topologicalWaves(tasks)).toEqual([[0, 1]]);
  });

  it("handles empty input", () => {
    expect(topologicalWaves([])).toEqual([]);
  });

  it("ignores unknown dependency IDs", () => {
    const tasks = [
      { id: 1, task: "A", dependsOn: [99] },
      { id: 2, task: "B", dependsOn: [] as number[] },
    ];
    // ID 99 doesn't exist, so task 1 has no real deps
    expect(topologicalWaves(tasks)).toEqual([[0, 1]]);
  });
});

describe("estimateTokens", () => {
  it("estimates tokens from character count", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("a".repeat(101))).toBe(26);
  });
});

describe("batchByTokenBudget", () => {
  it("returns empty for empty input", () => {
    expect(batchByTokenBudget([], (s) => s, 1000)).toEqual([]);
  });

  it("puts everything in one batch when it fits", () => {
    const items = ["hello", "world"];
    const result = batchByTokenBudget(items, (s) => s, 1000);
    expect(result).toEqual([["hello", "world"]]);
  });

  it("splits into multiple batches based on token budget", () => {
    // Each item is 400 chars = 100 tokens. Budget of 150 tokens fits 1 item per batch.
    const items = ["a".repeat(400), "b".repeat(400), "c".repeat(400)];
    const result = batchByTokenBudget(items, (s) => s, 150);
    expect(result).toEqual([["a".repeat(400)], ["b".repeat(400)], ["c".repeat(400)]]);
  });

  it("groups items that fit together", () => {
    // Each item is 100 chars = 25 tokens. Budget of 60 fits 2 per batch.
    const items = ["a".repeat(100), "b".repeat(100), "c".repeat(100), "d".repeat(100), "e".repeat(100)];
    const result = batchByTokenBudget(items, (s) => s, 60);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual(["a".repeat(100), "b".repeat(100)]);
    expect(result[1]).toEqual(["c".repeat(100), "d".repeat(100)]);
    expect(result[2]).toEqual(["e".repeat(100)]);
  });

  it("puts oversized items in their own batch", () => {
    // Budget is 10 tokens (40 chars), but one item is 200 chars (50 tokens)
    const items = ["small", "a".repeat(200), "tiny"];
    const result = batchByTokenBudget(items, (s) => s, 10);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual(["small"]);
    expect(result[1]).toEqual(["a".repeat(200)]);
    expect(result[2]).toEqual(["tiny"]);
  });

  it("works with custom getText function", () => {
    const items = [{ text: "a".repeat(100) }, { text: "b".repeat(100) }];
    const result = batchByTokenBudget(items, (item) => item.text, 30);
    expect(result.length).toBe(2);
  });
});
