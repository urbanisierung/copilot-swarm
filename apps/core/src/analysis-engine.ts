import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import { SessionManager } from "./session.js";
import { responseContains } from "./utils.js";

const MAX_REVIEW_ITERATIONS = 3;
const APPROVAL_KEYWORD = "ANALYSIS_APPROVED";

const ARCHITECT_INSTRUCTIONS = `You are a Senior Software Architect producing a concise repository context document.
Your goal is to explore the repository thoroughly and create a structured analysis that gives an LLM everything it needs to understand and contribute to this codebase.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the repository exhaustively. Read key config files, entry points, and representative source files.
2. Produce a Markdown document with EXACTLY these sections:

## Overview
One paragraph: what this project does, who it's for, and its current state.

## Tech Stack
Bullet list: language(s), runtime, framework(s), package manager, build system, test framework, linter/formatter, CI/CD.

## Repository Structure
- Type: monorepo / single-package / multi-package
- Directory tree (top 2 levels) with one-line descriptions for each key directory
- Entry points and their roles

## Architecture
- High-level component diagram (describe in text: what components exist and how they interact)
- Key abstractions and patterns (e.g., dependency injection, event-driven, pipeline pattern)
- Data flow: how does a request/command flow through the system?

## Key Files Reference
Table: file path | purpose | key exports/interfaces (only the most important 10-15 files)

## Commands
Table: command | description (build, test, lint, format, typecheck, dev, etc.)

## Patterns & Conventions
- Naming conventions (files, variables, types)
- Testing patterns (where tests live, naming, utilities)
- Error handling approach
- Documentation conventions
- Import/module conventions

## How to Implement a New Feature
Step-by-step guide specific to this repo: where to add files, what to update, how to test, what conventions to follow. Reference actual file paths and patterns from the codebase.

## Dependencies
Key runtime dependencies and what they're used for (not devDependencies).

3. Be precise and factual. Every claim must be based on files you actually read.
4. Keep it concise — this document should be under 500 lines. Prioritize the most important information.
5. Do NOT include code snippets longer than 3 lines. Reference file paths instead.`;

const REVIEWER_INSTRUCTIONS = `You are a Senior Software Engineer reviewing a repository analysis document.
Your goal is to verify the analysis is accurate, complete, and useful for an LLM that needs to understand this codebase.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to independently verify claims in the document. Spot-check at least 5 specific claims.
2. Check for:
   - **Accuracy:** Are file paths, command names, and descriptions correct?
   - **Completeness:** Are critical files, patterns, or conventions missing?
   - **Clarity:** Would an LLM be able to implement a feature using only this document as context?
   - **"How to Implement" section:** Is the step-by-step guide actionable and complete?
   - **Conciseness:** Is there unnecessary detail that bloats the document?
3. Decision:
   - If the analysis is accurate, complete, and useful, respond with **${APPROVAL_KEYWORD}**.
   - If there are issues, provide a numbered list of specific corrections or additions needed. Be precise about what's wrong and what the fix should be.`;

export class AnalysisEngine {
  private readonly sessions: SessionManager;

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
  ) {
    this.sessions = new SessionManager(config, pipeline, logger);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.analyzeStart);

    // Phase 1: Primary model — architect drafts, senior engineer reviews
    let analysis = await this.runArchitectReviewLoop(this.pipeline.primaryModel);

    // Phase 2: Cross-model — same flow with the review model
    if (this.pipeline.reviewModel !== this.pipeline.primaryModel) {
      analysis = await this.runArchitectReviewLoop(this.pipeline.reviewModel, analysis);
    }

    // Save result
    const dir = analysisDir(this.config);
    await fs.mkdir(dir, { recursive: true });
    const outputPath = path.join(dir, "repo-analysis.md");
    await fs.writeFile(outputPath, analysis);

    this.logger.info(msg.analyzeComplete);
    this.logger.info(msg.analyzeSaved(path.relative(this.config.repoRoot, outputPath)));
  }

  private async runArchitectReviewLoop(model: string, existingAnalysis?: string): Promise<string> {
    // Architect produces or refines the analysis
    this.logger.info(msg.analyzeArchitectPhase(model));

    const architectSession = await this.sessions.createSessionWithInstructions(ARCHITECT_INSTRUCTIONS, model);
    let analysis: string;

    try {
      if (existingAnalysis) {
        analysis = await this.sessions.send(
          architectSession,
          "Here is a repository analysis produced by a different model. " +
            "Independently explore the repository and verify, correct, and improve this analysis. " +
            "Produce the final revised document.\n\n" +
            `Existing analysis:\n\n${existingAnalysis}`,
          `Architect is analyzing repository (${model})…`,
        );
      } else {
        analysis = await this.sessions.send(
          architectSession,
          "Explore this repository thoroughly and produce a complete repository analysis document following your instructions.",
          `Architect is analyzing repository (${model})…`,
        );
      }

      // Review loop
      this.logger.info(msg.analyzeReviewPhase(model));

      for (let i = 1; i <= MAX_REVIEW_ITERATIONS; i++) {
        this.logger.info(msg.analyzeIteration(i, MAX_REVIEW_ITERATIONS));

        const feedback = await this.sessions.callIsolatedWithInstructions(
          REVIEWER_INSTRUCTIONS,
          `Review this repository analysis document:\n\n${analysis}`,
          `Senior engineer is reviewing (${model})…`,
          model,
        );

        if (responseContains(feedback, APPROVAL_KEYWORD)) {
          this.logger.info(msg.analyzeApproved);
          break;
        }

        this.logger.info(msg.analyzeFeedback(feedback.substring(0, 80)));
        analysis = await this.sessions.send(
          architectSession,
          `Senior engineer review feedback:\n\n${feedback}\n\nRevise the analysis to address all issues.`,
          `Architect is revising analysis (${model})…`,
        );
      }
    } finally {
      await architectSession.destroy();
    }

    return analysis;
  }
}
