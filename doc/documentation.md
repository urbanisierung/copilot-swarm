# CLI Documentation

Detailed usage documentation for Copilot Swarm.

## Running the Orchestrator

### Via npx / pnpx

```bash
# Run directly (no install required)
npx @copilot-swarm/core "Add a dark mode toggle"
pnpx @copilot-swarm/core "Add a dark mode toggle"

# With verbose output
npx @copilot-swarm/core -v "Add login form"
```

### Global Install

```bash
npm install -g @copilot-swarm/core

# Then run with the short binary name
swarm "Add a dark mode toggle"
swarm -v "Fix the login bug"
```

### CLI Options

```
Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode — clarify requirements before running

Options:
  -v, --verbose        Enable verbose streaming output
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -h, --help           Show this help message
```

The prompt can be passed as the last argument or via the `ISSUE_BODY` environment variable. CLI arguments take precedence over env vars.

### Planning Mode

Use `swarm plan` to interactively refine vague requirements before running the full pipeline:

```bash
swarm plan "Add a dark mode toggle"
```

The planning mode runs two phases:
1. **Requirements Clarification** — A PM agent asks targeted questions to fill in gaps. You answer interactively in the terminal. Press Enter to skip a round.
2. **Technical Analysis** — An engineering agent analyzes the codebase and reports complexity, affected files, risks, and suggested approach.

Output files:
- `doc/plan-<timestamp>.md` — Timestamped plan (never overwritten)
- `doc/plan-latest.md` — Copy of the most recent plan (stable reference)

### Running from a Plan

After planning, run the full pipeline using the refined requirements:

```bash
# Use the latest plan
swarm --plan doc/plan-latest.md

# Or reference a specific timestamped plan
swarm --plan doc/plan-2026-02-14T13-30-00-000Z.md
```

The `--plan` flag reads the "Refined Requirements" section from the plan file and uses it as the pipeline input.

### Local Development

```bash
# Using CLI args
pnpm --filter @copilot-swarm/core start -- "Add a dark mode toggle"
pnpm --filter @copilot-swarm/core start -- -v "Add login form"

# Using env vars (also works)
ISSUE_BODY="Add a dark mode toggle" pnpm --filter @copilot-swarm/core start

# Override models
ISSUE_BODY="Fix bug" PRIMARY_MODEL=gpt-5.2 REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @copilot-swarm/core start

# Skip cross-model review (set both models to the same value)
ISSUE_BODY="Fix bug" PRIMARY_MODEL=claude-opus-4-6-fast REVIEW_MODEL=claude-opus-4-6-fast pnpm --filter @copilot-swarm/core start
```

### GitHub Actions

The orchestrator is triggered by labeling a GitHub Issue with `run-swarm` or `run-swarm-verbose`. See the workflow file for details.

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
| `SUMMARY_FILE_NAME` | `swarm-summary.md` | Name of the final summary file written to `DOC_DIR`. |

### Optional (Model Overrides)

These override the values in `swarm.config.yaml`:

| Variable | Default (from YAML) | Description |
|---|---|---|
| `PRIMARY_MODEL` | `claude-opus-4-6-fast` | The AI model used for all primary agent sessions. |
| `REVIEW_MODEL` | `gpt-5.2-codex` | The AI model used for cross-model review sessions. |

## Pipeline Configuration

The orchestrator reads `swarm.config.yaml` from the repository root. If not found, it uses the built-in default pipeline.

### Custom Pipeline

Create `swarm.config.yaml` in your repo root. See `apps/core/swarm.config.example.yaml` for a complete example.

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

## Publishing to npm

The package `@copilot-swarm/core` is published to npm using [changesets](https://github.com/changesets/changesets) for version management and npm trusted publishing (OIDC) for authentication.

### Release Flow

1. **Create a changeset** — After making changes, run:
   ```bash
   pnpm changeset
   ```
   Follow the prompts to select the package (`@copilot-swarm/core`), bump type (patch/minor/major), and write a summary. This creates a changeset file in `.changeset/`.

2. **Commit and push** — Commit the changeset file along with your code changes.

3. **Version PR** — When changesets are merged to `main`, the release workflow automatically creates a "Version Packages" PR that bumps `package.json` versions and updates `CHANGELOG.md`.

4. **Publish** — Merging the version PR triggers the release workflow again. Since there are no pending changesets, it runs `changeset publish`, which publishes to npm with provenance attestation.

### First-Time Setup

Before the first publish, configure npm trusted publishing:

1. **Create the package on npmjs.com** — Go to [npmjs.com](https://www.npmjs.com/) and create the `@copilot-swarm/core` package (or let the first publish create it).

2. **Configure trusted publisher** — On the package settings page, add a trusted publisher:
   - **GitHub organization/user**: `urbanisierung`
   - **Repository**: `copilot-swarm`
   - **Workflow filename**: `release.yml`

3. **No NPM_TOKEN needed** — Trusted publishing uses GitHub's OIDC token for authentication. No secrets need to be configured.

### Manual Publishing

For one-off publishes (e.g., the very first release):

```bash
# Login to npm
npm login

# Build and publish
pnpm turbo build
cd apps/core
npm publish --access public --provenance
```

### Changeset Commands

```bash
pnpm changeset              # Create a new changeset
pnpm version-packages       # Apply changesets (bump versions, update changelogs)
pnpm release                # Build and publish all versioned packages
```
