/**
 * PrepareEngine — generates Copilot instruction files for a repository.
 * Runs a deep analysis focused on patterns, conventions, and structure,
 * then outputs machine-readable instruction files to `.github/instructions/`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getCachedAnalysis } from "./analysis-cache.js";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { loadRepoAnalysis } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { scoutRepo } from "./repo-scanner.js";
import { SessionManager } from "./session.js";

const INSTRUCTIONS_DIR = ".github/instructions";

const PREPARE_INSTRUCTIONS = `You are a Senior Software Architect producing Copilot instruction files for a repository.
Your output will be consumed by GitHub Copilot (an AI coding assistant), NOT by humans. Optimize for machine readability and actionable precision.

You will receive a repository analysis document AND have access to explore the repository yourself. Use both to produce comprehensive instruction files.

**Your task:** Generate EXACTLY 3 instruction files as specified below. Each file must start with a YAML frontmatter block and contain dense, actionable instructions.

Output your response as 3 consecutive file blocks separated by the exact delimiter \`--- FILE: <filename> ---\`. Example:

--- FILE: codebase.instructions.md ---
(frontmatter + content)

--- FILE: patterns.instructions.md ---
(frontmatter + content)

--- FILE: testing.instructions.md ---
(frontmatter + content)

**FILE 1: codebase.instructions.md**
\`\`\`yaml
---
applyTo: "**"
---
\`\`\`
Repository-wide instructions covering:
- Project overview in 2-3 sentences (what it does, what stack)
- Directory structure with purpose of each top-level directory
- Build, test, lint, typecheck commands (exact commands, not descriptions)
- Module system (ESM/CJS, import conventions, path aliases)
- Key entry points and their roles
- Dependency management rules (where deps go, what package manager)
- File naming conventions (kebab-case, PascalCase, etc.)
- Error handling patterns used in this codebase (with file path examples)
- Logging approach
- Configuration patterns (env vars, config files)

**FILE 2: patterns.instructions.md**
\`\`\`yaml
---
applyTo: "**"
---
\`\`\`
Code patterns and conventions:
- Naming conventions for variables, functions, types, interfaces, constants
- Import ordering rules (built-in, external, internal, relative)
- Export patterns (named vs default, barrel files)
- Type patterns (discriminated unions, branded types, utility types used)
- State management patterns (if applicable)
- API patterns (request/response shapes, error responses)
- Code organization within files (ordering of exports, methods, etc.)
- Comment conventions (when to comment, style)
- Specific anti-patterns to avoid in this codebase
- Reference 3-5 exemplary files that demonstrate these patterns

**FILE 3: testing.instructions.md**
\`\`\`yaml
---
applyTo: "**/*.test.*"
---
\`\`\`
Testing conventions:
- Test framework and assertion library
- Test file location and naming (\`*.test.ts\`, \`__tests__/\`, etc.)
- Test structure patterns (describe/it nesting, setup/teardown)
- Mocking patterns (what's mocked, how, which libraries)
- Test data patterns (fixtures, factories, builders)
- What to test and what not to test
- Coverage expectations
- Integration vs unit test conventions
- Reference 2-3 exemplary test files

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the repository. Read at least 10 source files and all config files.
2. Every claim must be based on actual files you read. Reference file paths.
3. Be extremely specific — use actual names, paths, and patterns from the codebase.
4. Do NOT include generic advice. Every instruction must be specific to THIS repository.
5. Keep each file under 150 lines. Dense and precise, not verbose.
6. Use imperative mood ("Use X", "Follow Y", "Never Z") — these are instructions, not documentation.`;

export class PrepareEngine {
  private readonly sessions: SessionManager;

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
    this.logger.info("🔧 Preparing Copilot instructions...");

    const phases = [{ phase: "prepare-analyze" }, { phase: "prepare-generate" }];
    this.tracker?.initPhases(phases);

    // Phase 1: Ensure we have a repo analysis
    const analyzeKey = "prepare-analyze-0";
    this.tracker?.activatePhase(analyzeKey);

    let repoAnalysis = loadRepoAnalysis(this.config);
    if (!repoAnalysis) {
      const cached = getCachedAnalysis(this.config.repoRoot);
      if (cached) {
        repoAnalysis = cached;
      }
    }

    if (!repoAnalysis) {
      this.logger.info("📂 No existing analysis found — running analysis first...");
      const { AnalysisEngine } = await import("./analysis-engine.js");
      const analyzer = new AnalysisEngine(this.config, this.pipeline, this.logger);
      await analyzer.start();
      await analyzer.execute();
      await analyzer.stop();
      repoAnalysis = loadRepoAnalysis(this.config) ?? "";
    }

    this.tracker?.completePhase(analyzeKey);

    // Phase 2: Generate instruction files
    const genKey = "prepare-generate-1";
    this.tracker?.activatePhase(genKey);

    const scout = await scoutRepo(this.config.repoRoot);
    const scoutContext = `Repository has ${scout.totalFiles} files across ${scout.topLevelDirs.length} directories.`;

    const prompt =
      `## Repository Analysis\n\n${repoAnalysis}\n\n## Scout Overview\n\n${scoutContext}\n\n` +
      "Generate the 3 instruction files as specified in your instructions. " +
      "Explore the repository yourself to verify and enrich the analysis. " +
      "Be extremely specific to this codebase.";

    const response = await this.sessions.callIsolatedWithInstructions(
      PREPARE_INSTRUCTIONS,
      prompt,
      "Generating Copilot instructions…",
      this.pipeline.primaryModel,
      "prepare/generate",
      "prepare",
    );

    // Parse and write instruction files
    const files = this.parseInstructionFiles(response);
    const outDir = path.join(this.config.repoRoot, INSTRUCTIONS_DIR);
    await fs.mkdir(outDir, { recursive: true });

    for (const file of files) {
      const filePath = path.join(outDir, file.name);
      await fs.writeFile(filePath, file.content, "utf-8");
      this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)}`);
    }

    this.tracker?.completePhase(genKey);
    this.logger.info(`✅ Copilot instructions written to ${INSTRUCTIONS_DIR}/`);
  }

  private parseInstructionFiles(response: string): { name: string; content: string }[] {
    const files: { name: string; content: string }[] = [];
    const delimiter = /^--- FILE: (.+?) ---$/gm;
    const parts = response.split(delimiter);

    // parts: [preamble, filename1, content1, filename2, content2, ...]
    for (let i = 1; i < parts.length - 1; i += 2) {
      const name = parts[i].trim();
      const content = parts[i + 1].trim();
      if (name && content) {
        files.push({ name, content });
      }
    }

    // Fallback: if parsing failed, write the whole response as a single file
    if (files.length === 0 && response.trim().length > 0) {
      files.push({ name: "codebase.instructions.md", content: response.trim() });
    }

    return files;
  }
}
