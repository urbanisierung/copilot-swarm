# Features

High-level feature list for Copilot Swarm.

## Core Features

| Feature | Added | Description |
|---|---|---|
| **Multi-agent orchestration** | 2026-02 | Coordinates PM, designer, engineer, reviewer, and tester agents through a structured pipeline |
| **Interactive planning mode** | 2026-02-14 | `swarm plan` — Pre-analysis identifies parallelizable research tasks and runs them concurrently. PM clarifies requirements, engineer clarifies technical approach, designer clarifies UI/UX, each step reviewed by a reviewer (up to 3 iterations). Final cross-model review of the complete plan when review model differs from primary. All roles get interactive Q&A with the user |
| **Auto mode** | 2026-02-18 | `swarm auto` — Runs analysis → planning → implementation in one autonomous pipeline. Repo analysis provides context for all subsequent phases. All clarifying questions are auto-answered with the agent's best judgment. Useful for well-defined tasks, CI/CD, or batch processing |
| **Review mode** | 2026-02-17 | `swarm review` — Provide feedback on a previous run for agents to fix/improve. Loads previous run's context and collapses all streams into a single review stream — one engineer sees the full prior implementation + feedback to apply targeted fixes. Supports `--run <runId>`. Checkpoint/resume and auto-retry work the same as run mode |
| **Plan-to-run handoff** | 2026-02-16 | When `--plan` is used, spec phase is automatically skipped — refined requirements become the spec. Avoids redundant re-analysis. Engineering and design decisions from planning are included as context |
| **Repository analysis** | 2026-02-15 | `swarm analyze` — Architect explores repo, senior engineer reviews, cross-model verification; outputs `.swarm/analysis/repo-analysis.md` |
| **Analysis-aware pipeline** | 2026-02-16 | If repo analysis exists, it's automatically injected as context into the spec phase (run mode) and PM clarification + technical analysis phases (plan mode) so agents understand the codebase before implementing |
| **Declarative pipeline config** | 2026-02-14 | `swarm.config.yaml` defines agents, phases, review loops, and conditions — zero code changes to customize |
| **Cross-model review** | 2026-02 | Optional phase where a different AI model reviews all output, catching model-specific blind spots |
| **Isolated session strategy** | 2026-02 | Reviews use fresh sessions to prevent self-review bias; implementation streams use long-lived sessions for context |
| **Configurable review loops** | 2026-02-14 | Per-step `maxIterations` and `approvalKeyword` in the pipeline config |
| **Frontend-aware task routing** | 2026-02 | Tasks marked with `[FRONTEND]` receive the design spec; backend tasks don't |
| **Conditional phases** | 2026-02-14 | Phases can be skipped based on conditions (e.g., `hasFrontendTasks`, `differentReviewModel`) |
| **Agent instruction resolution** | 2026-02-14 | `builtin:` prefix for package defaults, file paths for custom overrides, fallback to agents dir |
| **Central config with validation** | 2026-02 | All env vars validated at startup with descriptive errors; fail-fast on invalid values |
| **Checkpoint & resume** | 2026-02-15 | Pipeline progress saved after each phase and each review/QA iteration; `--resume` skips completed phases, streams, and iterations, retrying only from the last saved point. Works for `run`, `plan`, and `analyze` modes — plan mode checkpoints all 8 phases and review iterations independently; analyze mode checkpoints architect drafts and each review iteration |
| **Auto-resume** | 2026-02-15 | On failure, automatically retries from checkpoint up to 3 times (configurable via `MAX_AUTO_RESUME`) — no manual intervention needed |
| **Extended timeout** | 2026-02-15 | Default session timeout increased to 30 minutes (configurable via `SESSION_TIMEOUT_MS`) for complex tasks |
| **Structured `.swarm/` output** | 2026-02-15 | All output organized under `.swarm/` with subfolders: `plans/`, `runs/<runId>/`, `analysis/` — no conflicts with existing repo files |
| **TUI dashboard** | 2026-02-16 | Full-screen terminal dashboard for all modes (`run`, `plan`, `analyze`) showing phase progress, active agent, and activity log. Auto-pauses for interactive input in `plan` mode. Auto-enabled on TTY, disable with `--no-tui` |
| **Debug log files** | 2026-02-16 | Every run writes a debug log to `os.tmpdir()/copilot-swarm/swarm-<runId>.log`. Captures all levels including debug. Log path shown on error. Non-blocking (failures silently ignored) |
| **Completion summary** | 2026-02-16 | Every mode (`run`, `plan`, `analyze`) prints a completion summary after finishing — shows elapsed time, phases completed/skipped, stream stats (run mode), output directory, and log file path |
| **Interactive editor input** | 2026-02-16 | `--editor` / `-e` flag opens a full-screen bordered text area for multi-line prompt entry. Ctrl+Left/Right for word-jump navigation, Ctrl+A/E for line start/end, Ctrl+W for word deletion. Ctrl+S opens command palette (Submit/Cancel). Flicker-free incremental rendering. Zero dependencies |
| **Split-pane Q&A editor** | 2026-02-17 | During plan mode clarification, a two-column editor opens: left panel for user input, right panel with scrollable agent questions. Tab to switch panels, PgUp/PgDown to scroll context. All Q&A answers are checkpointed and replayed on resume |
| **Session tracking** | 2026-02-17 | Every Copilot SDK session created during a run is logged in the checkpoint with its session ID, agent name, and context key (e.g. `spec`, `implement/stream-0`, `design/review-1-2`). Restored on resume so the full session history is preserved for debugging |
| **Sessions (feature grouping)** | 2026-02-18 | Group related runs (analyze, plan, run, review) under a logical feature via `swarm session create/list/use`. All output scoped to active session. `--session <id>` override. Auto-migration of legacy `.swarm/` layout |
| **Finish command** | 2026-02-18 | `swarm finish` — finalize a session: collect all artifacts, append structured summary to `.swarm/changelog.md`, clean up checkpoint files, mark session as finished. Central changelog tracks completed features across the project |
| **GitHub Action** | 2026-02-18 | Reusable composite action (`urbanisierung/copilot-swarm/action`) for running Copilot Swarm in any repo's CI pipeline. Supports all commands, model overrides, session/resume flags. Plan mode auto-skips interactive clarification in CI |
| **Verification phase** | 2026-02-18 | Post-implementation phase that runs actual shell commands (build, test, lint) to verify the code works. Commands resolved with priority: CLI flags (`--verify-build`, `--verify-test`, `--verify-lint`) > YAML config > auto-detect from project files. Supports 6 ecosystems (Node.js, Rust, Go, Python, Maven, Gradle). On failure, errors are fed to a fix agent for correction, then re-verified (up to `maxIterations`). Skipped if no commands configured or detected. For greenfield projects, re-detects commands after implementation |
| **Global session registry** | 2026-02-19 | All sessions tracked in `~/.config/copilot-swarm/sessions.json`. `swarm list` shows sessions across all repos with status, timestamp, and repository path |
| **TUI header info** | 2026-02-19 | TUI dashboard header shows CLI version, currently active model(s) (updates dynamically as phases switch models or parallel streams run), and current working directory (smartly shortened) |
| **GitHub issue input** | 2026-02-16 | Reference a GitHub issue as prompt: `gh:owner/repo#123`, `gh:#123`, or a full GitHub URL. Fetches title + body via the `gh` CLI. Requires `gh auth login` |
| **Engineer-to-PM clarification** | 2026-02-16 | During `implement` phase, engineers can signal `CLARIFICATION_NEEDED` to route questions to the PM agent autonomously. PM answers with context from the spec. Fully automatic — no user interaction. Configurable via `clarificationAgent` and `clarificationKeyword` in pipeline config |
| **Verbose streaming mode** | 2026-02 | `VERBOSE=true` streams agent deltas, tool calls, and intent updates to stdout |
| **Role summaries** | 2026-02 | Each agent writes a timestamped summary to `.swarm/runs/<runId>/roles/` for audit trail |

## Pipeline Phases

| Phase | Description | Configurable |
|---|---|---|
| **Spec** | PM drafts specification, reviewed by PM-reviewer and spec-reviewer | Agents, review iterations, approval keyword |
| **Decompose** | PM breaks spec into independent, parallelizable tasks with frontend markers | Agent, frontend marker string |
| **Design** | Designer creates UI/UX spec, reviewed by design-reviewer (conditional) | Condition, agents, clarification flow |
| **Implement** | Engineer implements each task, reviewed by code-reviewer, tested by QA. Engineers can escalate ambiguities to PM via keyword | Parallel/sequential, multiple reviewers, QA iterations, clarification agent/keyword |
| **Cross-model review** | Different model reviews all streams (conditional) | Model, fix agent, iterations |
| **Verify** | Runs shell commands (build, test, lint) after implementation. Auto-detects commands from project files. On failure, sends errors to fix agent and re-runs. Skipped if no commands configured or detected | Commands (CLI/YAML/auto-detect), fix agent, max iterations |
