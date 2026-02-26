# @copilot-swarm/core

Multi-agent orchestrator for GitHub Copilot — coordinates PM, designer, engineer, reviewer, and tester agents through a declarative pipeline.

## Why?

Modern AI coding assistants work well for individual tasks, but complex features benefit from a structured multi-agent approach. Copilot Swarm mimics a high-performing engineering team: a PM writes specs, reviewers challenge them, an engineer implements, a code reviewer gates quality, and a QA tester validates — all coordinated automatically with self-correcting review loops.

## Quick Start

```bash
# Run directly — no install required
npx @copilot-swarm/core "Add a dark mode toggle"

# Or install globally for the short `swarm` command
npm install -g @copilot-swarm/core
swarm "Add a dark mode toggle"
```

> **Prerequisite:** An active [GitHub Copilot](https://github.com/features/copilot) subscription and the [GitHub CLI](https://cli.github.com/) (`gh`) authenticated on your machine.

## CLI Reference

```
Usage: swarm [command] [options] "<prompt>"

Commands:
  run              Run the full orchestration pipeline (default)
  plan             Interactive planning mode — clarify requirements before running
  analyze          Analyze the repository and generate a context document

Options:
  -v, --verbose        Enable verbose streaming output
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -f, --file <file>    Read prompt from a file instead of inline text
  -r, --resume         Resume from the last checkpoint (skip completed phases)
  -V, --version        Show version number
  -h, --help           Show this help message
```

### Examples

```bash
# Basic run
swarm "Fix the login bug on the settings page"

# Verbose output (streams agent deltas, tool calls, intent updates)
swarm -v "Add user avatar upload"

# Read prompt from a file
swarm plan -f requirements.md
swarm -f feature-description.txt

# Plan first, run later
swarm plan "Redesign the notification system"
swarm --plan .swarm/plans/plan-latest.md

# Resume a failed/timed-out run
swarm --resume
```

The prompt can also be passed via the `ISSUE_BODY` environment variable. CLI arguments take precedence.

## Planning Mode

Use `swarm plan` to interactively refine vague requirements before running the full pipeline:

```bash
swarm plan "Add a dark mode toggle"
```

Two phases run in sequence:

1. **Requirements Clarification** — A PM agent asks targeted questions to fill gaps in the requirements. Answer interactively in the terminal. Press Enter to skip a round.
2. **Technical Analysis** — An engineering agent analyzes the codebase and reports complexity, affected files, risks, and a suggested approach.

Output:

- `.swarm/plans/plan-<timestamp>.md` — Timestamped plan (never overwritten)
- `.swarm/plans/plan-latest.md` — Copy of the most recent plan

Then feed the plan into the full pipeline:

```bash
swarm --plan .swarm/plans/plan-latest.md
```

## Analyze Mode

Generate a comprehensive repository context document:

```bash
swarm analyze
```

Produces `.swarm/analysis/repo-analysis.md` — a structured analysis covering tech stack, architecture, key files, commands, patterns, and a step-by-step guide for implementing new features. The analysis goes through a dual-model review process:

1. **Architect** explores the repo and drafts the document
2. **Senior engineer** reviews for accuracy (up to 3 iterations)
3. **Cross-model verification** — same flow with a different AI model to catch blind spots

## Pipeline

The default pipeline runs five phases:

| Phase | What happens |
|---|---|
| **Spec** | PM drafts a specification, reviewed by a creative reviewer and a technical architect (up to 3 iterations each) |
| **Decompose** | PM splits the spec into 2–3 independent tasks, marking frontend tasks with `[FRONTEND]` |
| **Design** | *(conditional)* If frontend tasks exist, a designer creates a UI/UX spec, reviewed by a design reviewer |
| **Implement** | Each task runs in parallel: engineer implements → code reviewer gates quality → QA validates against spec |
| **Cross-model review** | *(conditional)* A different AI model reviews all output, catching model-specific blind spots |

### Built-in Agents

| Agent | Role |
|---|---|
| `pm` | Analyzes requirements, writes specs, decomposes tasks |
| `pm-reviewer` | Challenges the PM's spec for completeness |
| `spec-reviewer` | Validates technical feasibility |
| `designer` | Creates UI/UX specifications for frontend tasks |
| `design-reviewer` | Reviews designs for usability and accessibility |
| `engineer` | Implements code based on specs and designs |
| `code-reviewer` | Security and quality gate |
| `tester` | QA validation against acceptance criteria |
| `cross-model` | Independent review using a different AI model |

## Configuration

Drop a `swarm.config.yaml` in your repo root to customize the pipeline. If not present, the built-in default is used.

```yaml
primaryModel: claude-opus-4-6
reviewModel: gpt-5.3-codex

agents:
  pm:            builtin:pm
  engineer:      .github/agents/engineer.md   # Custom instructions
  security:      .github/agents/security.md   # New agent
  code-reviewer: builtin:eng-code-reviewer

pipeline:
  - phase: spec
    agent: pm
    reviews:
      - agent: pm-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED

  - phase: decompose
    agent: pm
    frontendMarker: "[FRONTEND]"

  # No design phase — backend-only project

  - phase: implement
    parallel: true
    agent: engineer
    reviews:
      - agent: code-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED
      - agent: security
        maxIterations: 2
        approvalKeyword: APPROVED
    qa:
      agent: tester
      maxIterations: 8
      approvalKeyword: ALL_PASSED

  - phase: cross-model-review
    condition: differentReviewModel
    agent: cross-model
    fixAgent: engineer
    maxIterations: 3
    approvalKeyword: APPROVED
```

### Agent Resolution

| Format | Resolution |
|---|---|
| `builtin:<name>` | Loads from the package's built-in agent definitions |
| `path/to/file.md` | Loads from the repository root |
| *(fallback)* | Looks for `<AGENTS_DIR>/<name>.md` |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ISSUE_BODY` | — | Task description (alternative to CLI prompt) |
| `VERBOSE` | `false` | Enable verbose streaming output |
| `AGENTS_DIR` | `.github/agents` | Directory for agent instruction files |
| `SWARM_DIR` | `.swarm` | Root directory for all swarm output |
| `SESSION_TIMEOUT_MS` | `1800000` | Timeout per agent session (ms) |
| `MAX_AUTO_RESUME` | `3` | Auto-resume attempts on failure |
| `MAX_RETRIES` | `2` | Retry attempts for failed agent responses |
| `PRIMARY_MODEL` | `claude-opus-4-6` | AI model for primary agents (overrides YAML) |
| `REVIEW_MODEL` | `gpt-5.3-codex` | AI model for cross-model review (overrides YAML) |

## GitHub Actions

Trigger the swarm from GitHub Issues by adding a workflow to your repo:

```yaml
# .github/workflows/swarm-trigger.yml
name: Run Copilot Swarm
on:
  issues:
    types: [labeled]

jobs:
  swarm:
    if: contains(fromJson('["run-swarm","run-swarm-verbose"]'), github.event.label.name)
    runs-on: ubuntu-latest
    timeout-minutes: 120
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - uses: mvkaran/setup-copilot-cli@v1
        with: { token: "${{ secrets.COPILOT_CLI_TOKEN }}" }
      - run: npx @copilot-swarm/core "${{ github.event.issue.body }}"
        env:
          GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
          VERBOSE: ${{ github.event.label.name == 'run-swarm-verbose' }}
```

Label an issue with `run-swarm` or `run-swarm-verbose` to trigger it.

## Output

All output is organized under `.swarm/`:

```
.swarm/
  plans/                    # Planning mode output
    plan-latest.md
    plan-<timestamp>.md
  runs/                     # Per-run output (timestamped)
    <runId>/
      summary.md
      roles/
        pm.md, designer.md, engineer-stream-*.md, ...
  analysis/                 # Repository analysis
    repo-analysis.md
  latest                    # Pointer to most recent run
```

## Requirements

- **Node.js** ≥ 22
- **GitHub Copilot** — active subscription
- **GitHub CLI** (`gh`) — authenticated

## License

MIT
