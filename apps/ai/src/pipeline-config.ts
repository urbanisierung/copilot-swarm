import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  CrossModelReviewPhaseConfig,
  DecomposePhaseConfig,
  DesignPhaseConfig,
  ImplementPhaseConfig,
  PhaseConfig,
  PipelineConfig,
  QaStepConfig,
  ReviewStepConfig,
  SpecPhaseConfig,
} from "./pipeline-types.js";

const VALID_PHASES = new Set(["spec", "decompose", "design", "implement", "cross-model-review"]);
const CONFIG_FILE_NAME = "agency.config.yaml";

function fail(msg: string): never {
  throw new Error(`Pipeline config error: ${msg}`);
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val === "") {
    fail(`"${key}" must be a non-empty string in ${context}`);
  }
  return val;
}

function requirePositiveInt(obj: Record<string, unknown>, key: string, context: string): number {
  const val = obj[key];
  if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
    fail(`"${key}" must be a positive integer in ${context}`);
  }
  return val;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") fail(`"${key}" must be a string if provided`);
  return val;
}

function validateReviewStep(raw: unknown, context: string): ReviewStepConfig {
  if (typeof raw !== "object" || raw === null) fail(`review step must be an object in ${context}`);
  const obj = raw as Record<string, unknown>;
  return {
    agent: requireString(obj, "agent", context),
    maxIterations: requirePositiveInt(obj, "maxIterations", context),
    approvalKeyword: requireString(obj, "approvalKeyword", context),
    clarificationKeyword: optionalString(obj, "clarificationKeyword"),
    clarificationAgent: optionalString(obj, "clarificationAgent"),
  };
}

function validateReviews(raw: unknown, context: string): ReviewStepConfig[] {
  if (!Array.isArray(raw)) fail(`"reviews" must be an array in ${context}`);
  return raw.map((item, i) => validateReviewStep(item, `${context}.reviews[${i}]`));
}

function validateQa(raw: unknown, context: string): QaStepConfig {
  if (typeof raw !== "object" || raw === null) fail(`"qa" must be an object in ${context}`);
  const obj = raw as Record<string, unknown>;
  return {
    agent: requireString(obj, "agent", context),
    maxIterations: requirePositiveInt(obj, "maxIterations", context),
    approvalKeyword: requireString(obj, "approvalKeyword", context),
  };
}

function validatePhase(raw: unknown, index: number): PhaseConfig {
  if (typeof raw !== "object" || raw === null) fail(`pipeline[${index}] must be an object`);
  const obj = raw as Record<string, unknown>;
  const phase = requireString(obj, "phase", `pipeline[${index}]`);

  if (!VALID_PHASES.has(phase)) {
    fail(`Unknown phase type "${phase}" in pipeline[${index}]. Valid: ${[...VALID_PHASES].join(", ")}`);
  }

  const ctx = `pipeline[${index}] (phase: ${phase})`;

  switch (phase) {
    case "spec": {
      return {
        phase: "spec",
        agent: requireString(obj, "agent", ctx),
        reviews: validateReviews(obj.reviews, ctx),
      } satisfies SpecPhaseConfig;
    }
    case "decompose": {
      return {
        phase: "decompose",
        agent: requireString(obj, "agent", ctx),
        frontendMarker: requireString(obj, "frontendMarker", ctx),
      } satisfies DecomposePhaseConfig;
    }
    case "design": {
      return {
        phase: "design",
        condition: optionalString(obj, "condition"),
        agent: requireString(obj, "agent", ctx),
        clarificationAgent: optionalString(obj, "clarificationAgent"),
        reviews: validateReviews(obj.reviews, ctx),
      } satisfies DesignPhaseConfig;
    }
    case "implement": {
      const parallel = obj.parallel;
      if (typeof parallel !== "boolean") fail(`"parallel" must be a boolean in ${ctx}`);
      return {
        phase: "implement",
        parallel,
        agent: requireString(obj, "agent", ctx),
        reviews: validateReviews(obj.reviews, ctx),
        qa: obj.qa !== undefined ? validateQa(obj.qa, ctx) : undefined,
      } satisfies ImplementPhaseConfig;
    }
    case "cross-model-review": {
      return {
        phase: "cross-model-review",
        condition: optionalString(obj, "condition"),
        agent: requireString(obj, "agent", ctx),
        fixAgent: requireString(obj, "fixAgent", ctx),
        maxIterations: requirePositiveInt(obj, "maxIterations", ctx),
        approvalKeyword: requireString(obj, "approvalKeyword", ctx),
      } satisfies CrossModelReviewPhaseConfig;
    }
    default:
      fail(`Unhandled phase type "${phase}"`);
  }
}

