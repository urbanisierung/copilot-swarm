import { describe, expect, it } from "vitest";
import { hasFrontendWork, isFrontendTask, parseJsonArray, responseContains } from "./utils.js";

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
