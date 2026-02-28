import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SwarmConfig } from "./config.js";
import { ResponseKeyword } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisFilePath, brainstormsDir } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { openSplitEditor } from "./textarea.js";
import type { TuiRenderer } from "./tui-renderer.js";
import { responseContains } from "./utils.js";

const MAX_ROUNDS = 20;

const STRATEGIST_INSTRUCTIONS = `You are a Senior Product Strategist leading a brainstorming session with a user.
You combine PM, design, and engineering perspectives to explore ideas thoroughly.

**Your approach:**
1. Read the user's idea carefully. Use \`list_dir\` and \`read_file\` to understand the existing codebase if relevant.
2. Respond with your initial thoughts, then ask probing questions to deepen the discussion:
   - Challenge assumptions — don't just agree. Play devil's advocate when appropriate.
   - Suggest alternative approaches the user may not have considered.
   - Identify risks, edge cases, and potential pitfalls.
   - Consider feasibility (engineering), user value (product), and experience (design).
   - Explore tradeoffs explicitly.
3. Keep each response focused. Ask 2–4 questions at a time.
4. Build on previous answers — don't repeat what's already been discussed.
5. When the user sends "${ResponseKeyword.BRAINSTORM_DONE}", generate a structured summary of the brainstorm:

   # Brainstorm Summary

   ## Problem / Idea
   (What was explored)

   ## Key Ideas Discussed
   (Numbered list of main ideas with brief descriptions)

   ## Pros & Cons
   (For each major idea or approach)

   ## Open Questions
   (Unresolved questions that need further thought)

   ## Recommendations
   (Your recommended next steps or approach, with reasoning)

   ## Raw Discussion Notes
   (Brief chronological notes of the key points from each round)`;

const DONE_HINT = `Type "${ResponseKeyword.BRAINSTORM_DONE}" to finish and generate a summary`;

export class BrainstormEngine {
  private readonly sessions: SessionManager;

  constructor(
    private readonly config: SwarmConfig,
    readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
    private readonly renderer?: TuiRenderer,
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
    this.logger.info(msg.brainstormStart);

    const phases = [{ phase: "brainstorm-discuss" }, { phase: "brainstorm-summarize" }];
    this.tracker?.initPhases(phases);

    // Load repo analysis if available
    let repoAnalysis = "";
    try {
      repoAnalysis = await fs.readFile(analysisFilePath(this.config), "utf-8");
      this.logger.info(msg.repoAnalysisLoaded);
    } catch {
      // No analysis available — that's fine
    }

    this.logger.info(msg.brainstormPhase);
    this.tracker?.activatePhase("brainstorm-discuss-0");

    const session = await this.sessions.createSessionWithInstructions(STRATEGIST_INSTRUCTIONS, undefined, "strategist");
    this.sessions.recordSession("brainstorm", session, "strategist", "strategist");

    let summary = "";

    try {
      // Build initial prompt with context
      const contextParts: string[] = [];
      if (repoAnalysis) contextParts.push(`## Repository Context\n\n${repoAnalysis}`);
      contextParts.push(`## Idea to Explore\n\n${this.config.issueBody}`);

      let response = await this.sessions.send(
        session,
        `${contextParts.join("\n\n")}\n\nAnalyze this idea and share your initial thoughts. Ask probing questions to deepen the discussion.`,
        "Strategist is thinking…",
      );

      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (!process.stdin.isTTY) {
          // Non-interactive: auto-finish
          response = await this.sessions.send(session, `${ResponseKeyword.BRAINSTORM_DONE}`, "Generating summary…");
          break;
        }

        this.renderer?.pause();
        const answer = await openSplitEditor(response, {
          editorTitle: `Your Response  ·  ${DONE_HINT}`,
          contextTitle: "Strategist",
        });
        this.renderer?.resume();

        if (answer === undefined) {
          // User cancelled (Esc) — generate summary with what we have
          response = await this.sessions.send(session, `${ResponseKeyword.BRAINSTORM_DONE}`, "Generating summary…");
          break;
        }

        if (responseContains(answer, ResponseKeyword.BRAINSTORM_DONE)) {
          response = await this.sessions.send(session, `${ResponseKeyword.BRAINSTORM_DONE}`, "Generating summary…");
          break;
        }

        if (!answer.trim()) {
          // Empty answer — skip this round, let agent continue
          response = await this.sessions.send(
            session,
            "The user skipped this round. Continue the discussion — share more thoughts or ask different questions.",
            "Strategist is thinking…",
          );
        } else {
          response = await this.sessions.send(session, `User's response:\n\n${answer}`, "Strategist is thinking…");
        }
      }

      summary = response;
    } finally {
      await this.sessions.destroySession(session);
    }

    this.tracker?.completePhase("brainstorm-discuss-0");

    // Save summary
    this.tracker?.activatePhase("brainstorm-summarize-1");
    this.logger.info(msg.brainstormSummarizing);

    const outDir = brainstormsDir(this.config);
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${this.config.runId}.md`);
    await fs.writeFile(outPath, summary, "utf-8");
    this.logger.info(msg.brainstormSaved(path.relative(this.config.repoRoot, outPath)));

    this.tracker?.completePhase("brainstorm-summarize-1");
    this.logger.info(msg.brainstormComplete);

    // Print summary
    this.renderer?.pause();
    console.log("\n📋 Brainstorm Summary:\n");
    console.log(summary);
    this.renderer?.resume();

    return summary;
  }
}
