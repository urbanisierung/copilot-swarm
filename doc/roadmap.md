# Roadmap

Implementation roadmap for the AI Agency Orchestrator.

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
- [x] Built-in default config (`defaults/agency.config.yaml`)
- [x] Example config with customization (`agency.config.example.yaml`)
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

- [ ] Add `bin/ai-agency.js` CLI entry point
- [ ] Add `publishConfig` to `package.json` targeting GitHub Packages
- [ ] Bundle built-in agent `.md` files into the package
- [ ] Create publish workflow (GitHub Action → `npm publish` on push to main)
- [ ] Extract to dedicated `camunda/ai-agency` repo
- [ ] Validate `pnpx @camunda/ai-agency` works from a consuming repo

See [`doc/standalone-execution.md`](standalone-execution.md) for the full extraction proposal.
