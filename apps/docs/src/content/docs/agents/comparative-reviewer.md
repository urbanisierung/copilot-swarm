---
title: Comparative Reviewer
description: Produces a head-to-head comparison report for two PR implementations.
---

**Role:** Comparative Reviewer — Principal Engineer  
**Config key:** `comparative-reviewer`  
**Built-in file:** `builtin:comparative-reviewer`  
**Tools:** `read_file`

## Responsibilities

1. **Synthesize findings** — Combines Diff Analyst output and Requirements Evaluator output (when available) into a cohesive report.
2. **Compare across dimensions** — Evaluates correctness, maintainability, performance, testing, security, and readability.
3. **Be balanced** — Presents strengths and weaknesses for both sides fairly.
4. **Be specific** — References actual files, patterns, and decisions rather than generalities.
5. **Recommend** — Provides a clear, justified recommendation.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Compare — Comparative Review** | Produces the final head-to-head report |

## Output Format

Produces the final comparison report with:

- **Executive Summary** — Which PR is stronger and why (2-3 sentences)
- **File Changes Overview** — Side-by-side metrics table
- **Requirements Coverage** — Summary of the coverage matrix (when available)
- **Detailed Comparison** — Architecture, code quality, error handling, testing, performance, security
- **Strengths & Weaknesses** — Bullet lists per PR
- **Recommendation** — Clear recommendation with reasoning

## Model

Uses the **primary model** for nuanced synthesis and judgment.
