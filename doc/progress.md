# Progress / Changelog

All notable changes to this project are documented here, in reverse chronological order.

## 2026-03-04

### Fixed
- **`swarm prepare` instruction files contained task descriptions instead of generated content** — Fixed two issues: (1) PREPARE_INSTRUCTIONS referenced non-existent tool names (`list_dir`, `read_file`, `run_terminal`) instead of the correct Copilot CLI tools (`view`, `glob`, `grep`, `bash`), causing the agent to fail silently at repository exploration. (2) `SessionManager.send()` only captured the final `assistant.message` from `sendAndWait()`, but in multi-turn sessions the generated content may span earlier messages. Added `collectAll` parameter to `send()` and `callIsolatedWithInstructions()` that registers an event handler to collect ALL assistant message content. The prepare engine now uses this to capture the full output. Also added explicit instruction telling the agent to output content as text blocks (not via `create`/`edit` tools).
- **Ctrl+C not working during TUI mode** — `TuiRenderer.startKeyListener()` enables `setRawMode(true)` on stdin for keyboard navigation, which causes the terminal to deliver Ctrl+C as raw data byte `\x03` instead of SIGINT. The `handleKey` method didn't check for this byte, so Ctrl+C was silently ignored. Fixed by detecting `\x03` in `handleKey`, calling `cleanup()` to restore the terminal (show cursor, leave alternate screen), then re-emitting SIGINT via `process.kill(process.pid, "SIGINT")` to trigger the existing graceful shutdown handler in `index.ts`.

### Added
- **`swarm prepare dirs <path>` subcommand** — Generates per-directory Copilot instruction files focused on architecture and concepts. Scans immediate subdirectories of the given path, then runs a specialized agent per directory that explores the code and produces an instruction file covering: module purpose, internal architecture, key abstractions, relationships to other modules, design patterns, data flow, extension points, invariants, and common pitfalls. Agents run in parallel (up to 10 concurrent). Files are stored flat in `.github/instructions/` with path-based naming (e.g., `src-auth.instructions.md`) and `applyTo` globs scoped to each directory. Usage: `swarm prepare dirs src/`.
- **Deep analysis for complex directories** — Directories with more than 10 source files (configurable via `PREPARE_DEEP_THRESHOLD`) automatically use deep analysis. Two strategies ensure unique, non-overlapping `applyTo` globs: (1) Directories with subdirectories split by subdirectory, each getting a separate instruction file with a precise glob (`dir/subdir/**`); root-level files get an overview file with a non-recursive glob (`dir/*`). (2) Flat directories (no subdirs) use scout → parallel group agents, but merge all outputs into ONE consolidated instruction file with sections per topic — single `applyTo` glob, zero conflicts.

## 2026-03-03

### Added
- **`swarm prepare` command** — New command that analyzes a repository and generates Copilot instruction files in `.github/instructions/`. Produces 3 structured markdown files (`codebase.instructions.md`, `patterns.instructions.md`, `testing.instructions.md`) aimed at helping GitHub Copilot understand the codebase. Each file uses YAML frontmatter with `applyTo` globs. Leverages existing repo analysis (central cache) and runs a specialized agent that explores the repo to extract patterns, conventions, naming rules, file organization, testing practices, and more. No prompt required — just run `swarm prepare`.
- **`swarm fleet architecture` subcommand** — New fleet subcommand that maps cross-repo relationships and produces an architecture document. Analyzes all repos (reuses central analysis cache), then synthesizes a unified architecture doc covering: dependency graph, API contracts, data flow, shared patterns, deployment topology, change impact matrix. Output saved both to the fleet run directory and centrally at `~/.config/copilot-swarm/fleet/architecture.md`. Includes mermaid diagrams. Usage: `swarm fleet architecture ./repo1 ./repo2`.
- **Central analysis cache** — Repo analysis results are now stored centrally at `~/.config/copilot-swarm/analysis/<repo-key>/`, keyed by git remote origin. Analysis is automatically reused across sessions and fleet runs if the repo content hasn't changed. Staleness is detected via `git rev-parse HEAD^{tree}` (tree hash) — same content = cache hit regardless of commit history. All engines (pipeline, planning, task, brainstorm) fall back to the central cache when no session-local analysis exists.
- **Fleet auto-discover repos** — When no repos are specified via `--repos`, positional args, or `fleet.config.yaml`, fleet now scans the current directory for git repositories and presents an interactive multi-select. Use arrow keys to navigate, space to toggle, `a` to select/unselect all, and Enter to confirm. All repos are pre-selected by default.
- **Fleet cleanup command in summary** — The `swarm fleet cleanup` command is now shown in the fleet completion summary (both terminal output and `fleet-summary.md`), after SIGTERM interruption, and in the markdown summary file. Includes the correct branch name and repo paths for easy copy-paste.

