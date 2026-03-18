---
title: Code Reviewer
description: Security and quality gate for all implemented code.
---

**Role:** Security & Quality Engineer — Quality Gate  
**Config key:** `code-reviewer`  
**Built-in file:** `builtin:eng-code-reviewer`  
**Tools:** `read_file`, `run_terminal`

## Responsibilities

1. **Read Changes** — Examines the files modified by the engineer.
2. **Test** — Runs the project's build, linter, type checker, and test suite.
3. **Security** — Checks for injection vulnerabilities, exposed secrets, insecure defaults, improper input validation.
4. **Quality** — Verifies error handling, edge cases, performance, and adherence to project conventions.
5. **Decision** — Replies `APPROVED` if correct and secure, or provides a bulleted list of required fixes.

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Implement** | Reviews engineer's code in each stream (up to 3 iterations) |
