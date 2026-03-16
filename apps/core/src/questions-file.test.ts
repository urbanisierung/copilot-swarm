import { describe, expect, it } from "vitest";
import { parseQuestionsFile, splitNumberedQuestions, writeQuestionsFile } from "./questions-file.js";

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