### Improved
- **Fleet wave retry mechanism** — When a repo fails during a fleet wave, other repos in the same wave continue running instead of aborting immediately. Failed repos are retried up to `MAX_RETRIES` times (default 2) with checkpoint saves between attempts. The wave only fails after all retries are exhausted. On resume, previously succeeded repos are skipped while failed repos are retried.
- **Fleet summary stats** — The fleet completion summary now shows how many repos were checked and how many were touched (had file changes). Displayed in both the terminal log line and the `fleet-summary.md` file. Uses `git status --porcelain` per repo to detect actual modifications.

## 2026-03-02

### Fixed
- **Non-git directory crash** — Running any `swarm` command (including `-V` and `--help`) outside a git repository caused an unhandled `execSync` error at module load time. Fixed by deferring git detection to after CLI arg parsing. `--version` and `--help` now work anywhere. Commands that don't require a git repo (`fleet`, `list`) fall back to `process.cwd()`. All other commands print a clear error message instead of a stack trace.
- **CLI error handling hardening** — Added global error handlers (`uncaughtException` + `unhandledRejection`) so the CLI never shows stack traces. All errors produce clean user-friendly messages. Fleet config loading is wrapped in try/catch with specific guidance when `fleet.config.yaml` is missing (shows how to use `--repos`, positional paths, or create a config file). Fleet mode now accepts positional repo paths (e.g., `swarm fleet analyze ./repo1 ./repo2`) in addition to `--repos`.
- **Fleet parallel analysis** — Fleet `analyzeAll()` was using `execSync` which blocks the Node.js event loop, causing repos to analyze sequentially despite `Promise.all`. Each repo timed out at 10 minutes. Replaced with async `spawn`-based `runChildProcess()` for true parallel execution with a 30-minute timeout per repo. The child `swarm analyze` process uses the same chunking mechanism for large repos.
- **Fleet strategy path validation** — The fleet strategist LLM could generate repo names/paths that don't match actual filesystem paths (e.g., `` `bpmn-js-element-templates` (not in local workspace) ``). Added `resolveToFleetRepo()` which validates parsed strategy wave entries against actual fleet repos — tries direct match first, then strips markdown formatting, then matches by basename. Unknown repos are warned and skipped instead of crashing.
- **Fleet strategist prompt hardening** — Added explicit "ONLY USE THESE EXACT PATHS" constraint with the full list of repo paths in the strategist prompt, and updated `fleet-strategist.md` agent instructions with a "Use Exact Paths" rule.

### Added
- **Fleet subcommands** — `swarm fleet analyze` runs analysis across all repos without executing (outputs `fleet-analysis.md`). `swarm fleet plan "prompt"` runs analysis + interactive planning (PM and engineer clarification rounds with the user, adapted for multi-repo context) + strategize, producing a cross-repo strategy without executing waves. The default `swarm fleet "prompt"` still runs the full autonomous pipeline.
- **Fleet interactive planning** — `swarm fleet plan` includes interactive Q&A rounds: a PM agent asks clarifying questions about the cross-repo feature (scope, contracts, data flow), then an engineer agent asks technical questions (API shapes, deployment order, testing strategy). User answers via the split-pane editor. The enriched context feeds into the strategist for a better cross-repo plan. Non-interactive environments auto-skip questions. Checkpoint/resume preserves Q&A history.
- **Fleet branch management** — New `--create-branch <name>` flag for fleet mode creates a consistent feature branch across all affected repos before execution. Validates that every repo is on its default branch with no uncommitted changes, syncs with remote, then creates the branch. Fails early if any repo is not on its default branch or has dirty state — no repos are modified unless all pass validation.
- **Fleet branch cleanup** — New `swarm fleet cleanup <branch-name> ./repo1 ./repo2` command to revert all repos after a failed or abandoned fleet run. Discards all local changes (tracked and untracked), switches each repo back to its default branch, and deletes the feature branch locally. Handles repos already on the default branch or on unexpected branches gracefully.
- **Fleet central output store** — Fleet output now goes to `~/.config/copilot-swarm/fleet/<runId>/` instead of inside a single repo's `.swarm/` directory. Since fleet operations span multiple repositories, the output is stored centrally. A `latest` pointer file tracks the most recent fleet run.

