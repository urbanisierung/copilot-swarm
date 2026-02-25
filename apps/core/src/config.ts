import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveGitHubIssue } from "./github-issue.js";
import type { VerifyConfig } from "./pipeline-types.js";
import { openTextarea } from "./textarea.js";

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

export type SwarmCommand =
  | "run"
  | "plan"
  | "auto"
  | "task"
  | "analyze"
  | "brainstorm"
  | "review"
  | "session"
  | "finish"
  | "list";

interface CliArgs {
  command: SwarmCommand;
  verbose: boolean;
  prompt: string | undefined;
  planFile: string | undefined;
  promptFile: string | undefined;
  editor: boolean;
  resume: boolean;
  noTui: boolean;
  reviewRunId: string | undefined;
  sessionId: string | undefined;
  verifyBuild: string | undefined;
  verifyTest: string | undefined;
  verifyLint: string | undefined;
}

export function readVersion(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(dir, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

const HELP_TEXT = `Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode — clarify requirements before running
  auto             Autonomous mode — analyze, plan, then run without interaction
  task             Lightweight autonomous mode — prereqs, PM review, then run
  analyze          Analyze the repository and generate a context document
  review           Review a previous run — provide feedback for agents to fix/improve
  session          Manage sessions: create, list, use (group related runs)
  finish           Finalize the active session — summarize, log to changelog, clean up
  list             List all sessions across all repositories

Options:
  -v, --verbose        Enable verbose streaming output
  -e, --editor         Force the interactive editor (auto-opens when no prompt given)
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -f, --file <file>    Read prompt from a file instead of inline text
  -r, --resume         Resume from the last checkpoint (skip completed phases)
  --run <runId>        Specify which run to review (default: latest)
  --session <id>       Use a specific session (default: active session)
  --no-tui             Disable TUI dashboard (use plain log output)
  --verify-build <cmd> Shell command to verify the build (e.g. "npm run build")
  --verify-test <cmd>  Shell command to run tests (e.g. "npm test")
  --verify-lint <cmd>  Shell command to run linting (e.g. "npm run lint")
  -V, --version        Show version number
  -h, --help           Show this help message

Prompt sources (first match wins):
  --plan <file>        Extract refined requirements from a plan file
  --file <file>        Read entire file as prompt
  --editor             Open interactive multi-line editor (Ctrl+Enter to submit)
  "<prompt>"           Inline text argument
  gh:owner/repo#123    Fetch a GitHub issue (requires gh CLI)
  gh:#123              Fetch issue from current repo
  https://github.com/owner/repo/issues/123
  ISSUE_BODY env var   Fallback environment variable

Examples:
  swarm "Add a dark mode toggle"
  swarm plan "Add a dark mode toggle"
  swarm auto "Add a dark mode toggle"       Plan + run without interaction
  swarm task "Fix the login validation"     Light auto: prereqs + PM + run
  swarm plan -f requirements.md
  swarm run -e                            Open editor to describe the task
  swarm run -v "Fix the login bug"
  swarm run --resume                      Resume a failed/timed-out run
  swarm --plan .swarm/plans/plan-latest.md
  swarm "gh:owner/repo#123"               Fetch GitHub issue as prompt
  swarm "gh:#42"                          Fetch issue #42 from current repo
  swarm analyze
  swarm brainstorm "Should we use SSR?"   Explore ideas interactively
  swarm review "Fix the auth bug"         Review latest run with feedback
  swarm review -e --run 2026-02-17T08-00  Review a specific run
  swarm session create "Dark mode feature" Create a new session
  swarm session list                      List all sessions
  swarm session use <id>                  Switch active session
  swarm finish                            Finalize active session
  swarm finish --session <id>             Finalize a specific session

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
      editor: { type: "boolean", short: "e", default: false },
      "no-tui": { type: "boolean", default: false },
      plan: { type: "string", short: "p" },
      file: { type: "string", short: "f" },
      run: { type: "string" },
      session: { type: "string" },
      "verify-build": { type: "string" },
      "verify-test": { type: "string" },
      "verify-lint": { type: "string" },
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
    (positionals[0] === "plan" ||
      positionals[0] === "run" ||
      positionals[0] === "auto" ||
      positionals[0] === "task" ||
      positionals[0] === "analyze" ||
      positionals[0] === "brainstorm" ||
      positionals[0] === "review" ||
      positionals[0] === "session" ||
      positionals[0] === "finish" ||
      positionals[0] === "list")
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
    editor: values.editor as boolean,
    resume: values.resume as boolean,
    noTui: values["no-tui"] as boolean,
    reviewRunId: values.run as string | undefined,
    sessionId: values.session as string | undefined,
    verifyBuild: values["verify-build"] as string | undefined,
    verifyTest: values["verify-test"] as string | undefined,
    verifyLint: values["verify-lint"] as string | undefined,
  };
}

/** Extract the "Refined Requirements" section (and optional Engineering/Design Decisions) from a plan file. */
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

  const sections: string[] = [];

  // Extract Refined Requirements
  const afterMarker = content.substring(start + marker.length);
  const nextHeading = afterMarker.indexOf("\n## ");
  sections.push((nextHeading !== -1 ? afterMarker.substring(0, nextHeading) : afterMarker).trim());

  // Also include Engineering Decisions and Design Decisions if present
  for (const section of ["## Engineering Decisions", "## Design Decisions"]) {
    const sStart = content.indexOf(section);
    if (sStart !== -1) {
      const afterSection = content.substring(sStart + section.length);
      const sNext = afterSection.indexOf("\n## ");
      const body = (sNext !== -1 ? afterSection.substring(0, sNext) : afterSection).trim();
      if (body) {
        sections.push(`${section.replace("## ", "### ")}\n\n${body}`);
      }
    }
  }

  return sections.join("\n\n");
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
  readonly planProvided: boolean;
  readonly issueBody: string;
  readonly agentsDir: string;
  readonly swarmDir: string;
  readonly runId: string;
  readonly sessionTimeoutMs: number;
  readonly maxRetries: number;
  readonly maxAutoResume: number;
  /** For review mode: the runId of the previous run to review (default: latest). */
  readonly reviewRunId: string | undefined;
  /** Explicit session ID from --session flag. */
  readonly sessionId: string | undefined;
  /** Resolved session ID (set after session resolution). */
  resolvedSessionId?: string;
  /** Verification commands from CLI flags (override YAML and auto-detect). */
  readonly verifyOverrides?: VerifyConfig;
}

export async function loadConfig(): Promise<SwarmConfig> {
  const cli = parseCliArgs();

  let issueBody: string | undefined;

  if (cli.planFile) {
    issueBody = readPlanFile(cli.planFile);
  } else if (cli.promptFile) {
    issueBody = readPromptFile(cli.promptFile);
  } else if (cli.editor) {
    issueBody = await openTextarea();
    if (!issueBody) {
      console.error("Error: Editor cancelled — no prompt provided.");
      process.exit(1);
    }
  } else {
    const raw = cli.prompt ?? process.env.ISSUE_BODY;
    const resolved = resolveGitHubIssue(raw) ?? raw;
    if (resolved) {
      issueBody = resolved;
    } else if (
      process.stdin.isTTY &&
      cli.command !== "analyze" &&
      cli.command !== "session" &&
      cli.command !== "finish" &&
      cli.command !== "list"
    ) {
      // No prompt provided — open editor by default on interactive terminals
      issueBody = await openTextarea();
      if (!issueBody) {
        console.error("Error: Editor cancelled — no prompt provided.");
        process.exit(1);
      }
    }
  }

  if (
    cli.command !== "analyze" &&
    cli.command !== "session" &&
    cli.command !== "finish" &&
    cli.command !== "list" &&
    !cli.resume &&
    (!issueBody || issueBody === "")
  ) {
    console.error(
      `Error: No prompt provided. Pass it as an argument, use --editor, --plan, or set ISSUE_BODY.\n\n${HELP_TEXT}`,
    );
    process.exit(1);
  }

  const swarmDir = readEnvString("SWARM_DIR", ".swarm");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  // Build verify overrides from CLI flags (only include flags that were explicitly set)
  const hasVerifyFlags = cli.verifyBuild !== undefined || cli.verifyTest !== undefined || cli.verifyLint !== undefined;
  const verifyOverrides: VerifyConfig | undefined = hasVerifyFlags
    ? { build: cli.verifyBuild, test: cli.verifyTest, lint: cli.verifyLint }
    : undefined;

  return {
    command: cli.command,
    repoRoot,
    verbose: cli.verbose || readEnvBoolean("VERBOSE", false),
    resume: cli.resume,
    tui: !cli.noTui && !cli.verbose && process.stdout.isTTY === true,
    planProvided: cli.planFile !== undefined,
    issueBody: issueBody ?? "",
    agentsDir: readEnvString("AGENTS_DIR", ".github/agents"),
    swarmDir,
    runId,
    sessionTimeoutMs: readEnvPositiveInt("SESSION_TIMEOUT_MS", 1_800_000),
    maxRetries: readEnvPositiveInt("MAX_RETRIES", 2),
    maxAutoResume: readEnvPositiveInt("MAX_AUTO_RESUME", 3),
    reviewRunId: cli.reviewRunId,
    sessionId: cli.sessionId,
    verifyOverrides,
  };
}
