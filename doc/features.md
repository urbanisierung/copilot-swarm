# Features

High-level feature list for Copilot Swarm.

## Core Features

| Feature | Added | Description |
|---|---|---|
| **Multi-agent orchestration** | 2026-02 | Coordinates PM, designer, engineer, reviewer, and tester agents through a structured pipeline |
| **Interactive planning mode** | 2026-02-14 | `swarm plan` — PM clarifies requirements, engineer clarifies technical approach, designer clarifies UI/UX, each step reviewed by a reviewer (up to 3 iterations). Final cross-model review of the complete plan when review model differs from primary. All roles get interactive Q&A with the user |
| **Plan-to-run handoff** | 2026-02-16 | When `--plan` is used, spec phase is automatically skipped — refined requirements become the spec. Avoids redundant re-analysis. Engineering and design decisions from planning are included as context |
| **Repository analysis** | 2026-02-15 | `swarm analyze` — Architect explores repo, senior engineer reviews, cross-model verification; outputs `.swarm/analysis/repo-analysis.md` |
| **Analysis-aware pipeline** | 2026-02-16 | If repo analysis exists, it's automatically injected as context into the spec phase so agents understand the codebase before implementing |
| **Declarative pipeline config** | 2026-02-14 | `swarm.config.yaml` defines agents, phases, review loops, and conditions — zero code changes to customize |
| **Cross-model review** | 2026-02 | Optional phase where a different AI model reviews all output, catching model-specific blind spots |
| **Isolated session strategy** | 2026-02 | Reviews use fresh sessions to prevent self-review bias; implementation streams use long-lived sessions for context |
| **Configurable review loops** | 2026-02-14 | Per-step `maxIterations` and `approvalKeyword` in the pipeline config |
| **Frontend-aware task routing** | 2026-02 | Tasks marked with `[FRONTEND]` receive the design spec; backend tasks don't |
| **Conditional phases** | 2026-02-14 | Phases can be skipped based on conditions (e.g., `hasFrontendTasks`, `differentReviewModel`) |
| **Agent instruction resolution** | 2026-02-14 | `builtin:` prefix for package defaults, file paths for custom overrides, fallback to agents dir |
| **Central config with validation** | 2026-02 | All env vars validated at startup with descriptive errors; fail-fast on invalid values |
| **Checkpoint & resume** | 2026-02-15 | Pipeline progress saved after each phase and each review/QA iteration; `--resume` skips completed phases, streams, and iterations, retrying only from the last saved point |
| **Auto-resume** | 2026-02-15 | On failure, automatically retries from checkpoint up to 3 times (configurable via `MAX_AUTO_RESUME`) — no manual intervention needed |
| **Extended timeout** | 2026-02-15 | Default session timeout increased to 30 minutes (configurable via `SESSION_TIMEOUT_MS`) for complex tasks |
| **Structured `.swarm/` output** | 2026-02-15 | All output organized under `.swarm/` with subfolders: `plans/`, `runs/<runId>/`, `analysis/` — no conflicts with existing repo files |
| **TUI dashboard** | 2026-02-16 | Full-screen terminal dashboard for all modes (`run`, `plan`, `analyze`) showing phase progress, active agent, and activity log. Auto-pauses for interactive input in `plan` mode. Auto-enabled on TTY, disable with `--no-tui` |
| **Debug log files** | 2026-02-16 | Every run writes a debug log to `os.tmpdir()/copilot-swarm/swarm-<runId>.log`. Captures all levels including debug. Log path shown on error. Non-blocking (failures silently ignored) |
| **Completion summary** | 2026-02-16 | Every mode (`run`, `plan`, `analyze`) prints a completion summary after finishing — shows elapsed time, phases completed/skipped, stream stats (run mode), output directory, and log file path |
| **Engineer-to-PM clarification** | 2026-02-16 | During `implement` phase, engineers can signal `CLARIFICATION_NEEDED` to route questions to the PM agent autonomously. PM answers with context from the spec. Fully automatic — no user interaction. Configurable via `clarificationAgent` and `clarificationKeyword` in pipeline config |
| **Verbose streaming mode** | 2026-02 | `VERBOSE=true` streams agent deltas, tool calls, and intent updates to stdout |
| **Role summaries** | 2026-02 | Each agent writes a timestamped summary to `.swarm/runs/<runId>/roles/` for audit trail |

## Pipeline Phases

| Phase | Description | Configurable |
|---|---|---|
| **Spec** | PM drafts specification, reviewed by PM-reviewer and spec-reviewer | Agents, review iterations, approval keyword |
| **Decompose** | PM breaks spec into 2-3 independent tasks with frontend markers | Agent, frontend marker string |
| **Design** | Designer creates UI/UX spec, reviewed by design-reviewer (conditional) | Condition, agents, clarification flow |
| **Implement** | Engineer implements each task, reviewed by code-reviewer, tested by QA. Engineers can escalate ambiguities to PM via keyword | Parallel/sequential, multiple reviewers, QA iterations, clarification agent/keyword |
| **Cross-model review** | Different model reviews all streams (conditional) | Model, fix agent, iterations |
