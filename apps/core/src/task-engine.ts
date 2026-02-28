import * as fs from "node:fs/promises";
import type { SwarmConfig } from "./config.js";
import { ResponseKeyword } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import { analysisFilePath } from "./paths.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { SessionManager } from "./session.js";
import { responseContains } from "./utils.js";

const PREREQ_ANALYZER_PROMPT = `Analyze this user request and identify any independent research or study sub-tasks that can be performed IN PARALLEL before requirements clarification begins.

Examples of parallelizable sub-tasks:
- "Study this URL/resource" → fetch and summarize the resource
- "Research best practices for X" → investigate and summarize
- "Analyze this library/tool" → explore and document findings
- "Review this reference implementation" → study and extract patterns

Rules:
1. Only extract tasks that are genuinely independent and can run in parallel.
2. Each task must be a self-contained research/study task — NOT implementation.
3. If the request is straightforward with no research needed, return an empty array.
4. Return ONLY a JSON array of objects: [{"task": "description", "prompt": "detailed prompt for the researcher"}]
5. Keep it minimal — don't invent sub-tasks that aren't implied by the request.`;

const PM_INSTRUCTIONS = `You are a Senior Product Manager reviewing a task before it goes to engineering.
Your goal is to produce a clear, actionable specification from the user's request.

**Rules:**
1. Read the user's request carefully. Use \`list_dir\` and \`read_file\` to understand the existing project structure.
2. Identify any ambiguity, missing details, or edge cases.
3. Use your best judgment to resolve any open questions — do not ask the user.
4. Respond with **REQUIREMENTS_CLEAR** on its own line, followed by a structured summary:
   - Problem statement
   - Acceptance criteria (testable)
   - Technical requirements
   - Edge cases
   - Out-of-scope items`;

/**
 * TaskEngine — lightweight autonomous pipeline: prereqs → PM clarify → refined spec.
 * The refined spec is then fed into PipelineEngine for decompose → implement → verify.
 */
export class TaskEngine {
  private readonly sessions: SessionManager;
  private readonly pipeline: PipelineConfig;

  constructor(
    private readonly config: SwarmConfig,
    pipeline: PipelineConfig,
    private readonly logger: Logger,
    private readonly tracker?: ProgressTracker,
  ) {
    this.pipeline = pipeline;
    this.sessions = new SessionManager(config, pipeline, logger);
    if (tracker) this.sessions.setTracker(tracker);
  }

  async start(): Promise<void> {
    await this.sessions.start();
  }

  async stop(): Promise<void> {
    await this.sessions.stop();
  }

  /**
   * Run prereqs + PM clarification, return a refined spec string.
   * The caller feeds this into PipelineEngine/SwarmOrchestrator.
   */
  async execute(): Promise<string> {
    this.logger.info("🚀 Starting Task Mode...");

    const phases: { phase: string }[] = [{ phase: "task-prereqs" }, { phase: "task-clarify" }];
    this.tracker?.initPhases(phases);

    let effectivePrompt = this.config.issueBody;

    // Load repo analysis if available
    let repoAnalysis = "";
    try {
      repoAnalysis = await fs.readFile(analysisFilePath(this.config), "utf-8");
      this.logger.info(msg.repoAnalysisLoaded);
    } catch {
      // No analysis — agents work without it
    }

    // Phase 1: Pre-analysis for parallel research tasks
    const prereqKey = "task-prereqs-0";
    this.tracker?.activatePhase(prereqKey);
    const prereqContext = await this.executePrereqs(effectivePrompt);
    if (prereqContext) {
      effectivePrompt = `${effectivePrompt}\n\n## Research Context\n\n${prereqContext}`;
    }
    this.tracker?.completePhase(prereqKey);

    // Phase 2: PM review & clarification (auto-answered)
    const clarifyKey = "task-clarify-1";
    this.tracker?.activatePhase(clarifyKey);
    const pmInput = repoAnalysis
      ? `## Repository Context\n\n${repoAnalysis}\n\n## Task\n\n${effectivePrompt}`
      : effectivePrompt;
    const spec = await this.pmClarify(pmInput);
    this.tracker?.completePhase(clarifyKey);

    return spec;
  }

  private async executePrereqs(issueBody: string): Promise<string | null> {
    this.logger.info(msg.planPrereqsAnalyzing);

    let subtasks: { task: string; prompt: string }[];
    try {
      const raw = await this.sessions.callIsolated(
        "pm",
        `${PREREQ_ANALYZER_PROMPT}\n\nUser request:\n${issueBody}`,
        this.pipeline.fastModel,
        "prereq-analyze",
      );
      const jsonStr = raw.replace(/^[^[]*/, "").replace(/[^\]]*$/, "");
      subtasks = JSON.parse(jsonStr);
      if (!Array.isArray(subtasks) || subtasks.length === 0) {
        this.logger.info(msg.planPrereqsNone);
        return null;
      }
    } catch {
      this.logger.info(msg.planPrereqsNone);
      return null;
    }

    this.logger.info(msg.planPrereqsFound(subtasks.length));

    const results = await Promise.all(
      subtasks.map(async (st, i) => {
        const key = `prereq-${i}`;
        this.logger.info(msg.planPrereqsRunning(st.task));
        const result = await this.sessions.callIsolated("pm", st.prompt, undefined, key);
        return `### ${st.task}\n\n${result}`;
      }),
    );

    this.logger.info(msg.planPrereqsDone(results.length));
    return results.join("\n\n---\n\n");
  }

  private async pmClarify(prompt: string): Promise<string> {
    this.logger.info("📋 PM is reviewing the task...");

    const session = await this.sessions.createSessionWithInstructions(PM_INSTRUCTIONS, this.pipeline.fastModel, "pm");
    try {
      const response = await this.sessions.send(
        session,
        `Here is the task:\n\n${prompt}\n\nReview this task. Use your best judgment for any open questions. ` +
          "Respond with REQUIREMENTS_CLEAR followed by the structured summary.",
        "PM is refining requirements…",
      );

      // Strip the REQUIREMENTS_CLEAR keyword if present
      if (responseContains(response, ResponseKeyword.REQUIREMENTS_CLEAR)) {
        const idx = response.indexOf(ResponseKeyword.REQUIREMENTS_CLEAR);
        return response.substring(idx + ResponseKeyword.REQUIREMENTS_CLEAR.length).trim();
      }
      return response;
    } finally {
      await this.sessions.destroySession(session);
    }
  }
}
