---
title: Diff Analyst
description: Analyzes file changes in a single PR to produce a structured inventory.
---

**Role:** Diff Analyst — Change Inventory Specialist  
**Config key:** `diff-analyst`  
**Built-in file:** `builtin:diff-analyst`  
**Tools:** `read_file`, `list_dir`, `run_terminal`

## Responsibilities

1. **Read all changed files** — Examines every modified, added, and deleted file using `read_file`.
2. **Categorize changes** — Sorts files into new, modified, and deleted categories.
3. **Identify patterns** — Recognizes architectural approach, libraries/frameworks used, and design patterns.
4. **Assess scope** — Evaluates the size and complexity of the changeset, flags out-of-scope changes.
5. **No judgments** — Provides an objective, factual analysis without comparing to any other implementation.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Compare — Diff Analysis** | Analyzes one side of a PR comparison (runs in parallel — one instance per PR) |

## Output Format

Produces a structured Markdown report with:

- **Change Inventory** — New files, modified files, deleted files with descriptions
- **Architectural Approach** — Overall strategy, patterns, key design decisions
- **Implementation Details** — Error handling, testing, types/interfaces, dependencies
- **Scope Assessment** — File count, complexity estimate, out-of-scope change detection

## Model

Uses the **fast model** for speed, since the task is primarily reading and cataloging rather than deep reasoning.
