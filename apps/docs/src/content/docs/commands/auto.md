---
title: "swarm auto"
description: Fully autonomous plan + run pipeline with no interaction.
---

import { Aside } from "@astrojs/starlight/components";

Combines analysis, planning, and implementation into a single autonomous pipeline. No user interaction needed.

## Usage

```bash
swarm auto "Add a dark mode toggle"
swarm auto -f requirements.md
```

## Pipeline

1. **Analysis** — Full repository analysis (architect exploration + peer review) to generate context.
2. **Planning** — Full planning pipeline (pre-analysis, PM/engineer/designer clarification, reviews) with all questions auto-answered using the agent's best judgment.
3. **Implementation** — Decomposition → parallel implementation → cross-model review → verification.

## When to Use

- Well-defined tasks where interactive clarification isn't needed
- CI/CD pipelines
- Batch processing
- Tasks with detailed requirements provided via `--file`

<Aside type="note">
The analysis and plan files are still saved to `.swarm/` for reference, even in auto mode.
</Aside>

## Examples

```bash
# From a detailed requirements file
swarm auto -f detailed-requirements.md

# In CI
ISSUE_BODY="Add dark mode toggle" swarm auto
```
