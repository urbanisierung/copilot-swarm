---
title: "swarm prepare"
description: Generate Copilot instruction files for a repository.
---

Analyze your codebase and generate structured instruction files that help GitHub Copilot understand the repository's patterns, conventions, and practices.

## Usage

```bash
# Generate repo-level instruction files
swarm prepare

# Generate per-directory instruction files
swarm prepare dirs src/
swarm prepare dirs apps/core/src
```

## Repo-Level Output

Produces 3 instruction files in `.github/instructions/`:

| File | Content |
|---|---|
| `codebase.instructions.md` | Project overview, directory structure, build commands, module system, file naming, error handling, config patterns |
| `patterns.instructions.md` | Naming conventions, import ordering, export patterns, type patterns, anti-patterns, exemplary files |
| `testing.instructions.md` | Test framework, file naming, structure patterns, mocking, fixtures, coverage expectations |

Each file uses YAML frontmatter with `applyTo` globs for GitHub Copilot.

## Per-Directory Mode

`swarm prepare dirs <path>` generates concept-focused instruction files for each subdirectory:

- **Simple directories** (≤ 10 source files) — One agent, one instruction file
- **Complex directories with subdirectories** — Each subdirectory gets its own file with a precise glob
- **Complex flat directories** — Scout identifies logical groups, parallel agents analyze each, outputs merge into one consolidated file

Up to 10 directories analyzed in parallel. Configurable threshold via `PREPARE_DEEP_THRESHOLD` (default: 10).
