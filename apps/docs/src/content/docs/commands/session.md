---
title: "swarm session"
description: Create, list, and switch sessions to group related runs.
---

Sessions group related runs (analyze, plan, run, review) under a single logical feature. This preserves context across modes and tracks all work for a given feature.

## Usage

```bash
# Create a new session
swarm session create "Dark mode feature"

# List all sessions
swarm session list

# Switch to a specific session
swarm session use <sessionId>
```

## Session Structure

```
.swarm/sessions/<sessionId>/
  session.json          # Metadata (id, name, created, description)
  runs/<runId>/          # Run output directories
  plans/                # Plan outputs
  analysis/             # Analysis outputs
  latest                # Latest run pointer within session
```

## Automatic Behavior

- All commands automatically use the active session
- Override with `--session <id>` flag
- If no session exists, a default session is auto-created
- Legacy `.swarm/` directories are migrated on first use
