---
title: "swarm finish"
description: Finalize a session — summarize, log to changelog, and clean up.
---

Finalize a session when you're done with a feature.

## Usage

```bash
swarm finish                    # Finalize the active session
swarm finish --session <id>     # Finalize a specific session
```

## What It Does

1. Collects artifacts from all runs, plans, and analyses in the session
2. Builds a structured summary (original request, phases, tasks, stream counts)
3. Appends the summary to `.swarm/changelog.md` (newest first)
4. Deletes `checkpoint.json` files from all runs (role summaries preserved)
5. Marks the session as finished in `session.json`
