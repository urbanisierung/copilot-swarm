import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

function readEnvString(key: string, fallback: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value;
}

function readEnvRequired(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Required environment variable ${key} is not set.`);
  }
  return value;
}

function readEnvBoolean(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid value for ${key}: "${value}". Must be "true" or "false".`);
}

function readEnvPositiveInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${key}: "${value}". Must be a positive integer.`);
  }
  return parsed;
}

/**
 * Core config loaded from environment variables.
 * Model selection and pipeline structure are in `swarm.config.yaml` (PipelineConfig).
 */
export interface SwarmConfig {
  readonly repoRoot: string;
  readonly verbose: boolean;
  readonly issueBody: string;
  readonly agentsDir: string;
  readonly docDir: string;
  readonly sessionTimeoutMs: number;
  readonly maxRetries: number;
  readonly summaryFileName: string;
}

export function loadConfig(): SwarmConfig {
  return {
    repoRoot,
    verbose: readEnvBoolean("VERBOSE", false),
    issueBody: readEnvRequired("ISSUE_BODY"),
    agentsDir: readEnvString("AGENTS_DIR", ".github/agents"),
    docDir: readEnvString("DOC_DIR", "doc"),
    sessionTimeoutMs: readEnvPositiveInt("SESSION_TIMEOUT_MS", 300_000),
    maxRetries: readEnvPositiveInt("MAX_RETRIES", 2),
    summaryFileName: readEnvString("SUMMARY_FILE_NAME", "swarm-summary.md"),
  };
}