## 2026-03-01

### Added
- **Interactive stream selection** — During TUI mode, users can navigate streams with arrow keys (↑↓) to select one and see a detail panel with full task description, model, and current activity. Press Escape or `q` to deselect. Works in all modes that use streams (run, analyze, fleet).
- **Digest mode** — New `swarm digest` command that shows a concise highlights summary of a completed run. Reads the latest (or `--run <runId>`) run's artifacts (checkpoint, summary, role files), sends them to the fast model for synthesis, and prints a human-readable overview to stdout: what was done, key decisions, files changed, verification status. No TUI needed — pure text output.
- **Auto-model selection** — New `--auto-model` flag (or `AUTO_MODEL=true` env var) enables per-task model selection during the implement phase. Before each task stream, a fast-model classifier assesses the task's complexity and selects `primaryModel` for complex work (architecture, security, algorithms) or `fastModel` for simple tasks (CRUD, config, docs, boilerplate). Added `classifyModelForTask()` method to `SessionManager`. Saves cost on mixed-complexity runs without sacrificing quality.
- **Demo scenarios** — Added "Run (auto-model)" and "Digest" demo scenarios to `swarm demo`. Auto-model demo shows smart model selection per task with 3 streams at different complexity levels. Digest demo shows a mock highlights output.

## 2026-02-28

### Fixed
- **TUI active agents leak** — Sessions created via `createAgentSession()` and destroyed with the SDK's `session.destroy()` bypassed `SessionManager.destroySession()`, so agents stayed in the TUI "Active Agents" column with spinning indicators forever. Fixed by making `destroySession()` public and using it in all engines (pipeline, brainstorm, task, planning). This also fixes the "too many models rendered" issue — only agents currently executing now appear in the right column.

### Added
- **Per-agent elapsed time in TUI** — The "Active Agents" column now shows how long each agent has been running (e.g. `pm  claude-sonnet-4  01:23`).
- **Agent usage stats** — Every agent invocation is now recorded to `.swarm/stats.json` with invocation count, model used, and elapsed time. Stats accumulate across runs.
- **`swarm stats` command** — New CLI command to view aggregated agent invocation statistics: call counts, total/average time, models used, and token counts (when available).
- **Central backup store** — All `.swarm/` artifacts (sessions, checkpoints, plans, stats) are automatically synced to `~/.config/copilot-swarm/backups/` on every checkpoint save and session finish. New `swarm backup` (manual full sync) and `swarm restore` (recover from central store) commands.

## 2026-02-27

### Added
- **Fleet mode (multi-repo orchestration)** — New `swarm fleet` command for coordinating features across multiple repositories. A meta-orchestrator analyzes all repos in parallel, a strategist agent produces cross-repo plans with shared contracts and dependency-ordered execution waves, and independent `swarm task` processes run per repo per wave. A cross-repo reviewer validates consistency across all changes. Supports `fleet.config.yaml` for repo/role definitions and per-repo verify overrides, or `--repos` CLI args for ad-hoc use. Fleet-level checkpoint/resume tracks wave progress and per-repo completion. New agent instructions: `fleet-strategist.md` (cross-repo planning) and `fleet-reviewer.md` (consistency validation). Output goes to `.swarm/fleet/<runId>/`.

## 2026-02-26

