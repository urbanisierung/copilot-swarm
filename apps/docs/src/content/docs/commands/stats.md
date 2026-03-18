---
title: "swarm stats"
description: View aggregated agent invocation statistics.
---

Shows agent usage statistics accumulated across all runs.

## Usage

```bash
swarm stats
```

## Output

A table showing:

| Column | Description |
|---|---|
| Agent | Agent name |
| Calls | Total invocation count |
| Total time | Cumulative elapsed time |
| Avg time | Average time per call |
| Models | Which models were used |
| Tokens (in/out) | Input/output token counts (when available) |

Stats are stored in `.swarm/stats.json` and accumulate automatically across runs.
