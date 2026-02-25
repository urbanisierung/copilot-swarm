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
  auto             Autonomous plan + run (no interaction)
  task             Lightweight autonomous pipeline for well-scoped tasks
  analyze          Analyze the repository and generate a context document
  brainstorm       Interactive discussion mode — explore ideas with a strategist agent
  review           Review a previous run — provide feedback for agents to fix/improve
  session          Manage sessions: create, list, use (group related runs)
  finish           Finalize the active session — summarize, log to changelog, clean up
  list             List all sessions across all repositories

Options:
  -v, --verbose        Enable verbose streaming output
  -e, --editor         Open an interactive text editor to enter the prompt
  -p, --plan <file>    Use a plan file as input (reads the refined requirements section)
  -f, --file <file>    Read prompt from a file instead of inline text
  -r, --resume         Resume from the last checkpoint (skip completed phases)
  --run <runId>        Specify which run to review (default: latest)
  --session <id>       Use a specific session (default: active session)
  --no-tui             Disable TUI dashboard (use plain log output)
  --verify-build <cmd> Shell command to verify the build (e.g. "npm run build")
  --verify-test <cmd>  Shell command to run tests (e.g. "npm test")
  --verify-lint <cmd>  Shell command to run linting (e.g. "npm run lint")
  -V, --version        Show version number
  -h, --help           Show this help message
```

The prompt can be passed as the last argument or via the `ISSUE_BODY` environment variable. CLI arguments take precedence over env vars.

### Prompt Sources

The CLI supports multiple ways to provide the task description (first match wins):

| Source | Example | Description |
|---|---|---|
| `--plan <file>` | `swarm --plan .swarm/plans/plan-latest.md` | Extract refined requirements from a plan file |
| `--file <file>` | `swarm -f requirements.md` | Read entire file as prompt |
| `--editor` | `swarm -e` | Open interactive multi-line editor |
| Inline text | `swarm "Add dark mode"` | Pass prompt as a positional argument |
| GitHub issue | `swarm "gh:owner/repo#123"` | Fetch issue from GitHub (requires `gh` CLI) |
| GitHub issue (current repo) | `swarm "gh:#42"` | Fetch issue from the current repo |
| GitHub issue (URL) | `swarm "https://github.com/owner/repo/issues/123"` | Fetch issue via full URL |
| `ISSUE_BODY` env var | `ISSUE_BODY="Add dark mode" swarm` | Fallback environment variable |

#### Interactive Editor (`--editor` / `-e`)

Opens a full-screen bordered text area in the terminal. Requires an interactive TTY.

**Navigation:**
- Arrow keys to move cursor
- Ctrl+Left/Right to jump between words
- Home/End to go to line start/end
- Ctrl+A/Ctrl+E for line start/end

**Editing:**
- Enter for new lines
- Backspace/Delete to remove characters
- Ctrl+W or Ctrl+Backspace to delete word backwards

**Actions:**
- Ctrl+S or Esc opens the command palette (Submit / Cancel)
- Ctrl+D to submit directly

```bash
swarm -e
swarm run --editor
swarm plan -e
```

#### Split-Pane Editor (Interactive Q&A)

During plan mode, when agents (PM, engineer, designer) ask clarifying questions, a two-column split-pane editor opens automatically:

- **Left panel:** Editable text area for your answer
- **Right panel:** Read-only scrollable context showing the agent's questions

**Panel navigation:**
- Tab to switch focus between panels
- Arrow keys scroll the right panel when focused
- PgUp/PgDown for page-level scrolling in the right panel

**Actions (from command palette):**
- Submit — send your answer to the agent
- Skip — let the agent use its best judgment
- Cancel — abort the clarification round

All Q&A answers are checkpointed. On resume, previously answered rounds are replayed automatically.

#### GitHub Issue Input

Reference a GitHub issue directly — the CLI fetches the issue title and body using the `gh` CLI. Requires `gh` to be installed and authenticated (`gh auth login`).

Supported formats:
- `gh:owner/repo#123` — full reference
- `gh:#123` — issue in the current repository (detected from git remote)
- `https://github.com/owner/repo/issues/123` — full URL

