---
title: Technical Architect
description: Validates specs for engineering feasibility and safety.
---

**Role:** Technical Architect — Feasibility Validator  
**Config key:** `spec-reviewer`  
**Built-in file:** `builtin:eng-spec-reviewer`  
**Tools:** `read_file`, `list_dir`, `run_terminal`

## Responsibilities

1. **Assess Feasibility** — Verifies the spec aligns with existing architecture using code exploration.
2. **Identify Risks** — Flags performance concerns, security implications, breaking changes, and missing edge cases.
3. **Validate Scope** — Ensures the spec is neither too vague nor overly prescriptive.
4. **Decision** — Replies `APPROVED` if sound, or provides a bulleted list of required changes.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Spec** | Reviews PM's specification for technical feasibility (up to 3 iterations) |

## Approval Keyword

`APPROVED` — The spec is technically sound and complete.