### Fixed
- **Analyze mode `--resume` now works across invocations** — Previously, `swarm analyze --resume` always re-ran all phases (scout, chunk agents, synthesis, review) from scratch because the checkpoint could not be found. Root cause: analyze mode never wrote a `latest` pointer file, and each invocation generated a new `runId`. Fixed by introducing mode-specific latest pointers (`latest-analyze`, `latest-plan`) so each mode's resume resolves to its own most recent checkpoint without interfering with other modes.
- **Run mode now produces actual code changes instead of only markdown summaries** — Engineer agents now receive the repo analysis context (structure, conventions, file layout) and explicit instructions to use `edit_file` for all code changes. Previously, engineers had no context about the repository beyond the spec and task, causing them to output documentation/plans instead of calling `edit_file`. Repo analysis is token-guarded (capped at 16K tokens) to avoid context overflow.
- **Agents no longer run git commands** — All agents with `run_terminal` access now explicitly prohibited from running `git add`, `git commit`, `git push`, or any other git commands that modify version control state. Users manage commits.
- **Faster, targeted code reviews** — Review and QA agents now receive an explicit list of files modified by the engineer (tracked via SDK `edit_file` tool events) instead of just the engineer's prose summary. Reviewers are instructed to `read_file` on those specific files, eliminating slow exploratory scanning of the entire repo. Cross-model review uses `git diff --name-only` + untracked files for a comprehensive file list.

### Improved
- **Structured engineer output** — Engineer agent now produces a structured summary (file list with descriptions, verification status, brief notes) instead of free-form prose. Downstream agents parse this more efficiently, reducing token usage and review latency.
- **Leaner agent handoffs** — Review, QA, and cross-model review prompts now receive the specific task description instead of the full PM spec, dramatically reducing prompt size for multi-task runs. Dependency context between streams is capped at 2K chars per dependency with a pointer to use `read_file` for full details. Cross-model fix agent now gets explicit `edit_file` instructions and file list instead of full spec + prose dump.

### Added
- **Token-aware hierarchical synthesis** — Analysis of very large repos no longer fails with "prompt token count exceeds limit" errors. When combined chunk analyses exceed the model's context window, synthesis uses a hierarchical map-reduce strategy: chunks are batched into groups that fit within the token budget, merged in parallel, and the partial results are recursively merged until a single document remains. Small repos continue to use single-pass synthesis unchanged. Configurable via `MODEL_CONTEXT_LIMIT` env var (default: 128000). Token guards also protect the review/revision phases from overflow. 98 tests (was 91).

## 2026-02-25

### Added
- **Chunked analysis for large repositories** — `swarm analyze` now automatically detects large repos (500+ files) and splits analysis into parallel chunks. A fast/cheap model scouts the repo structure, directories are deterministically partitioned into chunks (~300 files each), multiple agents analyze chunks in parallel, and a synthesis agent merges all results into a unified document. The review phase then validates the final output. Small repos continue to use the original single-agent flow unchanged. Thresholds configurable via `ANALYZE_CHUNK_THRESHOLD` and `ANALYZE_CHUNK_MAX_FILES` env vars. Chunk analyses saved to `.swarm/analysis/chunks/`. 88 tests (was 76), including 9 new tests for the partition algorithm.
- **Auto-resume for analyze mode** — `swarm analyze` now automatically retries from the last checkpoint on failure (up to 3 times), matching the existing behavior of `swarm run` via SwarmOrchestrator.

### Fixed
- Skip editor prompt for `analyze`, `session`, `finish`, and `list` commands — these don't need user-provided prompts.
- Auto-approve SDK permission requests so agents can access the file system during analysis.
- Instruct agents to output analysis content in their response instead of writing to files via tools.

## 2026-02-18

### Added
- **Auto mode** — New `swarm auto` command runs analysis → planning → implementation in a single autonomous pipeline. All clarifying questions during planning are auto-answered with the agent's best judgment. Repo analysis is generated first and provides context for all subsequent phases.
- **Task mode** — New `swarm task` command provides a lightweight autonomous pipeline: pre-analysis for parallel research → PM review (auto-answered) → decompose → implement (with QA loops per stream) → verify. Skips the full planning ceremony. Ideal for well-scoped tasks.

### Improved
- **Analysis context in planning** — Planning mode now loads the existing `repo-analysis.md` (if available) and injects it as context into PM clarification and the technical analysis phase, giving agents better understanding of the codebase from the start.

## 2026-02-19

