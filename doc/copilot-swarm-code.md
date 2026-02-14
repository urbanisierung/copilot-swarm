# Copilot Swarm — Code Architecture

## Overview

Copilot Swarm is a TypeScript application that coordinates multiple AI agents through a **declarative, config-driven pipeline**. It uses the GitHub Copilot SDK to run specialized agents in isolated sessions, producing reviewed and tested code from a natural language issue description.

The pipeline — which agents exist, how they connect, and in what order phases execute — is defined in a single `swarm.config.yaml` file. If no config is found, the built-in default mirrors the original hardcoded behavior.

## File Structure

```
apps/core/
├── src/
│   ├── index.ts              Entry point — routes to planning or orchestration mode
│   ├── config.ts             Core config (env vars + CLI args): command, verbose, issueBody, etc.
│   ├── constants.ts          Enums and constant values used across the codebase
│   ├── messages.ts           All user-facing log message templates
│   ├── logger.ts             Logging abstraction wrapping console output
│   ├── session.ts            SessionManager — Copilot SDK lifecycle + agent resolution
│   ├── utils.ts              Pure utility functions (parsing, file I/O, detection)
│   ├── planning-engine.ts    Interactive planning mode (PM clarification + engineering analysis)
│   ├── pipeline-types.ts     TypeScript types for the pipeline config schema
│   ├── pipeline-config.ts    YAML loader, validator, and env var override logic
│   ├── pipeline-engine.ts    Generic engine that interprets the config and runs phases
│   └── orchestrator.ts       Thin wrapper — loads pipeline config, delegates to engine
├── defaults/
│   └── swarm.config.yaml    Built-in default pipeline (used when no repo config exists)
└── swarm.config.example.yaml  Example showing customization
```

## Module Responsibilities

### `config.ts`
- Defines the `SwarmConfig` interface with core parameters (runtime behavior, not pipeline structure)
- Parses CLI arguments (`plan`/`run` subcommands, `-v`/`--verbose`, positional prompt)
- CLI args take precedence over environment variables
- Fails fast with descriptive errors for invalid values

### `planning-engine.ts`
- `PlanningEngine` — interactive requirements clarification and technical analysis
- Phase 1: PM agent asks clarifying questions; user answers via stdin (up to 10 rounds)
- Phase 2: Engineering agent analyzes codebase and produces complexity/scope assessment
- Agent instructions are embedded inline (no external files needed)
- Output saved to `doc/plan.md`

### `pipeline-types.ts`
- TypeScript types for the `swarm.config.yaml` schema
- `PipelineConfig` — root config: agents map + ordered phase list
- Phase types: `SpecPhaseConfig`, `DecomposePhaseConfig`, `DesignPhaseConfig`, `ImplementPhaseConfig`, `CrossModelReviewPhaseConfig`
- `ReviewStepConfig` / `QaStepConfig` — review loop configuration

### `pipeline-config.ts`
- `loadPipelineConfig(repoRoot)` — loads `swarm.config.yaml` from repo root, falls back to `defaults/`
- Full validation: type checks every field, validates agent cross-references
- Env var overrides: `PRIMARY_MODEL` and `REVIEW_MODEL` always take precedence over YAML

### `pipeline-engine.ts`
- `PipelineEngine` — the main execution class
- Iterates through the pipeline's phase list and dispatches each to the appropriate handler
- Handlers: `executeSpec`, `executeDecompose`, `executeDesign`, `executeImplement`, `executeCrossModelReview`
- Shared context (`PipelineContext`) flows between phases: spec, tasks, designSpec, streamResults
- Generic `runReviewLoop` handles any review step with configurable agent, iterations, and approval keyword

### `constants.ts`
- `SessionEvent` — Copilot SDK event names (`assistant.message_delta`, etc.)
- `ResponseKeyword` — Agent decision keywords (`APPROVED`, `ALL_PASSED`, `CLARIFICATION_NEEDED`)
- `BUILTIN_AGENT_PREFIX` — `"builtin:"` prefix for agent source resolution
- `FRONTEND_MARKER` / `FRONTEND_KEYWORDS` — Frontend task detection
- `SYSTEM_MESSAGE_MODE` — Session system message injection mode

### `messages.ts`
- All log messages in one place for centralized editing
- Template functions accept dynamic agent names (no hardcoded agent references)
- Change any user-facing text here without touching business logic

### `logger.ts`
- `Logger` class wrapping `console.log/warn/error`
- Verbose-aware: `write()`, `newline()`, and `debug()` only output when verbose is enabled
- Safe error formatting (handles both `Error` instances and unknown types)

### `session.ts`
- `SessionManager` — owns the `CopilotClient` lifecycle
- Agent instruction resolution: looks up the agent name in `PipelineConfig.agents`, resolves `builtin:` prefix or file path
- Caches loaded instructions (each agent file is read once)
- `createAgentSession(agentName, model?)` — creates a Copilot session with resolved instructions
- `send(session, prompt)` — sends a prompt and waits for response
- `callIsolated(agentName, prompt, model?)` — throwaway session with retry logic

### `utils.ts`
- `parseJsonArray(raw)` — extracts and validates a JSON string array from agent prose
- `writeRoleSummary(config, role, content)` — writes timestamped markdown to `doc/`
- `hasFrontendWork(tasks)` — checks if any task matches frontend keywords
- `isFrontendTask(task)` — checks for the `[FRONTEND]` marker
- `responseContains(response, keyword)` — case-insensitive keyword detection

