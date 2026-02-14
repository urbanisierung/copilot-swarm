import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

function readEnvString(key: string, fallback: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
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

interface CliArgs {
  verbose: boolean;
  prompt: string | undefined;
}

function parseCliArgs(): CliArgs {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: swarm [options] "<prompt>"

Options:
  -v, --verbose   Enable verbose streaming output
  -h, --help      Show this help message

Examples:
  swarm "Add a dark mode toggle"
  swarm -v "Fix the login bug"
  ISSUE_BODY="Add a feature" swarm

Environment variables override defaults; CLI args override env vars.
See documentation for all env var options.`);
    process.exit(0);
  }

  return {
    verbose: values.verbose as boolean,
    prompt: positionals.length > 0 ? positionals.join(" ") : undefined,
  };
}

/**
 * Core config loaded from environment variables and CLI arguments.
 * CLI args take precedence over env vars.
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
  const cli = parseCliArgs();

  const issueBody = cli.prompt ?? process.env.ISSUE_BODY;
  if (!issueBody || issueBody === "") {
    console.error('Error: No prompt provided. Pass it as an argument or set ISSUE_BODY.\n\nUsage: swarm "<prompt>"');
    process.exit(1);
  }

  return {
    repoRoot,
    verbose: cli.verbose || readEnvBoolean("VERBOSE", false),
    issueBody,
    agentsDir: readEnvString("AGENTS_DIR", ".github/agents"),
    docDir: readEnvString("DOC_DIR", "doc"),
    sessionTimeoutMs: readEnvPositiveInt("SESSION_TIMEOUT_MS", 300_000),
    maxRetries: readEnvPositiveInt("MAX_RETRIES", 2),
    summaryFileName: readEnvString("SUMMARY_FILE_NAME", "swarm-summary.md"),
  };
}
