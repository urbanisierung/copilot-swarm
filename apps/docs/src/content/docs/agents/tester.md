---
title: QA Engineer
description: Validates implementation against the specification.
---

**Role:** QA Engineer — Quality Validator  
**Config key:** `tester`  
**Built-in file:** `builtin:tester`  
**Tools:** `read_file`, `run_terminal`, `list_dir`

## Responsibilities

1. **Understand the Spec** — Reads the specification and acceptance criteria before testing.
2. **Run Tests** — Executes the full test suite. Verifies no regressions.
3. **Verify Acceptance Criteria** — Checks each criterion against the implementation.
4. **Exploratory Testing** — Looks for edge cases, error handling gaps, and uncovered scenarios.
5. **Decision** — Replies `ALL_PASSED` if everything checks out, or provides a numbered defect list with description, steps to reproduce, expected vs. actual behavior, and severity.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Implement** | Validates each stream against the spec (up to 5 iterations) |

## Defect Report Format

When issues are found:

```
1. [Description]
   Steps to reproduce: ...
   Expected: ...
   Actual: ...
   Severity: critical/major/minor
```