### `orchestrator.ts`
- Thin backward-compatible wrapper
- Loads `PipelineConfig`, creates `PipelineEngine`, delegates `start`/`stop`/`execute`

### `index.ts`
- Thin entry point: loads config, creates logger and orchestrator, runs it
- No business logic

## Pipeline Configuration

### `swarm.config.yaml` Schema

```yaml
# Models (overridable via PRIMARY_MODEL / REVIEW_MODEL env vars)
primaryModel: claude-opus-4-6-fast
reviewModel: gpt-5.2-codex

# Agent definitions: name → instruction source
agents:
  pm:           builtin:pm                    # Built-in instructions
  engineer:     .github/agents/engineer.md    # Custom file in repo
  security:     .github/agents/security.md    # Entirely new agent

# Pipeline: ordered list of phases
pipeline:
  - phase: spec          # Specification drafting + reviews
  - phase: decompose     # Task decomposition
  - phase: design        # UI/UX design (conditional)
  - phase: implement     # Per-task engineering + reviews + QA
  - phase: cross-model-review  # Different-model review (conditional)
```

### Agent Source Resolution

When the engine needs agent instructions, it resolves the source from the `agents` map:

| Source | Resolution |
|---|---|
| `builtin:<name>` | `<agentsDir>/<name>.md` (e.g., `.github/agents/pm.md`) |
| `path/to/file.md` | Repo root-relative file path |
| *(not in map)* | Falls back to `<agentsDir>/<agentName>.md` |

Instructions are cached after first load — each file is read once per run.

### Phase Types

| Phase | Purpose | Key Config |
|---|---|---|
| `spec` | Draft specification, run review loops | `agent`, `reviews[]` |
| `decompose` | Break spec into tasks | `agent`, `frontendMarker` |
| `design` | UI/UX design with reviews | `condition`, `agent`, `clarificationAgent`, `reviews[]` |
| `implement` | Per-task engineering + code review + QA | `parallel`, `agent`, `reviews[]`, `qa` |
| `cross-model-review` | Different-model review of all streams | `condition`, `agent`, `fixAgent`, `maxIterations` |

### Conditions

| Condition | Meaning |
|---|---|
| `hasFrontendTasks` | Phase runs only if decomposed tasks include frontend keywords |
| `differentReviewModel` | Phase runs only if `reviewModel ≠ primaryModel` |

## Environment Variable Reference

### Core Config (always env vars)

| Parameter | Env Var | Default | Validation |
|---|---|---|---|
| `verbose` | `VERBOSE` | `false` | Must be `"true"` or `"false"` |
| `issueBody` | `ISSUE_BODY` | *(required)* | **Required.** Non-empty string |
| `agentsDir` | `AGENTS_DIR` | `.github/agents` | Non-empty string |
| `docDir` | `DOC_DIR` | `doc` | Non-empty string |
| `sessionTimeoutMs` | `SESSION_TIMEOUT_MS` | `300000` | Positive integer |
| `maxRetries` | `MAX_RETRIES` | `2` | Positive integer |
| `summaryFileName` | `SUMMARY_FILE_NAME` | `swarm-summary.md` | Non-empty string |

### Pipeline Config (YAML, env var overridable)

| Parameter | Env Var | Default | Source |
|---|---|---|---|
| `primaryModel` | `PRIMARY_MODEL` | `claude-opus-4-6-fast` | `swarm.config.yaml` |
| `reviewModel` | `REVIEW_MODEL` | `gpt-5.2-codex` | `swarm.config.yaml` |

Review iterations and QA iterations are now **per-step** in the pipeline YAML, not global env vars.

## Usage

### Local Development

```bash
# Run with defaults (built-in pipeline)
ISSUE_BODY="Add a dark mode toggle" pnpm --filter @copilot-swarm/core start

# Override models via env
ISSUE_BODY="Fix bug" PRIMARY_MODEL=gpt-5.2 REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @copilot-swarm/core start

# Skip cross-model review
ISSUE_BODY="Fix bug" PRIMARY_MODEL=claude-opus-4-6-fast REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @copilot-swarm/core start
```

### Custom Pipeline

Create `swarm.config.yaml` in the repo root (see `swarm.config.example.yaml`):

```bash
# Uses the repo's swarm.config.yaml if present, otherwise built-in defaults
ISSUE_BODY="Add login page" pnpm --filter @copilot-swarm/core start
```

### GitHub Actions

The orchestrator is triggered by labeling a GitHub Issue. Environment variables are passed through the workflow.

## Design Decisions

### Config-Driven Pipeline
- The full pipeline is declarative YAML — adding/removing phases, agents, or review loops requires zero code changes
- Validation happens at startup with clear error messages (missing agents, invalid types, undefined references)
- The default config reproduces the original hardcoded behavior exactly

### Session Strategy
- **Spec reviews** use isolated sessions (fresh context prevents self-review bias)
- **Task streams** use a single long-lived session per task to preserve implementation context
- **Cross-model review** uses isolated sessions with the alternate model

### Agent Resolution
- `builtin:` prefix resolves to the repo's agents directory (ready for package extraction where builtins ship with the package)
- File paths are repo root-relative for portability
- Instruction caching prevents redundant file reads

### Error Handling
- Agent calls retry up to `maxRetries` times on empty responses or errors
- Missing agent instructions cause immediate failure with the full file path
- JSON parsing validates the result is actually a `string[]`
- Pipeline config validation is exhaustive: every field, every cross-reference
