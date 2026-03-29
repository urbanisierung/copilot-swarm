---
title: "swarm compare"
description: Compare two PRs or branches side-by-side and generate a comprehensive report.
---

Compare two implementations of the same requirements. The command analyzes changes in each repository, optionally evaluates them against a requirements document, and produces a Markdown report with a recommendation.

## Usage

```bash
# Basic comparison
swarm compare --left ./pr-a --right ./pr-b

# With requirements — scores each PR against the spec
swarm compare --left ./pr-a --right ./pr-b -f requirements.md

# Custom base branch and output path
swarm compare --left ./pr-a --right ./pr-b --base develop -o review.md

# Verbose mode
swarm compare --left ./pr-a --right ./pr-b -v -f requirements.md
```

## Options

| Option | Description |
|---|---|
| `--left <path>` | Root folder of the first PR (required) |
| `--right <path>` | Root folder of the second PR (required) |
| `-f, --file <file>` | Requirements file describing what should be done |
| `--base <branch>` | Base branch to diff against (default: `main`) |
| `-o, --output <file>` | Output report file path (default: `compare-report.md`) |

## How It Works

1. **File Inventory** — Detects changed files via `git diff` in both repos, filtering out noise directories (`.github/`, `node_modules/`, `dist/`, lock files, etc.).
2. **Diff Analysis** (parallel) — Two independent [Diff Analyst](/agents/diff-analyst/) agents analyze the left and right PRs simultaneously, producing structured change inventories.
3. **Requirements Evaluation** (conditional) — Only runs when `-f` is provided. A [Requirements Evaluator](/agents/requirements-evaluator/) scores each PR against each requirement using a ✅/⚠️/❌ matrix.
4. **Comparative Review** — A [Comparative Reviewer](/agents/comparative-reviewer/) synthesizes all findings into a head-to-head report with executive summary, comparison tables, strengths/weaknesses, and a recommendation.

## Output

The report is written to the path specified by `--output` (default: `compare-report.md`). It includes:

- **Executive summary** — Which PR is stronger and why
- **File changes overview** — Side-by-side file counts
- **Requirements coverage** — Matrix of requirement satisfaction (when `-f` is used)
- **Detailed comparison** — Architecture, code quality, error handling, testing, performance, security
- **Strengths & weaknesses** — Bullet lists for each PR
- **Recommendation** — Clear recommendation with reasoning

## Example Output

```
🔍 Starting PR Comparison...

[Compare: Inventorying changed files]
  📊 Left PR: 5 files, Right PR: 8 files

[Compare: Analyzing changes (parallel)]
[Compare: Evaluating against requirements]
[Compare: Generating comparative review]

✅ PR comparison complete (01:23)
📄 Report: /path/to/compare-report.md
```

## Tips

- Each `--left` and `--right` path must be a valid git repository.
- The `--base` branch must exist in both repositories.
- Large diffs are automatically truncated to fit within token limits.
- The Diff Analyst uses the fast model for speed; the Requirements Evaluator and Comparative Reviewer use the primary model for depth.