```bash
swarm "gh:owner/repo#123"
swarm plan "gh:#42"
swarm "https://github.com/my-org/my-repo/issues/7"
```

### Planning Mode

Use `swarm plan` to interactively refine vague requirements before running the full pipeline:

```bash
swarm plan "Add a dark mode toggle"
```

The planning mode runs up to 9 phases:
1. **Pre-Analysis** — Analyzes the request for parallelizable research sub-tasks (e.g. "study this URL", "research best practices for X"). If found, runs them concurrently and merges results as enriched context for the PM. Skipped if no research tasks are detected.
2. **Requirements Clarification** — A PM agent asks targeted questions to fill in gaps. You answer interactively in the terminal. Multi-line answers are supported: type your response across multiple lines and press Enter on an empty line to send. Literal `\n` sequences are converted to real newlines. Press Enter immediately to skip a round.
3. **PM Review** — A reviewer verifies the refined requirements are clear, complete, and actionable (up to 3 iterations).
4. **Engineer Clarification** — A senior engineer reviews the refined requirements from a technical perspective. Asks about API contracts, edge cases, testing expectations, and integration points. Skip if everything is clear.
5. **Engineer Review** — A reviewer verifies the engineering decisions are sound and complete (up to 3 iterations).
6. **Designer Clarification** — A UI/UX designer clarifies visual, interaction, and accessibility details. Skip if the task has no frontend aspects.
7. **Designer Review** — A reviewer verifies the design decisions (up to 3 iterations).
8. **Technical Analysis** — An engineering agent analyzes the codebase and reports complexity, affected files, risks, and suggested approach.
9. **Cross-model Review** — If the review model differs from the primary model, the complete plan is reviewed by the review model for accuracy, feasibility, and completeness (up to 3 iterations). Skipped if both models are the same.

Output files:
- `.swarm/plans/plan-<timestamp>.md` — Timestamped plan with refined requirements, engineering decisions, design decisions, and technical analysis (never overwritten)
- `.swarm/plans/plan-latest.md` — Copy of the most recent plan (stable reference)

### Running from a Plan

After planning, run the full pipeline using the refined requirements:

```bash
# Use the latest plan
swarm --plan .swarm/plans/plan-latest.md

# Or reference a specific timestamped plan
swarm --plan .swarm/plans/plan-2026-02-14T13-30-00-000Z.md
```

The `--plan` flag reads the "Refined Requirements", "Engineering Decisions", and "Design Decisions" sections from the plan file and uses them as the pipeline input. When a plan is provided, the **spec phase is automatically skipped** — the plan's refined requirements are used directly as the specification, going straight to task decomposition. This avoids redundant re-analysis that can produce blockers instead of actionable implementation.

### Auto Mode

Use `swarm auto` to run planning and implementation in one shot without user interaction:

```bash
swarm auto "Add a dark mode toggle"
swarm auto -f requirements.md
```

Auto mode combines analysis, planning and running into a single autonomous pipeline:

1. **Analysis phase** — Runs the full repository analysis (architect exploration + peer review) to generate a comprehensive context document.
2. **Planning phase** — Runs the full planning pipeline (pre-analysis, PM clarification, engineer/designer clarification, reviews) with repo analysis as context. All clarifying questions are auto-answered with the agent's best judgment.
3. **Implementation phase** — Takes the plan output and feeds it directly into the run pipeline (decomposition, implementation, cross-model review, verification).

This is useful for well-defined tasks where interactive clarification is not needed, CI/CD pipelines, or batch processing. The analysis and plan files are still saved to `.swarm/` for reference.

### Task Mode

Use `swarm task` for a lightweight autonomous mode — faster than `auto`, skips the full planning pipeline:

```bash
swarm task "Fix the login validation bug"
swarm task -f task-description.md
```

Task mode runs a streamlined pipeline:

