# Progress / Changelog

All notable changes to this project are documented here, in reverse chronological order.

## 2026-02-14

### Added
- **CLI binary** — Package exposes `swarm` binary via `bin` field. Runnable with `npx @copilot-swarm/core`, `pnpx @copilot-swarm/core`, or globally as `swarm`.
- **Renamed to Copilot Swarm** — All references to "AI Agency" / "AI Playground" renamed to "copilot-swarm". Package: `@copilot-swarm/core`. Config file: `swarm.config.yaml`.
- **Declarative pipeline engine** — `swarm.config.yaml` defines the full pipeline: agents, phases, review loops, conditions. Replaces all hardcoded phase logic.
  - `pipeline-types.ts` — TypeScript schema for the pipeline config
  - `pipeline-config.ts` — YAML loader with exhaustive validation and env var overrides
  - `pipeline-engine.ts` — Generic engine that interprets the config and runs phases
  - `defaults/swarm.config.yaml` — Built-in default pipeline
  - `swarm.config.example.yaml` — Example showing customization (custom agents, security reviewer, no design phase)
- **Tooling setup** — Turborepo, Biome, Vitest installed and configured
  - `turbo.json` — Task pipeline (build, typecheck, check, test)
  - `biome.json` — Linter/formatter config
  - `vitest.config.ts` — Test config for the ai app
- **Tests** — 28 tests covering `utils.ts` and `pipeline-config.ts` validators
- **Documentation** — README, progress, features, documentation, roadmap files created

### Changed
- **Config split** — Model selection and iteration limits moved from env vars to `swarm.config.yaml`. Core runtime config (verbose, issueBody, timeouts) remains in env vars.
- **Agent resolution** — `SessionManager` now resolves agent instructions via `builtin:<name>` prefix or file paths from the pipeline config, with instruction caching.
- **Constants** — Removed hardcoded `AgentName` enum; agent names are now dynamic strings from the config.
- **Messages** — Generalized log messages to accept dynamic agent names instead of hardcoded references.
- **Orchestrator** — Now a thin wrapper that loads pipeline config and delegates to `PipelineEngine`.
- Root `package.json` scripts use `turbo` instead of `pnpm -r`.

### Earlier changes

- Cross-model review feature (agent, code, docs)
- Full code refactoring from single 317-line file into 8 modular files
- Central config with env var type/value validation
- Centralized constants, messages, logging
- Hardened type safety (parseJsonArray validates string[], error wrapping)
- Made ISSUE_BODY mandatory (app exits with error if missing)
- Restructured Copilot instructions into portable (Parts 1+2) + repo-specific (Part 3)
- Standalone package extraction proposal (`doc/standalone-execution.md`)
