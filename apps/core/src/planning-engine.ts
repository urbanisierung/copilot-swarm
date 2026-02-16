import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import type { SwarmConfig } from "./config.js";
import { ResponseKeyword } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { plansDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import type { TuiRenderer } from "./tui-renderer.js";
import { responseContains } from "./utils.js";

const MAX_CLARIFICATION_ROUNDS = 10;

const PLANNER_INSTRUCTIONS = `You are a Senior Product Manager conducting a requirements clarification session with a user.
Your goal is to fully understand the user's request before any engineering work begins.

**Rules:**
1. Read the user's request carefully. Use \`list_dir\` and \`read_file\` to understand the existing project structure if it helps you ask better questions.
2. If the request is vague or incomplete, ask targeted clarifying questions:
   - Scope boundaries (what's included, what's not)
   - Expected behavior, user flows, and edge cases
   - Technical constraints or preferences
   - Priority and phasing (if the request is large)
3. Ask at most 3–5 questions at a time. Number them clearly.
4. After the user answers, assess whether you have enough information. Ask follow-up questions only if genuinely needed.
5. When you have sufficient clarity to write a complete specification, respond with **REQUIREMENTS_CLEAR** on its own line, followed by a structured summary of the requirements including:
   - Problem statement
   - Acceptance criteria (testable)
   - Technical requirements
   - Edge cases
   - Out-of-scope items`;

const ANALYST_INSTRUCTIONS = `You are a Senior Software Architect conducting a technical feasibility analysis.
Given a set of requirements, analyze the codebase and produce a structured assessment.

**Rules:**
1. Use \`list_dir\`, \`read_file\`, and \`run_terminal\` to explore the codebase thoroughly.
2. Assess and report:
   - **Complexity:** Low / Medium / High — with justification
   - **Affected files/modules:** List every file or module that needs changes
   - **Approach:** Concise description of the implementation strategy
   - **Risks & blockers:** Anything that could cause problems (breaking changes, missing dependencies, performance concerns)
   - **Estimated scope:** Number of files to change, new files to create, tests to write
3. Be specific. Reference actual file paths and code structures you found in the repo.
4. Do not implement anything — analysis only.`;

export class PlanningEngine {
  private readonly sessions: SessionManager;

  constructor(
    private readonly config: SwarmConfig,
    pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
    private readonly renderer?: TuiRenderer,
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
    this.logger.info(msg.planningStart);
    this.tracker?.initPhases([{ phase: "plan-clarify" }, { phase: "plan-analyze" }]);

    // Phase 1: PM clarifies requirements interactively
    this.tracker?.activatePhase("plan-clarify-0");
    const spec = await this.clarifyRequirements();
    this.tracker?.completePhase("plan-clarify-0");

    // Phase 2: Engineering analyst assesses codebase
    this.tracker?.activatePhase("plan-analyze-1");
    const analysis = await this.analyzeCodebase(spec);
    this.tracker?.completePhase("plan-analyze-1");

    // Assemble and save plan
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const plan =
      `# Plan\n\n**Timestamp:** ${timestamp}\n\n` +
      `## Original Request\n\n${this.config.issueBody}\n\n` +
      `## Refined Requirements\n\n${spec}\n\n` +
      `## Technical Analysis\n\n${analysis}\n`;

    const dir = plansDir(this.config);
    await fs.mkdir(dir, { recursive: true });

    const timestampedPath = path.join(dir, `plan-${fileTimestamp}.md`);
    const latestPath = path.join(dir, "plan-latest.md");
    await fs.writeFile(timestampedPath, plan);
    await fs.copyFile(timestampedPath, latestPath);

    this.logger.info(msg.planningComplete);
    this.logger.info(msg.planSaved(path.relative(this.config.repoRoot, timestampedPath)));
    this.logger.info(`📌 Latest plan: ${path.relative(this.config.repoRoot, latestPath)}`);
    this.logger.info(`\n💡 Run the pipeline with: swarm --plan ${path.relative(this.config.repoRoot, latestPath)}`);
  }

  private async clarifyRequirements(): Promise<string> {
    this.logger.info(msg.planningPmPhase);

    const session = await this.sessions.createSessionWithInstructions(PLANNER_INSTRUCTIONS);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
      let response = await this.sessions.send(
        session,
        `Here is the user's request:\n\n${this.config.issueBody}\n\n` +
          "Analyze this request. If it's clear enough, respond with REQUIREMENTS_CLEAR followed by the structured summary. " +
          "If you need more information, ask your clarifying questions.",
        "PM is analyzing requirements…",
      );

      for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
        if (responseContains(response, ResponseKeyword.REQUIREMENTS_CLEAR)) {
          break;
        }

        // Show agent's questions — pause TUI for interactive I/O
        this.renderer?.pause();
        console.log(`\n${response}`);

        // Read multi-line user answer
        const answer = await this.readMultiLineInput(rl);
        this.renderer?.resume();
        if (!answer.trim()) {
          response = await this.sessions.send(
            session,
            "The user skipped this round. Use your best judgment for any open questions and produce the final requirements. Respond with REQUIREMENTS_CLEAR followed by the structured summary.",
            "PM is finalizing requirements…",
          );
        } else {
          response = await this.sessions.send(
            session,
            `User's answers:\n\n${answer}`,
            "PM is processing your answers…",
          );
        }
      }

      // Extract everything after REQUIREMENTS_CLEAR keyword
      const marker = "REQUIREMENTS_CLEAR";
      const idx = response.toUpperCase().indexOf(marker);
      const spec = idx !== -1 ? response.substring(idx + marker.length).trim() : response;

      this.renderer?.pause();
      console.log("\n📋 Refined Requirements:\n");
      console.log(spec);
      this.renderer?.resume();

      return spec;
    } finally {
      rl.close();
      await session.destroy();
    }
  }

  /**
   * Reads multi-line input from the user. Lines are collected until the user
   * submits an empty line (presses Enter twice). Literal `\n` sequences typed
   * by the user are converted to real newlines.
   */
  private async readMultiLineInput(rl: readline.Interface): Promise<string> {
    const lines: string[] = [];
    const firstLine = await rl.question(msg.planningUserPrompt);
    if (!firstLine.trim()) {
      return "";
    }
    lines.push(firstLine);

    // Continue reading until empty line
    while (true) {
      const line = await rl.question(msg.planningInputContinue);
      if (!line.trim()) {
        break;
      }
      lines.push(line);
    }

    // Join and convert literal \n sequences to real newlines
    return lines.join("\n").replace(/\\n/g, "\n");
  }

  private async analyzeCodebase(spec: string): Promise<string> {
    this.logger.info(msg.planningEngPhase);

    const session = await this.sessions.createSessionWithInstructions(ANALYST_INSTRUCTIONS);
    try {
      const analysis = await this.sessions.send(
        session,
        `Analyze the codebase against these requirements and produce a technical assessment:\n\n${spec}`,
        "Engineer is analyzing codebase…",
      );

      this.renderer?.pause();
      console.log("\n🔍 Technical Analysis:\n");
      console.log(analysis);
      this.renderer?.resume();

      return analysis;
    } finally {
      await session.destroy();
    }
  }
}