### Added
- **Wave-based execution** — The decompose phase now produces tasks with optional dependency annotations (`dependsOn`). Tasks are grouped into execution waves via topological sort: wave 1 contains tasks with no dependencies (run in parallel), wave 2 contains tasks depending on wave 1 (run in parallel with wave 1 output as context), etc. Fully backward compatible — tasks without dependencies run in a single wave (same as before). Checkpoint/resume stores task dependency graph. Prior wave results are injected into each subsequent wave's engineering prompt.
- **Fast model tier** — Three-tier model architecture: `fastModel` (default: `claude-haiku-4.5`) for lightweight coordination tasks (prereq analysis, task decomposition, task-mode PM review), `primaryModel` for main work, `reviewModel` for cross-model verification. Configurable via `swarm.config.yaml` (`fastModel` field) or `FAST_MODEL` env var. Reduces cost and latency for tasks that don't require a powerful model.
- **Brainstorm mode** — New `swarm brainstorm` command for interactive idea exploration with a product strategist agent. The agent challenges assumptions, suggests alternatives, and identifies risks through back-and-forth discussion via the split-pane editor. On finish (type `BRAINSTORM_DONE`), generates a structured markdown summary (problem, ideas, pros/cons, open questions, recommendations) saved to `.swarm/brainstorms/`. The latest brainstorm summary is automatically loaded as context in subsequent `swarm plan` runs.
- **Global session registry** — All sessions are now tracked in a central registry at `~/.config/copilot-swarm/sessions.json` (respects `XDG_CONFIG_HOME`). Each session records its ID, name, repository root, creation timestamp, and finished status. Registry updated on session creation and finalization.
- **List command** — New `swarm list` command shows all sessions across all repositories in a formatted table (session ID, name, repository path, status, created date). Useful for finding sessions in other repos or reviewing past work.
- **TUI header improvements** — TUI dashboard header now displays CLI version and currently active model(s) on the title line (updates dynamically as phases switch between primary and review models, or when multiple models run in parallel streams), and the current working directory (smartly shortened with `…/` prefix) on a second dimmed line.

