# Standalone Execution: Extracting the AI Agency into a Reusable Package

## Goal

Extract the AI Agency orchestrator into a standalone npm package (`@camunda/ai-agency`) published to **GitHub Packages** (private, org-scoped). Any repository in the `camunda` org can then run the full agency pipeline with:

```bash
pnpx @camunda/ai-agency
```

No code needs to be copied. Agent role definitions and pipeline flows are fully configurable from the consuming repo.

## Distribution Strategy

### GitHub Packages (Private npm Registry)

| Aspect | Detail |
|---|---|
| **Registry** | `npm.pkg.github.com` — private to the GitHub org |
| **Scope** | `@camunda/ai-agency` |
| **Auth (CI)** | `GITHUB_TOKEN` — automatic in Actions, has `read:packages` for same-org repos |
| **Auth (local)** | PAT with `read:packages` scope + `.npmrc` entry |
| **Publishing** | GitHub Action in the package repo: on push to `main` → `npm publish` |

### Usage in a Target Repo

**GitHub Action:**
```yaml
- name: Run AI Agency
  env:
    ISSUE_BODY: ${{ github.event.issue.body }}
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    echo "@camunda:registry=https://npm.pkg.github.com/" >> .npmrc
    pnpx @camunda/ai-agency
```

**Local:**
```bash
# One-time setup: add to ~/.npmrc
echo "@camunda:registry=https://npm.pkg.github.com/" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=YOUR_PAT" >> ~/.npmrc

# Run
ISSUE_BODY="Add a login page" pnpx @camunda/ai-agency
```

## Agent Role Configuration

### The Problem

The current implementation hardcodes:
1. **Which agents exist** — pm, pm-reviewer, engineer, tester, etc.
2. **How they connect** — pm → pm-reviewer (loop, max 3), engineer → code-reviewer (loop, max 3), etc.
3. **Which phases run** — PM → Design (conditional) → Task Streams → Cross-Model Review
4. **Agent instructions** — `.md` files in `.github/agents/`

For a reusable package, consuming repos need to:
- Override agent instructions (e.g., different code review standards)
- Add or remove agents from the pipeline (e.g., skip design, add a security review phase)
- Adjust loop limits per step (e.g., allow 5 QA iterations but only 2 code reviews)
- Add entirely new phases

### Proposed Solution: Declarative Pipeline Config

A single `agency.config.yaml` file in the consuming repo defines the full pipeline. The package ships **sensible defaults** — if no config file is found, it runs the standard pipeline with built-in agent instructions.

#### Config File: `agency.config.yaml`

```yaml
# Optional: override the default model for all agents
primaryModel: claude-opus-4-6-fast
reviewModel: gpt-5.2-codex

# Agent role definitions
# Each agent has a name and an instructions source.
# "builtin:<name>" uses the package's built-in instructions.
# A file path (relative to repo root) uses custom instructions.
agents:
  pm:              builtin:pm
  pm-reviewer:     builtin:pm-reviewer
  spec-reviewer:   builtin:eng-spec-reviewer
  designer:        builtin:designer
  design-reviewer: builtin:design-reviewer
  engineer:        .github/agents/engineer.md        # custom override
  code-reviewer:   builtin:eng-code-reviewer
  tester:          builtin:tester
  cross-model:     builtin:cross-model-reviewer
  security:        .github/agents/security-reviewer.md  # entirely new agent

# Pipeline definition
# Phases execute in order. Each phase has a type and a configuration.
pipeline:

  # Phase 1: Specification
  - phase: spec
    agent: pm
    reviews:
      - agent: pm-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED
      - agent: spec-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED

  # Phase 2: Task Decomposition (always runs after spec)
  - phase: decompose
    agent: pm
    frontendMarker: "[FRONTEND]"

  # Phase 3: Design (conditional — only if frontend tasks exist)
  - phase: design
    condition: hasFrontendTasks
    agent: designer
    clarificationAgent: pm
    reviews:
      - agent: design-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED
        clarificationKeyword: CLARIFICATION_NEEDED
        clarificationAgent: pm

  # Phase 4: Implementation (runs per task, in parallel)
  - phase: implement
    parallel: true
    agent: engineer
    reviews:
      - agent: code-reviewer
        maxIterations: 3
        approvalKeyword: APPROVED
      - agent: security             # custom agent added to the pipeline
        maxIterations: 2
        approvalKeyword: APPROVED
    qa:
      agent: tester
      maxIterations: 5
      approvalKeyword: ALL_PASSED

  # Phase 5: Cross-Model Review (conditional — skipped if models match)
  - phase: cross-model-review
    condition: differentReviewModel
    agent: cross-model
    fixAgent: engineer
    maxIterations: 3
    approvalKeyword: APPROVED
```

### How the Layers Work

