import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveGitHubIssue } from "./github-issue.js";
import type { VerifyConfig } from "./pipeline-types.js";
import { openTextarea } from "./textarea.js";

/** Lazily detect git repo root — returns null if not in a git repo. */
let _repoRoot: string | null | undefined;
function detectRepoRoot(): string | null {
  if (_repoRoot === undefined) {
    try {
      _repoRoot = execSync("git rev-parse --show-toplevel", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      _repoRoot = null;
    }
  }
  return _repoRoot;
}

const COMMANDS_WITHOUT_GIT: ReadonlySet<string> = new Set(["fleet", "list", "logs"]);

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
  | "fleet"
  | "digest"
  | "session"
  | "finish"
  | "list"
  | "stats"
  | "demo"
  | "backup"
  | "restore"
  | "prepare"
  | "logs";

export type FleetMode = "analyze" | "plan" | "cleanup" | "architecture";

export type PrepareMode = "dirs";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export function logLevelValue(level: LogLevel): number {
  return LOG_LEVELS[level];
}

interface CliArgs {
  command: SwarmCommand;
  verbose: boolean;
  logLevel: LogLevel | undefined;
  prompt: string | undefined;
  planFile: string | undefined;
  promptFile: string | undefined;
  editor: boolean;
  resume: boolean;
  noTui: boolean;
  autoModel: boolean;
  reviewRunId: string | undefined;
  sessionId: string | undefined;
  verifyBuild: string | undefined;
  verifyTest: string | undefined;
  verifyLint: string | undefined;
  fleetRepos: string[] | undefined;
  fleetConfigPath: string | undefined;
  fleetMode: FleetMode | undefined;
  fleetBranch: string | undefined;
  prepareMode: PrepareMode | undefined;
  preparePath: string | undefined;
  harvest: boolean;
  harvestVerify: boolean;
}

export function readVersion(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(dir, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

/** Apply ANSI color highlighting to help text. Respects NO_COLOR and non-TTY. */
export function formatHelpText(text: string, stream: NodeJS.WriteStream = process.stdout): string {
  if (!stream.isTTY || "NO_COLOR" in process.env) return text;

  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;

  const lines = text.split("\n");
  const out: string[] = [];
  let section = "";

  for (const line of lines) {
    if (line.startsWith("Usage:")) {
      out.push(bold(line));
      continue;
    }

    if (/^[A-Z][\w ]+(?:\([^)]*\))?:$/.test(line)) {
      if (line.startsWith("Commands")) section = "commands";
      else if (line.startsWith("Options")) section = "options";
      else if (line.startsWith("Prompt")) section = "prompt";
      else if (line.startsWith("Examples")) section = "examples";
      out.push(bold(line));
      continue;
    }

    if (/^[A-Z]/.test(line) && !line.startsWith("  ")) {
      out.push(dim(line));
      continue;
    }

    if (line.startsWith("  ") && line.trim() !== "") {
      if (section === "commands") {
        const m = line.match(/^(\s+)(\S+)(\s{2,})(.*)$/);
        if (m) {
          out.push(`${m[1]}${green(m[2])}${m[3]}${m[4]}`);
          continue;
        }
      }

      if (section === "options" || section === "prompt") {
        const m = line.match(/^(\s+)((?:-\w,\s)?--[\w-]+)(?:(\s<[^>]+>))?(\s{2,})(.*)$/);
        if (m) {
          out.push(`${m[1]}${yellow(m[2])}${m[3] ? cyan(m[3]) : ""}${m[4]}${m[5]}`);
          continue;
        }
        if (section === "prompt") {
          const m2 = line.match(/^(\s+)(.+?)(\s{2,})(.+)$/);
          if (m2) {
            out.push(`${m2[1]}${cyan(m2[2])}${m2[3]}${m2[4]}`);
            continue;
          }
        }
      }

      if (section === "examples") {
        const m = line.match(/^(\s+)(swarm\s.+\S)(\s{2,})(.+)$/);
        if (m) {
          out.push(`${m[1]}${cyan(m[2])}${m[3]}${dim(m[4])}`);
          continue;
        }
        const m2 = line.match(/^(\s+)(swarm\s.+)$/);
        if (m2) {
          out.push(`${m2[1]}${cyan(m2[2])}`);
          continue;
        }
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

const HELP_TEXT = `Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode — clarify requirements before running
  auto             Autonomous mode — analyze, plan, then run without interaction
  task             Lightweight autonomous mode — prereqs, PM review, then run
  analyze          Analyze the repository and generate a context document
  review           Review a previous run — provide feedback for agents to fix/improve
  digest           Show a concise highlights summary of a completed run
  fleet            Multi-repo orchestration — coordinate work across repositories
  session          Manage sessions: create, list, use (group related runs)
  finish           Finalize the active session — summarize, log to changelog, clean up
  list             List all sessions across all repositories
  stats            Show agent invocation statistics
  logs             Show path to latest log file or tail recent logs
  demo             Interactive TUI demo — guided walkthrough of all modes
  backup           Sync all .swarm/ artifacts to central store
  restore          Restore .swarm/ artifacts from central store

Options:
  -v, --verbose        Enable verbose streaming output (sets log level to debug)
  --log-level <level>  Set log level: error, warn, info (default), debug
  -e, --editor         Force the interactive editor (auto-opens when no prompt given)
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -f, --file <file>    Read prompt from a file instead of inline text
  -r, --resume         Resume from the last checkpoint (skip completed phases)
  --run <runId>        Specify which run to review/digest (default: latest)
  --session <id>       Use a specific session (default: active session)
  --no-tui             Disable TUI dashboard (use plain log output)
  --auto-model         Auto-select model per task (use fast model when primary isn't needed)
  --harvest            Plan mode: generate questions file for async answering (use with plan command)
  --harvest-verify     Verify/consolidate an existing questions file (preserves answers, use -f for custom path)
  --verify-build <cmd> Shell command to verify the build (e.g. "npm run build")
  --verify-test <cmd>  Shell command to run tests (e.g. "npm test")
  --verify-lint <cmd>  Shell command to run linting (e.g. "npm run lint")
  --repos <paths...>   Repository paths for fleet mode (space-separated)
  --fleet-config <f>   Fleet config file path (default: fleet.config.yaml)
  --create-branch <n>  Create a branch in all fleet repos before execution
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
  swarm digest                            Show highlights of the latest run
  swarm digest --run 2026-02-17T08-00     Digest a specific run
  swarm session create "Dark mode feature" Create a new session
  swarm session list                      List all sessions
  swarm session use <id>                  Switch active session
  swarm finish                            Finalize active session
  swarm finish --session <id>             Finalize a specific session
  swarm fleet "Add OAuth" ./auth ./api ./frontend
  swarm fleet analyze ./auth ./api           Analyze all repos (no execution)
  swarm fleet plan "Add OAuth" ./auth ./api  Cross-repo plan (no execution)
  swarm fleet "Add OAuth" --fleet-config fleet.config.yaml
  swarm fleet "Add OAuth" ./auth ./api --create-branch feat/oauth
  swarm fleet cleanup feat/oauth ./auth ./api  Discard changes, delete branch
  swarm run --auto-model "Fix validation"  Use fast model for simple tasks
  swarm plan --harvest "Add dark mode"    Generate questions file, answer async
  swarm plan --harvest-verify             Verify/consolidate existing questions file
  swarm plan --harvest-verify -f q.md     Verify a specific questions file
  swarm logs                             Show path to latest log file
  swarm run --log-level debug "Fix bug"  Log all debug info to file

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
      "auto-model": { type: "boolean", default: false },
      harvest: { type: "boolean", default: false },
      "harvest-verify": { type: "boolean", default: false },
      "log-level": { type: "string" },
      plan: { type: "string", short: "p" },
      file: { type: "string", short: "f" },
      run: { type: "string" },
      session: { type: "string" },
      "verify-build": { type: "string" },
      "verify-test": { type: "string" },
      "verify-lint": { type: "string" },
      repos: { type: "string", multiple: true },
      "fleet-config": { type: "string" },
      "create-branch": { type: "string" },
    },
  });

  if (values.version) {
    console.log(readVersion());
    process.exit(0);
  }

  if (values.help) {
    console.log(formatHelpText(HELP_TEXT));
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
      positionals[0] === "fleet" ||
      positionals[0] === "digest" ||
      positionals[0] === "session" ||
      positionals[0] === "finish" ||
      positionals[0] === "list" ||
      positionals[0] === "stats" ||
      positionals[0] === "demo" ||
      positionals[0] === "backup" ||
      positionals[0] === "restore" ||
      positionals[0] === "prepare" ||
      positionals[0] === "logs")
  ) {
    command = positionals[0] as SwarmCommand;
    promptParts = positionals.slice(1);
  }

  // Parse fleet subcommand: `swarm fleet analyze ...` or `swarm fleet plan ...` or `swarm fleet cleanup ...`
  let fleetMode: FleetMode | undefined;
  if (
    command === "fleet" &&
    promptParts.length > 0 &&
    (promptParts[0] === "analyze" ||
      promptParts[0] === "plan" ||
      promptParts[0] === "cleanup" ||
      promptParts[0] === "architecture")
  ) {
    fleetMode = promptParts[0] as FleetMode;
    promptParts = promptParts.slice(1);
  }

  // Parse prepare subcommand: `swarm prepare dirs <path>`
  let prepareMode: PrepareMode | undefined;
  let preparePath: string | undefined;
  if (command === "prepare" && promptParts.length > 0 && promptParts[0] === "dirs") {
    prepareMode = "dirs";
    preparePath = promptParts[1];
    promptParts = promptParts.slice(2);
  }

  // For fleet cleanup, treat the first non-path positional as the branch name
  let fleetBranch = values["create-branch"] as string | undefined;
  if (command === "fleet" && fleetMode === "cleanup" && !fleetBranch && promptParts.length > 0) {
    const isPathLike = (s: string) =>
      s.startsWith("./") || s.startsWith("/") || s.startsWith("~/") || s.startsWith("../");
    if (!isPathLike(promptParts[0])) {
      fleetBranch = promptParts[0];
      promptParts = promptParts.slice(1);
    }
  }

  // In fleet mode, treat path-like positional args as repo paths
  // This allows: swarm fleet analyze ./repo1 ./repo2
  // Also fixes: --repos ~/a ~/b ~/c (parseArgs only captures the first value)
  let fleetRepos = values.repos as string[] | undefined;
  if (command === "fleet") {
    const isPathLike = (s: string) =>
      s.startsWith("./") || s.startsWith("/") || s.startsWith("~/") || s.startsWith("../");
    const pathArgs = promptParts.filter(isPathLike);
    if (pathArgs.length > 0) {
      fleetRepos = [...(fleetRepos ?? []), ...pathArgs];
      promptParts = promptParts.filter((p) => !isPathLike(p));
    }
  }

  // Validate --log-level
  const rawLogLevel = values["log-level"] as string | undefined;
  let logLevel: LogLevel | undefined;
  if (rawLogLevel) {
    if (!["error", "warn", "info", "debug"].includes(rawLogLevel)) {
      console.error(`Error: Invalid log level "${rawLogLevel}". Must be one of: error, warn, info, debug.`);
      process.exit(1);
    }
    logLevel = rawLogLevel as LogLevel;
  }

  return {
    command,
    verbose: values.verbose as boolean,
    logLevel,
    prompt: promptParts.length > 0 ? promptParts.join(" ") : undefined,
    planFile: values.plan as string | undefined,
    promptFile: values.file as string | undefined,
    editor: values.editor as boolean,
    resume: values.resume as boolean,
    noTui: values["no-tui"] as boolean,
    autoModel: values["auto-model"] as boolean,
    harvest: values.harvest as boolean,
    harvestVerify: values["harvest-verify"] as boolean,
    reviewRunId: values.run as string | undefined,
    sessionId: values.session as string | undefined,
    verifyBuild: values["verify-build"] as string | undefined,
    verifyTest: values["verify-test"] as string | undefined,
    verifyLint: values["verify-lint"] as string | undefined,
    fleetRepos,
    fleetConfigPath: values["fleet-config"] as string | undefined,
    fleetMode,
    fleetBranch,
    prepareMode,
    preparePath,
  };
}

function readPlanFile(filePath: string): string {
  const root = detectRepoRoot() ?? process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: Plan file not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, "utf-8").trim();
  if (!content) {
    console.error(`Error: Plan file is empty: ${resolved}`);
    process.exit(1);
  }

  return content;
}

/** Read the entire contents of a file as the prompt. */
function readPromptFile(filePath: string): string {
  const root = detectRepoRoot() ?? process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
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
  /** Log level for file logging. --verbose sets this to "debug". Default: "info". */
  readonly logLevel: LogLevel;
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
  /** When true, auto-select model per task (fast model for simple tasks). */
  readonly autoModel: boolean;
  /** Repository paths for fleet mode (from --repos). */
  readonly fleetRepos?: string[];
  /** Fleet config file path (from --fleet-config). */
  readonly fleetConfigPath?: string;
  /** Fleet subcommand: analyze-only or plan-only (omit for full pipeline). */
  readonly fleetMode?: FleetMode;
  /** Branch name to create in all fleet repos before execution. */
  readonly fleetBranch?: string;
  /** Prepare subcommand: "dirs" for per-directory instruction files. */
  readonly prepareMode?: PrepareMode;
  /** Target directory path for `prepare dirs`. */
  readonly preparePath?: string;
  /** When true, run plan mode in harvest mode — generate questions file for async answering. */
  readonly harvest: boolean;
  /** When true, verify/consolidate an existing questions file (preserves answers). */
  readonly harvestVerify: boolean;
  /** Optional override path to questions file (for --harvest-verify -f). */
  readonly questionsFilePath?: string;
}

export async function loadConfig(): Promise<SwarmConfig> {
  const cli = parseCliArgs();

  let issueBody: string | undefined;

  if (cli.harvestVerify) {
    // harvest-verify needs no prompt — skip all prompt resolution
    issueBody = "";
  } else if (cli.planFile) {
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
      !cli.resume &&
      cli.command !== "analyze" &&
      cli.command !== "prepare" &&
      cli.command !== "digest" &&
      cli.command !== "session" &&
      cli.command !== "finish" &&
      cli.command !== "list" &&
      cli.command !== "stats" &&
      cli.command !== "demo" &&
      cli.command !== "backup" &&
      cli.command !== "restore" &&
      cli.command !== "logs" &&
      !(
        cli.command === "fleet" &&
        (cli.fleetMode === "analyze" || cli.fleetMode === "cleanup" || cli.fleetMode === "architecture")
      )
    ) {
      issueBody = await openTextarea();
      if (!issueBody) {
        console.error("Error: Editor cancelled — no prompt provided.");
        process.exit(1);
      }
    }
  }

  if (
    cli.command !== "analyze" &&
    cli.command !== "prepare" &&
    cli.command !== "digest" &&
    cli.command !== "session" &&
    cli.command !== "finish" &&
    cli.command !== "list" &&
    cli.command !== "stats" &&
    cli.command !== "demo" &&
    cli.command !== "backup" &&
    cli.command !== "restore" &&
    cli.command !== "logs" &&
    !(
      cli.command === "fleet" &&
      (cli.fleetMode === "analyze" || cli.fleetMode === "cleanup" || cli.fleetMode === "architecture")
    ) &&
    !cli.resume &&
    !cli.harvestVerify &&
    (!issueBody || issueBody === "")
  ) {
    console.error(
      `Error: No prompt provided. Pass it as an argument, use --editor, --plan, or set ISSUE_BODY.\n\n${formatHelpText(HELP_TEXT, process.stderr)}`,
    );
    process.exit(1);
  }

  const swarmDir = readEnvString("SWARM_DIR", ".swarm");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  // Resolve repo root — fail clearly for commands that require a git repo
  const gitRoot = detectRepoRoot();
  if (!gitRoot && !COMMANDS_WITHOUT_GIT.has(cli.command)) {
    console.error("Error: Not a git repository. Most swarm commands must be run inside a git repository.");
    process.exit(1);
  }
  const repoRoot = gitRoot ?? process.cwd();

  // Build verify overrides from CLI flags (only include flags that were explicitly set)
  const hasVerifyFlags = cli.verifyBuild !== undefined || cli.verifyTest !== undefined || cli.verifyLint !== undefined;
  const verifyOverrides: VerifyConfig | undefined = hasVerifyFlags
    ? { build: cli.verifyBuild, test: cli.verifyTest, lint: cli.verifyLint }
    : undefined;

  const isVerbose = cli.verbose || readEnvBoolean("VERBOSE", false);
  const envLogLevel = readEnvString("LOG_LEVEL", "") as LogLevel | "";
  const resolvedLogLevel: LogLevel =
    cli.logLevel ??
    (envLogLevel && ["error", "warn", "info", "debug"].includes(envLogLevel)
      ? (envLogLevel as LogLevel)
      : isVerbose
        ? "debug"
        : "info");

  return {
    command: cli.command,
    repoRoot,
    verbose: isVerbose,
    logLevel: resolvedLogLevel,
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
    fleetRepos: cli.fleetRepos,
    fleetConfigPath: cli.fleetConfigPath,
    fleetMode: cli.fleetMode,
    fleetBranch: cli.fleetBranch,
    autoModel: cli.autoModel || readEnvBoolean("AUTO_MODEL", false),
    prepareMode: cli.prepareMode,
    preparePath: cli.preparePath,
    harvest: cli.harvest,
    harvestVerify: cli.harvestVerify,
    questionsFilePath: cli.harvestVerify ? cli.promptFile : undefined,
  };
}
