# @copilot-swarm/core

## 0.0.6

### Patch Changes

- dee9aec: Dedicated swarm folder

## 0.0.5

### Patch Changes

- 1246785: Add resume logic.

## 0.0.4

### Patch Changes

- 4ce2750: Add analyze mode.

## 0.0.3

### Patch Changes

- 47d6770: Embed default agent roles.

## 0.0.2

### Patch Changes

- db43158: Add -f / --file parameter

## 0.0.1

### Patch Changes

- ad6dd20: Initial release of Copilot Swarm — a multi-agent orchestrator for GitHub Copilot.

  - Declarative pipeline via `swarm.config.yaml` (spec → decompose → design → implement → cross-model review)
  - Interactive planning mode (`swarm plan`) with PM clarification and engineering analysis
  - 9 built-in agents: PM, designer, engineer, reviewers, tester, cross-model reviewer
  - Self-correcting review loops with configurable iterations and approval keywords
  - Cross-model review phase to catch model-specific blind spots
  - CLI binary (`swarm`) with verbose mode, plan file input, and env var support
  - GitHub Actions integration via issue labels
