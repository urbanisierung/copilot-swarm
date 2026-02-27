/**
 * FleetEngine — meta-orchestrator for cross-repo feature implementation.
 * Coordinates independent swarm instances across multiple repositories:
 *   1. Analyze all repos in parallel
 *   2. Strategist agent produces cross-repo plan with waves
 *   3. Execute waves: repos in each wave run in parallel via child `swarm task` processes
 *   4. Cross-repo reviewer validates consistency
 */
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import type { FleetCheckpoint, FleetConfig, FleetDependency, FleetRepoTasks, FleetStrategy } from "./fleet-types.js";
import type { Logger } from "./logger.js";
import { loadPipelineConfig } from "./pipeline-config.js";
import { SessionManager } from "./session.js";

const FLEET_CHECKPOINT_FILE = "fleet-checkpoint.json";
const FLEET_APPROVED_KEYWORD = "FLEET_APPROVED";

function fleetOutputDir(config: SwarmConfig): string {
  return path.join(config.repoRoot, config.swarmDir, "fleet", config.runId);
}

function checkpointPath(config: SwarmConfig): string {
  return path.join(fleetOutputDir(config), FLEET_CHECKPOINT_FILE);
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

  async execute(): Promise<void> {
    const outDir = fleetOutputDir(this.config);
    fs.mkdirSync(outDir, { recursive: true });

    const checkpoint = this.loadCheckpoint();
    const repos = this.fleetConfig.repos;

    // Phase 1: Analyze all repos
    let analyses = checkpoint.analyses;
    if (!checkpoint.completedPhases.includes("analyze")) {
      this.logger.info(`🔍 Analyzing ${repos.length} repositories...`);
      analyses = await this.analyzeAll();
      checkpoint.analyses = analyses;
      checkpoint.completedPhases.push("analyze");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping analysis (completed in previous run)");
    }

    // Phase 2: Strategize
    let strategy = checkpoint.strategy;
    if (!checkpoint.completedPhases.includes("strategize")) {
      this.logger.info("🧠 Strategist analyzing cross-repo dependencies...");
      strategy = await this.strategize(analyses);
      checkpoint.strategy = strategy;
      checkpoint.completedPhases.push("strategize");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping strategy (completed in previous run)");
    }

    if (!strategy) throw new Error("Strategy not produced — cannot continue");

    // Save strategy to output
    const strategyPath = path.join(outDir, "strategy.md");
    fs.writeFileSync(strategyPath, this.formatStrategy(strategy), "utf-8");
    this.logger.info(`📋 Strategy saved to ${strategyPath}`);

    // Phase 3: Execute waves
    if (!checkpoint.completedPhases.includes("execute")) {
      this.logger.info(`🚀 Executing ${strategy.waves.length} wave(s)...`);
      await this.executeWaves(strategy, checkpoint);
      checkpoint.completedPhases.push("execute");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping execution (completed in previous run)");
    }

    // Phase 4: Cross-repo review
    if (!checkpoint.completedPhases.includes("review")) {
      this.logger.info("🔎 Cross-repo reviewer checking consistency...");
      const reviewResult = await this.crossReview(strategy, checkpoint.waveResults);
      const reviewPath = path.join(outDir, "fleet-review.md");
      fs.writeFileSync(reviewPath, reviewResult, "utf-8");
      checkpoint.completedPhases.push("review");
      this.saveCheckpoint(checkpoint);
    } else {
      this.logger.info("⏭️  Skipping cross-repo review (completed in previous run)");
    }

    // Phase 5: Summary
    const summaryPath = path.join(outDir, "fleet-summary.md");
    fs.writeFileSync(summaryPath, this.buildSummary(strategy, checkpoint), "utf-8");
    this.logger.info(`✅ Fleet completed — summary at ${summaryPath}`);
  }

  // --- Phase implementations ---

  private async analyzeAll(): Promise<Record<string, string>> {
    const analyses: Record<string, string> = {};
    const swarmBin = resolveSwarmBin();

    // Run analyses in parallel
    const promises = this.fleetConfig.repos.map(async (repo) => {
      this.logger.info(`  📂 Analyzing ${path.basename(repo.path)}...`);
      try {
        execSync(`${swarmBin} analyze --no-tui`, {
          cwd: repo.path,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 600_000,
        });
      } catch (err) {
        this.logger.warn(`  ⚠️  Analysis failed for ${repo.path}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Read the generated analysis
      const analysisFile = path.join(repo.path, ".swarm", "analysis", "repo-analysis.md");
      // Also check session-scoped paths
      const swarmDir = path.join(repo.path, ".swarm");
      const analysis = this.findAnalysisFile(swarmDir) ?? (fs.existsSync(analysisFile) ? analysisFile : null);

      if (analysis) {
        analyses[repo.path] = fs.readFileSync(analysis, "utf-8");
      } else {
        analyses[repo.path] = `Repository at ${repo.path} — no analysis available. Role: ${repo.role}`;
      }
    });

    await Promise.all(promises);
    return analyses;
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

  private async strategize(analyses: Record<string, string>): Promise<FleetStrategy> {
    if (!this.sessions) throw new Error("Sessions not initialized");

    const repoContexts = this.fleetConfig.repos
      .map((repo) => {
        const analysis = analyses[repo.path] ?? "No analysis available.";
        return `### ${path.basename(repo.path)} (${repo.path})\n**Role:** ${repo.role}\n\n${analysis}`;
      })
      .join("\n\n---\n\n");

    const prompt = `## Feature Request\n\n${this.config.issueBody}\n\n## Repository Analyses\n\n${repoContexts}\n\nProduce a cross-repo strategy with shared contracts, per-repo tasks, dependencies, and execution waves.`;

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

    return { sharedContracts, repoTasks, dependencies, waves };
  }

  private async executeWaves(strategy: FleetStrategy, checkpoint: FleetCheckpoint): Promise<void> {
    const swarmBin = resolveSwarmBin();
    let priorWaveContext = "";

    for (let waveIdx = checkpoint.currentWave; waveIdx < strategy.waves.length; waveIdx++) {
      const wave = strategy.waves[waveIdx];
      this.logger.info(`\n  🌊 Wave ${waveIdx + 1}/${strategy.waves.length}: ${wave.length} repo(s)`);

      if (!checkpoint.waveResults[waveIdx]) {
        checkpoint.waveResults[waveIdx] = {};
      }

      // Run repos in this wave in parallel
      const promises = wave.map(async (repoPath) => {
        if (checkpoint.waveResults[waveIdx][repoPath]) {
          this.logger.info(`  ⏭️  ${path.basename(repoPath)} already completed`);
          return;
        }

        const repoTask = strategy.repoTasks.find((rt) => rt.repoPath === repoPath);
        const taskPrompt = this.buildRepoPrompt(repoPath, repoTask, strategy.sharedContracts, priorWaveContext);

        this.logger.info(`  🔧 ${path.basename(repoPath)} starting...`);

        try {
          const result = await this.runSwarmTask(swarmBin, repoPath, taskPrompt);
          checkpoint.waveResults[waveIdx][repoPath] = result || "Completed (no summary)";
          this.logger.info(`  ✅ ${path.basename(repoPath)} completed`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          checkpoint.waveResults[waveIdx][repoPath] = `FAILED: ${errMsg}`;
          this.logger.error(`  ❌ ${path.basename(repoPath)} failed: ${errMsg}`);
          throw new Error(`Wave ${waveIdx + 1} failed: ${path.basename(repoPath)} — ${errMsg}`);
        }

        this.saveCheckpoint(checkpoint);
      });

      await Promise.all(promises);

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
    // Write prompt to temp file to avoid shell escaping issues
    const tmpFile = path.join(os.tmpdir(), `fleet-${Date.now()}-${path.basename(repoPath)}.md`);
    fs.writeFileSync(tmpFile, prompt, "utf-8");

    const overrides = this.fleetConfig.overrides?.[repoPath];
    const verifyArgs: string[] = [];
    if (overrides?.verifyBuild) verifyArgs.push(`--verify-build "${overrides.verifyBuild}"`);
    if (overrides?.verifyTest) verifyArgs.push(`--verify-test "${overrides.verifyTest}"`);
    if (overrides?.verifyLint) verifyArgs.push(`--verify-lint "${overrides.verifyLint}"`);

    const cmd = `${swarmBin} task --no-tui -f "${tmpFile}" ${verifyArgs.join(" ")}`.trim();

    return new Promise<string>((resolve, reject) => {
      const child = spawn("sh", ["-c", cmd], {
        cwd: repoPath,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 1_800_000,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // ignore
        }

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`swarm task exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      child.on("error", (err) => {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // ignore
        }
        reject(err);
      });
    });
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

  private buildSummary(strategy: FleetStrategy, checkpoint: FleetCheckpoint): string {
    const parts: string[] = ["# Fleet Summary\n"];
    parts.push(`**Feature:** ${this.config.issueBody.slice(0, 200)}\n`);
    parts.push(`**Repos:** ${this.fleetConfig.repos.map((r) => path.basename(r.path)).join(", ")}\n`);
    parts.push(`**Waves:** ${strategy.waves.length}\n`);

    for (let i = 0; i < checkpoint.waveResults.length; i++) {
      parts.push(`\n## Wave ${i + 1}\n`);
      for (const [repo, result] of Object.entries(checkpoint.waveResults[i])) {
        const status = result.startsWith("FAILED:") ? "❌" : "✅";
        parts.push(`### ${status} ${path.basename(repo)}\n\n${result.slice(0, 500)}\n`);
      }
    }

    return parts.join("\n");
  }
}