```
┌──────────────────────────────────────────────┐
│  @camunda/ai-agency (npm package)            │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Built-in agent instructions (.md)      │ │
│  │  pm, pm-reviewer, engineer, tester, ... │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Pipeline engine                        │ │
│  │  Reads agency.config.yaml               │ │
│  │  Executes phases, loops, conditions     │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Default agency.config.yaml             │ │
│  │  (used when no config file found)       │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                      │
          pnpx @camunda/ai-agency
                      │
┌──────────────────────────────────────────────┐
│  Consuming repo (e.g., camunda/some-project) │
│                                              │
│  agency.config.yaml        (optional)        │
│  .github/agents/engineer.md (optional)       │
│  .github/agents/security.md (optional)       │
└──────────────────────────────────────────────┘
```

### Resolution Order

When the package starts, it resolves configuration in this order:

1. **Config file:** Look for `agency.config.yaml` in the repo root. If not found, use the built-in default config.
2. **Agent instructions:** For each agent in the pipeline:
   - If the source starts with `builtin:`, load from the package's embedded instructions.
   - If the source is a file path, load from the consuming repo (relative to repo root).
   - If no source is specified, look in the repo's `.github/agents/<name>.md`, then fall back to `builtin:<name>`.
3. **Environment variables:** Override scalar config values (`PRIMARY_MODEL`, `REVIEW_MODEL`, `VERBOSE`, etc.). These always take precedence over the YAML file.

### What Can Be Customized

| Customization | How |
|---|---|
| **Override one agent's instructions** | Set its source to a local `.md` file in `agents:` |
| **Add a new agent to the pipeline** | Define it in `agents:`, add it as a review step in the relevant phase |
| **Remove a phase** | Delete it from `pipeline:` |
| **Change loop limits** | Set `maxIterations` on any review or QA step |
| **Change approval keywords** | Set `approvalKeyword` on any review step |
| **Skip design phase** | Remove the `design` phase, or it auto-skips if no frontend tasks |
| **Add a new phase** | Add a new entry to `pipeline:` with the appropriate type |
| **Use entirely custom pipeline** | Replace the entire `pipeline:` section |
| **Use all defaults** | Don't create `agency.config.yaml` at all |

### What the Package Ships

```
@camunda/ai-agency/
├── bin/
│   └── ai-agency.js           # CLI entry point
├── dist/                       # Compiled TypeScript
│   ├── config.js
│   ├── constants.js
│   ├── logger.js
│   ├── messages.js
│   ├── session.js
│   ├── utils.js
│   ├── orchestrator.js
│   └── pipeline-engine.js     # NEW: interprets agency.config.yaml
├── agents/                     # Built-in agent instructions
│   ├── pm.md
│   ├── pm-reviewer.md
│   ├── eng-spec-reviewer.md
│   ├── designer.md
│   ├── design-reviewer.md
│   ├── engineer.md
│   ├── eng-code-reviewer.md
│   ├── tester.md
│   └── cross-model-reviewer.md
├── defaults/
│   └── agency.config.yaml     # Default pipeline config
└── package.json
```

### `package.json` (Key Fields)

```json
{
  "name": "@camunda/ai-agency",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "ai-agency": "./bin/ai-agency.js"
  },
  "files": ["dist", "agents", "defaults", "bin"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com/"
  }
}
```

## Migration Path

### Phase 1: Prepare (current repo)
- Add `bin/ai-agency.js` entry point
- Add `publishConfig` to `package.json`
- Bundle built-in agent `.md` files into the package
- Ship the default `agency.config.yaml`
- Validate the package works via `pnpx` locally

### Phase 2: Extract
- Create `camunda/ai-agency` repo
- Move the `apps/ai/` code to the new repo root
- Add a GitHub Action for publishing to GitHub Packages on push to `main`
- Tag `v1.0.0`

### Phase 3: Pipeline Engine ✅
- ~~Implement `pipeline-engine.ts` — a generic engine that reads `agency.config.yaml` and executes the phases~~
- ~~Refactor `orchestrator.ts` to use the pipeline engine instead of hardcoded phase methods~~
- ~~The current hardcoded behavior becomes the default config, so nothing breaks~~
- Completed: `pipeline-types.ts`, `pipeline-config.ts`, `pipeline-engine.ts` implemented; `orchestrator.ts` is now a thin wrapper

### Phase 4: Consume
- In any `camunda/*` repo, add the one-line `.npmrc` and the workflow step
- Optionally add `agency.config.yaml` for customization

## Considerations

- **Versioning:** Use semver. Breaking changes to the config format require a major version bump.
- **Config validation:** The pipeline engine must validate `agency.config.yaml` at startup with clear error messages (just like the current env var validation).
- **Backward compatibility:** If no `agency.config.yaml` exists, the package must behave identically to the current hardcoded pipeline.
- **Agent instruction caching:** Built-in instructions are read from the package's `agents/` directory. Custom instructions are read from the consuming repo. Both are loaded once at startup.
- **Testing:** The pipeline engine should be testable with mock sessions — the config-driven design makes this straightforward.
