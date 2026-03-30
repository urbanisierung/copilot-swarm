---
title: Requirements Evaluator
description: Scores PR implementations against a requirements document.
---

**Role:** Requirements Evaluator — Traceability Specialist  
**Config key:** `requirements-evaluator`  
**Built-in file:** `builtin:requirements-evaluator`  
**Tools:** `read_file`

## Responsibilities

1. **Parse requirements** — Breaks the requirements document into individually testable items.
2. **Evaluate all implementations** — Independently assesses each PR's changes against every requirement.
3. **Score conservatively** — Only marks ✅ when a requirement is clearly and fully met.
4. **Identify gaps** — Documents what's missing or incomplete in each implementation.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Compare — Requirements Check** | Evaluates all PRs (A, B, C, ...) against the requirements (only runs when `-f` is provided) |

## Output Format

Produces a structured report with:

- **Requirements Breakdown** — Numbered list of extracted requirements
- **Coverage Matrix** — Table with ✅ (fully met), ⚠️ (partially met), ❌ (not met) per requirement per implementation (one column per PR)
- **Gap Analysis** — Per-implementation list of unmet requirements with explanations
- **Coverage Summary** — Overall scores (e.g., "PR A: 7/10 requirements fully met (70%)")

## Model

Uses the **primary model** for accurate requirement interpretation and evaluation.