1. **Pre-analysis** — Checks if the task requires any research or study (URLs to read, libraries to investigate). If found, runs them in parallel and merges results as context.
2. **PM review** — A PM agent reviews and refines the task into a clear specification, auto-answering any open questions with best judgment.
3. **Decomposition** — Determines how many engineering streams are needed. If tasks have dependencies, they're grouped into execution waves.
4. **Implementation** — Streams implement their tasks. Independent tasks run in parallel; tasks with dependencies run in sequential waves, each wave receiving prior wave output as context. Each stream has QA loops (if something breaks, it goes back to the engineer).
5. **Verification** — Runs build/test/lint commands to verify the implementation.

Task mode is ideal for well-scoped tasks that don't need the full planning ceremony (engineer/designer clarification, plan reviews, cross-model plan review). Use `auto` for larger, more complex work.

### Analyze Mode

Use `swarm analyze` to generate a comprehensive repository context document:

```bash
swarm analyze
```

The analyze mode runs a dual-model review process:

1. **Architect exploration (primary model)** — An architect agent explores the repository and produces a structured analysis covering: tech stack, structure, architecture, key files, commands, patterns, conventions, dependencies, and a step-by-step guide for implementing new features.
2. **Senior engineer review (primary model)** — A senior engineer independently verifies the analysis for accuracy and completeness (up to 3 iterations).
3. **Cross-model verification** — The same architect→senior engineer loop runs with the review model, catching model-specific blind spots (up to 3 iterations). Skipped if primary and review models are the same.

**Large repository support:** For repositories with 500+ files (configurable via `ANALYZE_CHUNK_THRESHOLD`), analysis automatically switches to a chunked parallel strategy:

1. **Scout (fast model)** — A cheap model scans the repository structure and README to produce a high-level overview.
2. **Partition (deterministic)** — Directories are grouped into chunks of ~300 files each (configurable via `ANALYZE_CHUNK_MAX_FILES`), respecting natural boundaries (monorepo packages, top-level dirs). Large directories are split by their subdirectories.
3. **Parallel chunk analysis (primary model)** — Multiple agents analyze their assigned chunks in parallel, each producing a focused markdown file saved to `.swarm/analysis/chunks/`.
4. **Synthesis (primary model)** — One agent merges all chunk analyses into a single unified document, deduplicating and cross-referencing.
5. **Review** — Senior engineer reviews the synthesized document (up to 3 iterations).

Output:
- `.swarm/analysis/repo-analysis.md` — The final analysis document (overwritten on each run)
- `.swarm/analysis/chunks/` — Individual chunk analyses (only for chunked mode)

### Review Mode

Use `swarm review` to provide feedback on a previous run. The agents receive the original spec, tasks, design, and their previous implementation alongside your feedback, then fix only what needs to change:

```bash
# Review the latest run with inline feedback
swarm review "Fix the auth bug in stream 1, add error handling in stream 2"

# Use the editor for detailed feedback
swarm review -e

# Read feedback from a file
swarm review -f review-notes.md

# Review a specific run (not the latest)
swarm review --run 2026-02-17T08-00-00-000Z "Fix the login form"
```

**How it works:**
1. Loads the previous run's context (spec, tasks, design spec, stream results) from `.swarm/sessions/<id>/runs/<runId>/`
2. Skips spec, decompose, and design phases (they were already done)
3. Collapses all previous streams into a **single review stream** — one engineer sees the full prior implementation + your feedback
4. The engineer is instructed to keep what works and only fix what's described in the feedback
5. Code review and QA loops run normally on the revised output
6. Output goes to a new run directory (new timestamp)

The review mode supports checkpoint/resume (`--resume`) and auto-retry, same as regular run mode.

### Brainstorm Mode

Use `swarm brainstorm` to explore ideas interactively with a product strategist agent. No code is produced — just a structured discussion and summary:

```bash
swarm brainstorm "Should we migrate from REST to GraphQL?"
swarm brainstorm -e   # Open editor for a longer description
```

