/**
 * PrepareEngine — generates Copilot instruction files for a repository.
 * Runs a deep analysis focused on patterns, conventions, and structure,
 * then outputs machine-readable instruction files to `.github/instructions/`.
 */
import { execSync } from "node:child_process";
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

const MAX_PARALLEL_DIRS = 10;

const PREPARE_DEEP_THRESHOLD = Number.parseInt(process.env.PREPARE_DEEP_THRESHOLD ?? "10", 10);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".cs",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".vue",
  ".svelte",
]);

interface GroupInfo {
  group: string;
  files: string[];
  description: string;
}

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

const PREPARE_SCOUT_INSTRUCTIONS = `You are a Senior Software Architect analyzing the structure of a directory to identify its logical groups/topics.
Your output will be parsed as JSON by a program. You must output ONLY valid JSON with no surrounding text, markdown, or code fences.

You will receive a directory path and a list of source files. Your job is to study the files and identify the logical groups or topics within this directory.

**Your task:** Output a JSON array of group objects. Each group represents a cohesive set of files that belong together conceptually.

Example output (output ONLY the JSON, no markdown fences):
[
  { "group": "engines", "files": ["pipeline-engine.ts", "analysis-engine.ts", "fleet-engine.ts"], "description": "Core execution engines that orchestrate agent workflows" },
  { "group": "configuration", "files": ["config.ts", "pipeline-config.ts", "pipeline-types.ts"], "description": "Configuration parsing, validation, and type definitions" }
]

**Grouping guidelines:**
- Each group should have a short, descriptive kebab-case name (1-3 words)
- Every source file must appear in exactly one group
- Aim for 2-6 groups (merge tiny topics, split huge ones)
- Group by conceptual cohesion: files that work together to deliver a feature/capability
- Test files should be grouped with their corresponding source files
- Type/interface-only files go with the group that consumes them most

**Rules:**
1. Use \`view\`, \`glob\`, \`grep\`, and \`bash\` to explore the directory. Read file headers, imports, and exports to understand relationships.
2. Output ONLY the JSON array — no explanations, no markdown, no code fences.
3. Every file from the provided list MUST appear in exactly one group.`;

