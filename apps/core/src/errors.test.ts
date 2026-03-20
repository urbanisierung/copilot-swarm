import { describe, expect, it } from "vitest";
import {
  applyRecoveryActions,
  buildRecoveryPrompt,
  ContextLengthError,
  estimateCallTokens,
  type PromptComponent,
  parseRecoveryActions,
  reducePrompt,
  shouldRetry,
} from "./errors.js";

// ---------------------------------------------------------------------------
// ContextLengthError
// ---------------------------------------------------------------------------

describe("ContextLengthError", () => {
  it("parses token counts from standard API error", () => {
    const err = new Error("CAPIError: 400 prompt token count of 137574 exceeds the limit of 136000");
    const ctxErr = ContextLengthError.fromError(err);
    expect(ctxErr).toBeInstanceOf(ContextLengthError);
    expect(ctxErr?.promptTokens).toBe(137574);
    expect(ctxErr?.limit).toBe(136000);
    expect(ctxErr?.overage).toBe(1574);
  });

  it("parses alternate token pattern", () => {
    const err = new Error("150000 tokens exceeds the maximum 128000");
    const ctxErr = ContextLengthError.fromError(err);
    expect(ctxErr).toBeInstanceOf(ContextLengthError);
    expect(ctxErr?.promptTokens).toBe(150000);
    expect(ctxErr?.limit).toBe(128000);
  });

  it("returns ContextLengthError with zero counts for unparseable context errors", () => {
    const err = new Error("context length exceeded");
    const ctxErr = ContextLengthError.fromError(err);
    expect(ctxErr).toBeInstanceOf(ContextLengthError);
    expect(ctxErr?.promptTokens).toBe(0);
    expect(ctxErr?.limit).toBe(0);
  });

  it("returns null for non-context-length errors", () => {
    expect(ContextLengthError.fromError(new Error("rate limit exceeded"))).toBeNull();
    expect(ContextLengthError.fromError(new Error("401 Unauthorized"))).toBeNull();
    expect(ContextLengthError.fromError("not an error")).toBeNull();
  });

  it("preserves original error as cause", () => {
    const original = new Error("token limit exceeded with 200000 tokens exceeds limit of 128000");
    const ctxErr = ContextLengthError.fromError(original);
    expect(ctxErr?.cause).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// shouldRetry
// ---------------------------------------------------------------------------

describe("shouldRetry", () => {
  it("returns false for context_length errors", () => {
    const err = new Error("context length exceeded");
    const decision = shouldRetry(err, 1, 5);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toContain("context length");
  });

  it("returns false for auth errors", () => {
    const decision = shouldRetry(new Error("401 Unauthorized"), 1, 5);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toContain("permanent");
  });

  it("returns true with backoff for transient errors", () => {
    const decision = shouldRetry(new Error("socket hang up"), 1, 5);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBeGreaterThan(0);
  });

  it("returns false when max attempts reached", () => {
    const decision = shouldRetry(new Error("socket hang up"), 5, 5);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("max attempts reached");
  });

  it("uses longer backoff for rate limit errors", () => {
    const rateLimitDecision = shouldRetry(new Error("rate limit exceeded"), 2, 5);
    const networkDecision = shouldRetry(new Error("socket hang up"), 2, 5);
    expect(rateLimitDecision.delayMs).toBeGreaterThan(networkDecision.delayMs);
  });
});

// ---------------------------------------------------------------------------
// estimateCallTokens
// ---------------------------------------------------------------------------

describe("estimateCallTokens", () => {
  it("calculates total tokens and overage", () => {
    const components: PromptComponent[] = [
      { label: "spec", content: "a".repeat(4000), priority: 1, droppable: false },
      { label: "task", content: "b".repeat(2000), priority: 0, droppable: false },
    ];
    const report = estimateCallTokens(components, 2000);
    expect(report.totalTokens).toBe(1500); // 1000 + 500
    expect(report.limit).toBe(1400); // 2000 * 0.7
    expect(report.overBudget).toBe(true);
    expect(report.overage).toBe(100);
    expect(report.components).toHaveLength(2);
  });

  it("reports within budget correctly", () => {
    const components: PromptComponent[] = [{ label: "task", content: "hello", priority: 0, droppable: false }];
    const report = estimateCallTokens(components, 128000);
    expect(report.overBudget).toBe(false);
    expect(report.overage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reducePrompt
// ---------------------------------------------------------------------------

describe("reducePrompt", () => {
  it("reduces high-priority components first", () => {
    const components: PromptComponent[] = [
      { label: "task", content: "a".repeat(400), priority: 0, droppable: false },
      { label: "spec", content: "b".repeat(4000), priority: 2, droppable: false },
      { label: "repo", content: "c".repeat(8000), priority: 5, droppable: true },
    ];
    // Budget: 2000 * 0.7 = 1400 tokens. Current: 100 + 1000 + 2000 = 3100
    const { components: reduced, succeeded } = reducePrompt(components, 2000);
    expect(succeeded).toBe(true);
    // Repo should be dropped or heavily truncated first (priority 5)
    const repo = reduced.find((c) => c.label === "repo");
    expect(repo?.content.length).toBeLessThan(8000);
    // Task should be untouched (priority 0)
    const task = reduced.find((c) => c.label === "task");
    expect(task?.content).toBe("a".repeat(400));
  });

  it("drops droppable components when truncation is insufficient", () => {
    const components: PromptComponent[] = [
      { label: "task", content: "a".repeat(400), priority: 0, droppable: false },
      { label: "extra", content: "c".repeat(40000), priority: 5, droppable: true },
    ];
    const { components: reduced, succeeded } = reducePrompt(components, 500);
    expect(succeeded).toBe(true);
    const extra = reduced.find((c) => c.label === "extra");
    expect(extra?.content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseRecoveryActions
// ---------------------------------------------------------------------------

describe("parseRecoveryActions", () => {
  it("parses valid JSON array of actions", () => {
    const raw = `[{"action":"truncate","label":"spec","maxTokens":8000},{"action":"drop","label":"repo"}]`;
    const actions = parseRecoveryActions(raw);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ action: "truncate", label: "spec", maxTokens: 8000 });
    expect(actions[1]).toEqual({ action: "drop", label: "repo" });
  });

  it("extracts JSON from markdown fencing", () => {
    const raw = '```json\n[{"action":"drop","label":"repo"}]\n```';
    const actions = parseRecoveryActions(raw);
    expect(actions).toHaveLength(1);
  });

  it("returns empty array for unparseable input", () => {
    expect(parseRecoveryActions("no json here")).toEqual([]);
    expect(parseRecoveryActions("{}")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyRecoveryActions
// ---------------------------------------------------------------------------

describe("applyRecoveryActions", () => {
  it("drops droppable components", () => {
    const components: PromptComponent[] = [
      { label: "task", content: "important", priority: 0, droppable: false },
      { label: "repo", content: "x".repeat(10000), priority: 5, droppable: true },
    ];
    const result = applyRecoveryActions(components, [{ action: "drop", label: "repo" }]);
    expect(result.find((c) => c.label === "repo")?.content).toBe("");
    expect(result.find((c) => c.label === "task")?.content).toBe("important");
  });

  it("truncates components to specified token limit", () => {
    const components: PromptComponent[] = [
      { label: "spec", content: "y".repeat(40000), priority: 2, droppable: false },
    ];
    const result = applyRecoveryActions(components, [{ action: "truncate", label: "spec", maxTokens: 1000 }]);
    const spec = result.find((c) => c.label === "spec") as PromptComponent;
    // 1000 tokens * 4 chars = 4000 chars + truncation message
    expect(spec.content.length).toBeLessThan(5000);
    expect(spec.content).toContain("truncated by AI recovery agent");
  });

  it("does not drop non-droppable components", () => {
    const components: PromptComponent[] = [{ label: "task", content: "critical", priority: 0, droppable: false }];
    const result = applyRecoveryActions(components, [{ action: "drop", label: "task" }]);
    expect(result.find((c) => c.label === "task")?.content).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// buildRecoveryPrompt
// ---------------------------------------------------------------------------

describe("buildRecoveryPrompt", () => {
  it("produces a prompt with component breakdown", () => {
    const err = new ContextLengthError(new Error("test"), 150000, 128000);
    const components: PromptComponent[] = [
      { label: "task", content: "a".repeat(400), priority: 0, droppable: false },
      { label: "spec", content: "b".repeat(20000), priority: 2, droppable: false },
    ];
    const prompt = buildRecoveryPrompt(err, components, 128000);
    expect(prompt).toContain("task: 100 tokens");
    expect(prompt).toContain("spec: 5000 tokens");
    expect(prompt).toContain("128000");
  });
});
