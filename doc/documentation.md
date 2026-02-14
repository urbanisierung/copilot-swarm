# CLI Documentation

Detailed usage documentation for the AI Agency Orchestrator.

## Running the Orchestrator

### Local Development

```bash
# Required: set the issue body (the task description for the agents)
ISSUE_BODY="Add a dark mode toggle to the settings page" pnpm --filter @ai-playground/ai start

# With verbose output (streams agent responses, tool calls, intents)
ISSUE_BODY="Add login form" VERBOSE=true pnpm --filter @ai-playground/ai start

# Override models
ISSUE_BODY="Fix bug" PRIMARY_MODEL=gpt-5.2 REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @ai-playground/ai start

# Skip cross-model review (set both models to the same value)
ISSUE_BODY="Fix bug" PRIMARY_MODEL=claude-opus-4-6-fast REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @ai-playground/ai start
```

### GitHub Actions

The orchestrator is triggered by labeling a GitHub Issue with `run-agency` or `run-agency-verbose`. See the workflow file for details.

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `ISSUE_BODY` | The task description for the agents. **Must be set.** The app exits with an error if missing. |

### Optional (Core Config)

| Variable | Default | Description |
|---|---|---|
| `VERBOSE` | `false` | Enable verbose streaming output. Must be `"true"` or `"false"`. |
| `AGENTS_DIR` | `.github/agents` | Directory containing agent instruction `.md` files. |
| `DOC_DIR` | `doc` | Directory for role summaries and the final summary file. |
| `SESSION_TIMEOUT_MS` | `300000` | Timeout in milliseconds for each agent session call. |
| `MAX_RETRIES` | `2` | Max retry attempts for failed or empty agent responses. |
| `SUMMARY_FILE_NAME` | `agency-summary.md` | Name of the final summary file written to `DOC_DIR`. |

### Optional (Model Overrides)

These override the values in `agency.config.yaml`:

| Variable | Default (from YAML) | Description |
|---|---|---|
| `PRIMARY_MODEL` | `claude-opus-4-6-fast` | The AI model used for all primary agent sessions. |
| `REVIEW_MODEL` | `gpt-5.2-codex` | The AI model used for cross-model review sessions. |

## Pipeline Configuration

The orchestrator reads `agency.config.yaml` from the repository root. If not found, it uses the built-in default pipeline.

### Custom Pipeline

Create `agency.config.yaml` in your repo root. See `apps/ai/agency.config.example.yaml` for a complete example.

```yaml
agents:
  pm:           builtin:pm
  engineer:     .github/agents/engineer.md   # Custom instructions
  security:     .github/agents/security.md   # New agent

pipeline:
  - phase: spec
    agent: pm
    reviews:
      - agent: pm-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED
  # ... more phases
```

### Agent Source Resolution

| Source Format | Resolution |
|---|---|
| `builtin:<name>` | Loads `<AGENTS_DIR>/<name>.md` |
| `path/to/file.md` | Loads from repo root |
| *(not in agents map)* | Falls back to `<AGENTS_DIR>/<agentName>.md` |

## Output

The orchestrator writes the following files:

| File | Description |
|---|---|
| `<DOC_DIR>/<agent-name>.md` | Per-role summary with timestamp |
| `<DOC_DIR>/engineer-stream-N.md` | Per-task engineering output |
| `<DOC_DIR>/cross-model-review.md` | Cross-model review results (if applicable) |
| `<DOC_DIR>/<SUMMARY_FILE_NAME>` | Final summary with all stream results |

## Build & Check Commands

```bash
pnpm turbo build       # Build all packages
pnpm turbo typecheck   # TypeScript type checking
pnpm turbo check       # Biome lint & format
pnpm turbo test        # Run all tests
```
