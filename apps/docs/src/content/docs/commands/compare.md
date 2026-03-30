---
title: "swarm compare"
description: Compare multiple PRs or branches side-by-side and generate a comprehensive report.
---

Compare multiple implementations of the same requirements. The command analyzes changes in each repository, optionally evaluates them against a requirements document, and produces a Markdown report with a recommendation. Supports 2 or more repos.

## Usage

```bash
# Compare two implementations (positional paths)
swarm compare ./pr-a ./pr-b

# Compare three or more implementations
swarm compare ./pr-a ./pr-b ./pr-c

# With requirements — scores each PR against the spec
swarm compare ./pr-a ./pr-b -f requirements.md

# Legacy --left/--right flags still work for two repos
swarm compare --left ./pr-a --right ./pr-b

# Custom base branch and output path
swarm compare ./pr-a ./pr-b --base develop -o review.md

# Verbose mode
swarm compare ./pr-a ./pr-b -v -f requirements.md
```

## Options

| Option | Description |
|---|---|
| `<paths...>` | Two or more repository root folders to compare (positional) |
| `--left <path>` | Alias for first repo (legacy, merged into positional list) |
| `--right <path>` | Alias for second repo (legacy, merged into positional list) |
| `-f, --file <file>` | Requirements file describing what should be done |
| `--base <branch>` | Base branch to diff against (default: `main`) |
| `-o, --output <file>` | Output report file path (default: `compare-report.md`) |

## How It Works

1. **File Inventory** — Detects changed files via `git diff` in each repo, filtering out noise directories (`.github/`, `node_modules/`, `dist/`, lock files, etc.).
2. **Diff Analysis** (parallel) — One [Diff Analyst](/agents/diff-analyst/) agent per repo analyzes changes independently. Repos are labeled A, B, C, etc.
3. **Requirements Evaluation** (conditional) — Only runs when `-f` is provided. A [Requirements Evaluator](/agents/requirements-evaluator/) scores each implementation against each requirement using a ✅/⚠️/❌ matrix.
4. **Comparative Review** — A [Comparative Reviewer](/agents/comparative-reviewer/) synthesizes all findings into a report with executive summary, comparison tables, strengths/weaknesses per implementation, and a recommendation.

## Output

The report is written to the path specified by `--output` (default: `compare-report.md`). It includes:

- **Executive summary** — Which implementation is strongest and why
- **File changes overview** — Per-repo file counts
- **Requirements coverage** — Matrix of requirement satisfaction (when `-f` is used)
- **Detailed comparison** — Architecture, code quality, error handling, testing, performance, security
- **Strengths & weaknesses** — Bullet lists for each implementation
- **Recommendation** — Clear recommendation with ranking

## Example Output

```
🔍 Starting PR Comparison...

[Compare: Inventorying changed files]
  📊 PR A: 5 files, PR B: 8 files, PR C: 3 files

[Compare: Analyzing changes (parallel)]
[Compare: Evaluating against requirements]
[Compare: Generating comparative review]

✅ PR comparison complete (01:23)
📄 Report: /path/to/compare-report.md
```

## Tips

- Each repo path must be a valid git repository.
- The `--base` branch must exist in all repositories.
- Large diffs are automatically truncated to fit within token limits.
- The Diff Analyst uses the fast model for speed; the Requirements Evaluator and Comparative Reviewer use the primary model for depth.
- Implementations are labeled alphabetically: A, B, C, ... for easy reference in the report.
