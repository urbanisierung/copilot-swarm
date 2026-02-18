# Progress / Changelog

All notable changes to this project are documented here, in reverse chronological order.

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
