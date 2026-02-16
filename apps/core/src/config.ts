import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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

export type SwarmCommand = "run" | "plan" | "analyze";

interface CliArgs {
  command: SwarmCommand;
  verbose: boolean;
  prompt: string | undefined;
  planFile: string | undefined;
  promptFile: string | undefined;
  resume: boolean;
  noTui: boolean;
}

function readVersion(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(dir, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

const HELP_TEXT = `Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode — clarify requirements before running
  analyze          Analyze the repository and generate a context document

Options:
  -v, --verbose        Enable verbose streaming output
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -f, --file <file>    Read prompt from a file instead of inline text
  -r, --resume         Resume from the last checkpoint (skip completed phases)
  --no-tui             Disable TUI dashboard (use plain log output)
  -V, --version        Show version number
  -h, --help           Show this help message

Examples:
  swarm "Add a dark mode toggle"
  swarm plan "Add a dark mode toggle"
  swarm plan -f requirements.md
  swarm run -v "Fix the login bug"
  swarm run --resume                   Resume a failed/timed-out run
  swarm --plan .swarm/plans/plan-latest.md
  swarm analyze

Environment variables override defaults; CLI args override env vars.
See documentation for all env var options.`;

function parseCliArgs(): CliArgs {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "V", default: false },
      resume: { type: "boolean", short: "r", default: false },
      "no-tui": { type: "boolean", default: false },
      plan: { type: "string", short: "p" },
      file: { type: "string", short: "f" },
    },
  });

  if (values.version) {
    console.log(readVersion());
    process.exit(0);
  }

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  let command: SwarmCommand = "run";
  let promptParts = positionals;

  if (
    positionals.length > 0 &&
    (positionals[0] === "plan" || positionals[0] === "run" || positionals[0] === "analyze")
  ) {
    command = positionals[0] as SwarmCommand;
    promptParts = positionals.slice(1);
  }

  return {
    command,
    verbose: values.verbose as boolean,
    prompt: promptParts.length > 0 ? promptParts.join(" ") : undefined,
    planFile: values.plan as string | undefined,
    promptFile: values.file as string | undefined,
    resume: values.resume as boolean,
    noTui: values["no-tui"] as boolean,
  };
}

/** Extract the "Refined Requirements" section from a plan file. */
function readPlanFile(filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Plan file not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, "utf-8");
  const marker = "## Refined Requirements";
  const start = content.indexOf(marker);
  if (start === -1) {
    console.error(`Error: Plan file does not contain a "${marker}" section: ${resolved}`);
    process.exit(1);
  }

  // Extract from marker to the next ## heading or end of file
  const afterMarker = content.substring(start + marker.length);
  const nextHeading = afterMarker.indexOf("\n## ");
  const section = nextHeading !== -1 ? afterMarker.substring(0, nextHeading) : afterMarker;
  return section.trim();
}

/** Read the entire contents of a file as the prompt. */
function readPromptFile(filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Prompt file not found: ${resolved}`);
    process.exit(1);
  }
  return fs.readFileSync(resolved, "utf-8").trim();
}

/**
 * Core config loaded from environment variables and CLI arguments.
 * CLI args take precedence over env vars.
 * Model selection and pipeline structure are in `swarm.config.yaml` (PipelineConfig).
 */
export interface SwarmConfig {
  readonly command: SwarmCommand;
  readonly repoRoot: string;
  readonly verbose: boolean;
  readonly resume: boolean;
  readonly tui: boolean;
  readonly issueBody: string;
  readonly agentsDir: string;
  readonly swarmDir: string;
  readonly runId: string;
  readonly sessionTimeoutMs: number;
  readonly maxRetries: number;
  readonly maxAutoResume: number;
}

export function loadConfig(): SwarmConfig {
  const cli = parseCliArgs();

  let issueBody: string | undefined;

  if (cli.planFile) {
    issueBody = readPlanFile(cli.planFile);
  } else if (cli.promptFile) {
    issueBody = readPromptFile(cli.promptFile);
  } else {
    issueBody = cli.prompt ?? process.env.ISSUE_BODY;
  }

  if (cli.command !== "analyze" && !cli.resume && (!issueBody || issueBody === "")) {
    console.error(`Error: No prompt provided. Pass it as an argument, use --plan, or set ISSUE_BODY.\n\n${HELP_TEXT}`);
    process.exit(1);
  }

  const swarmDir = readEnvString("SWARM_DIR", ".swarm");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  return {
    command: cli.command,
    repoRoot,
    verbose: cli.verbose || readEnvBoolean("VERBOSE", false),
    resume: cli.resume,
    tui: cli.command === "run" && !cli.noTui && !cli.verbose && process.stdout.isTTY === true,
    issueBody: issueBody ?? "",
    agentsDir: readEnvString("AGENTS_DIR", ".github/agents"),
    swarmDir,
    runId,
    sessionTimeoutMs: readEnvPositiveInt("SESSION_TIMEOUT_MS", 1_800_000),
    maxRetries: readEnvPositiveInt("MAX_RETRIES", 2),
    maxAutoResume: readEnvPositiveInt("MAX_AUTO_RESUME", 3),
  };
}
