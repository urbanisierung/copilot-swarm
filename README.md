# Copilot Swarm

A Turborepo monorepo for **Copilot Swarm** — a multi-agent orchestrator that coordinates PM, designer, engineer, reviewer, and tester agents through a declarative pipeline, powered by the GitHub Copilot SDK.

🌐 [cpswarm.com](https://cpswarm.com) · 📖 [docs.cpswarm.com](https://docs.cpswarm.com) · 📦 [npm](https://www.npmjs.com/package/@copilot-swarm/core)

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
pnpm --filter @copilot-swarm/core start -- "Add a dark mode toggle"

# Or via npx (no local clone needed)
npx @copilot-swarm/core "Add a dark mode toggle"

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
  core/            # Copilot Swarm Orchestrator (CLI)
  landing/         # Landing page (Astro)
  docs/            # Documentation site (Astro Starlight)
doc/               # Internal documentation
.github/
  agents/          # Agent instruction files (.md)
  instructions/    # Copilot instructions
```

## Documentation

- 📖 [docs.cpswarm.com](https://docs.cpswarm.com) — Full documentation
- [Copilot Swarm Concept](doc/copilot-swarm.md) — Architecture, agent roles, workflow
- [Code Architecture](doc/copilot-swarm-code.md) — File structure, modules, config reference
- [Features](doc/features.md) — High-level feature list
- [CLI Documentation](doc/documentation.md) — Detailed usage guide
- [Roadmap](doc/roadmap.md) — Implementation roadmap
- [Changelog](doc/progress.md) — Historical changelog