### Improved
- **Review mode single stream** — Review mode now collapses all previous implementation streams into a single review stream. One engineer sees the full prior implementation + feedback and applies all fixes in one pass. Eliminates unnecessary parallel streams and the AI triage call. Previously, review re-ran all N streams from the original run even for small feedback.
- **Package manager detection** — Verification auto-detect now reads lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`) to determine the correct package manager for Node.js projects. Previously hardcoded to `npm` regardless of actual project tooling.

### Added
- **Plan pre-analysis** — Planning mode now starts with a pre-analysis step that scans the request for parallelizable research sub-tasks (e.g. "study this URL", "research best practices for X"). Identified tasks run concurrently via `Promise.all`, and results are merged as enriched context for the PM clarification phase. Skipped automatically if no research tasks are detected.

### Fixed
- **Session-scoped paths** — `loadPreviousRun`, `resolveCheckpointPath`, and the latest-pointer write in `pipeline-engine` now use `sessionScopedRoot` instead of `swarmRoot`, fixing "no previous run found" errors when sessions are active.

## 2026-02-18

### Added
- **Sessions (feature grouping)** — New `swarm session` command to group related runs under a logical feature. `swarm session create "Feature X"` creates a session, `swarm session list` shows all sessions, `swarm session use <id>` switches active session. All commands auto-use the active session; override with `--session <id>`. Output is scoped per-session under `.swarm/sessions/<id>/`. Legacy `.swarm/runs/` layout auto-migrated to a default session on first use.
- **Finish command** — New `swarm finish` command to finalize a session. Collects all artifacts (plans, analyses, run checkpoints, role summaries), builds a structured summary, appends it to `.swarm/changelog.md` (newest first), cleans up checkpoint files, and marks the session as finished in `session.json`. Supports `--session <id>` to finalize a specific session.
- **GitHub Action** — Reusable composite action at `action/` for running Copilot Swarm in any repository's CI pipeline. Supports all commands (`run`, `plan`, `analyze`, `review`, `finish`), model overrides, session/resume flags, and version pinning. Plan mode interactive clarification auto-skips in non-TTY environments — agents use their best judgment for open questions.
- **Verification phase** — New `verify` pipeline phase that runs actual shell commands (build, test, lint) after implementation to confirm the code works. Commands resolved with priority: CLI flags (`--verify-build`, `--verify-test`, `--verify-lint`) > YAML `verify:` section > auto-detection from project files (package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, build.gradle). On failure, errors are sent to the fix agent for correction and commands are re-run (up to `maxIterations`, default 3). Skipped if no commands are configured or detected. For greenfield projects, auto-detection re-runs after implementation when project files exist. 62 tests (was 48), including 11 new tests for auto-detection across 6 ecosystems.

## 2026-02-17

### Added
- **Review mode** — New `swarm review` command for providing feedback on a previous run. Loads the previous run's full context (spec, tasks, design spec, stream results) and re-runs the implement phase with the user's review feedback injected alongside the previous implementation. Engineers are instructed to keep what works and only fix what's described in the feedback. Supports `--run <runId>` to target a specific previous run (defaults to latest). Checkpoint/resume and auto-retry work the same as run mode. Includes `loadPreviousRun()` utility that reconstructs context from checkpoint files or role summaries.
- **Split-pane Q&A editor** — Plan mode interactive clarification now uses a two-column split editor: left panel for user input, right panel with scrollable agent questions (PM, engineer, designer). Tab to switch panels, PgUp/PgDown to scroll context. Submit/Skip/Cancel via command palette. All Q&A answers saved in checkpoint `answeredQuestions` field — on resume, previously answered rounds are replayed automatically without re-prompting.
- **Session tracking in checkpoints** — Every Copilot SDK session created during a run is now logged in the checkpoint file (`sessionLog` field). Each entry records the session ID, agent name, and role, keyed by context (e.g. `spec`, `implement/stream-0`, `design/review-1-2`, `plan-clarify-0`). Session logs are restored on resume and accumulate across the run. Useful for debugging and correlating checkpoint state with Copilot session history in `~/.copilot/session-state/`.

### Improved
- **Clarification timeout recovery** — If a Copilot session expires during interactive clarification (plan mode Q&A), the CLI no longer crashes. Instead it catches the error, creates a fresh session with all collected Q&A context, and asks the agent to finalize the summary. If recovery also fails, the last available response is used. This prevents losing long clarification sessions to timeouts.
- **Interactive editor input** — Word-jump navigation with Ctrl+Left/Right, Ctrl+A/E for line start/end, Ctrl+W and Ctrl+Backspace for word deletion. Replaced Ctrl+Enter submit with Ctrl+S command palette (Submit/Cancel menu with arrow key selection). Esc now opens the command palette instead of immediately cancelling. Flicker-free rendering: single-character edits only redraw the affected line, cursor-only movements reposition without redrawing, full redraws only on structural changes.
- **TUI dashboard rendering** — Fixed activity log rendering when content reaches terminal bottom. Each row is now written with explicit cursor positioning and line clearing (`\x1b[K`) to prevent ghosting. Lines wider than terminal columns are truncated (ANSI-aware) to prevent wrapping that consumed extra visual rows.

## 2026-02-16

### Added
- **Analyze mode checkpoint & resume** — Analyze mode now supports full checkpoint & resume (`swarm analyze --resume`). Architect draft is checkpointed before the review loop begins. Each review iteration saves progress. Cross-model analysis phases are tracked independently. On resume, completed phases and iterations are skipped — the architect's initial analysis is preserved and the review loop resumes from the last completed iteration. Checkpoint is cleared on successful completion.
- **Interactive editor input** — New `--editor` / `-e` flag opens a full-screen bordered text area for entering multi-line task descriptions. Uses ANSI alternate screen buffer and raw stdin mode (zero dependencies). Arrow keys for cursor navigation, Enter for new lines, Ctrl+Enter (or Ctrl+D) to submit, Esc/Ctrl+C to cancel. Requires interactive TTY.
- **GitHub issue input** — Task descriptions can now reference GitHub issues directly: `gh:owner/repo#123`, `gh:#123` (current repo), or full GitHub URLs. The CLI fetches the issue title and body via the `gh` CLI (`gh issue view --json`). Requires `gh` to be installed and authenticated. Clear error messages if `gh` is missing or authentication fails.
- **Plan mode checkpoint & resume** — Plan mode now supports full checkpoint & resume (`swarm plan --resume`). Each of the 8 planning phases is checkpointed after completion. Review iteration progress is saved after each iteration (same granularity as run mode). On resume, completed phases are skipped and interactive Q&A results are preserved. Checkpoint is cleared on successful plan completion. Extended `PipelineCheckpoint` with plan-specific fields (`mode`, `engDecisions`, `designDecisions`, `analysis`).
- **Plan revision content guards** — Revision agents in `reviewStep` and `crossModelReview` now have strengthened instructions demanding full content output (not summaries). Cross-model revision validates that all 4 section headers are preserved (`## Refined Requirements`, `## Engineering Decisions`, `## Design Decisions`, `## Technical Analysis`). Step revision validates that output is at least 30% of original length. If validation fails, the previous version is kept and a warning is logged.
- **TUI dashboard** — Full-screen terminal dashboard for all modes (`run`, `plan`, `analyze`) showing phase progress, active agent, and scrolling activity log. Uses ANSI alternate screen buffer (zero external dependencies). Auto-pauses for interactive user input in `plan` mode. Auto-enabled on interactive TTY; `--no-tui` flag or piped/CI output falls back to plain log mode. Verbose mode (`-v`) and TUI are mutually exclusive. Post-run summary printed after TUI exits.
- **Debug log files** — Every run writes a timestamped log to the system temp directory (`/tmp/copilot-swarm/swarm-<runId>.log`). Captures all log levels including debug regardless of verbose/TUI mode. On error, the log file path is printed for debugging. Non-blocking — write failures are silently ignored.
- **Engineer-to-PM clarification** — During `implement` phase, engineers can signal `CLARIFICATION_NEEDED` to autonomously route questions to the PM agent. PM answers using the original spec as context, and the answer is sent back to the engineer session. No user interaction required. Configured via optional `clarificationAgent` and `clarificationKeyword` fields in the implement phase of `swarm.config.yaml`. Engineer agent instructions updated with escalation rule; PM agent instructions updated to make reasonable assumptions.
- **Completion summary** — All modes (`run`, `plan`, `analyze`) now print a summary after finishing: elapsed time, phases completed/skipped, stream stats (run mode), output directory, and log file path. Printed after TUI exits or inline in plain mode.
- **Enhanced planning mode** — Plan mode now has up to 8 phases: PM requirements clarification → PM review → engineer technical clarification → engineer review → designer UI/UX clarification → designer review → technical analysis → cross-model review. Each clarification step is reviewed by a dedicated reviewer (up to 3 iterations). Cross-model review uses the review model to check the full assembled plan for accuracy and feasibility (skipped if review model equals primary model). Engineering and design decisions are included in the plan output alongside refined requirements.
- **Plan-to-run handoff** — When `--plan` is used, the spec phase is automatically skipped (`noPlanProvided` condition). The refined requirements from the plan become the spec directly, going straight to decomposition. Engineering and design decisions from the plan are included as context. Eliminates redundant re-analysis that produced blockers instead of implementation.
- **Multi-line plan input** — Interactive planning mode now supports multi-line answers (press Enter on empty line to send). Literal `\n` escape sequences converted to real newlines.
- **Analysis-aware pipeline** — If `.swarm/analysis/repo-analysis.md` exists, it is automatically loaded and provided as context to the spec phase, giving agents full repo understanding before implementation.

## 2026-02-15

### Added
- **Checkpoint & resume** — Pipeline progress saved at phase-level, iteration-level (within review/QA loops), and draft-level (agent initial output). `--resume`/`-r` flag skips completed phases, iterations, and streams. Individual implement streams saved incrementally — completed streams survive a timeout/crash. When resuming mid-review, the session is primed with the latest content so the agent has full context. Checkpoint cleared on successful completion.
- **Auto-resume** — On pipeline failure, automatically retries from the last checkpoint up to 3 times (configurable via `MAX_AUTO_RESUME` env var). No manual `--resume` needed for transient failures.
- **Extended timeout** — Default `SESSION_TIMEOUT_MS` increased from 5 minutes to 30 minutes (1,800,000ms) for complex agent tasks. Still configurable via env var.
- **Structured `.swarm/` output directory** — All output moved from `doc/` to `.swarm/` with dedicated subfolders: `plans/` for planning mode, `runs/<runId>/` for per-run summaries and role outputs, `analysis/` for repo analysis. Eliminates conflicts with existing repo files. `DOC_DIR` and `SUMMARY_FILE_NAME` env vars replaced by `SWARM_DIR` (default `.swarm`).
- **Repository analysis mode** — `swarm analyze` generates a structured repo context document (`.swarm/analysis/repo-analysis.md`). Architect explores repo, senior engineer reviews for accuracy (max 3 iterations), then cross-model verification with a different AI model repeats the same loop.

## 2026-02-14

### Added
- **npm publishing setup** — Changesets for version management, GitHub Actions release workflow with npm trusted publishing (OIDC, no NPM_TOKEN needed), provenance attestation. Scripts: `pnpm changeset`, `pnpm version-packages`, `pnpm release`.
- **Repository analysis mode** — `swarm analyze` generates a structured repo context document (`.swarm/analysis/repo-analysis.md`). Architect agent explores the repo, senior engineer reviews for accuracy (max 3 iterations), then cross-model verification with a different AI model repeats the same loop.
- **CLI binary** — Package exposes `swarm` binary via `bin` field. Runnable with `npx @copilot-swarm/core`, `pnpx @copilot-swarm/core`, or globally as `swarm`. Supports `-v`/`--verbose` flag and prompt as trailing argument (e.g., `swarm "Add a feature"`). Subcommands: `run` (default), `plan`, and `analyze`.
- **Interactive planning mode** — `swarm plan "prompt"` runs an interactive requirements clarification session (PM agent asks questions, user answers via stdin) followed by a codebase analysis (engineering agent). Output saved to `.swarm/plans/`.
- **Renamed to Copilot Swarm** — All references to "AI Agency" / "AI Playground" renamed to "copilot-swarm". Package: `@copilot-swarm/core`. Config file: `swarm.config.yaml`.
- **Declarative pipeline engine** — `swarm.config.yaml` defines the full pipeline: agents, phases, review loops, conditions. Replaces all hardcoded phase logic.
  - `pipeline-types.ts` — TypeScript schema for the pipeline config
  - `pipeline-config.ts` — YAML loader with exhaustive validation and env var overrides
  - `pipeline-engine.ts` — Generic engine that interprets the config and runs phases
  - `defaults/swarm.config.yaml` — Built-in default pipeline
  - `swarm.config.example.yaml` — Example showing customization (custom agents, security reviewer, no design phase)
- **Tooling setup** — Turborepo, Biome, Vitest installed and configured
  - `turbo.json` — Task pipeline (build, typecheck, check, test)
  - `biome.json` — Linter/formatter config
  - `vitest.config.ts` — Test config for the ai app
- **Tests** — 28 tests covering `utils.ts` and `pipeline-config.ts` validators
- **Documentation** — README, progress, features, documentation, roadmap files created

### Changed
- **Config split** — Model selection and iteration limits moved from env vars to `swarm.config.yaml`. Core runtime config (verbose, issueBody, timeouts) remains in env vars.
- **Agent resolution** — `SessionManager` now resolves agent instructions via `builtin:<name>` prefix or file paths from the pipeline config, with instruction caching.
- **Constants** — Removed hardcoded `AgentName` enum; agent names are now dynamic strings from the config.
- **Messages** — Generalized log messages to accept dynamic agent names instead of hardcoded references.
- **Orchestrator** — Now a thin wrapper that loads pipeline config and delegates to `PipelineEngine`.
- Root `package.json` scripts use `turbo` instead of `pnpm -r`.

### Earlier changes

- Cross-model review feature (agent, code, docs)
- Full code refactoring from single 317-line file into 8 modular files
- Central config with env var type/value validation
- Centralized constants, messages, logging
- Hardened type safety (parseJsonArray validates string[], error wrapping)
- Made ISSUE_BODY mandatory (app exits with error if missing)
- Restructured Copilot instructions into portable (Parts 1+2) + repo-specific (Part 3)
- Standalone package extraction proposal (`doc/standalone-execution.md`)
