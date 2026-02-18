import { describe, expect, it } from "vitest";
import { parsePipelineConfig } from "./pipeline-config.js";

const validAgents = {
  pm: "builtin:pm",
  reviewer: "builtin:pm-reviewer",
  engineer: "builtin:engineer",
  "code-reviewer": "builtin:eng-code-reviewer",
  tester: "builtin:tester",
  cross: "builtin:cross-model-reviewer",
};

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    primaryModel: "test-model",
    reviewModel: "test-review",
    agents: validAgents,
    pipeline: [
      {
        phase: "spec",
        agent: "pm",
        reviews: [{ agent: "reviewer", maxIterations: 2, approvalKeyword: "APPROVED" }],
      },
      { phase: "decompose", agent: "pm", frontendMarker: "[FRONTEND]" },
      {
        phase: "implement",
        parallel: true,
        agent: "engineer",
        reviews: [{ agent: "code-reviewer", maxIterations: 3, approvalKeyword: "APPROVED" }],
        qa: { agent: "tester", maxIterations: 5, approvalKeyword: "ALL_PASSED" },
      },
    ],
    ...overrides,
  };
}

describe("parsePipelineConfig", () => {
  it("parses a valid config", () => {
    const config = parsePipelineConfig(makeConfig());
    expect(config.primaryModel).toBe("test-model");
    expect(config.reviewModel).toBe("test-review");
    expect(config.pipeline).toHaveLength(3);
    expect(config.pipeline[0].phase).toBe("spec");
  });

  it("defaults models when not provided", () => {
    const raw = makeConfig();
    delete (raw as Record<string, unknown>).primaryModel;
    delete (raw as Record<string, unknown>).reviewModel;
    const config = parsePipelineConfig(raw);
    expect(config.primaryModel).toBe("claude-opus-4-6-fast");
    expect(config.reviewModel).toBe("gpt-5.2-codex");
  });

  it("rejects missing agents map", () => {
    expect(() => parsePipelineConfig(makeConfig({ agents: null }))).toThrow("agents");
  });

  it("rejects empty pipeline", () => {
    expect(() => parsePipelineConfig(makeConfig({ pipeline: [] }))).toThrow("non-empty array");
  });

  it("rejects unknown phase type", () => {
    expect(() => parsePipelineConfig(makeConfig({ pipeline: [{ phase: "unknown", agent: "pm" }] }))).toThrow(
      "Unknown phase type",
    );
  });

  it("rejects agent reference not defined in agents map", () => {
    expect(() =>
      parsePipelineConfig(
        makeConfig({
          pipeline: [
            {
              phase: "spec",
              agent: "nonexistent",
              reviews: [],
            },
          ],
        }),
      ),
    ).toThrow('Agent "nonexistent"');
  });

  it("rejects review step with missing maxIterations", () => {
    expect(() =>
      parsePipelineConfig(
        makeConfig({
          pipeline: [
            {
              phase: "spec",
              agent: "pm",
              reviews: [{ agent: "reviewer", approvalKeyword: "APPROVED" }],
            },
          ],
        }),
      ),
    ).toThrow("maxIterations");
  });

  it("rejects non-boolean parallel in implement phase", () => {
    expect(() =>
      parsePipelineConfig(
        makeConfig({
          pipeline: [
            {
              phase: "implement",
              parallel: "yes",
              agent: "engineer",
              reviews: [],
            },
          ],
        }),
      ),
    ).toThrow("parallel");
  });

  it("validates cross-model-review phase", () => {
    const config = parsePipelineConfig(
      makeConfig({
        pipeline: [
          {
            phase: "cross-model-review",
            agent: "cross",
            fixAgent: "engineer",
            maxIterations: 3,
            approvalKeyword: "APPROVED",
          },
        ],
      }),
    );
    expect(config.pipeline[0].phase).toBe("cross-model-review");
  });

  it("validates design phase with condition", () => {
    const agents = { ...validAgents, designer: "builtin:designer", "design-reviewer": "builtin:design-reviewer" };
    const config = parsePipelineConfig({
      agents,
      pipeline: [
        {
          phase: "design",
          condition: "hasFrontendTasks",
          agent: "designer",
          clarificationAgent: "pm",
          reviews: [{ agent: "design-reviewer", maxIterations: 3, approvalKeyword: "APPROVED" }],
        },
      ],
    });
    const phase = config.pipeline[0];
    expect(phase.phase).toBe("design");
    if (phase.phase === "design") {
      expect(phase.condition).toBe("hasFrontendTasks");
    }
  });

  it("parses implement phase with clarification agent", () => {
    const config = parsePipelineConfig(
      makeConfig({
        pipeline: [
          {
            phase: "implement",
            parallel: true,
            agent: "engineer",
            clarificationAgent: "pm",
            clarificationKeyword: "CLARIFICATION_NEEDED",
            reviews: [{ agent: "code-reviewer", maxIterations: 3, approvalKeyword: "APPROVED" }],
          },
        ],
      }),
    );
    const phase = config.pipeline[0];
    expect(phase.phase).toBe("implement");
    if (phase.phase === "implement") {
      expect(phase.clarificationAgent).toBe("pm");
      expect(phase.clarificationKeyword).toBe("CLARIFICATION_NEEDED");
    }
  });

  it("allows implement phase without clarification fields", () => {
    const config = parsePipelineConfig(
      makeConfig({
        pipeline: [
          {
            phase: "implement",
            parallel: false,
            agent: "engineer",
            reviews: [],
          },
        ],
      }),
    );
    const phase = config.pipeline[0];
    if (phase.phase === "implement") {
      expect(phase.clarificationAgent).toBeUndefined();
      expect(phase.clarificationKeyword).toBeUndefined();
    }
  });

  it("parses spec phase with condition", () => {
    const config = parsePipelineConfig(
      makeConfig({
        pipeline: [
          {
            phase: "spec",
            condition: "noPlanProvided",
            agent: "pm",
            reviews: [{ agent: "reviewer", maxIterations: 2, approvalKeyword: "APPROVED" }],
          },
        ],
      }),
    );
    const phase = config.pipeline[0];
    expect(phase.phase).toBe("spec");
    if (phase.phase === "spec") {
      expect(phase.condition).toBe("noPlanProvided");
    }
  });

  it("rejects non-object input", () => {
    expect(() => parsePipelineConfig("not an object")).toThrow("YAML object");
    expect(() => parsePipelineConfig(null)).toThrow("YAML object");
  });

  it("parses verify phase", () => {
    const config = parsePipelineConfig(
      makeConfig({
        pipeline: [
          {
            phase: "verify",
            fixAgent: "engineer",
            maxIterations: 3,
          },
        ],
      }),
    );
    expect(config.pipeline[0].phase).toBe("verify");
    if (config.pipeline[0].phase === "verify") {
      expect(config.pipeline[0].fixAgent).toBe("engineer");
      expect(config.pipeline[0].maxIterations).toBe(3);
    }
  });

  it("parses optional verify config", () => {
    const config = parsePipelineConfig(
      makeConfig({
        verify: { build: "npm run build", test: "npm test" },
      }),
    );
    expect(config.verify).toEqual({ build: "npm run build", test: "npm test", lint: undefined });
  });

  it("allows missing verify config", () => {
    const config = parsePipelineConfig(makeConfig());
    expect(config.verify).toBeUndefined();
  });
});
