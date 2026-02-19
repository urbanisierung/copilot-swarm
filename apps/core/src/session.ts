import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CopilotSession } from "@github/copilot-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import type { SessionRecord } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import { BUILTIN_AGENT_PREFIX, SessionEvent, SYSTEM_MESSAGE_MODE } from "./constants.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_AGENTS_DIR = path.join(PACKAGE_DIR, "defaults", "agents");

export class SessionManager {
  private readonly client: CopilotClient;
  private readonly instructionCache = new Map<string, string>();
  private readonly _sessionLog: Record<string, SessionRecord> = {};
  private readonly _sessionModels = new Map<string, string>();
  private readonly _sessionLabels = new Map<string, string>();
  private tracker?: ProgressTracker;

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
  ) {
    this.client = new CopilotClient({
      logLevel: config.verbose ? "debug" : "warning",
    });
  }

  /** All Copilot SDK sessions created during this run, keyed by context. */
  get sessionLog(): Record<string, SessionRecord> {
    return this._sessionLog;
  }

  /** Attach a progress tracker for dynamic model display. */
  setTracker(tracker: ProgressTracker): void {
    this.tracker = tracker;
  }

  /** Record a session with a context key (e.g. "spec-0", "implement-3/stream-1"). */
  recordSession(key: string, session: CopilotSession, agent: string, role: string): void {
    this._sessionLog[key] = { sessionId: session.sessionId, agent, role };
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
    let agentFileName: string | undefined;
    let repoFilePath: string | undefined;

    if (source === undefined) {
      agentFileName = `${agentName}.md`;
      repoFilePath = path.join(this.config.repoRoot, this.config.agentsDir, agentFileName);
    } else if (source.startsWith(BUILTIN_AGENT_PREFIX)) {
      agentFileName = `${source.slice(BUILTIN_AGENT_PREFIX.length)}.md`;
      repoFilePath = path.join(this.config.repoRoot, this.config.agentsDir, agentFileName);
    } else {
      // Explicit file path — no bundled fallback
      repoFilePath = path.join(this.config.repoRoot, source);
    }

    // Try repo path first
    try {
      const content = await fs.readFile(repoFilePath, "utf-8");
      this.instructionCache.set(agentName, content);
      return content;
    } catch {
      // Fall through to bundled agents
    }

    // Fall back to bundled agent definitions shipped with the package
    if (agentFileName) {
      const bundledPath = path.join(BUNDLED_AGENTS_DIR, agentFileName);
      try {
        const content = await fs.readFile(bundledPath, "utf-8");
        this.instructionCache.set(agentName, content);
        return content;
      } catch {
        // Fall through to error
      }
    }

    throw new Error(
      `Failed to load agent instructions for "${agentName}": not found in repo (${repoFilePath}) or bundled defaults`,
    );
  }

  async createAgentSession(agentName: string, model?: string, sessionKey?: string): Promise<CopilotSession> {
    const instructions = await this.loadAgentInstructions(agentName);
    const session = await this.createSessionWithInstructions(instructions, model, agentName);
    if (sessionKey) this.recordSession(sessionKey, session, agentName, agentName);
    return session;
  }

  async createSessionWithInstructions(
    instructions: string,
    model?: string,
    agentLabel?: string,
  ): Promise<CopilotSession> {
    const resolvedModel = model ?? this.pipeline.primaryModel;
    const session = await this.client.createSession({
      model: resolvedModel,
      systemMessage: { mode: SYSTEM_MESSAGE_MODE, content: instructions },
    });

    const label = agentLabel ?? "agent";
    this._sessionModels.set(session.sessionId, resolvedModel);
    this._sessionLabels.set(session.sessionId, label);
    if (this.tracker) {
      this.tracker.addActiveAgent(session.sessionId, label, resolvedModel);
    }

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

  async send(session: CopilotSession, prompt: string, spinnerLabel?: string): Promise<string> {
    if (spinnerLabel) this.logger.startSpinner(spinnerLabel);
    const response = await session.sendAndWait({ prompt }, this.config.sessionTimeoutMs);
    this.logger.stopSpinner();
    this.logger.newline();
    return response?.data.content ?? "";
  }

  private async destroySession(session: CopilotSession): Promise<void> {
    const model = this._sessionModels.get(session.sessionId);
    if (model) {
      this.tracker?.removeActiveAgent(session.sessionId);
      this._sessionModels.delete(session.sessionId);
      this._sessionLabels.delete(session.sessionId);
    }
    await session.destroy();
  }

  async callIsolated(agentName: string, prompt: string, model?: string, sessionKey?: string): Promise<string> {
    const maxAttempts = this.config.maxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const session = await this.createAgentSession(agentName, model);
      if (sessionKey) this.recordSession(sessionKey, session, agentName, agentName);
      try {
        const content = await this.send(session, prompt, `${agentName} is working…`);
        if (!content && attempt < maxAttempts) {
          this.logger.warn(msg.emptyResponse(agentName, attempt, maxAttempts));
          continue;
        }
        return content;
      } catch (err) {
        this.logger.stopSpinner();
        this.logger.error(msg.callError(agentName, attempt, maxAttempts), err);
        if (attempt >= maxAttempts) throw err;
      } finally {
        await this.destroySession(session);
      }
    }
    return "";
  }

  async callIsolatedWithInstructions(
    instructions: string,
    prompt: string,
    spinnerLabel: string,
    model?: string,
    sessionKey?: string,
    agentLabel?: string,
  ): Promise<string> {
    const maxAttempts = this.config.maxRetries;
    const label = agentLabel ?? "agent";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const session = await this.createSessionWithInstructions(instructions, model, label);
      if (sessionKey) this.recordSession(sessionKey, session, "inline-agent", "inline-agent");
      try {
        const content = await this.send(session, prompt, spinnerLabel);
        if (!content && attempt < maxAttempts) {
          this.logger.warn(msg.emptyResponse("inline-agent", attempt, maxAttempts));
          continue;
        }
        return content;
      } catch (err) {
        this.logger.stopSpinner();
        this.logger.error(msg.callError("inline-agent", attempt, maxAttempts), err);
        if (attempt >= maxAttempts) throw err;
      } finally {
        await this.destroySession(session);
      }
    }
    return "";
  }
}
