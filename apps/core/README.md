<p align="center">
  <img src="https://raw.githubusercontent.com/urbanisierung/copilot-swarm/main/doc/logo.svg" width="80" alt="Copilot Swarm" />
</p>

<h1 align="center">Copilot Swarm</h1>

<p align="center">
  <strong>One prompt. An entire engineering team.</strong><br/>
  Multi-agent orchestrator that coordinates PM, designer, engineer, reviewer, and tester agents — all powered by the GitHub Copilot SDK.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@copilot-swarm/core"><img src="https://img.shields.io/npm/v/@copilot-swarm/core?color=a78bfa&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@copilot-swarm/core"><img src="https://img.shields.io/npm/dm/@copilot-swarm/core?color=60a5fa" alt="monthly downloads" /></a>
  <a href="https://github.com/urbanisierung/copilot-swarm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/urbanisierung/copilot-swarm?color=34d399" alt="license" /></a>
  <a href="https://github.com/urbanisierung/copilot-swarm"><img src="https://img.shields.io/github/stars/urbanisierung/copilot-swarm?style=flat&color=fbbf24" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://cpswarm.com">Website</a> · <a href="https://docs.cpswarm.com">Documentation</a> · <a href="https://docs.cpswarm.com/getting-started/quickstart/">Quick Start</a> · <a href="https://github.com/urbanisierung/copilot-swarm">GitHub</a>
</p>

---

## Why?

AI coding assistants are great for single tasks — but complex features need a team. Copilot Swarm spawns a **full engineering team of AI agents** that collaborate, review each other's work, and self-correct until the job is done:

```
You: "Add OAuth login with PKCE flow"

Swarm: PM writes spec → Reviewers challenge it → Engineer implements →
       Code reviewer validates → QA tests against spec → Different AI model
       double-checks everything → Build/test/lint verification passes ✅
```

No babysitting. No copy-pasting between chats. One command.

## Quick Start

```bash
npx @copilot-swarm/core "Add a dark mode toggle"
```

Or install globally:

```bash
npm install -g @copilot-swarm/core
swarm "Add a dark mode toggle"
```

