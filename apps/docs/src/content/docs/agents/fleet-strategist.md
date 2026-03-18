---
title: Fleet Strategist
description: Coordinates features spanning multiple repositories.
---

**Role:** Senior Technical Strategist — Cross-Repo Coordinator  
**Config key:** `fleet-strategist`  
**Built-in file:** `builtin:fleet-strategist`  
**Tools:** `read_file`, `list_dir`

## Responsibilities

1. **Analyze Dependencies** — Identifies which repos depend on changes in other repos.
2. **Define Shared Contracts** — Specifies exact interfaces, API schemas, type definitions, protocols with precise field names, types, endpoints, and payloads.
3. **Produce Per-Repo Tasks** — Writes clear task descriptions for each repo (implementable by `swarm task`), including what to implement, files to change, and shared contracts.
4. **Organize into Waves** — Wave 1 for repos with no cross-repo dependencies (parallel), Wave 2+ for dependent repos (with context from prior waves).

## Output Format

```markdown
## Shared Contracts
[Exact interface/API definitions all repos must agree on]

## Per-Repo Tasks
### [repo-name] (path: /absolute/path)
[Task description — detailed enough for `swarm task`]

## Dependencies
- [repo A] → [repo B]: [reason]

## Execution Waves
### Wave 1 (parallel)
- /absolute/path/repo-a
- /absolute/path/repo-b

### Wave 2 (depends on wave 1)
- /absolute/path/repo-c
```

## Pipeline Involvement

| Phase | Role |
|---|---|
| **Fleet strategize** | Produces cross-repo strategy after analyzing all repos |
