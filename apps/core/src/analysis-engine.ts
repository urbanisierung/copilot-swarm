import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearCheckpoint, type IterationSnapshot, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisChunksDir, analysisDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { partitionChunks, type ScoutResult, scoutRepo } from "./repo-scanner.js";
import { SessionManager } from "./session.js";
import { responseContains } from "./utils.js";

const MAX_REVIEW_ITERATIONS = 3;
const APPROVAL_KEYWORD = "ANALYSIS_APPROVED";
const DEFAULT_CHUNK_THRESHOLD = 500;
const DEFAULT_CHUNK_MAX_FILES = 300;

function readEnvPositiveInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

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
5. Do NOT include code snippets longer than 3 lines. Reference file paths instead.
6. **OUTPUT THE COMPLETE DOCUMENT IN YOUR RESPONSE.** Do NOT write it to a file. Your entire response must BE the analysis document.`;

const CHUNK_ARCHITECT_INSTRUCTIONS = `You are a Senior Software Architect analyzing a specific section of a larger repository.
You are responsible for producing a focused analysis of the directories assigned to you. Another agent will later synthesize all chunk analyses into a unified document.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore ONLY the directories listed below. Read config files, entry points, and representative source files within your scope.
2. Produce a Markdown document with these sections:

## Chunk Overview
One paragraph: what this section of the repository does and its role in the larger project.

## Tech Stack (within this chunk)
Bullet list of languages, frameworks, and tools used specifically in these directories.

## Structure
Directory tree (up to 2 levels within your assigned directories) with one-line descriptions.

## Architecture
- Key components and abstractions within this chunk
- How components in this chunk interact with each other
- Any external interfaces (APIs, shared types, imports from outside this chunk)

## Key Files Reference
Table: file path | purpose | key exports/interfaces (the most important files in your chunk)

## Patterns & Conventions
- Naming conventions, testing patterns, error handling specific to this chunk
- Any chunk-specific conventions that differ from the rest of the repo

## Dependencies
Key runtime dependencies used within this chunk and what they're for.

3. Be precise and factual. Every claim must be based on files you actually read.
4. Keep it concise — under 300 lines. Prioritize the most important information.
5. Do NOT include code snippets longer than 3 lines. Reference file paths instead.
6. **OUTPUT THE COMPLETE DOCUMENT IN YOUR RESPONSE.** Do NOT write it to a file. Your entire response must BE the chunk analysis document.`;

const SYNTHESIS_INSTRUCTIONS = `You are a Senior Software Architect producing a unified repository analysis from multiple chunk analyses.
Each chunk was independently analyzed by a different agent. Your job is to merge them into a single coherent document.

**Rules:**
1. You MAY use \`list_dir\`, \`read_file\`, and \`run_terminal\` to verify claims and fill gaps. Spot-check at least 3 claims per chunk.
2. **OUTPUT THE COMPLETE DOCUMENT IN YOUR RESPONSE.** Do NOT write it to a file. Do NOT use tools to create files. Your entire response must BE the merged analysis document.
3. Produce a SINGLE Markdown document with EXACTLY these sections:

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
- Cross-cutting concerns: how do the chunks relate to each other?

## Key Files Reference
Table: file path | purpose | key exports/interfaces (only the most important 10-15 files across the ENTIRE repo)

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

3. DEDUPLICATE information across chunks. Do not repeat the same dependency, pattern, or file in multiple places.
4. CONNECT THE DOTS: explain how the chunks relate to each other, where cross-chunk dependencies exist, and how data flows between them.
5. Be precise and factual. Keep it under 500 lines.
6. Do NOT include code snippets longer than 3 lines. Reference file paths instead.
7. **Your entire response must BE the merged analysis document.** Do NOT write it to a file using tools.`;

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

