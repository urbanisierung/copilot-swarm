# Copilot Swarm

A Turborepo monorepo for experimenting with AI-powered development workflows, featuring **Copilot Swarm** — a multi-agent orchestrator that coordinates multiple AI agents through a declarative, config-driven pipeline.

## Motivation

Modern AI coding assistants work well for individual tasks, but complex features benefit from a structured multi-agent approach — product managers, designers, engineers, reviewers, and testers each contributing their expertise. This project implements that vision using the GitHub Copilot SDK.

## Prerequisites

- **Node.js** — latest LTS
- **pnpm** — v10+
- **GitHub Copilot** — active subscription (for the Copilot SDK)

## Quickstart

```bash
# Install dependencies
pnpm install

# Run Copilot Swarm
ISSUE_BODY="Add a dark mode toggle" pnpm --filter @copilot-swarm/ai start

# Build all packages
pnpm turbo build

# Run all checks
pnpm turbo check      # Biome lint & format
pnpm turbo typecheck   # TypeScript
pnpm turbo test        # Vitest
```

## Project Structure

```
apps/
  ai/              # Copilot Swarm Orchestrator
doc/               # Documentation
.github/
  agents/          # Agent instruction files (.md)
  instructions/    # Copilot instructions
```

## Documentation

- [Copilot Swarm Concept](doc/copilot-swarm.md) — Architecture, agent roles, workflow
- [Code Architecture](doc/copilot-swarm-code.md) — File structure, modules, config reference
- [Features](doc/features.md) — High-level feature list
- [CLI Documentation](doc/documentation.md) — Detailed usage guide
- [Roadmap](doc/roadmap.md) — Implementation roadmap
- [Changelog](doc/progress.md) — Historical changelog