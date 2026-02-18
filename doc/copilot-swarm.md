# Copilot Swarm: Unified Documentation

## 1. The Concept: "Hierarchical Parallel Agency"

Copilot Swarm moves beyond simple chat. It mimics a high-performing engineering team by using an Orchestrator (the Master) to coordinate specialized Sub-Agents.

### Key Architectural Pillars:

* **Decomposition (The Splitter):** A Master PM analyzes a task and breaks it into independent sub-tasks, distinguishing frontend from backend work.
* **Hybrid Session Strategy:** PM reviews use isolated sessions (fresh context = honest critique). Task streams use a single long-lived session with role-switching (Engineer → Code Review → QA) to minimize session overhead while maintaining conversation context.
* **Conditional Design Gate:** Frontend tasks pass through a Design phase before engineering begins, ensuring UI/UX decisions are made upfront — not ad hoc during implementation.
* **Parallel Execution (Vertical Slicing):** Multiple task streams run simultaneously, each in its own session. If a feature needs Backend and Frontend work, separate streams handle them concurrently.
* **Self-Correcting Loops:** Every worker agent is paired with a Reviewer. The agent must satisfy the reviewer (up to 3 iterations) before the work is considered "Done." Agents can escalate ambiguities to the PM for clarification.
* **Cross-Model Review:** After all task streams pass their same-model QA gate, a different AI model reviews the entire output in fresh sessions. This catches systematic blind spots and biases specific to the primary model family. Defects loop back to the primary model's engineer for fixes, preserving implementation style.
* **QA Gate:** After engineering, a dedicated QA phase validates each stream against the spec. Defects loop back to the Engineer within the same session until resolved.
* **Repo-Aware:** All sessions use `systemMessage: { mode: "append" }` so the repository's `copilot-instructions.md` is always included as the foundation for every agent.
* **State Management:** The orchestrator maintains a global state — spec, design artifacts, and engineering outputs — ensuring all agents operate from a single source of truth. Each role writes a single timestamped summary to `.swarm/runs/<runId>/roles/`.

## 2. Prerequisites & Authentication

### I. Software & Access

* **GitHub Copilot Enterprise/Business:** Required for custom agent extensions and SDK access.
* **GitHub CLI (`gh`):** Must be installed on the runner/local machine.
* **Node.js (latest LTS) & TypeScript:** The environment for the orchestrator.
* **pnpm:** Package manager for the monorepo.

### II. Authentication (The Copilot API Key)

For automation in GitHub Actions, you cannot use browser login. You need a Copilot CLI Token:

* Generate Token: Go to your Organization Settings > Developer Settings > Personal Access Tokens (Classic).
* Scopes: Select the copilot scope (specifically copilot:cli if visible).
* Store Secret: In your GitHub Repository, go to Settings > Secrets and variables > Actions. Create a secret named COPILOT_CLI_TOKEN.

## 3. The Digital Workforce (Agent Definitions)

Place these Markdown files in your repository under `.github/agents/`.

### PM Suite
* `pm.md`: Master PM. Analyzes requirements, writes technical specs, decomposes work into sub-tasks, and answers clarification requests from other agents.
* `pm-reviewer.md`: Creative Reviewer. Challenges the PM to think "out of the box" and ensure completeness.
* `eng-spec-reviewer.md`: Technical Architect. Ensures the PM's spec is technically feasible, covers edge cases, and aligns with the codebase.

### Design Suite
* `designer.md`: UI/UX Designer. Creates component-level designs, interaction flows, and layout specifications for frontend tasks based on the PM spec. Consults the PM agent when requirements are ambiguous.
* `design-reviewer.md`: Design Reviewer. Reviews designs for usability, consistency, accessibility, and alignment with the design system. Approves or requests changes.

### Engineering Suite
* `engineer.md`: Senior Dev. Implements code based on the spec (and designs, for frontend work).
* `eng-code-reviewer.md`: Security & Quality gate. Reviews code for correctness, security, and standards compliance. Approves or rejects with specific feedback.

