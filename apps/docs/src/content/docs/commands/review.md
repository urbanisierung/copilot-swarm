---
title: "swarm review"
description: Review a previous run — provide feedback for agents to fix and improve.
---

Provide feedback on a previous run. Agents receive the original context plus your feedback and apply targeted fixes.

## Usage

```bash
swarm review "Fix the auth bug in stream 1, add error handling in stream 2"
swarm review -e                   # Detailed feedback via editor
swarm review -f review-notes.md   # Read feedback from a file
swarm review --run <runId> "Fix the login form"   # Review a specific run
```

## How It Works

1. Loads the previous run's context (spec, tasks, design spec, stream results).
2. Skips spec, decompose, and design phases — they were already done.
3. Collapses all previous streams into a **single review stream** — one engineer sees the full prior implementation plus your feedback.
4. The engineer keeps what works and only fixes what's described in the feedback.
5. Code review and QA loops run normally on the revised output.
6. Output goes to a new run directory.

## Tips

- Be specific about what needs fixing and in which stream/file.
- The engineer has full context from the original run.
- Checkpoint/resume works the same as regular run mode.
