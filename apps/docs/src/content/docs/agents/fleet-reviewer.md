---
title: Fleet Reviewer
description: Verifies cross-repo consistency and integration completeness.
---

**Role:** Senior Cross-Repository Reviewer — Integration Validator  
**Config key:** `fleet-reviewer`  
**Built-in file:** `builtin:fleet-reviewer`  
**Tools:** `read_file`, `list_dir`

## Responsibilities

1. **Contract Compliance** — Verifies each repo's implementation matches shared contracts exactly (field names, types, endpoints, payloads, error codes).
2. **Interface Compatibility** — Checks producers/consumers agree on data formats, authentication, error handling, versioning.
3. **Completeness** — Verifies every repo completed assigned tasks. Flags incomplete/missing tasks.
4. **Consistency** — Checks naming conventions, error handling patterns, and assumptions are consistent across repos.
5. **Integration Gaps** — Identifies scenarios where individual repos pass but cross-repo integration would fail (path mismatches, auth format differences, serialization issues).
6. **Decision** — Replies `FLEET_APPROVED` or provides a numbered list of fixes tagged with affected repo paths.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Fleet cross-repo review** | Reviews all repo changes for consistency |

## Approval Keyword

`FLEET_APPROVED` — All repos are consistent, compatible, and complete.