/** Format scout result as context for chunk/synthesis agents. */
function formatScoutContext(scout: ScoutResult): string {
  const lines: string[] = ["# Repository Overview (Scout)", ""];
  if (scout.readme) {
    lines.push("## README (excerpt)", "", scout.readme.substring(0, 2000), "");
  }
  lines.push(`**Total files:** ${scout.totalFiles}`, "");
  lines.push("## Directory Structure", "");
  for (const dir of scout.topLevelDirs) {
    lines.push(`- \`${dir.name}/\` — ${dir.fileCount} files`);
    if (dir.children.length > 0) {
      lines.push(`  Subdirs: ${dir.children.slice(0, 15).join(", ")}${dir.children.length > 15 ? "…" : ""}`);
    }
  }
  if (scout.rootFiles.length > 0) {
    lines.push("", `Root files: ${scout.rootFiles.join(", ")}`);
  }
  return lines.join("\n");
}

export class AnalysisEngine {
  private readonly sessions: SessionManager;
  private activePhaseKey: string | null = null;
  private iterationProgress: Record<string, IterationSnapshot> = {};

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
  ) {
    this.sessions = new SessionManager(config, pipeline, logger);
    if (tracker) this.sessions.setTracker(tracker);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  async execute(): Promise<void> {
    this.logger.info(msg.analyzeStart);

    // Scout the repo to decide whether to use chunked analysis
    const scout = await scoutRepo(this.config.repoRoot);
    const threshold = readEnvPositiveInt("ANALYZE_CHUNK_THRESHOLD", DEFAULT_CHUNK_THRESHOLD);

    if (scout.totalFiles >= threshold) {
      await this.executeChunked(scout);
    } else {
      await this.executeStandard();
    }
  }

  /** Original single-agent analysis for small repos. */
  private async executeStandard(): Promise<void> {
    const useCrossModel = this.pipeline.reviewModel !== this.pipeline.primaryModel;

    const phases: { phase: string }[] = [{ phase: "analyze-architect" }, { phase: "analyze-review" }];
    if (useCrossModel) {
      phases.push({ phase: "analyze-architect" }, { phase: "analyze-review" });
    }
    this.tracker?.initPhases(phases);

    // State
    const completedPhases = new Set<string>();
    let analysis = "";
    let resumedPhaseKey: string | null = null;

    // Resume from checkpoint
    if (this.config.resume) {
      const cp = await loadCheckpoint(this.config);
      if (cp?.mode === "analyze") {
        this.logger.info(msg.resuming(cp.completedPhases.length));
        for (const p of cp.completedPhases) {
          completedPhases.add(p);
          this.tracker?.completePhase(p);
        }
        analysis = cp.analysis || "";
        if (cp.activePhase) {
          resumedPhaseKey = cp.activePhase;
          this.iterationProgress = cp.iterationProgress ?? {};
          if (cp.sessionLog) {
            Object.assign(this.sessions.sessionLog, cp.sessionLog);
          }
        }
      } else {
        this.logger.info(msg.noCheckpoint);
      }
    }

    const saveProgress = async () => {
      await saveCheckpoint(this.config, {
        mode: "analyze",
        completedPhases: [...completedPhases],
        analysis,
        issueBody: "",
        runId: this.config.runId,
        spec: "",
        tasks: [],
        designSpec: "",
        streamResults: [],
        activePhase: this.activePhaseKey ?? undefined,
        iterationProgress: Object.keys(this.iterationProgress).length > 0 ? this.iterationProgress : undefined,
        sessionLog: Object.keys(this.sessions.sessionLog).length > 0 ? this.sessions.sessionLog : undefined,
      });
    };

    // Phase 1: Primary model — architect drafts, senior engineer reviews
    const archKey0 = "analyze-architect-0";
    const reviewKey1 = "analyze-review-1";
    if (completedPhases.has(archKey0)) {
      this.logger.info(msg.phaseSkipped("analyze-architect"));
    } else {
      this.tracker?.activatePhase(archKey0);
      this.activePhaseKey = archKey0;
      if (archKey0 !== resumedPhaseKey) this.iterationProgress = {};
      analysis = await this.runArchitectReviewLoop(this.pipeline.primaryModel, archKey0, saveProgress);
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(archKey0);
      completedPhases.add(reviewKey1);
      this.tracker?.completePhase(archKey0);
      this.tracker?.completePhase(reviewKey1);
      await saveProgress();
    }

    // Phase 2: Cross-model — same flow with the review model
    if (useCrossModel) {
      const archKey2 = "analyze-architect-2";
      const reviewKey3 = "analyze-review-3";
      if (completedPhases.has(archKey2)) {
        this.logger.info(msg.phaseSkipped("analyze-architect"));
      } else {
        this.tracker?.activatePhase(archKey2);
        this.activePhaseKey = archKey2;
        if (archKey2 !== resumedPhaseKey) this.iterationProgress = {};
        analysis = await this.runArchitectReviewLoop(this.pipeline.reviewModel, archKey2, saveProgress, analysis);
        this.activePhaseKey = null;
        this.iterationProgress = {};
        completedPhases.add(archKey2);
        completedPhases.add(reviewKey3);
        this.tracker?.completePhase(archKey2);
        this.tracker?.completePhase(reviewKey3);
        await saveProgress();
      }
    }

    await this.saveAnalysis(analysis);
  }

  /** Chunked analysis for large repos: scout → partition → parallel chunks → synthesis → review. */
  private async executeChunked(scout: ScoutResult): Promise<void> {
    const maxFiles = readEnvPositiveInt("ANALYZE_CHUNK_MAX_FILES", DEFAULT_CHUNK_MAX_FILES);
    const chunks = partitionChunks(scout, maxFiles);

    this.logger.info(msg.analyzeChunkedStart(scout.totalFiles, chunks.length));

    // Build TUI phases
    const phases: { phase: string }[] = [
      { phase: "analyze-scout" },
      ...chunks.map(() => ({ phase: "analyze-chunk" })),
      { phase: "analyze-synthesis" },
      { phase: "analyze-review" },
    ];
    this.tracker?.initPhases(phases);

    // State
    const completedPhases = new Set<string>();
    let chunkResults: Record<string, string> = {};
    let scoutOverview = "";
    let analysis = "";

    // Resume from checkpoint
    if (this.config.resume) {
      const cp = await loadCheckpoint(this.config);
      if (cp?.mode === "analyze") {
        this.logger.info(msg.resuming(cp.completedPhases.length));
        for (const p of cp.completedPhases) {
          completedPhases.add(p);
          this.tracker?.completePhase(p);
        }
        analysis = cp.analysis || "";
        chunkResults = cp.chunkResults ?? {};
        scoutOverview = cp.scoutOverview ?? "";
        if (cp.activePhase) {
          this.activePhaseKey = cp.activePhase;
          this.iterationProgress = cp.iterationProgress ?? {};
          if (cp.sessionLog) {
            Object.assign(this.sessions.sessionLog, cp.sessionLog);
          }
        }
      } else {
        this.logger.info(msg.noCheckpoint);
      }
    }

    const saveProgress = async () => {
      await saveCheckpoint(this.config, {
        mode: "analyze",
        completedPhases: [...completedPhases],
        analysis,
        chunkResults: Object.keys(chunkResults).length > 0 ? chunkResults : undefined,
        scoutOverview: scoutOverview || undefined,
        issueBody: "",
        runId: this.config.runId,
        spec: "",
        tasks: [],
        designSpec: "",
        streamResults: [],
        activePhase: this.activePhaseKey ?? undefined,
        iterationProgress: Object.keys(this.iterationProgress).length > 0 ? this.iterationProgress : undefined,
        sessionLog: Object.keys(this.sessions.sessionLog).length > 0 ? this.sessions.sessionLog : undefined,
      });
    };

    // Phase 1: Scout — cheap model produces high-level overview
    const scoutKey = "analyze-scout-0";
    if (completedPhases.has(scoutKey)) {
      this.logger.info(msg.phaseSkipped("analyze-scout"));
    } else {
      this.tracker?.activatePhase(scoutKey);
      this.logger.info(msg.analyzeScoutPhase(this.pipeline.fastModel));

      const scoutContext = formatScoutContext(scout);
      scoutOverview = await this.sessions.callIsolatedWithInstructions(
        "You are a scout agent. Given the repository structure and README below, produce a concise high-level overview " +
          "of the project: what it does, its architecture, and how the major directories relate to each other. " +
          "This will be used as context for other agents analyzing individual sections in parallel.\n\n" +
          "Keep your response under 200 lines. Be factual and concise.",
        scoutContext,
        `Scout is exploring repository (${this.pipeline.fastModel})…`,
        this.pipeline.fastModel,
        "analyze-scout/scout",
        "scout",
      );

      completedPhases.add(scoutKey);
      this.tracker?.completePhase(scoutKey);
      await saveProgress();
    }

    this.logger.info(msg.analyzePartitionResult(chunks.length, scout.totalFiles));

    // Phase 2: Parallel chunk analysis
    const chunkDir = analysisChunksDir(this.config);
    await fs.mkdir(chunkDir, { recursive: true });

    const pendingChunks = chunks.filter((chunk) => !completedPhases.has(`analyze-chunk-${chunk.id}`));
    if (pendingChunks.length > 0) {
      const settled = await Promise.allSettled(
        pendingChunks.map(async (chunk, _idx) => {
          const phaseIdx = chunks.indexOf(chunk) + 1; // +1 because scout is index 0
          const phaseKey = `analyze-chunk-${phaseIdx}`;
          this.tracker?.activatePhase(phaseKey);
          this.logger.info(msg.analyzeChunkStart(chunk.id, chunk.label));

          const chunkPrompt =
            `${scoutOverview}\n\n---\n\n` +
            `**Your assigned directories:** ${chunk.directories.join(", ")}\n` +
            `**Chunk:** ${chunk.label} (${chunk.fileCount} files)\n\n` +
            "Analyze ONLY the directories listed above. Explore them thoroughly using `list_dir`, `read_file`, and `run_terminal`.";

          const result = await this.sessions.callIsolatedWithInstructions(
            CHUNK_ARCHITECT_INSTRUCTIONS,
            chunkPrompt,
            `Analyzing chunk "${chunk.label}" (${this.pipeline.primaryModel})…`,
            this.pipeline.primaryModel,
            `analyze-chunk/${chunk.id}`,
            `chunk-${chunk.id}`,
          );

          chunkResults[chunk.id] = result;

          // Save individual chunk file
          await fs.writeFile(path.join(chunkDir, `chunk-${chunk.id}.md`), result);

          completedPhases.add(`analyze-chunk-${chunk.id}`);
          this.logger.info(msg.analyzeChunkComplete(chunk.id));
          this.tracker?.completePhase(phaseKey);
          await saveProgress();

          return result;
        }),
      );

      // Check for failures
      const failures = settled.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        this.logger.warn(msg.partialStreamFailure(failures.length, pendingChunks.length));
        if (failures.length === pendingChunks.length) {
          throw new Error("All chunk analyses failed");
        }
      }
    }

    // Phase 3: Synthesis — merge all chunk analyses
    const synthesisKey = `analyze-synthesis-${chunks.length + 1}`;
    if (completedPhases.has(synthesisKey)) {
      this.logger.info(msg.phaseSkipped("analyze-synthesis"));
    } else {
      this.tracker?.activatePhase(synthesisKey);
      this.logger.info(msg.analyzeSynthesisPhase(this.pipeline.primaryModel));

      const chunkSections = chunks
        .filter((c) => chunkResults[c.id])
        .map((c) => `# Chunk: ${c.label}\nDirectories: ${c.directories.join(", ")}\n\n${chunkResults[c.id]}`)
        .join("\n\n---\n\n");

      const synthesisPrompt =
        `${scoutOverview}\n\n---\n\n` +
        "Below are independent analyses of different sections of the repository. " +
        "Merge them into a single unified repository analysis document.\n\n" +
        `${chunkSections}`;

      analysis = await this.sessions.callIsolatedWithInstructions(
        SYNTHESIS_INSTRUCTIONS,
        synthesisPrompt,
        `Synthesizing analysis (${this.pipeline.primaryModel})…`,
        this.pipeline.primaryModel,
        "analyze-synthesis/synthesis",
        "synthesis",
      );

      completedPhases.add(synthesisKey);
      this.tracker?.completePhase(synthesisKey);
      await saveProgress();
    }

    // Phase 4: Review — reuse existing review loop
    const reviewKey = `analyze-review-${chunks.length + 2}`;
    if (completedPhases.has(reviewKey)) {
      this.logger.info(msg.phaseSkipped("analyze-review"));
    } else {
      this.tracker?.activatePhase(reviewKey);
      this.activePhaseKey = reviewKey;
      this.iterationProgress = {};
      analysis = await this.runArchitectReviewLoop(this.pipeline.primaryModel, reviewKey, saveProgress, analysis);
      this.activePhaseKey = null;
      this.iterationProgress = {};
      completedPhases.add(reviewKey);
      this.tracker?.completePhase(reviewKey);
      await saveProgress();
    }

    await this.saveAnalysis(analysis);
  }

  private async saveAnalysis(analysis: string): Promise<void> {
    const dir = analysisDir(this.config);
    await fs.mkdir(dir, { recursive: true });
    const outputPath = path.join(dir, "repo-analysis.md");
    await fs.writeFile(outputPath, analysis);
    await clearCheckpoint(this.config);
    this.logger.info(msg.analyzeComplete);
    this.logger.info(msg.analyzeSaved(path.relative(this.config.repoRoot, outputPath)));
  }

  private async runArchitectReviewLoop(
    model: string,
    phaseKey: string,
    saveProgress: () => Promise<void>,
    existingAnalysis?: string,
  ): Promise<string> {
    // Architect produces or refines the analysis
    this.logger.info(msg.analyzeArchitectPhase(model));

    // Resume: check for draft from a previous run
    const draftProgress = this.iterationProgress[`${phaseKey}-draft`];
    let analysis: string;

    if (draftProgress) {
      analysis = draftProgress.content;
      this.logger.info(msg.iterationResumed(0, MAX_REVIEW_ITERATIONS));
    } else {
      const architectSession = await this.sessions.createSessionWithInstructions(
        ARCHITECT_INSTRUCTIONS,
        model,
        "architect",
      );
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
      } finally {
        await architectSession.destroy();
      }

      // Save draft checkpoint
      this.iterationProgress[`${phaseKey}-draft`] = { content: analysis, completedIterations: 0 };
      await saveProgress();
    }

    // Review loop
    this.logger.info(msg.analyzeReviewPhase(model));

    const reviewProgressKey = `${phaseKey}-review`;
    const progress = this.iterationProgress[reviewProgressKey];
    let startIteration = 1;
    if (progress) {
      analysis = progress.content;
      startIteration = progress.completedIterations + 1;
      this.logger.info(msg.iterationResumed(progress.completedIterations, MAX_REVIEW_ITERATIONS));
    }

    for (let i = startIteration; i <= MAX_REVIEW_ITERATIONS; i++) {
      this.logger.info(msg.analyzeIteration(i, MAX_REVIEW_ITERATIONS));

      const feedback = await this.sessions.callIsolatedWithInstructions(
        REVIEWER_INSTRUCTIONS,
        `Review this repository analysis document:\n\n${analysis}`,
        `Senior engineer is reviewing (${model})…`,
        model,
        `${reviewProgressKey}/reviewer-${i}`,
        "sr-engineer",
      );

      if (responseContains(feedback, APPROVAL_KEYWORD)) {
        this.logger.info(msg.analyzeApproved);
        break;
      }

      this.logger.info(msg.analyzeFeedback(feedback.substring(0, 80)));

      const revision = await this.sessions.callIsolatedWithInstructions(
        ARCHITECT_INSTRUCTIONS +
          "\n\n**CRITICAL:** You are revising an existing analysis based on reviewer feedback. " +
          "Output the COMPLETE revised document — do NOT output a summary or changelog.",
        `Current analysis:\n\n${analysis}\n\nReviewer feedback:\n\n${feedback}\n\nRevise the analysis to address all issues. Output the COMPLETE document.`,
        `Architect is revising analysis (${model})…`,
        model,
        `${reviewProgressKey}/revision-${i}`,
        "architect",
      );

      analysis = revision;

      // Save iteration progress
      this.iterationProgress[reviewProgressKey] = { content: analysis, completedIterations: i };
      await saveProgress();
    }

    return analysis;
  }
}
