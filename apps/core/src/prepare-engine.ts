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
1. Use \`view\`, \`glob\`, \`grep\`, and \`bash\` to explore the repository. Read at least 10 source files and all config files.
2. Every claim must be based on actual files you read. Reference file paths.
3. Be extremely specific — use actual names, paths, and patterns from the codebase.
4. Do NOT include generic advice. Every instruction must be specific to THIS repository.
5. Keep each file under 150 lines. Dense and precise, not verbose.
6. Use imperative mood ("Use X", "Follow Y", "Never Z") — these are instructions, not documentation.
7. Output ALL file content directly in your text response using the \`--- FILE: <filename> ---\` delimiters. Do NOT use the \`create\` or \`edit\` tools to write files — the caller handles file creation from your text output.`;

const PREPARE_DIRS_INSTRUCTIONS = `You are a Senior Software Architect producing a Copilot instruction file for a specific directory/module in a repository.
Your output will be consumed by GitHub Copilot (an AI coding assistant), NOT by humans. Optimize for machine readability and actionable precision.

You will receive a directory path and a repository analysis. Your job is to deeply understand the architecture, concepts, and design of that specific directory/module.

**Your task:** Generate EXACTLY 1 instruction file for the given directory. The file must start with a YAML frontmatter block and contain dense, actionable instructions.

Output your response as a single file block starting with the exact delimiter \`--- FILE: <filename> ---\`. Example:

--- FILE: src-auth.instructions.md ---
(frontmatter + content)

**Content requirements — focus on CONCEPTS and ARCHITECTURE:**
- Module purpose: What this module does and why it exists (2-3 sentences)
- Architecture: How the module is structured internally (layers, components, data flow)
- Key abstractions: Core types, interfaces, classes, and their roles
- Relationships: How this module relates to other modules (dependencies, consumers, shared contracts)
- Design patterns: Specific patterns used (factory, strategy, observer, etc.) with file references
- Data flow: How data enters, transforms, and exits this module
- Extension points: How to add new functionality (where to add files, what interfaces to implement)
- Invariants: Rules that must always hold (e.g., "every engine must call destroySession in finally blocks")
- Common pitfalls: What mistakes are easy to make when modifying this module
- Reference 3-5 key files that are essential to understanding this module

**Rules:**
1. Use \`view\`, \`glob\`, \`grep\`, and \`bash\` to explore the directory thoroughly. Read ALL source files in the directory.
2. Every claim must be based on actual files you read. Reference file paths.
3. Be extremely specific — use actual names, paths, and patterns from the codebase.
4. Do NOT include generic advice. Every instruction must be specific to THIS directory.
5. Keep the file under 150 lines. Dense and precise, not verbose.
6. Use imperative mood ("Use X", "Follow Y", "Never Z") — these are instructions, not documentation.
7. Output ALL file content directly in your text response using the \`--- FILE: <filename> ---\` delimiter. Do NOT use the \`create\` or \`edit\` tools to write files — the caller handles file creation from your text output.`;

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
      true,
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

  async executeDirs(targetDir: string): Promise<void> {
    const resolvedDir = path.isAbsolute(targetDir) ? targetDir : path.join(this.config.repoRoot, targetDir);

    // Verify directory exists
    const stat = await fs.stat(resolvedDir).catch(() => null);
    if (!stat?.isDirectory()) {
      this.logger.error(`Error: "${targetDir}" is not a directory.`);
      return;
    }

    // Scan immediate subdirectories
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    const subdirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .sort();

    if (subdirs.length === 0) {
      this.logger.info(`No subdirectories found in "${targetDir}".`);
      return;
    }

    this.logger.info(
      `🔧 Generating per-directory instruction files for ${subdirs.length} subdirectories in "${targetDir}"...`,
    );

    const phases = subdirs.map((d) => ({ phase: `prepare-dir-${d}` }));
    this.tracker?.initPhases(phases);

    // Load repo analysis for context
    let repoAnalysis = loadRepoAnalysis(this.config);
    if (!repoAnalysis) {
      const cached = getCachedAnalysis(this.config.repoRoot);
      if (cached) repoAnalysis = cached;
    }

    const outDir = path.join(this.config.repoRoot, INSTRUCTIONS_DIR);
    await fs.mkdir(outDir, { recursive: true });

    // Relative path from repo root for applyTo globs
    const relativeBase = path.relative(this.config.repoRoot, resolvedDir);

    for (let i = 0; i < subdirs.length; i++) {
      const subdir = subdirs[i];
      const phaseKey = `prepare-dir-${subdir}-${i}`;
      this.tracker?.activatePhase(phaseKey);

      const dirRelPath = path.join(relativeBase, subdir);
      const applyTo = `${dirRelPath}/**`;
      const fileName = `${dirRelPath.replace(/\//g, "-")}.instructions.md`;

      const prompt =
        `## Target Directory\n\nPath: \`${dirRelPath}/\`\nApplyTo glob: \`${applyTo}\`\n\n` +
        (repoAnalysis ? `## Repository Analysis (for context)\n\n${repoAnalysis}\n\n` : "") +
        `Generate the instruction file for this directory. The filename should be \`${fileName}\`.\n` +
        `The YAML frontmatter must use \`applyTo: "${applyTo}"\`.\n` +
        "Explore the directory thoroughly to understand its architecture, concepts, and design patterns. " +
        "Focus on what a developer needs to know to work effectively in this module.";

      const response = await this.sessions.callIsolatedWithInstructions(
        PREPARE_DIRS_INSTRUCTIONS,
        prompt,
        `Analyzing ${dirRelPath}/…`,
        this.pipeline.primaryModel,
        `prepare/dirs/${subdir}`,
        `prepare-${subdir}`,
        true,
      );

      const parsed = this.parseInstructionFiles(response);
      const file = parsed[0];
      if (file) {
        // Use the expected filename regardless of what the agent returned
        const filePath = path.join(outDir, fileName);
        await fs.writeFile(filePath, file.content, "utf-8");
        this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)}`);
      }

      this.tracker?.completePhase(phaseKey);
    }

    this.logger.info(`✅ Per-directory instructions written to ${INSTRUCTIONS_DIR}/`);
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