> **Prerequisites:** [Node.js](https://nodejs.org/) ≥ 22 · [GitHub Copilot](https://github.com/features/copilot) subscription · [GitHub CLI](https://cli.github.com/) (`gh auth login`)

## How It Works

```bash
swarm plan "Add OAuth login"                       # 1. Refine requirements interactively
swarm --plan .swarm/plans/plan-latest.md           # 2. Execute the full pipeline
swarm digest                                       # 3. See what was built
git add -A && git commit -m "feat: OAuth login"    # 4. Ship it
```

### The Pipeline

Every run flows through a structured, multi-phase pipeline with self-correcting review loops:

| Phase | Agents | What happens |
|---|---|---|
| **Spec** | PM → Creative Reviewer → Tech Architect | PM drafts spec, two reviewers challenge it (3 iterations each) |
| **Decompose** | PM | Breaks spec into parallel tasks, marks `[FRONTEND]` work |
| **Design** | Designer → Design Reviewer | UI/UX spec for frontend tasks *(conditional)* |
| **Implement** | Engineer → Code Reviewer → QA | Parallel streams: build → review → test (5 QA iterations) |
| **Cross-Model** | Different AI model | Catches model-specific blind spots *(conditional)* |
| **Verify** | — | Runs your actual `build`, `test`, `lint` commands |

## Commands

| Command | Description |
|---|---|
| `swarm run` | Full orchestration pipeline *(default)* |
| `swarm plan` | Interactive planning — refine requirements before running |
| `swarm task` | Lightweight autonomous pipeline for well-scoped tasks |
| `swarm auto` | Fully autonomous plan + run (no interaction) |
| `swarm analyze` | Generate a repository context document |
| `swarm brainstorm` | Explore ideas with a strategist agent |
| `swarm review` | Fix a previous run based on feedback |
| `swarm fleet` | Multi-repo orchestration with shared contracts |
| `swarm prepare` | Generate Copilot instruction files |
| `swarm digest` | Concise summary of a completed run |
| `swarm session` | Group related runs under a feature |
| `swarm stats` | Agent invocation statistics |

📖 [Full command reference →](https://docs.cpswarm.com/commands/overview/)

## Modes at a Glance

```bash
# Interactive planning — PM, engineer, designer each clarify
swarm plan "Redesign the notification system"

# Quick autonomous task — skip planning, just implement
swarm task "Fix the login validation bug"

# Full autonomous — analysis → planning → implementation
swarm auto -f requirements.md

# Multi-repo — coordinate across services
swarm fleet "Add OAuth" ./auth-service ./api-gateway ./frontend

# Explore ideas before committing
swarm brainstorm "Should we migrate to GraphQL?"

# Review & iterate on a previous run
swarm review "Fix the auth bug in stream 1"
```

## 11 Built-in Agents

| Agent | Role | Suite |
|---|---|---|
| **Product Manager** | Writes specs, decomposes tasks, answers clarifications | PM |
| **Creative Reviewer** | Challenges specs from a product perspective | PM |
| **Technical Architect** | Validates feasibility and architecture alignment | PM |
| **UI/UX Designer** | Creates component designs and interaction flows | Design |
| **Design Reviewer** | Reviews for usability, accessibility, design system | Design |
| **Senior Engineer** | Implements code, runs builds, fixes defects | Engineering |
| **Code Reviewer** | Security & quality gate for all code changes | Engineering |
| **QA Engineer** | Tests implementation against acceptance criteria | Engineering |
| **Cross-Model Reviewer** | Different AI model catches systematic blind spots | Review |
| **Fleet Strategist** | Plans cross-repo features with shared contracts | Fleet |
| **Fleet Reviewer** | Validates cross-repo consistency and integration | Fleet |

Every agent is customizable — override any role with your own markdown instructions.  
📖 [Agent documentation →](https://docs.cpswarm.com/agents/overview/)

## Configuration

Drop a `swarm.config.yaml` in your repo root — or use the built-in defaults:

```yaml
primaryModel: claude-opus-4-6       # Main implementation model
reviewModel: gpt-5.3-codex          # Cross-model review (different family)
fastModel: claude-haiku-4.5         # Cheap model for coordination

agents:
  pm: builtin:pm
  engineer: ./my-agents/strict-engineer.md  # Custom override
  code-reviewer: builtin:eng-code-reviewer
```

📖 [Full configuration reference →](https://docs.cpswarm.com/configuration/pipeline/)

## Key Features

- **🔄 Self-correcting loops** — Every agent paired with a reviewer (up to 3–5 iterations)
- **⚡ Parallel execution** — Independent tasks run simultaneously; wave-based execution for dependencies
- **🧠 Cross-model review** — A different AI model catches blind spots of the primary
- **💾 Checkpoint & resume** — Every phase/stream/iteration saved; `--resume` picks up exactly where it stopped
- **🖥️ TUI dashboard** — Full-screen terminal UI with phase progress, active agents, and stream status
- **🚢 Fleet mode** — Multi-repo orchestration with shared contracts and consistency review
- **📋 Interactive planning** — PM, engineer, and designer each clarify from their perspective
- **✅ Built-in verification** — Runs your actual build/test/lint commands post-implementation
- **🤖 Auto-model selection** — `--auto-model` uses the fast model for simple tasks, saving cost
- **📝 Declarative pipeline** — Customize everything via `swarm.config.yaml`

## GitHub Action

```yaml
- uses: urbanisierung/copilot-swarm/action@main
  env:
    COPILOT_CLI_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
  with:
    command: run
    prompt: ${{ github.event.issue.body }}
```

📖 [GitHub Action docs →](https://docs.cpswarm.com/configuration/github-action/)

## Output

All artifacts are organized under `.swarm/`:

```
.swarm/
  sessions/<id>/
    runs/<runId>/
      summary.md          # Final summary
      roles/              # Per-agent output (pm.md, engineer-0.md, ...)
    plans/
      plan-latest.md      # Latest plan
    analysis/
      repo-analysis.md    # Repository analysis
```

## Requirements

- **Node.js** ≥ 22
- **GitHub Copilot** — active subscription (Business or Enterprise)
- **GitHub CLI** (`gh`) — authenticated

## Links

- 🌐 [cpswarm.com](https://cpswarm.com) — Website
- 📖 [docs.cpswarm.com](https://docs.cpswarm.com) — Documentation
- 📦 [@copilot-swarm/core](https://www.npmjs.com/package/@copilot-swarm/core) — npm
- 🐛 [GitHub Issues](https://github.com/urbanisierung/copilot-swarm/issues) — Bug reports & feature requests

## License

MIT © [urbanisierung](https://github.com/urbanisierung)
