---
title: "swarm brainstorm"
description: Interactive idea exploration with a product strategist agent.
---

Explore ideas interactively before committing to implementation. No code is produced — just structured discussion and a summary.

## Usage

```bash
swarm brainstorm "Should we migrate from REST to GraphQL?"
swarm brainstorm -e   # Open editor for longer descriptions
```

## How It Works

1. A **strategist agent** (combining PM, design, and engineering perspectives) reads your idea.
2. **Interactive loop** — The agent shares thoughts, asks probing questions, challenges assumptions, and suggests alternatives.
3. You respond in a split-pane editor (agent's questions on the right, your answer on the left).
4. Type `BRAINSTORM_DONE` to finish.
5. The agent generates a **structured summary**: problem/idea, key ideas discussed, pros & cons, open questions, and recommendations.

## Output

```
.swarm/brainstorms/<runId>.md
```

The latest brainstorm summary is automatically loaded as context in subsequent `swarm plan` runs, enriching the PM's understanding of your requirements.