**How it works:**
1. A strategist agent (combining PM, design, and engineering perspectives) reads your idea
2. Interactive loop: the agent shares thoughts, asks probing questions, challenges assumptions, and suggests alternatives
3. You respond in a split-pane editor (agent's questions on the right, your answer on the left)
4. Type `BRAINSTORM_DONE` to finish the discussion
5. The agent generates a structured summary: problem/idea, key ideas discussed, pros & cons, open questions, and recommendations

**Output:**
- `.swarm/brainstorms/<runId>.md` — Saved summary (session-scoped if a session is active)
- The latest brainstorm summary is automatically loaded as context when running `swarm plan`, enriching the PM's understanding of your requirements

### Checkpoint & Resume

Long-running pipeline executions are checkpointed at multiple granularity levels. If a run fails (e.g., due to a timeout), it resumes from the exact point of failure:

```bash
# Resume a failed run
swarm --resume
swarm -r

# Resume a failed plan
swarm plan --resume
swarm plan -r

# Resume a failed analysis
swarm analyze --resume
swarm analyze -r

# Resume with verbose output
swarm -r -v
```

How it works:
- **Phase-level:** After each pipeline phase completes, full progress is saved to `.swarm/runs/<runId>/checkpoint.json`. This applies to `run`, `plan`, and `analyze` modes.
- **Iteration-level:** Within review and QA feedback loops, progress is saved after each iteration. On resume, completed iterations are skipped and the latest revised content is used as the starting point.
- **Stream-level:** During the `implement` phase, each completed stream is saved individually — if 2 of 3 streams finish before a timeout, those 2 are preserved. Draft code and review progress within each stream are also checkpointed.
- **Draft-level:** The initial output of each agent (spec draft, design draft, engineering code, architecture analysis) is saved before review loops begin, so it doesn't need to be regenerated on resume.
- **Plan mode:** Each of the 8 planning phases (clarification, review, analysis, cross-model) is checkpointed individually. Interactive Q&A answers are saved as `answeredQuestions` — if a crash happens during engineer review, the PM and engineer clarification phases don't need to be repeated and previously answered Q&A rounds are replayed automatically. Review iteration progress within plan mode is also tracked.
- **Analyze mode:** The architect draft and each review iteration are checkpointed. Cross-model analysis phases are tracked independently. If a failure occurs mid-review, the architect's initial analysis is preserved and the review loop resumes from the last completed iteration.
- **Session tracking:** Every Copilot SDK session created during a run is logged in the checkpoint's `sessionLog` field, keyed by context (e.g., `spec`, `implement/stream-0`, `design/review-1-2`). Each entry records the session ID, agent name, and role. Session logs are restored on resume and accumulate across the run. This enables correlating checkpoint state with Copilot session history in `~/.copilot/session-state/`.
- On `--resume`, completed phases, iterations, and streams are skipped. Only the remaining work is executed.
- The checkpoint file is automatically deleted on successful completion.
- Add `.swarm/runs/` and `.swarm/latest` to your `.gitignore`.

### Auto-Resume

By default, the orchestrator automatically retries from the last checkpoint up to 3 times when a failure occurs (e.g., timeout, network error). This means most transient failures are recovered without manual intervention.

- Configure via `MAX_AUTO_RESUME` env var (default: `3`, set to `0` to disable)
- The `--resume` flag is still available for manual retries after all auto-resume attempts are exhausted

### Sessions (Feature Grouping)

Sessions group related runs (analyze, plan, run, review) under a single logical feature/project. This preserves context across modes and makes it easy to track all work for a given feature.

**Structure:**
```
.swarm/
  sessions/
    <sessionId>/
      session.json          # metadata (id, name, created, description)
      runs/<runId>/          # run output directories
      plans/                # plan outputs
      analysis/             # analysis outputs
      latest                # latest run pointer within session
  active-session            # pointer to the active session ID
```

**Commands:**
```bash
# Create a new session
swarm session create "Dark mode feature"

# List all sessions
swarm session list

# Switch to a specific session
swarm session use <sessionId>
```

**Automatic behavior:**
- All commands (`run`, `plan`, `analyze`, `review`) automatically use the active session
- Override with `--session <id>` flag
- If no session exists, a default session is auto-created
- Legacy `.swarm/runs/`, `plans/`, `analysis/` directories are automatically migrated into the default session on first use

### Finish Command

Finalize a session when you're done with a feature. This summarizes all work, appends an entry to a central changelog, cleans up checkpoint files, and marks the session as finished.

```bash
# Finalize the active session
swarm finish

# Finalize a specific session
swarm finish --session <id>
```

**What it does:**
1. Collects artifacts from all runs, plans, and analyses in the session
2. Builds a structured summary (original request, phases, tasks, stream counts)
3. Appends the summary to `.swarm/changelog.md` (newest first)
4. Deletes `checkpoint.json` files from all runs (role summaries are preserved)
5. Marks the session as finished in `session.json`

The changelog serves as a persistent record of completed features across the project.

### List Command

List all sessions across all repositories. Sessions are tracked in a global registry at `~/.config/copilot-swarm/sessions.json`.

```bash
swarm list
```

Output shows session ID, name, repository path, status (active/finished), and creation timestamp. This is useful for finding sessions in other repos or reviewing past work.

### TUI Dashboard

A full-screen terminal dashboard displays progress for all modes (`run`, `plan`, `analyze`) when running in a TTY (interactive terminal). The dashboard shows:

- **Header** — Tool name, CLI version, active model, current working directory, and elapsed time
- **Phase progress** — Status of each phase (pending, active, done, skipped)
- **Stream status** — Per-stream status during implementation (queued, coding, review, testing, done, failed) — `run` mode only
- **Active agent** — Which agent is currently working
- **Activity log** — Recent log entries

In `plan` mode, the TUI automatically pauses to show agent questions and accept user input, then resumes after each answer.

The TUI is automatically enabled when:
- stdout is a TTY (not piped or CI)
- Verbose mode (`-v`) is not active

To disable the TUI and use plain log output:

```bash
swarm --no-tui "Add a dark mode toggle"
swarm --no-tui plan "Add a dark mode toggle"
```

After the TUI exits, a completion summary is printed with elapsed time, phase stats, and output directory.

### Log Files

Every run writes a debug log to the system temp directory:

- **Linux:** `/tmp/copilot-swarm/swarm-<runId>.log`
- **macOS:** `$TMPDIR/copilot-swarm/swarm-<runId>.log`
- **Windows:** `%TEMP%\copilot-swarm\swarm-<runId>.log`

The log file captures all messages (including debug-level) regardless of verbose mode or TUI state. If an error occurs, the log file path is printed to help with debugging. Log file creation is non-blocking — if it fails, the tool continues normally.

### Local Development

```bash
# Using CLI args
pnpm --filter @copilot-swarm/core start -- "Add a dark mode toggle"
pnpm --filter @copilot-swarm/core start -- -v "Add login form"

# Using env vars (also works)
ISSUE_BODY="Add a dark mode toggle" pnpm --filter @copilot-swarm/core start

# Override models
ISSUE_BODY="Fix bug" PRIMARY_MODEL=gpt-5.2 REVIEW_MODEL=claude-opus-4-6 pnpm --filter @copilot-swarm/core start

# Use a different fast model for coordination tasks
ISSUE_BODY="Fix bug" FAST_MODEL=gpt-5-mini pnpm --filter @copilot-swarm/core start

# Skip cross-model review (set both models to the same value)
ISSUE_BODY="Fix bug" PRIMARY_MODEL=claude-opus-4-6 REVIEW_MODEL=claude-opus-4-6 pnpm --filter @copilot-swarm/core start
```

### GitHub Actions

Copilot Swarm provides a reusable GitHub Action that can be used in any repository.

#### Setup

1. Create a Copilot CLI token (Organization Settings → Developer Settings → Personal Access Tokens → Classic, select `copilot` scope)
2. Add it as a repository secret named `COPILOT_CLI_TOKEN`

#### Basic Usage

```yaml
name: Copilot Swarm
on:
  issues:
    types: [labeled]

jobs:
  swarm:
    if: github.event.label.name == 'run-swarm'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: urbanisierung/copilot-swarm/action@main
        env:
          COPILOT_CLI_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
        with:
          command: run
          prompt: ${{ github.event.issue.body }}
```

#### Action Inputs

| Input | Default | Description |
|---|---|---|
| `command` | `run` | Command to execute: `run`, `plan`, `analyze`, `review`, `finish` |
| `prompt` | — | Task description / prompt (inline) |
| `prompt-file` | — | Path to a file containing the prompt (for long descriptions) |
| `plan-file` | — | Path to a plan file from a previous plan mode run |
| `resume` | `false` | Resume from the last checkpoint |
| `session` | — | Session ID (default: active session) |
| `run-id` | — | Run ID for review mode (default: latest) |
| `verbose` | `false` | Enable verbose output |
| `version` | `latest` | Version of `@copilot-swarm/core` to use |
| `primary-model` | — | Primary AI model override |
| `review-model` | — | Review AI model override |

#### Action Outputs

| Output | Description |
|---|---|
| `output-dir` | Path to the `.swarm` output directory |
| `run-id` | The run ID of this execution |

#### Plan Mode in CI

Plan mode works in CI but interactive clarification is auto-skipped — agents use their best judgment for open questions. For best results, provide a detailed prompt or use a two-phase workflow:

1. **Phase 1:** Run `plan` mode → agents produce a plan, checkpoint is saved
2. **Review:** Check the plan output in the `.swarm/` artifact
3. **Phase 2:** Re-run with `resume: true` if needed, or proceed with `run --plan .swarm/plans/plan-latest.md`

#### Example: Full Pipeline

```yaml
jobs:
  implement:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: urbanisierung/copilot-swarm/action@main
        env:
          COPILOT_CLI_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
        with:
          command: run
          prompt: "Add a dark mode toggle to the settings page"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: swarm-output
          path: .swarm/
```

#### Long Prompts

For long or detailed prompts, use one of these approaches:

**Option 1: File in the repo** — Commit a prompt file and reference it:
```yaml
- uses: urbanisierung/copilot-swarm/action@main
  with:
    prompt-file: docs/feature-spec.md
```

**Option 2: YAML multi-line string** — Use `|` for multi-line prompts:
```yaml
- uses: urbanisierung/copilot-swarm/action@main
  with:
    prompt: |
      Add a user preferences page with the following requirements:
      - Dark mode toggle with system preference detection
      - Language selector (EN, DE, FR)
      - Notification settings (email, push, in-app)
      - All settings persisted to localStorage
```

**Option 3: Issue body** — Trigger from an issue and use its body:
```yaml
- uses: urbanisierung/copilot-swarm/action@main
  with:
    prompt: ${{ github.event.issue.body }}
```

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
| `SWARM_DIR` | `.swarm` | Root directory for all swarm output (plans, runs, analysis). |
| `SESSION_TIMEOUT_MS` | `1800000` | Timeout in milliseconds for each agent session call (default: 30 minutes). |
| `MAX_AUTO_RESUME` | `3` | Max automatic resume attempts on pipeline failure (set to `0` to disable). |
| `MAX_RETRIES` | `2` | Max retry attempts for failed or empty agent responses. |

### Optional (Model Overrides)

These override the values in `swarm.config.yaml`:

| Variable | Default (from YAML) | Description |
|---|---|---|
| `PRIMARY_MODEL` | `claude-opus-4-6` | The AI model used for all primary agent sessions (spec drafting, engineering, code review, QA, design). |
| `REVIEW_MODEL` | `gpt-5.2-codex` | The AI model used for cross-model review sessions. |
| `FAST_MODEL` | `claude-haiku-4.5` | Lightweight model for coordination tasks (prereq analysis, task decomposition, task-mode PM review). Faster and cheaper than the primary model. |

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

### Engineer-to-PM Clarification

During the `implement` phase, engineers may encounter ambiguities not covered by the spec. The pipeline supports automatic clarification routing:

```yaml
pipeline:
  - phase: implement
    agent: engineer
    clarificationAgent: pm            # Agent to answer questions
    clarificationKeyword: CLARIFICATION_NEEDED  # Trigger keyword
    reviews: [...]
```

When an engineer's output contains the `clarificationKeyword`, the pipeline automatically:
1. Extracts the engineer's questions
2. Routes them to the PM agent (isolated session) along with the original spec
3. Sends the PM's answers back to the engineer session
4. The engineer continues implementation with the clarified requirements

This is fully automatic — no user interaction required. Both fields are optional; if omitted, no clarification routing occurs.

### Verification Phase

After implementation (and cross-model review if enabled), the pipeline can run shell commands to verify the code actually builds, passes tests, and lints clean.

#### Command Resolution (priority order)

1. **CLI flags**: `--verify-build "npm run build" --verify-test "npm test" --verify-lint "npm run lint"`
2. **YAML config**: `verify:` section in `swarm.config.yaml`
3. **Auto-detect**: Scans for `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle`

```yaml
# swarm.config.yaml
verify:
  build: "npm run build"
  test: "npm test"
  lint: "npm run lint"
```

If no commands are configured and no project files are detected, the phase is skipped.

#### Auto-Detection

| Project File | Build | Test | Lint |
|---|---|---|---|
| `package.json` | `npm run build` (if script exists) | `npm test` (if script exists) | `npm run lint` or `npm run check` |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo clippy` |
| `go.mod` | `go build ./...` | `go test ./...` | `go vet ./...` |
| `pyproject.toml` | — | `pytest` | `ruff check .` |
| `pom.xml` | `mvn compile` | `mvn test` | — |
| `build.gradle` | `./gradlew build` | `./gradlew test` | — |

For greenfield projects, auto-detection runs after the implement phase (when project files exist).

#### Behavior

- All configured commands are run. If any fail, the errors are sent to the fix agent.
- The fix agent makes corrections, then all commands are re-run.
- Loops up to `maxIterations` (default: 3). If still failing, a failure summary is written.
- If all commands pass on any iteration, the phase completes immediately.

### Agent Source Resolution

| Source Format | Resolution |
|---|---|
| `builtin:<name>` | Loads `<AGENTS_DIR>/<name>.md` |
| `path/to/file.md` | Loads from repo root |
| *(not in agents map)* | Falls back to `<AGENTS_DIR>/<agentName>.md` |

## Output

All output is organized under the `.swarm/` directory:

```
.swarm/
  plans/                          # Planning mode output
    plan-latest.md                # Most recent plan (stable reference)
    plan-<timestamp>.md           # Timestamped plans
  runs/                           # Pipeline run output (one folder per run)
    <runId>/
      summary.md                  # Final run summary
      checkpoint.json             # Checkpoint (deleted on success)
      roles/                      # Per-role summaries
        pm.md
        designer.md
        engineer-stream-1.md
        ...
        cross-model-review.md
  analysis/                       # Repository analysis output
    repo-analysis.md
    chunks/                       # Per-chunk analyses (chunked mode only)
      chunk-<id>.md
  brainstorms/                    # Brainstorm discussion summaries
    <runId>.md
  latest                          # Pointer to the most recent run ID
```

Recommended `.gitignore` entries:
```gitignore
.swarm/runs/
.swarm/latest
```

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
npm publish --access public
```

> **Note:** `--provenance` only works inside GitHub Actions (requires an OIDC provider). Omit it for local publishes. The CI release workflow adds provenance automatically.

### Changeset Commands

```bash
pnpm changeset              # Create a new changeset
pnpm version-packages       # Apply changesets (bump versions, update changelogs)
pnpm release                # Build and publish all versioned packages
```
