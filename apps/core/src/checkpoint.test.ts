import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PipelineCheckpoint } from "./checkpoint.js";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";

function makeConfig(runId: string): SwarmConfig {
  const tmpDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}`);
  return {
    command: "run",
    repoRoot: tmpDir,
    verbose: false,
    resume: false,
    tui: false,
    planProvided: false,
    issueBody: "test",
    agentsDir: ".github/agents",
    swarmDir: ".swarm",
    runId,
    sessionTimeoutMs: 300_000,
    maxRetries: 2,
    maxAutoResume: 3,
  };
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  cleanupDirs.length = 0;
});

describe("checkpoint round-trip", () => {
  it("saves and loads a basic checkpoint", async () => {
    const config = makeConfig("test-basic");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      completedPhases: ["spec-0", "decompose-1"],
      spec: "test spec",
      tasks: ["task1", "task2"],
      designSpec: "design",
      streamResults: ["result1"],
      issueBody: "test issue",
      runId: "test-basic",
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded).toEqual(checkpoint);
  });

  it("saves and loads iteration progress", async () => {
    const config = makeConfig("test-iter");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      completedPhases: ["spec-0"],
      spec: "spec content",
      tasks: ["task1"],
      designSpec: "",
      streamResults: [],
      issueBody: "issue",
      runId: "test-iter",
      activePhase: "design-2",
      phaseDraft: "initial design draft",
      iterationProgress: {
        "review-0": { content: "revised after iteration 1", completedIterations: 1 },
        "review-1": { content: "revised after iteration 2", completedIterations: 2 },
      },
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded).toEqual(checkpoint);
    expect(loaded?.activePhase).toBe("design-2");
    expect(loaded?.phaseDraft).toBe("initial design draft");
    expect(loaded?.iterationProgress?.["review-0"]).toEqual({
      content: "revised after iteration 1",
      completedIterations: 1,
    });
  });

  it("saves and loads stream-level iteration progress", async () => {
    const config = makeConfig("test-stream-iter");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      completedPhases: ["spec-0", "decompose-1"],
      spec: "spec",
      tasks: ["task1", "task2"],
      designSpec: "design",
      streamResults: ["done", ""],
      issueBody: "issue",
      runId: "test-stream-iter",
      activePhase: "implement-3",
      iterationProgress: {
        "stream-0-code": { content: "initial code for stream 0", completedIterations: 0 },
        "stream-1-code": { content: "initial code for stream 1", completedIterations: 0 },
        "stream-1-review-0": { content: "revised stream 1 code", completedIterations: 1 },
      },
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded?.iterationProgress?.["stream-1-review-0"]).toEqual({
      content: "revised stream 1 code",
      completedIterations: 1,
    });
  });

  it("omits optional fields when not set", async () => {
    const config = makeConfig("test-no-iter");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      completedPhases: [],
      spec: "",
      tasks: [],
      designSpec: "",
      streamResults: [],
      issueBody: "issue",
      runId: "test-no-iter",
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded?.activePhase).toBeUndefined();
    expect(loaded?.phaseDraft).toBeUndefined();
    expect(loaded?.iterationProgress).toBeUndefined();
  });

  it("clears checkpoint", async () => {
    const config = makeConfig("test-clear");
    cleanupDirs.push(config.repoRoot);

    await saveCheckpoint(config, {
      completedPhases: ["spec-0"],
      spec: "s",
      tasks: [],
      designSpec: "",
      streamResults: [],
      issueBody: "i",
      runId: "test-clear",
      activePhase: "design-1",
      iterationProgress: { "review-0": { content: "c", completedIterations: 1 } },
    });

    await clearCheckpoint(config);
    const loaded = await loadCheckpoint(config);
    expect(loaded).toBeNull();
  });

  it("saves and loads a plan-mode checkpoint with plan-specific fields", async () => {
    const config = makeConfig("test-plan");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      mode: "plan",
      completedPhases: ["plan-clarify-0", "plan-review-1", "plan-eng-clarify-2"],
      spec: "refined requirements",
      engDecisions: "use REST API with pagination",
      designDecisions: "",
      analysis: "",
      tasks: [],
      designSpec: "",
      streamResults: [],
      issueBody: "Add search feature",
      runId: "test-plan",
      activePhase: "plan-review-3",
      iterationProgress: {
        "plan-review-3": { content: "revised eng decisions", completedIterations: 1 },
      },
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded).toEqual(checkpoint);
    expect(loaded?.mode).toBe("plan");
    expect(loaded?.engDecisions).toBe("use REST API with pagination");
    expect(loaded?.activePhase).toBe("plan-review-3");
    expect(loaded?.iterationProgress?.["plan-review-3"]?.completedIterations).toBe(1);
  });

  it("saves and loads an analyze-mode checkpoint with iteration progress", async () => {
    const config = makeConfig("test-analyze");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      mode: "analyze",
      completedPhases: ["analyze-architect-0", "analyze-review-1"],
      spec: "",
      tasks: [],
      designSpec: "",
      streamResults: [],
      analysis: "# Repository Analysis\n\n## Overview\nA CLI tool...",
      issueBody: "",
      runId: "test-analyze",
      activePhase: "analyze-architect-2",
      iterationProgress: {
        "analyze-architect-2-draft": {
          content: "cross-model draft analysis",
          completedIterations: 0,
        },
        "analyze-architect-2-review": {
          content: "revised analysis after review",
          completedIterations: 1,
        },
      },
    };

    await saveCheckpoint(config, checkpoint);
    const loaded = await loadCheckpoint(config);
    expect(loaded).toEqual(checkpoint);
    expect(loaded?.mode).toBe("analyze");
    expect(loaded?.analysis).toContain("Repository Analysis");
    expect(loaded?.activePhase).toBe("analyze-architect-2");
    expect(loaded?.iterationProgress?.["analyze-architect-2-draft"]?.content).toBe("cross-model draft analysis");
    expect(loaded?.iterationProgress?.["analyze-architect-2-review"]?.completedIterations).toBe(1);
  });
});
