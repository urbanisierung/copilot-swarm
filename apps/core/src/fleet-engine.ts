/**
 * FleetEngine — meta-orchestrator for cross-repo feature implementation.
 * Coordinates independent swarm instances across multiple repositories:
 *   1. Analyze all repos in parallel
 *   2. Interactive planning (fleet plan) or autonomous strategize (fleet run)
 *   3. Execute waves: repos in each wave run in parallel via child `swarm task` processes
 *   4. Cross-repo reviewer validates consistency
 */
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCachedAnalysis } from "./analysis-cache.js";
import type { SwarmConfig } from "./config.js";
import type { FleetCheckpoint, FleetConfig, FleetDependency, FleetRepoTasks, FleetStrategy } from "./fleet-types.js";
import type { Logger } from "./logger.js";
import { loadPipelineConfig } from "./pipeline-config.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { openSplitEditor } from "./textarea.js";
import type { TuiRenderer } from "./tui-renderer.js";
import { responseContains } from "./utils.js";

const FLEET_CHECKPOINT_FILE = "fleet-checkpoint.json";
const FLEET_APPROVED_KEYWORD = "FLEET_APPROVED";
const MAX_CLARIFICATION_ROUNDS = 10;
const REQUIREMENTS_CLEAR = "REQUIREMENTS_CLEAR";
const ENGINEERING_CLEAR = "ENGINEERING_CLEAR";

const FLEET_PM_INSTRUCTIONS = `You are a Senior Product Manager conducting a requirements clarification session for a CROSS-REPOSITORY feature.
Multiple repositories are involved, each with a different role. Your goal is to fully understand the user's request across all repos before any engineering work begins.

**Rules:**
1. Read the user's request and the analysis of each repository carefully.
2. Ask targeted clarifying questions about:
   - Scope boundaries: which repos need changes, which don't
   - Cross-repo contracts: API shapes, shared types, data flow between repos
   - Expected behavior and user flows that span multiple services
   - Priority and phasing: which repos should be implemented first
   - Edge cases at service boundaries (network errors, version mismatches)
3. Ask at most 3–5 questions at a time. Number them clearly.
4. After the user answers, assess whether you have enough information.
5. When you have sufficient clarity, respond with **REQUIREMENTS_CLEAR** on its own line, followed by a structured summary including:
   - Problem statement
   - Per-repo scope (what each repo needs to do)
   - Cross-repo contracts and data flow
   - Acceptance criteria (testable)
   - Edge cases and out-of-scope items`;

const FLEET_ENGINEER_INSTRUCTIONS = `You are a Senior Software Engineer reviewing requirements for a CROSS-REPOSITORY feature before implementation.
Multiple repositories are involved. Your goal is to identify and resolve technical ambiguities across repo boundaries.

**Rules:**
1. Review the requirements and repo analyses carefully.
2. Think about what you would need to know to implement this across all repos. Ask about:
   - API contracts between services (request/response shapes, authentication)
   - Shared types or interfaces that must be consistent across repos
   - Database schema changes and migration strategies
   - Deployment order and backward compatibility
   - Testing strategy across repos (integration tests, contract tests)
   - Error handling at service boundaries
3. Ask at most 3–5 focused questions at a time. Number them clearly.
4. When you have sufficient clarity, respond with **ENGINEERING_CLEAR** on its own line, followed by a summary of technical decisions and assumptions.`;

const FLEET_ARCHITECTURE_INSTRUCTIONS = `You are a Senior Software Architect mapping the cross-repository architecture of a multi-repo system.
You will receive individual analyses of several repositories. Your task is to produce a single architecture document that maps how these repos relate to each other.

**Your output must include:**
1. **System Overview** — What the overall system does. 2-3 sentences.
2. **Repository Map** — For each repo: purpose, tech stack, and role in the system.
3. **Dependency Graph** — Which repos depend on which. Include:
   - Direct code dependencies (npm/pip packages, shared libraries)
   - Runtime dependencies (API calls, message queues, shared databases)
   - Build-time dependencies (shared config, generated code)
4. **API Contracts & Data Flow** — How data moves between repos:
   - HTTP/gRPC endpoints that connect repos
   - Shared types or schemas
   - Event/message contracts
   - Database schemas accessed by multiple repos
5. **Shared Patterns** — Common patterns across repos:
   - Shared libraries or utilities
   - Common configuration approaches
   - Consistent naming conventions or divergences
6. **Deployment Topology** — How repos are deployed relative to each other:
   - Deployment order constraints
   - Shared infrastructure
   - Environment boundaries
7. **Cross-Cutting Concerns** — Auth, logging, monitoring, error handling patterns that span repos.
8. **Change Impact Matrix** — When repo X changes, which other repos are likely affected and why.

**Rules:**
- Be specific. Reference actual file paths, package names, and API endpoints.
- Use mermaid diagrams for the dependency graph and data flow.
- Keep the document under 300 lines. Dense and precise.
- Focus on relationships between repos, not internal details of each repo.`;

function fleetBaseDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg !== "" ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "copilot-swarm", "fleet");
}

function fleetOutputDir(config: SwarmConfig): string {
  return path.join(fleetBaseDir(), config.runId);
}

function checkpointPath(config: SwarmConfig): string {
  return path.join(fleetOutputDir(config), FLEET_CHECKPOINT_FILE);
}

function updateLatestPointer(config: SwarmConfig): void {
  const pointerPath = path.join(fleetBaseDir(), "latest");
  fs.mkdirSync(fleetBaseDir(), { recursive: true });
  fs.writeFileSync(pointerPath, config.runId, "utf-8");
}

function resolveSwarmBin(): string {
  // Prefer the locally built dist, fall back to npx
  const localBin = path.join(import.meta.dirname, "..", "dist", "index.js");
  if (fs.existsSync(localBin)) return `node ${localBin}`;
  return "npx @copilot-swarm/core";
}

export class FleetEngine {
  private sessions: SessionManager | null = null;

  constructor(
    private readonly config: SwarmConfig,
    private readonly fleetConfig: FleetConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
    private readonly renderer?: TuiRenderer,
  ) {}

