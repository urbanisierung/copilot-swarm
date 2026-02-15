# Progress / Changelog

All notable changes to this project are documented here, in reverse chronological order.

## 2026-02-15

### Added
- **Checkpoint & resume** — Pipeline progress saved to `.swarm/runs/<runId>/checkpoint.json` after each phase. `--resume`/`-r` flag skips completed phases and streams. Individual implement streams saved incrementally — completed streams survive a timeout/crash. Checkpoint cleared on successful completion.
- **Auto-resume** — On pipeline failure, automatically retries from the last checkpoint up to 3 times (configurable via `MAX_AUTO_RESUME` env var). No manual `--resume` needed for transient failures.
- **Extended timeout** — Default `SESSION_TIMEOUT_MS` increased from 5 minutes to 30 minutes (1,800,000ms) for complex agent tasks. Still configurable via env var.
- **Structured `.swarm/` output directory** — All output moved from `doc/` to `.swarm/` with dedicated subfolders: `plans/` for planning mode, `runs/<runId>/` for per-run summaries and role outputs, `analysis/` for repo analysis. Eliminates conflicts with existing repo files. `DOC_DIR` and `SUMMARY_FILE_NAME` env vars replaced by `SWARM_DIR` (default `.swarm`).
- **Repository analysis mode** — `swarm analyze` generates a structured repo context document (`.swarm/analysis/repo-analysis.md`). Architect explores repo, senior engineer reviews for accuracy (max 3 iterations), then cross-model verification with a different AI model repeats the same loop.

## 2026-02-14

### Added
- **npm publishing setup** — Changesets for version management, GitHub Actions release workflow with npm trusted publishing (OIDC, no NPM_TOKEN needed), provenance attestation. Scripts: `pnpm changeset`, `pnpm version-packages`, `pnpm release`.
- **Repository analysis mode** — `swarm analyze` generates a structured repo context document (`.swarm/analysis/repo-analysis.md`). Architect agent explores the repo, senior engineer reviews for accuracy (max 3 iterations), then cross-model verification with a different AI model repeats the same loop.
- **CLI binary** — Package exposes `swarm` binary via `bin` field. Runnable with `npx @copilot-swarm/core`, `pnpx @copilot-swarm/core`, or globally as `swarm`. Supports `-v`/`--verbose` flag and prompt as trailing argument (e.g., `swarm "Add a feature"`). Subcommands: `run` (default), `plan`, and `analyze`.
- **Interactive planning mode** — `swarm plan "prompt"` runs an interactive requirements clarification session (PM agent asks questions, user answers via stdin) followed by a codebase analysis (engineering agent). Output saved to `.swarm/plans/`.
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