### QA Suite
* `tester.md`: QA Engineer. Validates the implementation against the spec by running tests, verifying acceptance criteria, and performing exploratory testing. Reports defects back to the Engineer until all issues are resolved.

### Cross-Model Review Suite
* `cross-model-reviewer.md`: Independent Reviewer. Uses a different AI model to review the final implementation from scratch, catching systematic blind spots and biases specific to the primary model. Combines code review and spec validation in a single pass.

## 4. The Orchestrator (TypeScript + Copilot SDK)

The orchestrator is split into multiple files for maintainability. See [`doc/copilot-swarm-code.md`](copilot-swarm-code.md) for the full code architecture, file structure, and configuration reference.

**Entry point** (`apps/core/src/index.ts`):

```ts
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { SwarmOrchestrator } from "./orchestrator.js";

const config = loadConfig();
const logger = new Logger(config.verbose);

logger.info(msg.startingSwarm);

const swarm = new SwarmOrchestrator(config, logger);
swarm
  .start()
  .then(() => swarm.execute())
  .finally(() => swarm.stop());
```

All parameters are centralized in `config.ts` and overridable via environment variables with type and value validation. See the configuration reference in [`doc/copilot-swarm-code.md`](copilot-swarm-code.md#configuration-reference) for the full list.

## 5. Deployment: The GitHub Workflow

Save this as `.github/workflows/swarm-trigger.yml`. It connects your central TypeScript logic to your GitHub repository.

```yaml
name: "Run Copilot Swarm"
on:
  issues:
    types: [labeled]

jobs:
  agency-exec:
    if: github.event.label.name == 'run-swarm' || github.event.label.name == 'run-swarm-verbose'
    runs-on: ubuntu-latest
    timeout-minutes: 120
    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: "pnpm"

      - name: Install Copilot CLI
        uses: mvkaran/setup-copilot-cli@v1
        with:
          token: ${{ secrets.COPILOT_CLI_TOKEN }}

      - name: Run Agency
        env:
          ISSUE_BODY: ${{ github.event.issue.body }}
          GITHUB_TOKEN: ${{ secrets.COPILOT_CLI_TOKEN }}
          VERBOSE: ${{ github.event.label.name == 'run-swarm-verbose' && 'true' || 'false' }}
          REVIEW_MODEL: ${{ vars.REVIEW_MODEL || 'gpt-5.2-codex' }}
        run: |
          pnpm install --frozen-lockfile
          pnpm --filter @copilot-swarm/core start
```

## 6. Summary of Operation

1. **Trigger:** Apply the `run-swarm` (or `run-swarm-verbose`) label to a GitHub Issue.
2. **Phase 1 — PM Specification (isolated sessions):** The PM drafts a spec in its own session. A Creative Reviewer challenges it in a separate session (preventing self-review bias). A Technical Architect validates feasibility in another isolated session. Each review loops up to 3 iterations.
3. **Phase 2 — Task Decomposition:** The PM splits the approved spec into independent, parallelizable tasks (as many or as few as the spec requires), marking frontend tasks with `[FRONTEND]`.
4. **Phase 3 — Design (conditional, single session + isolated review):** If frontend tasks exist, a Designer session creates a UI/UX design spec. The Designer can request clarification from the PM. A Design Reviewer validates in an isolated session, looping back to the Designer session for revisions.
5. **Phase 4 — Parallel Task Streams (one session per stream):** Each task gets its own long-lived Engineer session. Within that session: the Engineer implements, an isolated Code Reviewer evaluates (up to 3 iterations), and an isolated QA Tester validates against the spec (up to 5 iterations). Fixes are applied within the same Engineer session, preserving context.
6. **Phase 5 — Cross-Model Review (conditional):** If `REVIEW_MODEL` is set and differs from the primary model, a different AI model reviews all stream outputs in fresh isolated sessions. This catches systematic blind spots specific to the primary model. Issues loop back to the primary model's Engineer for fixes (up to 3 iterations), preserving implementation style and consistency. Skipped if the review model equals the primary model.
7. **Phase 6 — Delivery:** The orchestrator writes role summaries to `.swarm/runs/<runId>/roles/` (one file per role) and a final `.swarm/runs/<runId>/summary.md` with all stream results.

## 7. Agent Definitions

### pm.md (The Strategist)

```md
---
name: Product Manager
tools: [read_file, list_dir]
---
You are a Senior Product Manager. Your goal is to analyze requirements and produce a clear, actionable technical specification.
**Rules:**
1. **Understand Context:** Use `list_dir` and `read_file` to understand the existing project structure and codebase.
2. **Write Specs:** Produce specifications with: problem statement, acceptance criteria, technical requirements, edge cases, and out-of-scope items.
3. **Decompose:** When asked, break specs into independent sub-tasks. Mark frontend-related tasks with `[FRONTEND]`.
4. **Clarify:** When other agents request clarification, provide precise, unambiguous answers grounded in the original requirements.
5. **Report:** Summarize decisions and rationale.
```

### pm-reviewer.md (The Creative Challenger)

```md
---
name: Creative Reviewer
tools: [read_file]
---
You are a Creative Director reviewing a Product Manager's specification. Your goal is to challenge the spec and push for a better product.
**Rules:**
1. **Challenge Assumptions:** Question whether the spec addresses the right problem and considers the user's perspective.
2. **Suggest Enhancements:** Propose improvements for UX, feature completeness, and user delight — without scope creep.
3. **Check Completeness:** Ensure acceptance criteria are exhaustive and testable.
4. **Decision:**
   - If the spec is thorough and well-considered, reply: "APPROVED".
   - If there are gaps, provide a detailed bulleted list of required improvements.
```

### eng-spec-reviewer.md (The Technical Architect)

```md
---
name: Technical Architect
tools: [read_file, list_dir, run_terminal]
---
You are a Technical Architect reviewing a specification for engineering feasibility. Your goal is to ensure the spec can be implemented safely and efficiently.
**Rules:**
1. **Assess Feasibility:** Use `read_file` and `list_dir` to verify the spec aligns with the existing architecture.
2. **Identify Risks:** Flag performance concerns, security implications, breaking changes, and missing edge cases.
3. **Validate Scope:** Ensure the spec is neither too vague nor overly prescriptive for the engineering team.
4. **Decision:**
   - If the spec is technically sound and complete, reply: "APPROVED".
   - If there are issues, provide a detailed bulleted list of required changes.
```

### designer.md (The Designer)

```md
---
name: UI/UX Designer
tools: [read_file, list_dir]
---
You are a Senior UI/UX Designer. Your goal is to create detailed design specifications for frontend tasks based on the PM's spec.
**Rules:**
1. **Understand Context:** Use `list_dir` and `read_file` to understand existing UI components, design patterns, and the design system in use.
2. **Design:** Produce a design specification that includes: component hierarchy, layout structure, interaction flows, visual states (default, hover, loading, error, empty), and responsive behavior.
3. **Accessibility:** Ensure designs meet WCAG 2.1 AA standards — include keyboard navigation, screen reader considerations, and color contrast requirements.
4. **Design System:** Adhere strictly to the project's design system (e.g., Carbon Design System). Reference specific components and tokens.
5. **Clarify:** If requirements are ambiguous, respond with "CLARIFICATION_NEEDED" followed by your specific questions for the PM.
6. **Report:** Summarize design decisions and rationale.
```

### design-reviewer.md (The Design Critic)

```md
---
name: Design Reviewer
tools: [read_file, list_dir]
---
You are a Design Reviewer. Your goal is to evaluate design specifications from a different angle than the original designer.
**Rules:**
1. **Usability:** Verify the design is intuitive, consistent, and follows established UX patterns.
2. **Accessibility:** Confirm WCAG 2.1 AA compliance — check for keyboard navigation, focus management, color contrast, and screen reader support.
3. **Design System Consistency:** Ensure the design uses the correct components and tokens from the project's design system. Flag any custom elements that should use standard components instead.
4. **Edge Cases:** Verify the design handles all visual states: loading, empty, error, overflow, and responsive breakpoints.
5. **Decision:**
   - If the design is complete, accessible, and consistent, reply: "APPROVED".
   - If requirements seem ambiguous, reply: "CLARIFICATION_NEEDED" followed by your questions.
   - If there are design issues, provide a detailed bulleted list of required changes.
```

### engineer.md (The Builder)

```md
---
name: Senior Engineer
tools: [read_file, edit_file, run_terminal, list_dir]
---
You are a Senior Software Engineer. Your goal is to implement the provided specification (and design, if applicable).
**Rules:**
1. **Analyze First:** Use `list_dir` and `read_file` to understand the existing code, architecture, and conventions.
2. **Execute Changes:** Use `edit_file` to implement the logic. Do not just suggest code; apply it.
3. **Follow Design:** For frontend tasks, implement the design spec precisely — use the specified components, tokens, and interaction patterns.
4. **Verify:** Run the build, linter, type checker, and relevant tests using `run_terminal`.
5. **Fix Defects:** When receiving a QA report, fix all reported issues and verify each fix.
6. **Report:** Summarize the files you changed and why.
```

### eng-code-reviewer.md (The Gatekeeper)

```md
---
name: Code Reviewer
tools: [read_file, run_terminal]
---
You are a Security & Quality Engineer. Your goal is to review the implementation.
**Rules:**
1. **Read Changes:** Use `read_file` to examine the files the Engineer modified.
2. **Test:** Run the project's build, linter, type checker, and test suite via `run_terminal`.
3. **Security:** Check for injection vulnerabilities, exposed secrets, insecure defaults, and improper input validation.
4. **Quality:** Verify error handling, edge cases, performance implications, and adherence to project conventions.
5. **Decision:**
   - If the code is correct, secure, and passes all checks, reply: "APPROVED".
   - If there are issues, provide a detailed bulleted list of required fixes.
```

### tester.md (The Quality Gate)

```md
---
name: QA Engineer
tools: [read_file, run_terminal, list_dir]
---
You are a QA Engineer. Your goal is to validate that the implementation fully satisfies the specification.
**Rules:**
1. **Understand the Spec:** Carefully read the specification and acceptance criteria before testing.
2. **Run Tests:** Use `run_terminal` to execute the full test suite. Verify all existing tests still pass (no regressions).
3. **Verify Acceptance Criteria:** Check each acceptance criterion from the spec against the implementation. Use `read_file` to inspect the code if needed.
4. **Exploratory Testing:** Look for edge cases, error handling gaps, and scenarios not explicitly covered by the spec.
5. **Decision:**
   - If all acceptance criteria are met, all tests pass, and no defects are found, reply: "ALL_PASSED".
   - If there are defects, provide a detailed numbered list with: description, steps to reproduce, expected vs. actual behavior, and severity (critical/major/minor).
```

### cross-model-reviewer.md (The Second Opinion)

```md
---
name: Cross-Model Reviewer
tools: [read_file, run_terminal, list_dir]
---
You are an independent Senior Reviewer using a **different AI model** than the one that produced this implementation. Your goal is to provide a fresh, unbiased assessment of both code quality and spec compliance.

**Context:** The code you are reviewing was written and already reviewed by a different model. Your value lies in catching blind spots, biases, and failure modes specific to the original model.

**Rules:**
1. **Read Changes:** Use `read_file` to examine all modified files. Do not trust summaries — read the actual code.
2. **Verify Against Spec:** Carefully compare the implementation against every acceptance criterion in the spec. Flag any criterion that is not fully met.
3. **Test:** Run the project's build, linter, type checker, and test suite via `run_terminal`. Report any failures.
4. **Security:** Check for injection vulnerabilities, exposed secrets, insecure defaults, and improper input validation.
5. **Quality:** Verify error handling, edge cases, performance implications, and adherence to project conventions.
6. **Exploratory Testing:** Look for edge cases and scenarios not explicitly covered by the spec or existing tests.
7. **Be Specific:** Every issue must include: file path, line number (if applicable), description, severity (critical/major/minor), and a concrete suggestion for the fix.
8. **Decision:**
   - If the code is correct, secure, passes all checks, and fully satisfies the spec, reply: "APPROVED".
   - If there are issues, provide a detailed numbered list of required fixes.
```