  async start(): Promise<void> {
    const pipeline = loadPipelineConfig(this.config.repoRoot);
    this.sessions = new SessionManager(this.config, pipeline, this.logger);
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    if (this.sessions) {
      await this.sessions.stop();
      this.sessions = null;
    }
  }

  /**
   * Validate all repos are on their default branch, sync with remote, and create feature branches.
   * Fails early if any repo is not on its default branch, has uncommitted changes, or can't sync.
   */
  private prepareBranches(branchName: string): void {
    const repos = this.fleetConfig.repos;
    this.logger.info(`🌿 Preparing branch "${branchName}" in ${repos.length} repo(s)...`);

    // Phase 1: Validate all repos before making any changes
    const repoStates: { repoPath: string; defaultBranch: string }[] = [];

    for (const repo of repos) {
      const label = path.basename(repo.path);
      const git = (args: string) =>
        execSync(`git ${args}`, { cwd: repo.path, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

      // Detect default branch
      let defaultBranch: string;
      try {
        const ref = git("symbolic-ref refs/remotes/origin/HEAD");
        defaultBranch = ref.replace("refs/remotes/origin/", "");
      } catch {
        // Fallback: try common names
        try {
          git("rev-parse --verify refs/heads/main");
          defaultBranch = "main";
        } catch {
          try {
            git("rev-parse --verify refs/heads/master");
            defaultBranch = "master";
          } catch {
            throw new Error(`${label}: Cannot determine default branch. Run "git remote set-head origin --auto".`);
          }
        }
      }

      // Check current branch
      const currentBranch = git("rev-parse --abbrev-ref HEAD");
      if (currentBranch !== defaultBranch) {
        throw new Error(
          `${label}: Currently on branch "${currentBranch}", expected "${defaultBranch}". ` +
            `Switch to ${defaultBranch} before using --create-branch.`,
        );
      }

      // Check for uncommitted changes
      const status = git("status --porcelain");
      if (status) {
        throw new Error(`${label}: Has uncommitted changes. Commit or stash them before using --create-branch.`);
      }

      // Check if branch already exists
      try {
        git(`rev-parse --verify refs/heads/${branchName}`);
        throw new Error(`${label}: Branch "${branchName}" already exists.`);
      } catch (err) {
        // Branch doesn't exist — good (unless it's our own error)
        if (err instanceof Error && err.message.includes("already exists")) throw err;
      }

      repoStates.push({ repoPath: repo.path, defaultBranch });
    }

    // Phase 2: All validation passed — sync and create branches
    for (const { repoPath, defaultBranch } of repoStates) {
      const label = path.basename(repoPath);
      const git = (args: string) =>
        execSync(`git ${args}`, { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

      // Pull latest
      try {
        git(`pull --ff-only origin ${defaultBranch}`);
      } catch {
        throw new Error(`${label}: Cannot fast-forward ${defaultBranch} from origin. Resolve divergence manually.`);
      }

      // Create and checkout branch
      git(`checkout -b ${branchName}`);
      this.logger.info(`  ✅ ${label}: created branch "${branchName}"`);
    }

    this.logger.info(`🌿 All repos on branch "${branchName}"`);
  }

  private cleanupRepo(repoPath: string, branchName: string): void {
    const label = path.basename(repoPath);
    const git = (args: string) =>
      execSync(`git ${args}`, { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();

    let defaultBranch: string;
    try {
      const ref = git("symbolic-ref refs/remotes/origin/HEAD");
      defaultBranch = ref.replace("refs/remotes/origin/", "");
    } catch {
      try {
        git("rev-parse --verify refs/heads/main");
        defaultBranch = "main";
      } catch {
        try {
          git("rev-parse --verify refs/heads/master");
          defaultBranch = "master";
        } catch {
          this.logger.warn(`  ⚠️  ${label}: Cannot determine default branch — skipping`);
          return;
        }
      }
    }

    const currentBranch = git("rev-parse --abbrev-ref HEAD");

    if (currentBranch === branchName) {
      git("checkout -- .");
      git("clean -fd");
      git(`checkout ${defaultBranch}`);
    } else if (currentBranch !== defaultBranch) {
      git("checkout -- .");
      git("clean -fd");
      git(`checkout ${defaultBranch}`);
    }

    try {
      git(`branch -D ${branchName}`);
    } catch {
      // branch doesn't exist — fine
    }
  }

  private cleanupBranches(branchName: string): void {
    const repos = this.fleetConfig.repos;
    this.logger.info(`🧹 Cleaning up branch "${branchName}" in ${repos.length} repo(s)...`);

    for (const repo of repos) {
      const label = path.basename(repo.path);
      this.cleanupRepo(repo.path, branchName);
      this.logger.info(`  ✅ ${label}: cleaned up`);
    }

    this.logger.info(`🧹 Cleanup complete — all repos on their default branch`);
  }

  async execute(): Promise<void> {
    // Fleet cleanup mode: discard changes, switch to default branch, delete feature branch
    if (this.config.fleetMode === "cleanup") {
      if (!this.config.fleetBranch) {
        throw new Error("Branch name required for cleanup. Usage: swarm fleet cleanup <branch-name> ./repo1 ./repo2");
      }
      this.cleanupBranches(this.config.fleetBranch);
      return;
    }

    const outDir = fleetOutputDir(this.config);
    fs.mkdirSync(outDir, { recursive: true });

    const checkpoint = this.loadCheckpoint();
    const repos = this.fleetConfig.repos;

    // Build dynamic phase list for TUI
    const phases: { phase: string }[] = [];
    if (this.config.fleetBranch) phases.push({ phase: "fleet-branch" });
    phases.push({ phase: "fleet-analyze" });
    if (this.config.fleetMode !== "analyze" && this.config.fleetMode !== "architecture") {
      phases.push({ phase: "fleet-strategize" });
    }
    if (this.config.fleetMode === "architecture") {
      phases.push({ phase: "fleet-architecture" });
    }
    // Wave phases are added dynamically after strategy is known
    this.tracker?.initPhases(phases);
    this.renderer?.start();

    // Pre-phase: Create branches in all repos if requested
    if (this.config.fleetBranch && !checkpoint.completedPhases.includes("create-branch")) {
      const branchKey = this.phaseKey("fleet-branch");
      this.activatePhase(branchKey);
      this.prepareBranches(this.config.fleetBranch);
      this.completePhase(branchKey);
      checkpoint.completedPhases.push("create-branch");
      this.saveCheckpoint(checkpoint);
    } else if (this.config.fleetBranch) {
      this.skipPhase(this.phaseKey("fleet-branch"));
    }

    // Phase 1: Analyze all repos
    const analyzeKey = this.phaseKey("fleet-analyze");
    let analyses = checkpoint.analyses;
    if (!checkpoint.completedPhases.includes("analyze")) {
      this.activatePhase(analyzeKey);
      this.logger.info(`🔍 Analyzing ${repos.length} repositories...`);
      this.tracker?.initStreams(repos.map((r) => path.basename(r.path)));
      analyses = await this.analyzeAll();
      this.completePhase(analyzeKey);
      checkpoint.analyses = analyses;
      checkpoint.completedPhases.push("analyze");
      this.saveCheckpoint(checkpoint);
    } else {
      this.skipPhase(analyzeKey);
      this.logger.info("⏭️  Skipping analysis (completed in previous run)");
    }

    // Fleet analyze mode: stop after analysis
    if (this.config.fleetMode === "analyze") {
      const analysisPath = path.join(outDir, "fleet-analysis.md");
      fs.writeFileSync(analysisPath, this.formatAnalyses(analyses), "utf-8");
      this.logger.info(`✅ Fleet analysis complete — saved to ${analysisPath}`);
      updateLatestPointer(this.config);
      this.stopTui();
      return;
    }

    // Fleet architecture mode: synthesize cross-repo architecture doc
    if (this.config.fleetMode === "architecture") {
      await this.executeArchitecture(analyses, outDir);
      updateLatestPointer(this.config);
      this.stopTui();
      return;
    }

    // Phase 2: Plan / Strategize
    const stratKey = this.phaseKey("fleet-strategize");
    let strategy = checkpoint.strategy;
    if (this.config.fleetMode === "plan") {
      this.activatePhase(stratKey);
      this.stopTui(); // TUI must stop for interactive planning (needs stdin)
      const planResult = await this.interactivePlan(analyses, checkpoint);
      strategy = planResult;
      this.completePhase(stratKey);
    } else if (!checkpoint.completedPhases.includes("strategize")) {
      this.activatePhase(stratKey);
      this.tracker?.setActiveAgent("strategizing cross-repo plan…");
      this.logger.info("🧠 Strategist analyzing cross-repo dependencies...");
      strategy = await this.strategize(analyses);
      this.tracker?.setActiveAgent(null);
      this.completePhase(stratKey);
      checkpoint.strategy = strategy;
      checkpoint.completedPhases.push("strategize");
      this.saveCheckpoint(checkpoint);
    } else {
      this.skipPhase(stratKey);
      this.logger.info("⏭️  Skipping strategy (completed in previous run)");
    }

    if (!strategy) throw new Error("Strategy not produced — cannot continue");

    // Save strategy to output
    const strategyPath = path.join(outDir, "strategy.md");
    fs.writeFileSync(strategyPath, this.formatStrategy(strategy), "utf-8");
    this.logger.info(`📋 Strategy saved to ${strategyPath}`);

    // Auto-cleanup repos not included in any wave (nothing to do for them)
    if (this.config.fleetBranch) {
      const reposInWaves = new Set(strategy.waves.flat());
      const unusedRepos = this.fleetConfig.repos.filter((r) => !reposInWaves.has(r.path));
      if (unusedRepos.length > 0) {
        this.logger.info(`🧹 Auto-cleaning ${unusedRepos.length} repo(s) not needed by strategy...`);
        for (const repo of unusedRepos) {
          this.cleanupRepo(repo.path, this.config.fleetBranch);
          this.logger.info(`  ✅ ${path.basename(repo.path)}: no changes needed — branch cleaned up`);
        }
      }
    }

    // Fleet plan mode: stop after strategy
    if (this.config.fleetMode === "plan") {
      this.logger.info("✅ Fleet planning complete — review the strategy before running the full pipeline.");
      updateLatestPointer(this.config);
      return;
    }

    // Add wave + review + summary phases now that we know the wave count
    if (this.tracker) {
      const wavePhases = strategy.waves.map((_, i) => ({
        key: `fleet-wave-${i + 1}-${this.tracker!.phases.length + i}`,
        name: `Wave ${i + 1}`,
        status: "pending" as const,
      }));
      this.tracker.phases.push(
        ...wavePhases,
        {
          key: `fleet-review-${this.tracker.phases.length + wavePhases.length}`,
          name: "Cross-Repo Review",
          status: "pending" as const,
        },
        {
          key: `fleet-summary-${this.tracker.phases.length + wavePhases.length + 1}`,
          name: "Summary",
          status: "pending" as const,
        },
      );
    }

    // Phase 3: Execute waves
    if (!checkpoint.completedPhases.includes("execute")) {
      this.logger.info(`🚀 Executing ${strategy.waves.length} wave(s)...`);
      await this.executeWaves(strategy, checkpoint);
      checkpoint.completedPhases.push("execute");
      this.saveCheckpoint(checkpoint);
    } else {
      // Mark all wave phases as skipped
      for (let i = 0; i < strategy.waves.length; i++) {
        this.skipPhaseByName(`Wave ${i + 1}`);
      }
      this.logger.info("⏭️  Skipping execution (completed in previous run)");
    }

    // Phase 4: Cross-repo review
    const reviewKey = this.findPhaseKey("Cross-Repo Review");
    if (!checkpoint.completedPhases.includes("review")) {
      this.activatePhase(reviewKey);
      this.tracker?.setActiveAgent("cross-repo consistency check…");
      this.logger.info("🔎 Cross-repo reviewer checking consistency...");
      const reviewResult = await this.crossReview(strategy, checkpoint.waveResults);
      const reviewPath = path.join(outDir, "fleet-review.md");
      fs.writeFileSync(reviewPath, reviewResult, "utf-8");
      this.tracker?.setActiveAgent(null);
      this.completePhase(reviewKey);
      checkpoint.completedPhases.push("review");
      this.saveCheckpoint(checkpoint);
    } else {
      this.skipPhase(reviewKey);
      this.logger.info("⏭️  Skipping cross-repo review (completed in previous run)");
    }

    // Phase 5: Summary
    const summaryKey = this.findPhaseKey("Summary");
    this.activatePhase(summaryKey);
    const repoStats = this.computeRepoStats(checkpoint);
    const summaryPath = path.join(outDir, "fleet-summary.md");
    fs.writeFileSync(summaryPath, this.buildSummary(strategy, checkpoint, repoStats), "utf-8");
    this.completePhase(summaryKey);
    this.logger.info(
      `✅ Fleet completed — ${repoStats.checked} repo(s) checked, ${repoStats.touched} touched — summary at ${summaryPath}`,
    );
    updateLatestPointer(this.config);
    this.stopTui();
  }

  // --- Phase implementations ---

  private async analyzeAll(): Promise<Record<string, string>> {
    const analyses: Record<string, string> = {};
    const swarmBin = resolveSwarmBin();

    // Run all repo analyses truly in parallel using async spawn
    const promises = this.fleetConfig.repos.map(async (repo, idx) => {
      const label = path.basename(repo.path);

      // Check central analysis cache first
      const cached = getCachedAnalysis(repo.path);
      if (cached) {
        this.logger.info(`  📦 ${label} — using cached analysis`);
        this.tracker?.updateStream(idx, "done");
        this.tracker?.updateStreamDetail(idx, "Cached");
        analyses[repo.path] = cached;
        return;
      }

      this.logger.info(`  📂 Analyzing ${label}...`);
      this.tracker?.updateStream(idx, "engineering");
      this.tracker?.updateStreamDetail(idx, "Analyzing…");

      try {
        await this.runChildProcess(swarmBin, repo.path, "analyze --no-tui", 1_800_000);
        this.logger.info(`  ✅ ${label} analysis complete`);
        this.tracker?.updateStream(idx, "done");
        this.tracker?.updateStreamDetail(idx, "Complete");
      } catch (err) {
        this.logger.warn(`  ⚠️  Analysis failed for ${repo.path}: ${err instanceof Error ? err.message : String(err)}`);
        this.tracker?.updateStream(idx, "failed");
        this.tracker?.updateStreamDetail(idx, "Failed");
      }

      // Read the generated analysis (child process also saves to central cache)
      const cached2 = getCachedAnalysis(repo.path);
      if (cached2) {
        analyses[repo.path] = cached2;
        return;
      }

      const swarmDir = path.join(repo.path, ".swarm");
      const analysis = this.findAnalysisFile(swarmDir);

      if (analysis) {
        analyses[repo.path] = fs.readFileSync(analysis, "utf-8");
      } else {
        analyses[repo.path] = `Repository at ${repo.path} — no analysis available. Role: ${repo.role}`;
      }
    });

    await Promise.all(promises);
    return analyses;
  }

  /** Run a swarm CLI command in a child process (async, non-blocking). */
  private runChildProcess(swarmBin: string, cwd: string, args: string, timeout: number): Promise<string> {
    const cmd = `${swarmBin} ${args}`;
    return new Promise<string>((resolve, reject) => {
      const child = spawn("sh", ["-c", cmd], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr.slice(-500) || `exited with code ${code}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }

  private findAnalysisFile(swarmDir: string): string | null {
    if (!fs.existsSync(swarmDir)) return null;

    // Check sessions directories for analysis files
    const sessionsDir = path.join(swarmDir, "sessions");
    if (fs.existsSync(sessionsDir)) {
      try {
        const sessions = fs.readdirSync(sessionsDir);
        for (const sid of sessions.reverse()) {
          const candidate = path.join(sessionsDir, sid, "analysis", "repo-analysis.md");
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch {
        // ignore
      }
    }

    // Legacy path
    const legacy = path.join(swarmDir, "analysis", "repo-analysis.md");
    if (fs.existsSync(legacy)) return legacy;

    return null;
  }

  private buildRepoContexts(analyses: Record<string, string>): string {
    return this.fleetConfig.repos
      .map((repo) => {
        const analysis = analyses[repo.path] ?? "No analysis available.";
        return `### ${path.basename(repo.path)} (${repo.path})\n**Role:** ${repo.role}\n\n${analysis}`;
      })
      .join("\n\n---\n\n");
  }

  /**
   * Interactive planning flow: PM clarification → engineer clarification → strategize.
   * Used when `fleetMode === "plan"`.
   */
  private async interactivePlan(analyses: Record<string, string>, checkpoint: FleetCheckpoint): Promise<FleetStrategy> {
    if (!this.sessions) throw new Error("Sessions not initialized");

    const outDir = fleetOutputDir(this.config);
    const repoContexts = this.buildRepoContexts(analyses);
    if (!checkpoint.answeredQuestions) checkpoint.answeredQuestions = {};

    // Phase 2a: PM clarification
    let pmRequirements = checkpoint.pmRequirements ?? "";
    if (!checkpoint.completedPhases.includes("plan-pm")) {
      this.logger.info("📋 PM clarifying cross-repo requirements...");
      pmRequirements = await this.clarifyFleetRole(
        FLEET_PM_INSTRUCTIONS,
        REQUIREMENTS_CLEAR,
        `## Feature Request\n\n${this.config.issueBody}\n\n## Repository Analyses\n\n${repoContexts}`,
        "PM is analyzing cross-repo requirements…",
        "PM Questions",
        "plan-pm",
        checkpoint,
      );
      checkpoint.pmRequirements = pmRequirements;
      checkpoint.completedPhases.push("plan-pm");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping PM clarification (completed in previous run)");
    }

    // Phase 2b: Engineer clarification
    let engDecisions = checkpoint.engDecisions ?? "";
    if (!checkpoint.completedPhases.includes("plan-eng")) {
      this.logger.info("🔧 Engineer clarifying cross-repo technical details...");
      engDecisions = await this.clarifyFleetRole(
        FLEET_ENGINEER_INSTRUCTIONS,
        ENGINEERING_CLEAR,
        `## Refined Requirements\n\n${pmRequirements}\n\n## Repository Analyses\n\n${repoContexts}`,
        "Engineer is reviewing cross-repo requirements…",
        "Engineer Questions",
        "plan-eng",
        checkpoint,
      );
      checkpoint.engDecisions = engDecisions;
      checkpoint.completedPhases.push("plan-eng");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping engineer clarification (completed in previous run)");
    }

    // Phase 2c: Strategize (autonomous, with enriched context)
    let strategy = checkpoint.strategy;
    if (!checkpoint.completedPhases.includes("strategize")) {
      this.logger.info("🧠 Strategist producing cross-repo plan...");
      const enrichedPrompt =
        `## Feature Request\n\n${this.config.issueBody}\n\n` +
        `## Refined Requirements\n\n${pmRequirements}\n\n` +
        `## Engineering Decisions\n\n${engDecisions}\n\n` +
        `## Repository Analyses\n\n${repoContexts}\n\n` +
        "Produce a cross-repo strategy with shared contracts, per-repo tasks, dependencies, and execution waves.";

      const response = await this.sessions.callIsolated(
        "fleet-strategist",
        enrichedPrompt,
        undefined,
        "fleet-strategize",
      );
      strategy = this.parseStrategy(response);
      checkpoint.strategy = strategy;
      checkpoint.completedPhases.push("strategize");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping strategy (completed in previous run)");
    }

    if (!strategy) throw new Error("Strategy not produced");

    // Save strategy
    const strategyPath = path.join(outDir, "strategy.md");
    fs.writeFileSync(strategyPath, this.formatStrategy(strategy), "utf-8");
    this.logger.info(`📋 Strategy saved to ${strategyPath}`);

    // Save planning outputs
    const planPath = path.join(outDir, "fleet-plan.md");
    const planDoc =
      `# Fleet Plan\n\n` +
      `## Refined Requirements\n\n${pmRequirements}\n\n` +
      `## Engineering Decisions\n\n${engDecisions}\n`;
    fs.writeFileSync(planPath, planDoc, "utf-8");
    this.logger.info(`📋 Plan saved to ${planPath}`);

    this.logger.info("✅ Fleet planning complete — review the strategy and plan before running the full pipeline.");
    return strategy;
  }

  /**
   * Interactive clarification round for a fleet role (PM or engineer).
   * Agent asks questions, user answers via split editor, until the agent signals the keyword.
   */
  private async clarifyFleetRole(
    instructions: string,
    clearKeyword: string,
    context: string,
    spinnerLabel: string,
    contextTitle: string,
    phaseKey: string,
    checkpoint: FleetCheckpoint,
  ): Promise<string> {
    if (!this.sessions) throw new Error("Sessions not initialized");

    const session = await this.sessions.createSessionWithInstructions(instructions, undefined, phaseKey);
    this.sessions.recordSession(phaseKey, session, phaseKey, phaseKey);
    const savedQA = checkpoint.answeredQuestions?.[phaseKey] ?? [];
    let response = "";

    try {
      const initialPrompt =
        `${context}\n\n` +
        `Review this from your perspective. If everything is clear, respond with ${clearKeyword} followed by your summary. ` +
        "If you need more information, ask your clarifying questions.";

      if (savedQA.length > 0) {
        this.logger.info(`  ⏭️  Replaying ${savedQA.length} previously answered question(s)`);
        response = await this.sessions.send(session, initialPrompt, spinnerLabel);
        for (const qa of savedQA) {
          if (responseContains(response, clearKeyword)) break;
          response = await this.sessions.send(session, `User's answers:\n\n${qa.answer}`, spinnerLabel);
        }
      } else {
        response = await this.sessions.send(session, initialPrompt, spinnerLabel);
      }

      for (let round = savedQA.length; round < MAX_CLARIFICATION_ROUNDS; round++) {
        if (responseContains(response, clearKeyword)) break;

        // Non-interactive: auto-skip
        if (!process.stdin.isTTY) {
          this.logger.info("  ⚠️  Non-interactive environment — auto-answering questions");
          response = await this.sessions.send(
            session,
            `This is running in a non-interactive environment. Use your best judgment for all open questions. Respond with ${clearKeyword} followed by your summary.`,
            spinnerLabel,
          );
          break;
        }

        const answer = await openSplitEditor(response, {
          editorTitle: "Your Answer",
          contextTitle,
        });

        if (answer === undefined || !answer.trim()) {
          response = await this.sessions.send(
            session,
            `The user skipped. Use your best judgment for any open questions. Respond with ${clearKeyword} followed by your summary.`,
            spinnerLabel,
          );
        } else {
          if (!checkpoint.answeredQuestions) checkpoint.answeredQuestions = {};
          if (!checkpoint.answeredQuestions[phaseKey]) checkpoint.answeredQuestions[phaseKey] = [];
          checkpoint.answeredQuestions[phaseKey].push({ question: response, answer });
          this.saveCheckpoint(checkpoint);

          response = await this.sessions.send(session, `User's answers:\n\n${answer}`, spinnerLabel);
        }
      }
    } finally {
      await this.sessions.destroySession(session);
    }

    const idx = response.toUpperCase().indexOf(clearKeyword);
    const result = idx !== -1 ? response.substring(idx + clearKeyword.length).trim() : response;

    console.log(`\n${contextTitle.replace("Questions", "Summary")}:\n`);
    console.log(result);

    return result;
  }

  private async strategize(analyses: Record<string, string>): Promise<FleetStrategy> {
    if (!this.sessions) throw new Error("Sessions not initialized");

    const repoContexts = this.buildRepoContexts(analyses);
    const exactPaths = this.fleetConfig.repos.map((r) => r.path).join("\n- ");

    const prompt =
      `## Feature Request\n\n${this.config.issueBody}\n\n` +
      `## Available Repositories (ONLY use these exact paths)\n\n- ${exactPaths}\n\n` +
      `## Repository Analyses\n\n${repoContexts}\n\n` +
      "Produce a cross-repo strategy with shared contracts, per-repo tasks, dependencies, and execution waves.\n" +
      "IMPORTANT: In Per-Repo Tasks and Execution Waves, use ONLY the exact absolute paths listed above. Do not invent repos.";

    const response = await this.sessions.callIsolated("fleet-strategist", prompt, undefined, "fleet-strategize");

    return this.parseStrategy(response);
  }

  private parseStrategy(markdown: string): FleetStrategy {
    const repoTasks: FleetRepoTasks[] = [];
    const dependencies: FleetDependency[] = [];
    const waves: string[][] = [];
    let sharedContracts = "";

    // Extract shared contracts
    const contractsMatch = markdown.match(/## Shared Contracts\s*\n([\s\S]*?)(?=\n## |\n---|z)/);
    if (contractsMatch) {
      sharedContracts = contractsMatch[1].trim();
    }

    // Extract per-repo tasks
    const tasksSection = markdown.match(/## Per-Repo Tasks\s*\n([\s\S]*?)(?=\n## |z)/);
    if (tasksSection) {
      const repoMatches = tasksSection[1].matchAll(/### .+?\(path:\s*(.+?)\)\s*\n([\s\S]*?)(?=\n### |z)/g);
      for (const match of repoMatches) {
        repoTasks.push({ repoPath: match[1].trim(), tasks: match[2].trim() });
      }
    }

    // Extract dependencies
    const depsSection = markdown.match(/## Dependencies\s*\n([\s\S]*?)(?=\n## |z)/);
    if (depsSection) {
      const depLines = depsSection[1].matchAll(/- (.+?) → (.+?): (.+)/g);
      for (const match of depLines) {
        dependencies.push({ from: match[1].trim(), to: match[2].trim(), reason: match[3].trim() });
      }
    }

    // Extract execution waves
    const wavesSection = markdown.match(/## Execution Waves\s*\n([\s\S]*?)$/);
    if (wavesSection) {
      const waveBlocks = wavesSection[1].matchAll(/### Wave \d+.*?\n([\s\S]*?)(?=\n### Wave |z)/g);
      for (const block of waveBlocks) {
        const paths = block[1].matchAll(/- (.+)/g);
        const wavePaths: string[] = [];
        for (const p of paths) {
          wavePaths.push(p[1].trim());
        }
        if (wavePaths.length > 0) waves.push(wavePaths);
      }
    }

    // Fallback: if no waves parsed, put all repos in one wave
    if (waves.length === 0) {
      waves.push(this.fleetConfig.repos.map((r) => r.path));
    }

    // Validate and normalize all paths against actual fleet repos
    const resolvedWaves = waves
      .map((wave) => wave.map((entry) => this.resolveToFleetRepo(entry)).filter((p): p is string => p !== null))
      .filter((wave) => wave.length > 0);

    const resolvedTasks = repoTasks
      .map((rt) => {
        const resolved = this.resolveToFleetRepo(rt.repoPath);
        return resolved ? { ...rt, repoPath: resolved } : null;
      })
      .filter((rt): rt is FleetRepoTasks => rt !== null);

    return {
      sharedContracts,
      repoTasks: resolvedTasks,
      dependencies,
      waves: resolvedWaves.length > 0 ? resolvedWaves : [this.fleetConfig.repos.map((r) => r.path)],
    };
  }

  /** Map a potentially LLM-generated path/name back to an actual fleet repo path. */
  private resolveToFleetRepo(entry: string): string | null {
    const repos = this.fleetConfig.repos;

    // Direct match
    if (repos.some((r) => r.path === entry)) return entry;

    // Strip markdown formatting (backticks, parenthetical notes)
    const cleaned = entry
      .replace(/`/g, "")
      .replace(/\s*\(.*\)\s*$/, "")
      .trim();
    if (repos.some((r) => r.path === cleaned)) return cleaned;

    // Match by basename
    const match = repos.find(
      (r) => path.basename(r.path) === cleaned || path.basename(r.path) === path.basename(cleaned),
    );
    if (match) return match.path;

    this.logger.warn(`  ⚠️  Strategy referenced unknown repo "${entry}" — skipping`);
    return null;
  }

  private async executeWaves(strategy: FleetStrategy, checkpoint: FleetCheckpoint): Promise<void> {
    const swarmBin = resolveSwarmBin();
    let priorWaveContext = "";
    const maxRetries = this.config.maxRetries;

    for (let waveIdx = checkpoint.currentWave; waveIdx < strategy.waves.length; waveIdx++) {
      const wave = strategy.waves[waveIdx];
      const waveKey = this.findPhaseKey(`Wave ${waveIdx + 1}`);
      this.activatePhase(waveKey);
      this.logger.info(`\n  🌊 Wave ${waveIdx + 1}/${strategy.waves.length}: ${wave.length} repo(s)`);

      // Set up streams for repos in this wave
      this.tracker?.initStreams(wave.map((r) => path.basename(r)));

      if (!checkpoint.waveResults[waveIdx]) {
        checkpoint.waveResults[waveIdx] = {};
      }

      // Track per-repo retry counts
      if (!checkpoint.waveRetries) checkpoint.waveRetries = {};
      if (!checkpoint.waveRetries[waveIdx]) checkpoint.waveRetries[waveIdx] = {};

      // Run repos in this wave in parallel — failures don't abort other repos
      const runRepos = async (repos: string[]) => {
        const promises = repos.map(async (repoPath) => {
          const streamIdx = wave.indexOf(repoPath);
          if (
            checkpoint.waveResults[waveIdx][repoPath] &&
            !checkpoint.waveResults[waveIdx][repoPath].startsWith("FAILED:")
          ) {
            this.logger.info(`  ⏭️  ${path.basename(repoPath)} already completed`);
            this.tracker?.updateStream(streamIdx, "done");
            this.tracker?.updateStreamDetail(streamIdx, "Completed (prior run)");
            return;
          }

          const repoTask = strategy.repoTasks.find((rt) => rt.repoPath === repoPath);
          const taskPrompt = this.buildRepoPrompt(repoPath, repoTask, strategy.sharedContracts, priorWaveContext);

          this.logger.info(`  🔧 ${path.basename(repoPath)} starting...`);
          this.tracker?.updateStream(streamIdx, "engineering");
          this.tracker?.updateStreamDetail(streamIdx, "Running swarm task…");

          try {
            const result = await this.runSwarmTask(swarmBin, repoPath, taskPrompt);
            checkpoint.waveResults[waveIdx][repoPath] = result || "Completed (no summary)";
            this.logger.info(`  ✅ ${path.basename(repoPath)} completed`);
            this.tracker?.updateStream(streamIdx, "done");
            this.tracker?.updateStreamDetail(streamIdx, "Complete");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            checkpoint.waveResults[waveIdx][repoPath] = `FAILED: ${errMsg}`;
            this.logger.error(`  ❌ ${path.basename(repoPath)} failed: ${errMsg}`);
            this.tracker?.updateStream(streamIdx, "failed");
            this.tracker?.updateStreamDetail(streamIdx, errMsg.slice(0, 80));
          }

          this.saveCheckpoint(checkpoint);
        });

        await Promise.all(promises);
      };

      // Initial run
      await runRepos(wave);

      // Retry failed repos
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const failedRepos = wave.filter((r) => checkpoint.waveResults[waveIdx][r]?.startsWith("FAILED:"));
        if (failedRepos.length === 0) break;

        this.logger.info(
          `\n  🔄 Wave ${waveIdx + 1} retry ${attempt}/${maxRetries}: ${failedRepos.length} repo(s) failed, retrying...`,
        );

        for (const r of failedRepos) {
          checkpoint.waveRetries[waveIdx][r] = (checkpoint.waveRetries[waveIdx][r] ?? 0) + 1;
        }
        this.saveCheckpoint(checkpoint);

        await runRepos(failedRepos);
      }

      // Check if any repos still failed after all retries
      const stillFailed = wave.filter((r) => checkpoint.waveResults[waveIdx][r]?.startsWith("FAILED:"));
      if (stillFailed.length > 0) {
        const names = stillFailed.map((r) => path.basename(r)).join(", ");
        throw new Error(`Wave ${waveIdx + 1} failed after ${maxRetries} retries: ${names}`);
      }

      this.completePhase(waveKey);

      // Collect context for next wave
      priorWaveContext = Object.entries(checkpoint.waveResults[waveIdx])
        .map(([repo, result]) => `### ${path.basename(repo)}\n${result}`)
        .join("\n\n");

      checkpoint.currentWave = waveIdx + 1;
      this.saveCheckpoint(checkpoint);
    }
  }

  private buildRepoPrompt(
    _repoPath: string,
    repoTask: FleetRepoTasks | undefined,
    sharedContracts: string,
    priorWaveContext: string,
  ): string {
    const parts: string[] = [];
    parts.push(`## Feature Context\n\n${this.config.issueBody}`);

    if (sharedContracts) {
      parts.push(`## Shared Contracts (MUST adhere to these exactly)\n\n${sharedContracts}`);
    }

    if (repoTask) {
      parts.push(`## Tasks for This Repository\n\n${repoTask.tasks}`);
    }

    if (priorWaveContext) {
      parts.push(`## Prior Wave Results (for context)\n\n${priorWaveContext}`);
    }

    return parts.join("\n\n");
  }

  private async runSwarmTask(swarmBin: string, repoPath: string, prompt: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `fleet-${Date.now()}-${path.basename(repoPath)}.md`);
    fs.writeFileSync(tmpFile, prompt, "utf-8");

    const overrides = this.fleetConfig.overrides?.[repoPath];
    const verifyArgs: string[] = [];
    if (overrides?.verifyBuild) verifyArgs.push(`--verify-build "${overrides.verifyBuild}"`);
    if (overrides?.verifyTest) verifyArgs.push(`--verify-test "${overrides.verifyTest}"`);
    if (overrides?.verifyLint) verifyArgs.push(`--verify-lint "${overrides.verifyLint}"`);

    const args = `task --no-tui -f "${tmpFile}" ${verifyArgs.join(" ")}`.trim();

    try {
      return await this.runChildProcess(swarmBin, repoPath, args, 1_800_000);
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }

  private async crossReview(strategy: FleetStrategy, waveResults: Record<string, string>[]): Promise<string> {
    if (!this.sessions) throw new Error("Sessions not initialized");

    const allResults = waveResults
      .flatMap((wave, i) =>
        Object.entries(wave).map(([repo, result]) => `### Wave ${i + 1}: ${path.basename(repo)}\n${result}`),
      )
      .join("\n\n---\n\n");

    const prompt = `## Feature Request\n\n${this.config.issueBody}\n\n## Shared Contracts\n\n${strategy.sharedContracts}\n\n## Implementation Results\n\n${allResults}\n\nReview all changes for consistency across repos. Reply "${FLEET_APPROVED_KEYWORD}" if everything is consistent, or list issues.`;

    return this.sessions.callIsolated("fleet-reviewer", prompt, undefined, "fleet-review");
  }

  // --- Checkpoint ---

  private loadCheckpoint(): FleetCheckpoint {
    const cpPath = checkpointPath(this.config);
    if (this.config.resume && fs.existsSync(cpPath)) {
      try {
        return JSON.parse(fs.readFileSync(cpPath, "utf-8"));
      } catch {
        this.logger.warn("⚠️  Failed to load fleet checkpoint, starting fresh");
      }
    }
    return { completedPhases: [], analyses: {}, waveResults: [], currentWave: 0 };
  }

  private saveCheckpoint(checkpoint: FleetCheckpoint): void {
    const cpPath = checkpointPath(this.config);
    fs.mkdirSync(path.dirname(cpPath), { recursive: true });
    fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  // --- Formatting ---

  private async executeArchitecture(analyses: Record<string, string>, outDir: string): Promise<void> {
    if (!this.sessions) throw new Error("Sessions not started");

    const archKey = this.phaseKey("fleet-architecture");
    this.tracker?.activatePhase(archKey);
    this.tracker?.setActiveAgent("mapping cross-repo architecture…");
    this.logger.info("🏗️  Mapping cross-repo architecture...");

    const analysisContext = this.formatAnalyses(analyses);
    const prompt =
      `${analysisContext}\n\n---\n\n` +
      "Produce a comprehensive cross-repo architecture document based on the analyses above.";

    const architecture = await this.sessions.callIsolatedWithInstructions(
      FLEET_ARCHITECTURE_INSTRUCTIONS,
      prompt,
      "Mapping cross-repo architecture…",
      undefined,
      "fleet-architecture/synthesis",
      "architect",
    );

    this.tracker?.setActiveAgent(null);
    this.completePhase(archKey);

    // Save to fleet output dir (run-specific)
    const runPath = path.join(outDir, "architecture.md");
    fs.writeFileSync(runPath, architecture, "utf-8");
    this.logger.info(`📋 Architecture saved to ${runPath}`);

    // Also save to central fleet persistence
    const centralPath = path.join(fleetBaseDir(), "architecture.md");
    fs.writeFileSync(centralPath, architecture, "utf-8");
    this.logger.info(`📋 Architecture saved centrally to ${centralPath}`);
  }

  private formatAnalyses(analyses: Record<string, string>): string {
    const parts: string[] = ["# Fleet Analysis\n"];
    for (const repo of this.fleetConfig.repos) {
      const analysis = analyses[repo.path] ?? "No analysis available.";
      parts.push(`## ${path.basename(repo.path)} (${repo.path})\n\n**Role:** ${repo.role}\n\n${analysis}\n`);
    }
    return parts.join("\n");
  }

  private formatStrategy(strategy: FleetStrategy): string {
    const parts: string[] = ["# Fleet Strategy\n"];

    if (strategy.sharedContracts) {
      parts.push(`## Shared Contracts\n\n${strategy.sharedContracts}\n`);
    }

    parts.push("## Per-Repo Tasks\n");
    for (const rt of strategy.repoTasks) {
      parts.push(`### ${path.basename(rt.repoPath)} (${rt.repoPath})\n\n${rt.tasks}\n`);
    }

    if (strategy.dependencies.length > 0) {
      parts.push("## Dependencies\n");
      for (const dep of strategy.dependencies) {
        parts.push(`- ${dep.from} → ${dep.to}: ${dep.reason}`);
      }
      parts.push("");
    }

    parts.push("## Execution Waves\n");
    for (let i = 0; i < strategy.waves.length; i++) {
      parts.push(`### Wave ${i + 1}\n`);
      for (const p of strategy.waves[i]) {
        parts.push(`- ${p}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }

  private computeRepoStats(checkpoint: FleetCheckpoint): { checked: number; touched: number } {
    const allRepos = new Set<string>();
    const touchedRepos = new Set<string>();

    for (const waveResult of checkpoint.waveResults) {
      for (const [repoPath, result] of Object.entries(waveResult)) {
        allRepos.add(repoPath);
        if (result.startsWith("FAILED:")) continue;
        try {
          const status = execSync("git status --porcelain", { cwd: repoPath, encoding: "utf-8" }).trim();
          if (status.length > 0) {
            touchedRepos.add(repoPath);
          }
        } catch {
          // If git status fails, conservatively skip
        }
      }
    }

    return { checked: allRepos.size, touched: touchedRepos.size };
  }

  private buildSummary(
    strategy: FleetStrategy,
    checkpoint: FleetCheckpoint,
    repoStats: { checked: number; touched: number },
  ): string {
    const parts: string[] = ["# Fleet Summary\n"];
    parts.push(`**Feature:** ${this.config.issueBody.slice(0, 200)}\n`);
    parts.push(`**Repos:** ${this.fleetConfig.repos.map((r) => path.basename(r.path)).join(", ")}\n`);
    parts.push(`**Waves:** ${strategy.waves.length}\n`);
    parts.push(`**Checked:** ${repoStats.checked} repo(s) | **Touched:** ${repoStats.touched} repo(s)\n`);

    for (let i = 0; i < checkpoint.waveResults.length; i++) {
      parts.push(`\n## Wave ${i + 1}\n`);
      for (const [repo, result] of Object.entries(checkpoint.waveResults[i])) {
        const status = result.startsWith("FAILED:") ? "❌" : "✅";
        parts.push(`### ${status} ${path.basename(repo)}\n\n${result.slice(0, 500)}\n`);
      }
    }

    parts.push("\n## Cleanup\n");
    parts.push(`To undo all changes and return repos to their default branch:\n`);
    parts.push(`\`\`\`\n${this.buildCleanupCommand()}\n\`\`\`\n`);

    return parts.join("\n");
  }

  /** Build the `swarm fleet cleanup` CLI command for the current fleet config. */
  buildCleanupCommand(): string {
    const repoPaths = this.fleetConfig.repos.map((r) => r.path).join(" ");
    const branch = this.config.fleetBranch;
    if (branch) {
      return `swarm fleet cleanup ${branch} ${repoPaths}`;
    }
    // Without a branch, user needs to provide one
    return `swarm fleet cleanup <branch-name> ${repoPaths}`;
  }

  // --- TUI helper methods ---

  private phaseKey(phase: string): string {
    if (!this.tracker) return "";
    const p = this.tracker.phases.find((ph) => ph.key.startsWith(phase));
    return p?.key ?? "";
  }

  private findPhaseKey(name: string): string {
    if (!this.tracker) return "";
    const p = this.tracker.phases.find((ph) => ph.name === name);
    return p?.key ?? "";
  }

  private activatePhase(key: string): void {
    if (key) this.tracker?.activatePhase(key);
  }

  private completePhase(key: string): void {
    if (key) this.tracker?.completePhase(key);
  }

  private skipPhase(key: string): void {
    if (key) this.tracker?.skipPhase(key);
  }

  private skipPhaseByName(name: string): void {
    this.skipPhase(this.findPhaseKey(name));
  }

  private stopTui(): void {
    this.renderer?.stop();
  }
}