const PREPARE_SECTION_INSTRUCTIONS = `You are a Senior Software Architect producing a documentation section for a specific group of related files within a module.
Your output will be consumed by GitHub Copilot (an AI coding assistant), NOT by humans. Optimize for machine readability and actionable precision.

You will receive a group name, description, file list, and the directory context. Your job is to deeply analyze these specific files and produce a focused section of an instruction file.

**Your task:** Output a single markdown section (NO frontmatter, NO file delimiters). Start with a level-2 heading (## Group Name) and write dense, actionable content.

Example output:
## Engines

Core execution engines that orchestrate multi-agent workflows through structured phases...

(dense content about architecture, patterns, invariants, etc.)

**Content requirements — deep architectural analysis of this group:**
- Group purpose: What capability these files deliver together (2-3 sentences)
- Architecture: Internal structure, layers, inheritance/composition hierarchies
- Key abstractions: Core types, interfaces, classes — their roles and contracts
- Lifecycle: How objects are created, used, and destroyed (if applicable)
- Data flow: How data moves through these files (input → processing → output)
- Relationships: Dependencies on other groups/modules, shared interfaces, event contracts
- Design patterns: Specific patterns used (factory, strategy, observer, state machine, etc.)
- Extension points: How to add new functionality (new engines, new strategies, etc.)
- Invariants: Rules that must hold (e.g., "always call destroy in finally", "never mutate config after init")
- Error handling: How errors propagate, retry logic, fallback behavior
- Common pitfalls: Mistakes that are easy to make, non-obvious coupling, ordering requirements
- Reference the most important 2-4 files with brief explanations of their roles

**Rules:**
1. Use \`view\`, \`glob\`, \`grep\`, and \`bash\` to explore the files deeply. Read ALL files in your assigned group.
2. Every claim must be based on actual code you read. Reference file paths and line numbers.
3. Be extremely specific — use actual names, paths, and patterns from the code.
4. Do NOT include generic advice. Every instruction must be specific to THESE files.
5. Keep the section under 80 lines. Dense and precise, not verbose.
6. Use imperative mood ("Use X", "Follow Y", "Never Z") — these are instructions, not documentation.
7. Output ONLY the markdown section (starting with ##). No YAML frontmatter, no file delimiters, no preamble. The caller will assemble sections into a complete file.`;

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

    const generateForDir = async (subdir: string, i: number): Promise<void> => {
      const phaseKey = `prepare-dir-${subdir}-${i}`;
      this.tracker?.activatePhase(phaseKey);

      const dirRelPath = path.join(relativeBase, subdir);
      const dirAbsPath = path.join(resolvedDir, subdir);
      const sourceFileCount = this.countSourceFiles(dirAbsPath);

      if (sourceFileCount > PREPARE_DEEP_THRESHOLD) {
        this.logger.info(`  🔬 Deep analysis for ${dirRelPath}/ (${sourceFileCount} source files)…`);
        await this.executeDeepDir(dirRelPath, dirAbsPath, outDir, repoAnalysis ?? "");
      } else {
        await this.executeSimpleDir(dirRelPath, outDir, repoAnalysis ?? "");
      }

      this.tracker?.completePhase(phaseKey);
    };

    // Run in parallel batches capped at MAX_PARALLEL_DIRS
    for (let batch = 0; batch < subdirs.length; batch += MAX_PARALLEL_DIRS) {
      const slice = subdirs.slice(batch, batch + MAX_PARALLEL_DIRS);
      await Promise.allSettled(slice.map((subdir, j) => generateForDir(subdir, batch + j)));
    }

    this.logger.info(`✅ Per-directory instructions written to ${INSTRUCTIONS_DIR}/`);
  }

  private async executeSimpleDir(dirRelPath: string, outDir: string, repoAnalysis: string): Promise<void> {
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
      `prepare/dirs/${dirRelPath}`,
      `prepare-${dirRelPath.replace(/\//g, "-")}`,
      true,
    );

    const parsed = this.parseInstructionFiles(response);
    const file = parsed[0];
    if (file) {
      const filePath = path.join(outDir, fileName);
      await fs.writeFile(filePath, file.content, "utf-8");
      this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)}`);
    }
  }

  private async executeDeepDir(
    dirRelPath: string,
    dirAbsPath: string,
    outDir: string,
    repoAnalysis: string,
  ): Promise<void> {
    // Check if directory has subdirectories
    const entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
    const subdirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .sort();

    if (subdirs.length > 0) {
      await this.executeDeepWithSubdirs(dirRelPath, dirAbsPath, subdirs, outDir, repoAnalysis);
    } else {
      await this.executeDeepFlat(dirRelPath, dirAbsPath, outDir, repoAnalysis);
    }
  }

  /**
   * Strategy 1: Directory has subdirectories — generate per-subdirectory files with precise globs.
   * Root-level files get an overview file with a non-recursive glob.
   */
  private async executeDeepWithSubdirs(
    dirRelPath: string,
    dirAbsPath: string,
    subdirs: string[],
    outDir: string,
    repoAnalysis: string,
  ): Promise<void> {
    this.logger.info(`  📂 Splitting by ${subdirs.length} subdirectories in ${dirRelPath}/`);

    // Check for root-level files (not in any subdirectory)
    const allFiles = this.listSourceFiles(dirAbsPath);
    const rootFiles = allFiles.filter((f) => !f.includes("/"));

    const tasks: Promise<void>[] = [];

    // Generate one instruction file per subdirectory
    for (const subdir of subdirs) {
      const subdirRelPath = `${dirRelPath}/${subdir}`;
      const applyTo = `${subdirRelPath}/**`;
      const fileName = `${subdirRelPath.replace(/\//g, "-")}.instructions.md`;

      const subdirFiles = this.listSourceFiles(path.join(dirAbsPath, subdir));
      if (subdirFiles.length === 0) continue;

      const prompt =
        `## Target Directory\n\nPath: \`${subdirRelPath}/\`\nApplyTo glob: \`${applyTo}\`\n` +
        `Source files (${subdirFiles.length}): ${subdirFiles.slice(0, 20).join(", ")}${subdirFiles.length > 20 ? "…" : ""}\n\n` +
        (repoAnalysis ? `## Repository Analysis (for context)\n\n${repoAnalysis}\n\n` : "") +
        `Generate the instruction file for this directory. The filename should be \`${fileName}\`.\n` +
        `The YAML frontmatter must use \`applyTo: "${applyTo}"\`.\n` +
        "Explore the directory thoroughly to understand its architecture, concepts, and design patterns. " +
        "Focus on what a developer needs to know to work effectively in this module.";

      tasks.push(
        this.sessions
          .callIsolatedWithInstructions(
            PREPARE_DIRS_INSTRUCTIONS,
            prompt,
            `Analyzing ${subdirRelPath}/…`,
            this.pipeline.primaryModel,
            `prepare/subdir/${subdirRelPath}`,
            `prepare-${subdirRelPath.replace(/\//g, "-")}`,
            true,
          )
          .then(async (response) => {
            const parsed = this.parseInstructionFiles(response);
            const file = parsed[0];
            if (file) {
              const filePath = path.join(outDir, fileName);
              await fs.writeFile(filePath, file.content, "utf-8");
              this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)}`);
            }
          }),
      );
    }

    // Generate overview file for root-level files (non-recursive glob)
    if (rootFiles.length > 0) {
      const applyTo = `${dirRelPath}/*`;
      const fileName = `${dirRelPath.replace(/\//g, "-")}.instructions.md`;

      const prompt =
        `## Target Directory (root-level files only)\n\nPath: \`${dirRelPath}/\`\nApplyTo glob: \`${applyTo}\` (non-recursive — root files only)\n` +
        `Root-level source files (${rootFiles.length}): ${rootFiles.join(", ")}\n\n` +
        (repoAnalysis ? `## Repository Analysis (for context)\n\n${repoAnalysis}\n\n` : "") +
        `Generate the instruction file for the root-level files in this directory (NOT files in subdirectories). The filename should be \`${fileName}\`.\n` +
        `The YAML frontmatter must use \`applyTo: "${applyTo}"\`.\n` +
        "Focus on the files directly in this directory. These are typically entry points, shared utilities, or configuration. " +
        "Explain their roles and how they relate to the subdirectories.";

      tasks.push(
        this.sessions
          .callIsolatedWithInstructions(
            PREPARE_DIRS_INSTRUCTIONS,
            prompt,
            `Analyzing ${dirRelPath}/ root files…`,
            this.pipeline.primaryModel,
            `prepare/subdir/${dirRelPath}-root`,
            `prepare-${dirRelPath.replace(/\//g, "-")}-root`,
            true,
          )
          .then(async (response) => {
            const parsed = this.parseInstructionFiles(response);
            const file = parsed[0];
            if (file) {
              const filePath = path.join(outDir, fileName);
              await fs.writeFile(filePath, file.content, "utf-8");
              this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)}`);
            }
          }),
      );
    }

    await Promise.allSettled(tasks);
  }

  /**
   * Strategy 2: Flat directory (no subdirectories) — scout identifies topic groups,
   * parallel agents analyze deeply, but all outputs merge into ONE consolidated file.
   */
  private async executeDeepFlat(
    dirRelPath: string,
    dirAbsPath: string,
    outDir: string,
    repoAnalysis: string,
  ): Promise<void> {
    const sourceFiles = this.listSourceFiles(dirAbsPath);

    // Phase 1: Scout — identify logical groups
    const scoutPrompt =
      `## Target Directory\n\nPath: \`${dirRelPath}/\`\n\n` +
      `## Source Files (${sourceFiles.length} files)\n\n${sourceFiles.map((f) => `- ${f}`).join("\n")}\n\n` +
      "Analyze these files and identify the logical groups/topics within this directory. " +
      "Read file headers, imports, and exports to understand how files relate to each other. " +
      "Output ONLY a JSON array of group objects as specified in your instructions.";

    const scoutResponse = await this.sessions.callIsolatedWithInstructions(
      PREPARE_SCOUT_INSTRUCTIONS,
      scoutPrompt,
      `Scouting ${dirRelPath}/…`,
      this.pipeline.fastModel,
      `prepare/scout/${dirRelPath}`,
      `scout-${dirRelPath.replace(/\//g, "-")}`,
      true,
    );

    const groups = this.parseGroups(scoutResponse);
    if (groups.length === 0) {
      this.logger.warn(`  ⚠️ Scout failed to identify groups for ${dirRelPath}/ — falling back to simple analysis`);
      await this.executeSimpleDir(dirRelPath, outDir, repoAnalysis);
      return;
    }

    this.logger.info(
      `  📋 Identified ${groups.length} groups in ${dirRelPath}/: ${groups.map((g) => g.group).join(", ")}`,
    );

    // Phase 2: Parallel group agents — each produces a markdown SECTION (not a file)
    const sectionResults = await Promise.allSettled(
      groups.map((group) => {
        const prompt =
          `## Group: ${group.group}\n\n` +
          `**Description:** ${group.description}\n\n` +
          `**Directory:** \`${dirRelPath}/\`\n\n` +
          `**Files in this group:**\n${group.files.map((f) => `- \`${dirRelPath}/${f}\``).join("\n")}\n\n` +
          (repoAnalysis ? `## Repository Analysis (for context)\n\n${repoAnalysis}\n\n` : "") +
          "Produce a detailed markdown section for this group. " +
          "Read ALL files in your assigned group deeply. Focus on how these files work together " +
          "and what a developer must understand to modify them correctly.";

        return this.sessions
          .callIsolatedWithInstructions(
            PREPARE_SECTION_INSTRUCTIONS,
            prompt,
            `Analyzing ${dirRelPath}/${group.group}…`,
            this.pipeline.primaryModel,
            `prepare/group/${dirRelPath}/${group.group}`,
            `group-${group.group}`,
            true,
          )
          .then((response) => ({ group: group.group, content: response.trim() }));
      }),
    );

    // Merge sections into one consolidated file
    const sections = sectionResults
      .filter((r): r is PromiseFulfilledResult<{ group: string; content: string }> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((s) => s.content.length > 0);

    if (sections.length === 0) {
      this.logger.warn(`  ⚠️ No group sections produced for ${dirRelPath}/ — falling back to simple analysis`);
      await this.executeSimpleDir(dirRelPath, outDir, repoAnalysis);
      return;
    }

    const applyTo = `${dirRelPath}/**`;
    const fileName = `${dirRelPath.replace(/\//g, "-")}.instructions.md`;
    const frontmatter = `---\napplyTo: "${applyTo}"\n---\n\n`;
    const content = frontmatter + sections.map((s) => s.content).join("\n\n---\n\n");

    const filePath = path.join(outDir, fileName);
    await fs.writeFile(filePath, content, "utf-8");
    this.logger.info(`  ✅ ${path.relative(this.config.repoRoot, filePath)} (${sections.length} sections)`);
  }

  private countSourceFiles(dirAbsPath: string): number {
    return this.listSourceFiles(dirAbsPath).length;
  }

  private listSourceFiles(dirAbsPath: string): string[] {
    try {
      const raw = execSync(`git ls-files -- "${dirAbsPath}"`, {
        cwd: this.config.repoRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      const relToDir = path.relative(this.config.repoRoot, dirAbsPath);
      return raw
        .split("\n")
        .filter(Boolean)
        .map((f) => (relToDir ? f.replace(`${relToDir}/`, "") : f))
        .filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return SOURCE_EXTENSIONS.has(ext);
        });
    } catch {
      return [];
    }
  }

  private parseGroups(response: string): GroupInfo[] {
    try {
      // Extract JSON from response (handle possible markdown fences)
      let json = response.trim();
      const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) json = fenceMatch[1].trim();

      const parsed = JSON.parse(json) as unknown[];
      if (!Array.isArray(parsed)) return [];

      const groups: GroupInfo[] = [];
      for (const item of parsed) {
        if (
          typeof item === "object" &&
          item !== null &&
          "group" in item &&
          "files" in item &&
          "description" in item &&
          typeof (item as GroupInfo).group === "string" &&
          Array.isArray((item as GroupInfo).files) &&
          typeof (item as GroupInfo).description === "string"
        ) {
          groups.push(item as GroupInfo);
        }
      }

      // Validate: at least 2 groups with files
      if (groups.length < 2) return [];
      if (groups.some((g) => g.files.length === 0)) return [];

      return groups;
    } catch {
      return [];
    }
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
