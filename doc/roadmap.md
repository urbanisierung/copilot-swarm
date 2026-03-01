# Roadmap

Implementation roadmap for Copilot Swarm.

## Phase 1: Core Orchestrator ✅

- [x] Multi-agent orchestration with PM, designer, engineer, reviewer, tester
- [x] Isolated session strategy (fresh sessions for reviews, long-lived for implementation)
- [x] Cross-model review phase (different model catches blind spots)
- [x] Parallel task streams
- [x] Frontend-aware task routing with `[FRONTEND]` marker
- [x] Role summaries and final summary output

## Phase 2: Code Quality & Structure ✅

- [x] Refactor from monolithic file to modular multi-file architecture
- [x] Central config with env var type/value validation
- [x] Centralized constants, log messages, and logging wrapper
- [x] Hardened type safety (validated JSON parsing, error wrapping)
- [x] Made `ISSUE_BODY` mandatory

## Phase 3: Declarative Pipeline ✅

- [x] Define pipeline config schema (`pipeline-types.ts`)
- [x] YAML config loader with exhaustive validation (`pipeline-config.ts`)
- [x] Generic pipeline engine that interprets config (`pipeline-engine.ts`)
- [x] Built-in default config (`defaults/swarm.config.yaml`)
- [x] Example config with customization (`swarm.config.example.yaml`)
- [x] Agent instruction resolution (builtin prefix, file paths, fallback)
- [x] Instruction caching in SessionManager

## Phase 4: Tooling & Compliance ✅

- [x] Turborepo setup (`turbo.json`, root scripts)
- [x] Biome linter/formatter setup (`biome.json`, zero warnings)
- [x] Vitest test framework setup
- [x] Tests for utility functions and pipeline config validation
- [x] Documentation: README, progress, features, documentation, roadmap
- [x] Copilot instructions (portable Parts 1+2, repo-specific Part 3)

## Phase 5: Standalone Package Extraction

- [x] Add `bin/copilot-swarm.js` CLI entry point
- [x] Add `publishConfig` to `package.json` targeting npm (public, scoped)
- [x] Bundle built-in agent `.md` files into the package
- [x] Create publish workflow (GitHub Action → trusted publishing with OIDC, changesets for versioning)
- [ ] Extract to dedicated `copilot-swarm` repo
- [x] Validate `pnpx @copilot-swarm/core` / `npx @copilot-swarm/core` works from a consuming repo (binary: `swarm`)

See [`doc/standalone-execution.md`](standalone-execution.md) for the full extraction proposal.

## Phase 6: Multi-Repo Orchestration ✅

- [x] Fleet config schema (`fleet.config.yaml` format with repos, roles, overrides)
- [x] Fleet config loader with validation and `--repos` CLI fallback
- [x] Fleet engine — meta-orchestrator: analyze → strategize → wave execution → cross-repo review
- [x] Fleet agent instructions: `fleet-strategist.md`, `fleet-reviewer.md`
- [x] `swarm fleet` CLI command with `--repos` and `--fleet-config` options
- [x] Fleet-level checkpoint/resume (wave progress, per-repo completion)
- [x] Cross-repo context passing (shared contracts + prior wave output injection)
- [x] Documentation updates (documentation, features, progress, roadmap)

## Phase 7: Run Insights & Smart Models ✅

- [x] `swarm digest` command — concise highlights summary of a completed run (fast model synthesis)
- [x] `--auto-model` flag — per-task model selection during implement phase (fast-model complexity classifier)
- [x] `classifyModelForTask()` in SessionManager — automatic PRIMARY/FAST classification
- [x] Demo scenarios for digest and auto-model in `swarm demo`
- [x] Documentation updates (documentation, features, progress, roadmap)
