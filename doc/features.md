# Features

High-level feature list for Copilot Swarm.

## Core Features

| Feature | Added | Description |
|---|---|---|
| **Multi-agent orchestration** | 2026-02 | Coordinates PM, designer, engineer, reviewer, and tester agents through a structured pipeline |
| **Interactive planning mode** | 2026-02-14 | `swarm plan` — PM agent clarifies requirements interactively, then engineering agent analyzes codebase complexity and scope |
| **Declarative pipeline config** | 2026-02-14 | `swarm.config.yaml` defines agents, phases, review loops, and conditions — zero code changes to customize |
| **Cross-model review** | 2026-02 | Optional phase where a different AI model reviews all output, catching model-specific blind spots |
| **Isolated session strategy** | 2026-02 | Reviews use fresh sessions to prevent self-review bias; implementation streams use long-lived sessions for context |
| **Configurable review loops** | 2026-02-14 | Per-step `maxIterations` and `approvalKeyword` in the pipeline config |
| **Frontend-aware task routing** | 2026-02 | Tasks marked with `[FRONTEND]` receive the design spec; backend tasks don't |
| **Conditional phases** | 2026-02-14 | Phases can be skipped based on conditions (e.g., `hasFrontendTasks`, `differentReviewModel`) |
| **Agent instruction resolution** | 2026-02-14 | `builtin:` prefix for package defaults, file paths for custom overrides, fallback to agents dir |
| **Central config with validation** | 2026-02 | All env vars validated at startup with descriptive errors; fail-fast on invalid values |
| **Verbose streaming mode** | 2026-02 | `VERBOSE=true` streams agent deltas, tool calls, and intent updates to stdout |
| **Role summaries** | 2026-02 | Each agent writes a timestamped summary to `doc/` for audit trail |

## Pipeline Phases

| Phase | Description | Configurable |
|---|---|---|
| **Spec** | PM drafts specification, reviewed by PM-reviewer and spec-reviewer | Agents, review iterations, approval keyword |
| **Decompose** | PM breaks spec into 2-3 independent tasks with frontend markers | Agent, frontend marker string |
| **Design** | Designer creates UI/UX spec, reviewed by design-reviewer (conditional) | Condition, agents, clarification flow |
| **Implement** | Engineer implements each task, reviewed by code-reviewer, tested by QA | Parallel/sequential, multiple reviewers, QA iterations |
| **Cross-model review** | Different model reviews all streams (conditional) | Model, fix agent, iterations |
