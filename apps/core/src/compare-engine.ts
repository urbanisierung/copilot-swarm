/**
 * CompareEngine — compare two PR/branch implementations side-by-side.
 * Runs Diff Analyst on each side (parallel), optionally a Requirements Evaluator,
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
    // Try merge-base diff first (compares branch point, not tip)
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
    // Fallback: diff against base branch directly
    try {
      const output = execSync(`git diff --name-only ${baseBranch}..HEAD`, {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return output ? output.split("\n").filter(Boolean) : [];
    } catch {
      // Last resort: show all uncommitted changes
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
      // New untracked file — read its content
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
    const { compareLeft, compareRight, compareBase, compareOutput } = this.config;
    if (!compareLeft || !compareRight) {
      throw new Error("Both --left and --right paths are required for the compare command.");
    }

    const leftPath = validateGitRepo(compareLeft, "Left");
    const rightPath = validateGitRepo(compareRight, "Right");

    this.logger.info(msg.compareStart);

    const hasRequirements = !!this.config.issueBody;
    const phases = [
      { phase: "compare-inventory" },
      { phase: "compare-analyze" },
      ...(hasRequirements ? [{ phase: "compare-requirements" }] : []),
      { phase: "compare-review" },
    ];
    this.tracker?.initPhases(phases);

    // Phase keys include index from initPhases
    const inventoryKey = "compare-inventory-0";
    const analyzeKey = "compare-analyze-1";
    const requirementsKey = hasRequirements ? "compare-requirements-2" : "";
    const reviewKey = hasRequirements ? "compare-review-3" : "compare-review-2";

    // Phase 1: Inventory
    this.tracker?.activatePhase(inventoryKey);
    this.logger.info(msg.compareInventory);

    const leftFiles = filterIgnoredFiles(getChangedFiles(leftPath, compareBase));
    const rightFiles = filterIgnoredFiles(getChangedFiles(rightPath, compareBase));

    if (leftFiles.length === 0 && rightFiles.length === 0) {
      const message =
        "No changed files found in either PR. Ensure both branches have changes relative to the base branch.";
      this.logger.warn(message);
      this.tracker?.completePhase(inventoryKey);
      return message;
    }

    this.logger.info(msg.compareFileCounts(leftFiles.length, rightFiles.length));

    const leftDiff = getDiffContent(leftPath, compareBase, leftFiles);
    const rightDiff = getDiffContent(rightPath, compareBase, rightFiles);

    this.tracker?.completePhase(inventoryKey);

    // Phase 2: Diff Analysis (parallel)
    this.tracker?.activatePhase(analyzeKey);
    this.logger.info(msg.compareAnalyzePhase);

    const leftAnalystPrompt = this.buildAnalystPrompt("Left PR", leftPath, leftFiles, leftDiff);
    const rightAnalystPrompt = this.buildAnalystPrompt("Right PR", rightPath, rightFiles, rightDiff);

    const [leftAnalysis, rightAnalysis] = await Promise.all([
      this.sessions.callIsolated("diff-analyst", leftAnalystPrompt, this.pipeline.fastModel, "compare-analyst-left"),
      this.sessions.callIsolated("diff-analyst", rightAnalystPrompt, this.pipeline.fastModel, "compare-analyst-right"),
    ]);

    this.tracker?.completePhase(analyzeKey);

    // Phase 3: Requirements Evaluation (conditional)
    let requirementsEval = "";
    const requirementsText = this.config.issueBody;
    if (hasRequirements) {
      this.tracker?.activatePhase(requirementsKey);
      this.logger.info(msg.compareRequirementsPhase);

      const reqPrompt = this.buildRequirementsPrompt(requirementsText, leftAnalysis, rightAnalysis);
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

    const reviewPrompt = this.buildReviewPrompt(leftAnalysis, rightAnalysis, requirementsEval);
    const report = await this.sessions.callIsolated(
      "comparative-reviewer",
      reviewPrompt,
      this.pipeline.primaryModel,
      "compare-review",
    );

    this.tracker?.completePhase(reviewKey);

    // Write report
    const outputPath = path.resolve(compareOutput);
    const header = `<!-- Generated by Copilot Swarm compare on ${new Date().toISOString()} -->\n<!-- Left: ${leftPath} | Right: ${rightPath} | Base: ${compareBase} -->\n\n`;
    await fs.writeFile(outputPath, header + report);
    this.logger.info(msg.compareSaved(outputPath));

    return report;
  }

  private buildAnalystPrompt(label: string, repoPath: string, files: string[], diff: string): string {
    return [
      `Analyze the following changes from the **${label}** (repository: ${repoPath}).`,
      "",
      `## Changed Files (${files.length})`,
      files.map((f) => `- ${f}`).join("\n"),
      "",
      "## Diffs",
      diff,
    ].join("\n");
  }

  private buildRequirementsPrompt(requirements: string, leftAnalysis: string, rightAnalysis: string): string {
    return [
      "## Requirements",
      requirements,
      "",
      "## Implementation A (Left PR) — Analysis",
      leftAnalysis,
      "",
      "## Implementation B (Right PR) — Analysis",
      rightAnalysis,
    ].join("\n");
  }

  private buildReviewPrompt(leftAnalysis: string, rightAnalysis: string, requirementsEval: string): string {
    const parts = ["## Diff Analysis — Left PR", leftAnalysis, "", "## Diff Analysis — Right PR", rightAnalysis];

    if (requirementsEval) {
      parts.push("", "## Requirements Evaluation", requirementsEval);
    }

    return parts.join("\n");
  }
}
