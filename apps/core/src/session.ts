import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import type { SwarmConfig } from "./config.js";
import { BUILTIN_AGENT_PREFIX, SessionEvent, SYSTEM_MESSAGE_MODE } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import type { PipelineConfig } from "./pipeline-types.js";

export class SessionManager {
  private readonly client: CopilotClient;
  private readonly instructionCache = new Map<string, string>();

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
  ) {
    this.client = new CopilotClient({
      logLevel: config.verbose ? "debug" : "warning",
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  /**
   * Resolve agent instructions from the pipeline config's `agents` map.
   * - "builtin:<name>" → load from `.github/agents/<name>.md` (repo agents dir)
   * - File path → load from repo root-relative path
   * - Undefined → fall back to `<agentsDir>/<agentName>.md`
   */
  async loadAgentInstructions(agentName: string): Promise<string> {
    const cached = this.instructionCache.get(agentName);
    if (cached !== undefined) return cached;

    const source = this.pipeline.agents[agentName];
    let filePath: string;

    if (source === undefined) {
      // Fallback: look in the repo's agents dir
      filePath = path.join(this.config.repoRoot, this.config.agentsDir, `${agentName}.md`);
    } else if (source.startsWith(BUILTIN_AGENT_PREFIX)) {
      const builtinName = source.slice(BUILTIN_AGENT_PREFIX.length);
      filePath = path.join(this.config.repoRoot, this.config.agentsDir, `${builtinName}.md`);
    } else {
      // Treat as a repo-relative file path
      filePath = path.join(this.config.repoRoot, source);
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      this.instructionCache.set(agentName, content);
      return content;
    } catch (err) {
      throw new Error(
        `Failed to load agent instructions for "${agentName}" at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async createAgentSession(agentName: string, model?: string): Promise<CopilotSession> {
    const instructions = await this.loadAgentInstructions(agentName);
    return this.createSessionWithInstructions(instructions, model);
  }

  async createSessionWithInstructions(instructions: string, model?: string): Promise<CopilotSession> {
    const session = await this.client.createSession({
      model: model ?? this.pipeline.primaryModel,
      systemMessage: { mode: SYSTEM_MESSAGE_MODE, content: instructions },
    });

    if (this.config.verbose) {
      session.on(SessionEvent.MESSAGE_DELTA, (e) => {
        this.logger.write(e.data.deltaContent);
      });
      session.on(SessionEvent.TOOL_EXECUTION_START, (e) => {
        this.logger.debug(msg.toolExecution(e.data.toolName));
      });
      session.on(SessionEvent.INTENT, (e) => {
        this.logger.debug(msg.intentUpdate(e.data.intent));
      });
    }

    return session;
  }

  async send(session: CopilotSession, prompt: string): Promise<string> {
    const response = await session.sendAndWait({ prompt }, this.config.sessionTimeoutMs);
    this.logger.newline();
    return response?.data.content ?? "";
  }

  async callIsolated(agentName: string, prompt: string, model?: string): Promise<string> {
    const maxAttempts = this.config.maxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const session = await this.createAgentSession(agentName, model);
      try {
        const content = await this.send(session, prompt);
        if (!content && attempt < maxAttempts) {
          this.logger.warn(msg.emptyResponse(agentName, attempt, maxAttempts));
          continue;
        }
        return content;
      } catch (err) {
        this.logger.error(msg.callError(agentName, attempt, maxAttempts), err);
        if (attempt >= maxAttempts) throw err;
      } finally {
        await session.destroy();
      }
    }
    return "";
  }
}
