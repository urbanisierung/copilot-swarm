# @copilot-swarm/core

## 0.0.29

### Patch Changes

- d9f067a: Fix analyze resume

## 0.0.28

### Patch Changes

- 342c1f9: Analyze resume

## 0.0.27

### Patch Changes

- be1d8a7: Fix repo analysis summary.

## 0.0.26

### Patch Changes

- 67e1192: Allow file system access.

## 0.0.25

### Patch Changes

- f895dfa: Fix prompt editor.

## 0.0.24

### Patch Changes

- f39d2fb: Analyze huge repos.

## 0.0.23

### Patch Changes

- 745f391: Improve TUI

## 0.0.22

### Patch Changes

- df06eaa: Default model changes

## 0.0.21

### Patch Changes

- a778fe7: Multiple flow improvements: task mode, brainstorm mode, quicker models

## 0.0.20

### Patch Changes

- 7121ed9: Fix review mode.

## 0.0.19

### Patch Changes

- d5b9de5: Improvements to the agent flow.

## 0.0.18

### Patch Changes

- 2fc98c1: Fix session grouping.

## 0.0.17

### Patch Changes

- 8056ac3: Improved loop handling. New CLI information.

## 0.0.16

### Patch Changes

- c2e9312: Multiple CLI improvements.

## 0.0.15

### Patch Changes

- 60520ce: Multiple cli improvements. Github Action support.

## 0.0.14

### Patch Changes

- eae158b: Track copilot session ids.

## 0.0.13

### Patch Changes

- a709bf8: Add review mode.

## 0.0.12

### Patch Changes

- 1c3dc73: Improve textarea and clarification UX

## 0.0.11

### Patch Changes

- 7713f17: Add checkpoints for analyze mode.

## 0.0.10

### Patch Changes

- d4b5b74: Further input options.

## 0.0.9

### Patch Changes

- 981b7d0: Improve plan and run mode.

## 0.0.8

### Patch Changes

- 3b2b045: TUI shell, Summary, clarification loop

## 0.0.7

### Patch Changes

- 5810801: TUI shell for improved UX in the cli.

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