function validateAgents(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail('"agents" must be an object mapping agent names to instruction sources');
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || value === "") {
      fail(`Agent "${key}" must have a non-empty string source (e.g. "builtin:pm" or a file path)`);
    }
    result[key] = value;
  }
  return result;
}

function validatePipeline(raw: unknown): PhaseConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail('"pipeline" must be a non-empty array of phase definitions');
  }
  return raw.map((item, i) => validatePhase(item, i));
}

/** Cross-validate that every agent referenced in the pipeline is defined in agents. */
function validateAgentReferences(config: PipelineConfig): void {
  const defined = new Set(Object.keys(config.agents));

  function check(agentName: string, context: string): void {
    if (!defined.has(agentName)) {
      fail(`Agent "${agentName}" referenced in ${context} is not defined in "agents"`);
    }
  }

  for (const phase of config.pipeline) {
    const ctx = `phase "${phase.phase}"`;
    switch (phase.phase) {
      case "spec":
        check(phase.agent, ctx);
        for (const r of phase.reviews) check(r.agent, `${ctx} review`);
        break;
      case "decompose":
        check(phase.agent, ctx);
        break;
      case "design":
        check(phase.agent, ctx);
        if (phase.clarificationAgent) check(phase.clarificationAgent, ctx);
        for (const r of phase.reviews) {
          check(r.agent, `${ctx} review`);
          if (r.clarificationAgent) check(r.clarificationAgent, `${ctx} review clarification`);
        }
        break;
      case "implement":
        check(phase.agent, ctx);
        for (const r of phase.reviews) check(r.agent, `${ctx} review`);
        if (phase.qa) check(phase.qa.agent, `${ctx} qa`);
        break;
      case "cross-model-review":
        check(phase.agent, ctx);
        check(phase.fixAgent, `${ctx} fixAgent`);
        break;
    }
  }
}

export function parsePipelineConfig(raw: unknown): PipelineConfig {
  if (typeof raw !== "object" || raw === null) {
    fail("Config must be a YAML object");
  }
  const obj = raw as Record<string, unknown>;

  const config: PipelineConfig = {
    primaryModel: typeof obj.primaryModel === "string" ? obj.primaryModel : "claude-opus-4-6-fast",
    reviewModel: typeof obj.reviewModel === "string" ? obj.reviewModel : "gpt-5.2-codex",
    agents: validateAgents(obj.agents),
    pipeline: validatePipeline(obj.pipeline),
  };

  validateAgentReferences(config);
  return config;
}

/**
 * Load pipeline config from the repo root, falling back to the built-in default.
 * Env vars PRIMARY_MODEL and REVIEW_MODEL override the YAML values.
 */
export function loadPipelineConfig(repoRoot: string): PipelineConfig {
  const repoConfigPath = path.join(repoRoot, CONFIG_FILE_NAME);
  const defaultConfigPath = path.join(import.meta.dirname, "..", "defaults", CONFIG_FILE_NAME);

  let yamlContent: string;
  let source: string;

  if (fs.existsSync(repoConfigPath)) {
    yamlContent = fs.readFileSync(repoConfigPath, "utf-8");
    source = repoConfigPath;
  } else if (fs.existsSync(defaultConfigPath)) {
    yamlContent = fs.readFileSync(defaultConfigPath, "utf-8");
    source = defaultConfigPath;
  } else {
    fail(`No ${CONFIG_FILE_NAME} found in repo root or package defaults`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (err) {
    fail(`Failed to parse ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const config = parsePipelineConfig(parsed);

  // Env var overrides for models
  const envPrimary = process.env.PRIMARY_MODEL;
  const envReview = process.env.REVIEW_MODEL;
  return {
    ...config,
    primaryModel: envPrimary && envPrimary !== "" ? envPrimary : config.primaryModel,
    reviewModel: envReview && envReview !== "" ? envReview : config.reviewModel,
  };
}
