import { describe, expect, it } from "vitest";
import type { QAPair } from "./checkpoint.js";
import {
  parseConsolidatedQAPairs,
  parseConsolidatedQuestions,
  parseQuestionsFile,
  parseQuestionsFileAll,
  splitNumberedQuestions,
  writeQuestionsFile,
  writeQuestionsFileWithAnswers,
} from "./questions-file.js";

describe("splitNumberedQuestions", () => {
  it("splits numbered questions with dot format", () => {
    const raw = "1. What is the scope?\n2. Who is the target user?\n3. Should it support mobile?";
    const result = splitNumberedQuestions(raw);
    expect(result).toEqual(["What is the scope?", "Who is the target user?", "Should it support mobile?"]);
  });

  it("splits numbered questions with paren format", () => {
    const raw = "1) What is the scope?\n2) Who is the target user?";
    const result = splitNumberedQuestions(raw);
    expect(result).toEqual(["What is the scope?", "Who is the target user?"]);
  });

  it("handles multi-line questions", () => {
    const raw = "1. What is the scope?\n   Including all sub-features.\n2. Who is the target user?";
    const result = splitNumberedQuestions(raw);
    expect(result).toEqual(["What is the scope?\n   Including all sub-features.", "Who is the target user?"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitNumberedQuestions("")).toEqual([]);
    expect(splitNumberedQuestions("No numbered items here")).toEqual([]);
  });

  it("handles colon format", () => {
    const raw = "1: What is the scope?\n2: Who is the target?";
    const result = splitNumberedQuestions(raw);
    expect(result).toEqual(["What is the scope?", "Who is the target?"]);
  });
});

describe("writeQuestionsFile and parseQuestionsFile", () => {
  it("round-trips questions and answers", async () => {
    const roleQuestions: Record<string, string[]> = {
      "plan-clarify": ["What is the scope?", "Who is the target user?"],
      "plan-eng-clarify": ["What API format?"],
      "plan-design-clarify": ["Match existing style?"],
    };
    const meta = { sessionId: "test-session", request: "Add dark mode", timestamp: "2026-03-16T12:00:00Z" };

    // Write to string via a mock
    let written = "";
    const { writeQuestionsFile: write } = await import("./questions-file.js");

    // Use the actual writeQuestionsFile but capture output
    const tmpPath = "/tmp/test-questions.md";
    await write(tmpPath, roleQuestions, meta);
    const fs = await import("node:fs/promises");
    written = await fs.readFile(tmpPath, "utf-8");

    // Verify structure
    expect(written).toContain("# Plan Questions");
    expect(written).toContain("`plan-clarify`");
    expect(written).toContain("`plan-eng-clarify`");
    expect(written).toContain("`plan-design-clarify`");
    expect(written).toContain("What is the scope?");
    expect(written).toContain("What API format?");
    expect(written).toContain("**Answer:**");

    // Simulate user filling in answers
    written = written.replace(
      "> What is the scope?\n\n**Answer:**",
      "> What is the scope?\n\n**Answer:** Everything in the main app",
    );
    written = written.replace("> What API format?\n\n**Answer:**", "> What API format?\n\n**Answer:** REST with JSON");

    // Parse
    const parsed = parseQuestionsFile(written);
    expect(parsed["plan-clarify"]).toHaveLength(1);
    expect(parsed["plan-clarify"][0].question).toBe("What is the scope?");
    expect(parsed["plan-clarify"][0].answer).toBe("Everything in the main app");

    expect(parsed["plan-eng-clarify"]).toHaveLength(1);
    expect(parsed["plan-eng-clarify"][0].answer).toBe("REST with JSON");

    // Unanswered questions should be omitted
    expect(parsed["plan-design-clarify"]).toBeUndefined();

    // Clean up
    await fs.unlink(tmpPath);
  });

  it("handles empty answers gracefully", () => {
    const content = `# Plan Questions

## PM / Requirements (\`plan-clarify\`)

### Q1
> What is the scope?

**Answer:**


### Q2
> Who is the target?

**Answer:**

`;
    const parsed = parseQuestionsFile(content);
    // Both answers are empty — should return no pairs
    expect(parsed["plan-clarify"]).toBeUndefined();
  });

  it("handles multi-line answers", () => {
    const content = `# Plan Questions

## PM / Requirements (\`plan-clarify\`)

### Q1
> What is the scope?

**Answer:**
The scope includes:
- Feature A
- Feature B
- Feature C

## Engineering (\`plan-eng-clarify\`)

### Q1
> What API format?

**Answer:** REST
`;
    const parsed = parseQuestionsFile(content);
    expect(parsed["plan-clarify"]).toHaveLength(1);
    expect(parsed["plan-clarify"][0].answer).toContain("Feature A");
    expect(parsed["plan-clarify"][0].answer).toContain("Feature C");

    expect(parsed["plan-eng-clarify"]).toHaveLength(1);
    expect(parsed["plan-eng-clarify"][0].answer).toBe("REST");
  });

  it("handles inline answer on same line as marker", () => {
    const content = `# Plan Questions

## PM / Requirements (\`plan-clarify\`)

### Q1
> What is the scope?

**Answer:** Just the frontend
`;
    const parsed = parseQuestionsFile(content);
    expect(parsed["plan-clarify"]).toHaveLength(1);
    expect(parsed["plan-clarify"][0].answer).toBe("Just the frontend");
  });

  it("handles no questions for a role", async () => {
    const roleQuestions: Record<string, string[]> = {
      "plan-clarify": ["What is the scope?"],
      "plan-eng-clarify": [],
      "plan-design-clarify": ["Match existing style?"],
    };
    const meta = { sessionId: "test-session", request: "Add feature", timestamp: "2026-03-16T12:00:00Z" };

    const tmpPath = "/tmp/test-questions-empty.md";
    await writeQuestionsFile(tmpPath, roleQuestions, meta);
    const fs = await import("node:fs/promises");
    const written = await fs.readFile(tmpPath, "utf-8");

    expect(written).toContain("_No questions from this role._");
    await fs.unlink(tmpPath);
  });
});

describe("parseConsolidatedQuestions", () => {
  it("parses sections with numbered questions", () => {
    const raw = `## plan-clarify
1. What is the scope?
2. Who is the target user?

## plan-eng-clarify
1. What API format?

## plan-design-clarify
1. Match existing style?
2. Responsive breakpoints?`;

    const result = parseConsolidatedQuestions(raw);
    expect(result["plan-clarify"]).toEqual(["What is the scope?", "Who is the target user?"]);
    expect(result["plan-eng-clarify"]).toEqual(["What API format?"]);
    expect(result["plan-design-clarify"]).toEqual(["Match existing style?", "Responsive breakpoints?"]);
  });

  it("ignores unknown section headers", () => {
    const raw = `## plan-clarify
1. Question one

## unknown-section
1. Should be ignored

## plan-eng-clarify
1. Engineering question`;

    const result = parseConsolidatedQuestions(raw);
    expect(result["plan-clarify"]).toEqual(["Question one"]);
    expect(result["plan-eng-clarify"]).toEqual(["Engineering question"]);
    expect(result["unknown-section"]).toBeUndefined();
  });

  it("returns empty object for garbage input", () => {
    const result = parseConsolidatedQuestions("Just some random text without any sections");
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles preamble text before first section", () => {
    const raw = `Here are the consolidated questions:

## plan-clarify
1. What is the scope?`;

    const result = parseConsolidatedQuestions(raw);
    expect(result["plan-clarify"]).toEqual(["What is the scope?"]);
  });

  it("skips empty sections", () => {
    const raw = `## plan-clarify
1. What is the scope?

## plan-eng-clarify

## plan-design-clarify
1. Responsive?`;

    const result = parseConsolidatedQuestions(raw);
    expect(result["plan-clarify"]).toEqual(["What is the scope?"]);
    expect(result["plan-eng-clarify"]).toBeUndefined();
    expect(result["plan-design-clarify"]).toEqual(["Responsive?"]);
  });
});

describe("parseQuestionsFileAll", () => {
  it("returns all Q&A pairs including unanswered", () => {
    const content = `# Plan Questions

## PM / Requirements (\`plan-clarify\`)

### Q1
> What is the scope?

**Answer:** Everything

### Q2
> Who is the target?

**Answer:**

`;
    const result = parseQuestionsFileAll(content);
    expect(result["plan-clarify"]).toHaveLength(2);
    expect(result["plan-clarify"][0]).toEqual({ question: "What is the scope?", answer: "Everything" });
    expect(result["plan-clarify"][1]).toEqual({ question: "Who is the target?", answer: "" });
  });

  it("returns empty object for content with no questions", () => {
    const content = "# Plan Questions\n\nNothing here\n";
    const result = parseQuestionsFileAll(content);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("preserves multi-line answers", () => {
    const content = `# Plan Questions

## Engineering (\`plan-eng-clarify\`)

### Q1
> What API format?

**Answer:**
REST with JSON
Multiple endpoints needed

`;
    const result = parseQuestionsFileAll(content);
    expect(result["plan-eng-clarify"][0].answer).toBe("REST with JSON\nMultiple endpoints needed");
  });
});

describe("writeQuestionsFileWithAnswers", () => {
  it("writes Q&A pairs with answers preserved", async () => {
    const roleQAPairs: Record<string, QAPair[]> = {
      "plan-clarify": [
        { question: "What is the scope?", answer: "Everything in main app" },
        { question: "Who is the target?", answer: "" },
      ],
      "plan-eng-clarify": [{ question: "What API format?", answer: "REST" }],
      "plan-design-clarify": [],
    };
    const meta = { sessionId: "test-session", request: "Add dark mode", timestamp: "2026-03-16T12:00:00Z" };

    const tmpPath = "/tmp/test-qa-with-answers.md";
    await writeQuestionsFileWithAnswers(tmpPath, roleQAPairs, meta);
    const fs = await import("node:fs/promises");
    const written = await fs.readFile(tmpPath, "utf-8");

    expect(written).toContain("Everything in main app");
    expect(written).toContain("> What is the scope?");
    expect(written).toContain("> Who is the target?");
    expect(written).toContain("REST");
    expect(written).toContain("_No questions from this role._");

    await fs.unlink(tmpPath);
  });

  it("round-trips with parseQuestionsFileAll", async () => {
    const original: Record<string, QAPair[]> = {
      "plan-clarify": [
        { question: "Scope?", answer: "Full app" },
        { question: "Priority?", answer: "" },
      ],
      "plan-eng-clarify": [{ question: "API?", answer: "GraphQL" }],
      "plan-design-clarify": [{ question: "Style?", answer: "Material" }],
    };
    const meta = { sessionId: "s1", request: "Test", timestamp: "2026-01-01T00:00:00Z" };

    const tmpPath = "/tmp/test-qa-roundtrip.md";
    await writeQuestionsFileWithAnswers(tmpPath, original, meta);
    const fs = await import("node:fs/promises");
    const written = await fs.readFile(tmpPath, "utf-8");
    const parsed = parseQuestionsFileAll(written);

    expect(parsed["plan-clarify"]).toHaveLength(2);
    expect(parsed["plan-clarify"][0].question).toBe("Scope?");
    expect(parsed["plan-clarify"][0].answer).toBe("Full app");
    expect(parsed["plan-clarify"][1].question).toBe("Priority?");
    expect(parsed["plan-clarify"][1].answer).toBe("");

    expect(parsed["plan-eng-clarify"][0].answer).toBe("GraphQL");
    expect(parsed["plan-design-clarify"][0].answer).toBe("Material");

    await fs.unlink(tmpPath);
  });
});

describe("parseConsolidatedQAPairs", () => {
  it("parses questions with answers", () => {
    const raw = `## plan-clarify
1. What is the scope?
**Answer:** Everything

2. Who is the target?
**Answer:**

## plan-eng-clarify
1. What API format?
**Answer:** REST with JSON`;

    const result = parseConsolidatedQAPairs(raw);
    expect(result["plan-clarify"]).toHaveLength(2);
    expect(result["plan-clarify"][0]).toEqual({ question: "What is the scope?", answer: "Everything" });
    expect(result["plan-clarify"][1]).toEqual({ question: "Who is the target?", answer: "" });
    expect(result["plan-eng-clarify"][0]).toEqual({ question: "What API format?", answer: "REST with JSON" });
  });

  it("handles multi-line answers", () => {
    const raw = `## plan-clarify
1. What is the scope?
**Answer:** Line one
Line two
Line three

2. Next question
**Answer:**`;

    const result = parseConsolidatedQAPairs(raw);
    expect(result["plan-clarify"][0].answer).toBe("Line one\nLine two\nLine three");
    expect(result["plan-clarify"][1].answer).toBe("");
  });

  it("ignores unknown sections", () => {
    const raw = `## unknown-section
1. Should be ignored
**Answer:** ignored

## plan-clarify
1. Valid question
**Answer:** Valid answer`;

    const result = parseConsolidatedQAPairs(raw);
    expect(result["unknown-section"]).toBeUndefined();
    expect(result["plan-clarify"][0].answer).toBe("Valid answer");
  });

  it("returns empty object for garbage input", () => {
    const result = parseConsolidatedQAPairs("Just some random text");
    expect(Object.keys(result)).toHaveLength(0);
  });
});
