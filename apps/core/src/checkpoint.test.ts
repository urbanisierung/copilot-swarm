import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PipelineCheckpoint } from "./checkpoint.js";
import { clearCheckpoint, loadCheckpoint, loadPreviousRun, saveCheckpoint } from "./checkpoint.js";
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
    reviewRunId: undefined,
    sessionId: undefined,
    autoModel: false,
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

  it("loads previous run context from checkpoint file", async () => {
    const config = makeConfig("test-review-source");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      mode: "run",
      completedPhases: ["spec-0", "decompose-1", "implement-2"],
      spec: "Build a login page",
      tasks: ["Create form component", "Add validation"],
      designSpec: "Use Carbon components",
      streamResults: ["// stream 1 code", "// stream 2 code"],
      issueBody: "Add login",
      runId: "test-review-source",
    };

    await saveCheckpoint(config, checkpoint);

    const prevRun = await loadPreviousRun(config);
    expect(prevRun).not.toBeNull();
    expect(prevRun?.runId).toBe("test-review-source");
    expect(prevRun?.spec).toBe("Build a login page");
    expect(prevRun?.tasks).toEqual(["Create form component", "Add validation"]);
    expect(prevRun?.designSpec).toBe("Use Carbon components");
    expect(prevRun?.streamResults).toEqual(["// stream 1 code", "// stream 2 code"]);
  });

  it("loads previous run context by explicit runId", async () => {
    const config = makeConfig("test-explicit-run");
    cleanupDirs.push(config.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      mode: "run",
      completedPhases: ["spec-0"],
      spec: "Explicit spec",
      tasks: ["Task A"],
      designSpec: "",
      streamResults: ["// code A"],
      issueBody: "test",
      runId: "test-explicit-run",
    };

    await saveCheckpoint(config, checkpoint);

    const prevRun = await loadPreviousRun(config, "test-explicit-run");
    expect(prevRun).not.toBeNull();
    expect(prevRun?.runId).toBe("test-explicit-run");
    expect(prevRun?.spec).toBe("Explicit spec");
  });

  it("resumes analyze-mode checkpoint across invocations via latest-analyze pointer", async () => {
    // Simulate first invocation: save an analyze checkpoint
    const config1 = makeConfig("analyze-run-1");
    (config1 as { command: string }).command = "analyze";
    cleanupDirs.push(config1.repoRoot);

    const checkpoint: PipelineCheckpoint = {
      mode: "analyze",
      completedPhases: ["analyze-scout-0", "analyze-chunk-chunk1"],
      spec: "",
      tasks: [],
      designSpec: "",
      streamResults: [],
      analysis: "partial analysis",
      issueBody: "",
      runId: "analyze-run-1",
      chunkResults: { chunk1: "chunk 1 result" },
      scoutOverview: "scout overview",
    };

    await saveCheckpoint(config1, checkpoint);

    // Simulate second invocation with --resume and a NEW runId
    const config2: SwarmConfig = {
      ...config1,
      runId: "analyze-run-2",
      resume: true,
    };

    const loaded = await loadCheckpoint(config2);
    expect(loaded).not.toBeNull();
    expect(loaded?.mode).toBe("analyze");
    expect(loaded?.completedPhases).toContain("analyze-scout-0");
    expect(loaded?.completedPhases).toContain("analyze-chunk-chunk1");
    expect(loaded?.chunkResults?.chunk1).toBe("chunk 1 result");
    expect(loaded?.scoutOverview).toBe("scout overview");
    expect(loaded?.analysis).toBe("partial analysis");
  });

  it("analyze latest pointer does not interfere with run latest pointer", async () => {
    const config = makeConfig("isolation-test");
    cleanupDirs.push(config.repoRoot);

    // Save a run checkpoint
    const runConfig: SwarmConfig = { ...config, runId: "run-1" };
    (runConfig as { command: string }).command = "run";
    await saveCheckpoint(runConfig, {
      mode: "run",
      completedPhases: ["spec-0"],
      spec: "run spec",
      tasks: [],
      designSpec: "",
      streamResults: [],
      issueBody: "run",
      runId: "run-1",
    });

    // Save an analyze checkpoint
    const analyzeConfig: SwarmConfig = { ...config, runId: "analyze-1" };
    (analyzeConfig as { command: string }).command = "analyze";
    await saveCheckpoint(analyzeConfig, {
      mode: "analyze",
      completedPhases: ["analyze-scout-0"],
      spec: "",
      tasks: [],
      designSpec: "",
      streamResults: [],
      issueBody: "",
      runId: "analyze-1",
      analysis: "analysis content",
    });

    // Resume run — should find run-1, not analyze-1
    const resumeRun: SwarmConfig = { ...config, runId: "run-2", resume: true };
    (resumeRun as { command: string }).command = "run";
    const loadedRun = await loadCheckpoint(resumeRun);
    expect(loadedRun?.runId).toBe("run-1");
    expect(loadedRun?.mode).toBe("run");

    // Resume analyze — should find analyze-1, not run-1
    const resumeAnalyze: SwarmConfig = { ...config, runId: "analyze-2", resume: true };
    (resumeAnalyze as { command: string }).command = "analyze";
    const loadedAnalyze = await loadCheckpoint(resumeAnalyze);
    expect(loadedAnalyze?.runId).toBe("analyze-1");
    expect(loadedAnalyze?.mode).toBe("analyze");
  });

  it("falls back to scanning runs when no mode-specific pointer exists (legacy checkpoints)", async () => {
    const config = makeConfig("legacy-scan");
    cleanupDirs.push(config.repoRoot);

    // Manually write an analyze checkpoint WITHOUT a latest-analyze pointer
    // (simulates checkpoints created before mode-specific pointers were added)
    const runsDir = path.join(config.repoRoot, ".swarm", "runs", "old-analyze-run");
    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(
      path.join(runsDir, "checkpoint.json"),
      JSON.stringify({
        mode: "analyze",
        completedPhases: ["analyze-scout-0"],
        spec: "",
        tasks: [],
        designSpec: "",
        streamResults: [],
        analysis: "legacy analysis",
        issueBody: "",
        runId: "old-analyze-run",
      }),
    );

    // Resume should find it via fallback scan
    const resumeConfig: SwarmConfig = { ...config, runId: "new-run", resume: true };
    (resumeConfig as { command: string }).command = "analyze";
    const loaded = await loadCheckpoint(resumeConfig);
    expect(loaded).not.toBeNull();
    expect(loaded?.mode).toBe("analyze");
    expect(loaded?.analysis).toBe("legacy analysis");
    expect(loaded?.completedPhases).toContain("analyze-scout-0");
  });
});
