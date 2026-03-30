/**
 * CompareEngine — compare multiple PR/branch implementations side-by-side.
 * Runs Diff Analyst on each repo (parallel), optionally a Requirements Evaluator,
 * then a Comparative Reviewer to produce a final Markdown report.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { estimateTokens } from "./utils.js";

/** Directories and file patterns to ignore when diffing. */
const IGNORED_PATTERNS: readonly string[] = [
  ".github/",
  ".vscode/",
  ".idea/",
  "node_modules/",
  ".turbo/",
  ".next/",
  "dist/",
  "build/",
  ".git/",
  ".swarm/",
  "coverage/",
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/** Maximum tokens to include from a single file diff to avoid blowing the context. */
const MAX_DIFF_TOKENS_PER_FILE = 2_000;
/** Maximum total tokens for all diffs sent to the analyst agent. */
const MAX_DIFF_TOKENS_TOTAL = 60_000;

/** Alphabetic label for a repo index: 0→A, 1→B, 2→C, etc. */
export function repoLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export interface CompareInventory {
  readonly files: string[];
  readonly diff: string;
}

/** Filter out ignored paths from a list of changed files. */
export function filterIgnoredFiles(files: string[]): string[] {
  return files.filter((f) => {
    const normalized = f.replace(/\\/g, "/");
    return !IGNORED_PATTERNS.some((pattern) => normalized.startsWith(pattern) || normalized.includes(`/${pattern}`));
  });
}

/** Get changed files between a base branch and HEAD in a repo directory. */
function getChangedFiles(repoPath: string, baseBranch: string): string[] {
  try {
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const output = execSync(`git diff --name-only ${mergeBase} HEAD`, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    try {
      const output = execSync(`git diff --name-only ${baseBranch}..HEAD`, {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return output ? output.split("\n").filter(Boolean) : [];
    } catch {
      const modified = execSync("git diff --name-only", {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard", {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return [...new Set([...modified.split("\n"), ...untracked.split("\n")])].filter(Boolean);
    }
  }
}

/** Get the actual diff content for changed files, respecting token limits. */
function getDiffContent(repoPath: string, baseBranch: string, files: string[]): string {
  const parts: string[] = [];
  let totalTokens = 0;

  for (const file of files) {
    if (totalTokens >= MAX_DIFF_TOKENS_TOTAL) {
      parts.push(`\n... (${files.length - parts.length} more files truncated to fit token budget)`);
      break;
    }

    let diff: string;
    try {
      const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      diff = execSync(`git diff ${mergeBase} HEAD -- "${file}"`, {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      try {
        diff = execSync(`git diff ${baseBranch}..HEAD -- "${file}"`, {
          cwd: repoPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {
        diff = `(unable to diff ${file})`;
      }
    }

    if (!diff) {
      try {
        const content = execSync(`head -c 8000 "${file}"`, {
          cwd: repoPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        diff = `new file: ${file}\n${content}`;
      } catch {
        diff = `new file: ${file} (unable to read)`;
      }
    }

    const tokens = estimateTokens(diff);
    if (tokens > MAX_DIFF_TOKENS_PER_FILE) {
      const chars = MAX_DIFF_TOKENS_PER_FILE * 4;
      diff = `${diff.substring(0, chars)}\n... (truncated, ${tokens} tokens total)`;
    }

    totalTokens += Math.min(tokens, MAX_DIFF_TOKENS_PER_FILE);
    parts.push(diff);
  }

  return parts.join("\n\n");
}

/** Validate that a path is a git repository. */
function validateGitRepo(repoPath: string, label: string): string {
  const resolved = path.resolve(repoPath);
  try {
    execSync("git rev-parse --git-dir", {
      cwd: resolved,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`${label} path is not a git repository: ${resolved}`);
  }
  return resolved;
}

/** Per-repo inventory collected during the inventory phase. */
interface RepoInfo {
  readonly label: string;
  readonly path: string;
  readonly files: string[];
  readonly diff: string;
}

export class CompareEngine {
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

  async execute(): Promise<string> {
    const { compareRepos, compareBase, compareOutput } = this.config;
    if (compareRepos.length < 2) {
      throw new Error("At least 2 repository paths are required for the compare command.");
    }

    // Validate all repos
    const repos: RepoInfo[] = compareRepos.map((repoPath, i) => {
      const label = repoLabel(i);
      const resolved = validateGitRepo(repoPath, `PR ${label}`);
      return { label, path: resolved, files: [], diff: "" };
    });

    this.logger.info(msg.compareStart);

    const hasRequirements = !!this.config.issueBody;
    const phases = [
      { phase: "compare-inventory" },
      { phase: "compare-analyze" },
      ...(hasRequirements ? [{ phase: "compare-requirements" }] : []),
      { phase: "compare-review" },
    ];
    this.tracker?.initPhases(phases);

    const inventoryKey = "compare-inventory-0";
    const analyzeKey = "compare-analyze-1";
    const requirementsKey = hasRequirements ? "compare-requirements-2" : "";
    const reviewKey = hasRequirements ? "compare-review-3" : "compare-review-2";

    // Phase 1: Inventory all repos
    this.tracker?.activatePhase(inventoryKey);
    this.logger.info(msg.compareInventory);

    const repoInfos: RepoInfo[] = repos.map((r) => {
      const files = filterIgnoredFiles(getChangedFiles(r.path, compareBase));
      const diff = getDiffContent(r.path, compareBase, files);
      return { ...r, files, diff };
    });

    const totalFiles = repoInfos.reduce((sum, r) => sum + r.files.length, 0);
    if (totalFiles === 0) {
      const message = "No changed files found in any PR. Ensure branches have changes relative to the base branch.";
      this.logger.warn(message);
      this.tracker?.completePhase(inventoryKey);
      return message;
    }

    this.logger.info(msg.compareFileCounts(repoInfos.map((r) => ({ label: `PR ${r.label}`, count: r.files.length }))));
    this.tracker?.completePhase(inventoryKey);

    // Phase 2: Diff Analysis (parallel across all repos)
    this.tracker?.activatePhase(analyzeKey);
    this.logger.info(msg.compareAnalyzePhase);

    const analyses = await Promise.all(
      repoInfos.map((r) => {
        const prompt = this.buildAnalystPrompt(`PR ${r.label}`, r.path, r.files, r.diff);
        return this.sessions.callIsolated(
          "diff-analyst",
          prompt,
          this.pipeline.fastModel,
          `compare-analyst-${r.label.toLowerCase()}`,
        );
      }),
    );

    this.tracker?.completePhase(analyzeKey);

    // Phase 3: Requirements Evaluation (conditional)
    let requirementsEval = "";
    if (hasRequirements) {
      this.tracker?.activatePhase(requirementsKey);
      this.logger.info(msg.compareRequirementsPhase);

      const reqPrompt = this.buildRequirementsPrompt(this.config.issueBody, repoInfos, analyses);
      requirementsEval = await this.sessions.callIsolated(
        "requirements-evaluator",
        reqPrompt,
        this.pipeline.primaryModel,
        "compare-requirements",
      );

      this.tracker?.completePhase(requirementsKey);
    }

    // Phase 4: Comparative Review
    this.tracker?.activatePhase(reviewKey);
    this.logger.info(msg.compareReviewPhase);

    const reviewPrompt = this.buildReviewPrompt(repoInfos, analyses, requirementsEval);
    const report = await this.sessions.callIsolated(
      "comparative-reviewer",
      reviewPrompt,
      this.pipeline.primaryModel,
      "compare-review",
    );

    this.tracker?.completePhase(reviewKey);

    // Write report
    const outputPath = path.resolve(compareOutput);
    const repoList = repoInfos.map((r) => `${r.label}: ${r.path}`).join(" | ");
    const header = `<!-- Generated by Copilot Swarm compare on ${new Date().toISOString()} -->\n<!-- Repos: ${repoList} | Base: ${compareBase} -->\n\n`;
    await fs.writeFile(outputPath, header + report);
    this.logger.info(msg.compareSaved(outputPath));

    return report;
  }

  private buildAnalystPrompt(label: string, repoPath: string, files: string[], diff: string): string {
    return [
      `Analyze the following changes from **${label}** (repository: ${repoPath}).`,
      "",
      `## Changed Files (${files.length})`,
      files.map((f) => `- ${f}`).join("\n"),
      "",
      "## Diffs",
      diff,
    ].join("\n");
  }

  private buildRequirementsPrompt(requirements: string, repos: RepoInfo[], analyses: string[]): string {
    const parts = ["## Requirements", requirements, ""];
    for (let i = 0; i < repos.length; i++) {
      parts.push(`## Implementation ${repos[i].label} — Analysis`, analyses[i], "");
    }
    return parts.join("\n");
  }

  private buildReviewPrompt(repos: RepoInfo[], analyses: string[], requirementsEval: string): string {
    const parts: string[] = [];
    for (let i = 0; i < repos.length; i++) {
      parts.push(`## Diff Analysis — PR ${repos[i].label}`, analyses[i], "");
    }

    if (requirementsEval) {
      parts.push("## Requirements Evaluation", requirementsEval);
    }

    return parts.join("\n");
  }
}
