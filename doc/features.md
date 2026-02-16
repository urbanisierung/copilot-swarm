# Features

High-level feature list for Copilot Swarm.

## Core Features

| Feature | Added | Description |
|---|---|---|
| **Multi-agent orchestration** | 2026-02 | Coordinates PM, designer, engineer, reviewer, and tester agents through a structured pipeline |
| **Interactive planning mode** | 2026-02-14 | `swarm plan` — PM agent clarifies requirements interactively, then engineering agent analyzes codebase complexity and scope |
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
| **Checkpoint & resume** | 2026-02-15 | Pipeline progress saved after each phase; `--resume` skips completed phases and streams, retrying only failed work |
| **Auto-resume** | 2026-02-15 | On failure, automatically retries from checkpoint up to 3 times (configurable via `MAX_AUTO_RESUME`) — no manual intervention needed |
| **Extended timeout** | 2026-02-15 | Default session timeout increased to 30 minutes (configurable via `SESSION_TIMEOUT_MS`) for complex tasks |
| **Structured `.swarm/` output** | 2026-02-15 | All output organized under `.swarm/` with subfolders: `plans/`, `runs/<runId>/`, `analysis/` — no conflicts with existing repo files |
| **Verbose streaming mode** | 2026-02 | `VERBOSE=true` streams agent deltas, tool calls, and intent updates to stdout |
| **Role summaries** | 2026-02 | Each agent writes a timestamped summary to `.swarm/runs/<runId>/roles/` for audit trail |

## Pipeline Phases

| Phase | Description | Configurable |
|---|---|---|
| **Spec** | PM drafts specification, reviewed by PM-reviewer and spec-reviewer | Agents, review iterations, approval keyword |
| **Decompose** | PM breaks spec into 2-3 independent tasks with frontend markers | Agent, frontend marker string |
| **Design** | Designer creates UI/UX spec, reviewed by design-reviewer (conditional) | Condition, agents, clarification flow |
| **Implement** | Engineer implements each task, reviewed by code-reviewer, tested by QA | Parallel/sequential, multiple reviewers, QA iterations |
| **Cross-model review** | Different model reviews all streams (conditional) | Model, fix agent, iterations |
