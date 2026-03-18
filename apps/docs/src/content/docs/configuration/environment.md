---
title: Environment Variables
description: All configuration options available via environment variables.
---

## Required

| Variable | Description |
|---|---|
| `ISSUE_BODY` | The task description. **Required** unless prompt is passed via CLI args. |

## Core Config

| Variable | Default | Description |
|---|---|---|
| `VERBOSE` | `false` | Enable verbose streaming output (`true`/`false`) |
| `AGENTS_DIR` | `.github/agents` | Directory containing agent instruction files |
| `SWARM_DIR` | `.swarm` | Root directory for all swarm output |
| `SESSION_TIMEOUT_MS` | `1800000` | Agent session timeout in ms (default: 30 minutes) |
| `MAX_AUTO_RESUME` | `3` | Auto-resume attempts on failure (0 to disable) |
| `MAX_RETRIES` | `2` | Retry attempts for failed agent responses |
| `AUTO_MODEL` | `false` | Auto-select model per task based on complexity |

## Model Overrides

These override values in `swarm.config.yaml`:

| Variable | Default (YAML) | Description |
|---|---|---|
| `PRIMARY_MODEL` | `claude-opus-4-6` | Primary model for all main agent sessions |
| `REVIEW_MODEL` | `gpt-5.3-codex` | Model for cross-model review sessions |
| `FAST_MODEL` | `claude-haiku-4.5` | Model for coordination tasks (cheaper, faster) |

## Analysis Config

| Variable | Default | Description |
|---|---|---|
| `ANALYZE_CHUNK_THRESHOLD` | `500` | File count to trigger chunked analysis |
| `ANALYZE_CHUNK_MAX_FILES` | `300` | Max files per chunk |
| `MODEL_CONTEXT_LIMIT` | `128000` | Model context window in tokens |
| `TOKEN_BUDGET_RATIO` | `0.7` | Fraction of context used for prompt content |

## Prepare Config

| Variable | Default | Description |
|---|---|---|
| `PREPARE_DEEP_THRESHOLD` | `10` | Source file count for deep directory analysis |

## Examples

```bash
# Use different models
PRIMARY_MODEL=gpt-5.2 REVIEW_MODEL=claude-opus-4-6 swarm "Add feature"

# Skip cross-model review (same model for both)
PRIMARY_MODEL=claude-opus-4-6 REVIEW_MODEL=claude-opus-4-6 swarm "Fix bug"

# Use a cheaper fast model
FAST_MODEL=gpt-5-mini swarm task "Update docs"

# Increase timeout for complex tasks
SESSION_TIMEOUT_MS=3600000 swarm "Major refactoring"

# Disable auto-resume
MAX_AUTO_RESUME=0 swarm "Risky change"
```
