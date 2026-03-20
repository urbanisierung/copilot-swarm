import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CopilotSession } from "@github/copilot-sdk";
import { CopilotClient } from "@github/copilot-sdk";
import { syncStats } from "./central-store.js";
import type { SessionRecord } from "./checkpoint.js";
import type { SwarmConfig } from "./config.js";
import { BUILTIN_AGENT_PREFIX, SessionEvent, SYSTEM_MESSAGE_MODE } from "./constants.js";
import { ContextLengthError, shouldRetry, smartTruncate } from "./errors.js";
import type { Logger } from "./logger.js";
import { msg } from "./messages.js";
import type { PipelineConfig } from "./pipeline-types.js";
import type { ProgressTracker } from "./progress-tracker.js";
import { recordAgentInvocation } from "./stats.js";

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLED_AGENTS_DIR = path.join(PACKAGE_DIR, "defaults", "agents");

const SUMMARIZE_INSTRUCTIONS = `You are a technical content compressor. Condense the provided content to approximately the requested size while preserving ALL critical information.

Rules:
1. Preserve ALL: file paths, function/class names, API endpoints, error messages, config keys
2. Preserve ALL: requirements, constraints, decisions, and their rationale
3. Preserve ALL: code snippets, type definitions, and interfaces
4. Remove: verbose explanations, repeated context, redundant examples
5. Use concise language — bullet points over paragraphs
6. Output ONLY the condensed content, no preamble or meta-commentary`;

export class SessionManager {
  private readonly client: CopilotClient;
  private readonly instructionCache = new Map<string, string>();
  private readonly _sessionLog: Record<string, SessionRecord> = {};
  private readonly _sessionModels = new Map<string, string>();
  private readonly _sessionLabels = new Map<string, string>();
  private readonly _sessionStartTimes = new Map<string, number>();
  private readonly _sessionInstructions = new Map<string, string>();
  private tracker?: ProgressTracker;

  constructor(
    private readonly config: SwarmConfig,
    private readonly pipeline: PipelineConfig,
    private readonly logger: Logger,
  ) {
    this.client = new CopilotClient({
      logLevel: config.logLevel === "debug" ? "debug" : "warning",
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

  /** Files modified by a session via edit_file tool calls, keyed by sessionId. */
  private readonly _editedFiles = new Map<string, Set<string>>();

  /**
   * Start tracking files modified via `edit_file` tool calls for the given session.
   * Returns the live Set that accumulates file paths as the agent works.
   */
  trackEditedFiles(session: CopilotSession): Set<string> {
    const files = new Set<string>();
    this._editedFiles.set(session.sessionId, files);
    session.on(SessionEvent.TOOL_EXECUTION_START, (e) => {
      if (e.data.toolName === "edit_file" && e.data.arguments) {
        const args = e.data.arguments as Record<string, unknown>;
        const filePath = (args.path ?? args.file ?? args.filePath) as string | undefined;
        if (typeof filePath === "string") {
          files.add(filePath);
        }
      }
    });
    return files;
  }

  /** Get the set of files edited by a session, if tracking was enabled. */
  getEditedFiles(session: CopilotSession): ReadonlySet<string> {
    return this._editedFiles.get(session.sessionId) ?? new Set();
  }

  async createSessionWithInstructions(
    instructions: string,
    model?: string,
    agentLabel?: string,
  ): Promise<CopilotSession> {
    const resolvedModel = model ?? this.pipeline.primaryModel;
    const hookLogger = this.logger;
    const session = await this.client.createSession({
      model: resolvedModel,
      systemMessage: { mode: SYSTEM_MESSAGE_MODE, content: instructions },
      onPermissionRequest: async () => ({ kind: "approved" }),
      hooks: {
        onErrorOccurred: async (input) => {
          const errLower = input.error.toLowerCase();
          // Abort immediately on permanent errors — don't let the CLI retry them
          if (
            errLower.includes("token count") ||
            errLower.includes("exceeds the limit") ||
            errLower.includes("exceeds the maximum") ||
            errLower.includes("context length") ||
            errLower.includes("too many tokens") ||
            errLower.includes("token limit") ||
            errLower.includes("unauthorized") ||
            errLower.includes("forbidden") ||
            errLower.includes("authentication")
          ) {
            hookLogger.debug(`  ⛔ Aborting CLI retry for permanent error: ${input.error.substring(0, 120)}`);
            return { errorHandling: "abort" };
          }
          hookLogger.debug(`  ↻ Allowing CLI retry for: ${input.error.substring(0, 120)}`);
          return { errorHandling: "retry" };
        },
      },
    });

    const label = agentLabel ?? "agent";
    this._sessionModels.set(session.sessionId, resolvedModel);
    this._sessionLabels.set(session.sessionId, label);
    this._sessionStartTimes.set(session.sessionId, Date.now());
    this._sessionInstructions.set(session.sessionId, instructions);
    if (this.tracker) {
      this.tracker.addActiveAgent(session.sessionId, label, resolvedModel);
    }

    // Always log SDK events to the structured log file
    const ctx = { agent: label, model: resolvedModel, sessionId: session.sessionId };
    session.on(SessionEvent.TOOL_EXECUTION_START, (e) => {
      this.logger.debug(msg.toolExecution(e.data.toolName), ctx);
    });
    session.on(SessionEvent.INTENT, (e) => {
      this.logger.debug(msg.intentUpdate(e.data.intent), ctx);
    });

    // Verbose mode additionally streams deltas to stdout
    if (this.config.verbose) {
      session.on(SessionEvent.MESSAGE_DELTA, (e) => {
        this.logger.write(e.data.deltaContent);
      });
    }

    return session;
  }

  async send(session: CopilotSession, prompt: string, spinnerLabel?: string, collectAll = false): Promise<string> {
    // Pre-flight safety net: sync smart-truncation if prompt would exceed budget.
    // This catches ALL code paths (multi-turn conversations, direct send() callers).
    const safePrompt = this.truncateForSend(session.sessionId, prompt);

    const allContent: string[] = [];
    let unsub: (() => void) | undefined;

    if (collectAll) {
      unsub = session.on("assistant.message", (e) => {
        if (e.data.content) {
          allContent.push(e.data.content);
        }
      });
    }

    if (spinnerLabel) this.logger.startSpinner(spinnerLabel);
    const response = await session.sendAndWait({ prompt: safePrompt }, this.config.sessionTimeoutMs);
    this.logger.stopSpinner();
    this.logger.newline();
    unsub?.();

    if (collectAll) {
      return allContent.join("\n\n");
    }
    return response?.data.content ?? "";
  }

  /**
   * Sync pre-flight check for send(). Applies smart truncation if the prompt
   * would exceed the token budget. This is a safety net — callers using
   * callIsolated/callIsolatedWithInstructions get the full AI summarization
   * treatment via fitToTokenBudget() before reaching here.
   */
  private truncateForSend(sessionId: string, prompt: string): string {
    const instructions = this._sessionInstructions.get(sessionId) ?? "";
    const limit = SessionManager.CONTEXT_LIMIT;
    const cpt = SessionManager.CHARS_PER_TOKEN;
    const budget = Math.floor(limit * SessionManager.PROMPT_BUDGET_RATIO) - SessionManager.SDK_OVERHEAD_TOKENS;
    const systemTokens = Math.ceil(instructions.length / cpt);
    const promptTokens = Math.ceil(prompt.length / cpt);
    const total = systemTokens + promptTokens;

    if (total <= budget) return prompt;

    const availableTokens = Math.max(budget - systemTokens, 1000);
    const label = this._sessionLabels.get(sessionId) ?? "agent";
    this.logger.warn(
      `  ✂️  send() pre-flight: ${label} prompt too large (~${total} est. tokens, budget ${budget}). Applying smart truncation.`,
    );
    // Convert our budget tokens (chars/3) to smartTruncate's expected format (chars/4)
    const truncateTarget = Math.floor((availableTokens * cpt) / 4);
    return smartTruncate(prompt, truncateTarget);
  }

  async destroySession(session: CopilotSession): Promise<void> {
    const model = this._sessionModels.get(session.sessionId);
    const label = this._sessionLabels.get(session.sessionId);
    const startTime = this._sessionStartTimes.get(session.sessionId);
    if (model) {
      this.tracker?.removeActiveAgent(session.sessionId);
      this._sessionModels.delete(session.sessionId);
      this._sessionLabels.delete(session.sessionId);
      // Record agent stats (fire-and-forget)
      if (label && startTime) {
        const elapsedMs = Date.now() - startTime;
        recordAgentInvocation(this.config, label, model, elapsedMs)
          .then(() => syncStats(this.config))
          .catch(() => {});
      }
    }
    this._sessionStartTimes.delete(session.sessionId);
    this._sessionInstructions.delete(session.sessionId);
    this._editedFiles.delete(session.sessionId);
    await session.destroy();
  }

  // The API enforces a hard prompt token limit (system message + user prompt).
  // Default matches the limit reported by the Copilot API. Configure with MODEL_CONTEXT_LIMIT.
  private static readonly CONTEXT_LIMIT = (() => {
    const env = process.env.MODEL_CONTEXT_LIMIT;
    if (env) {
      const n = Number.parseInt(env, 10);
      if (n > 0) return n;
    }
    return 136_000;
  })();
  // Conservative chars-per-token ratio for pre-flight estimation. Code-heavy content
  // tokenizes at ~3-3.5 chars/token (not the typical 4 for English prose). Using 3
  // ensures we catch oversized prompts before they reach the API.
  private static readonly CHARS_PER_TOKEN = 3;
  // 10% margin on top of the conservative estimation for additional safety.
  private static readonly PROMPT_BUDGET_RATIO = 0.9;
  // The Copilot SDK adds its full system prompt, tool definitions (edit_file, run_command,
  // search, etc.), and workspace context on top of our system message. This overhead counts
  // toward the API's token limit but is invisible to us. Empirically measured at ~100K tokens
  // for standard Copilot sessions with the full tool suite.
  private static readonly SDK_OVERHEAD_TOKENS = 100_000;

  /**
   * Pre-flight check: if system message + prompt would exceed the model's token limit,
   * intelligently reduce the prompt to fit. For small overages, uses smart truncation
   * (keeps beginning + end). For larger overages, uses the fast model to summarize
   * the excess content, preserving key information instead of losing it.
   */
  private async fitToTokenBudget(systemMessage: string, prompt: string, label: string): Promise<string> {
    const limit = SessionManager.CONTEXT_LIMIT;
    const cpt = SessionManager.CHARS_PER_TOKEN;
    const budget = Math.floor(limit * SessionManager.PROMPT_BUDGET_RATIO) - SessionManager.SDK_OVERHEAD_TOKENS;
    const systemTokens = Math.ceil(systemMessage.length / cpt);
    const promptTokens = Math.ceil(prompt.length / cpt);
    const total = systemTokens + promptTokens;

    if (total <= budget) return prompt;

    const availableTokens = Math.max(budget - systemTokens, 1000);
    const overage = total - budget;
    const overageRatio = overage / budget;
    this.logger.warn(
      `  ✂️  Pre-flight: ${label} prompt too large (~${total} est. tokens, budget ${budget}). Overage: ${overage} tokens (${Math.round(overageRatio * 100)}%).`,
    );

    // Small overages (< 5%): smart truncation is fast and sufficient
    if (overageRatio < 0.05) {
      this.logger.info("  📐 Using smart truncation (small overage)");
      const truncateTarget = Math.floor((availableTokens * cpt) / 4);
      return smartTruncate(prompt, truncateTarget);
    }

    // Larger overages: try AI-powered summarization to preserve key information
    try {
      this.logger.info("  🤖 Using AI summarization to preserve key information");
      return await this.summarizeToFit(prompt, availableTokens, label);
    } catch (err) {
      this.logger.warn(
        `  ⚠️  AI summarization failed, falling back to smart truncation: ${err instanceof Error ? err.message : err}`,
      );
      const truncateTarget = Math.floor((availableTokens * cpt) / 4);
      return smartTruncate(prompt, truncateTarget);
    }
  }

  /**
   * Summarize a prompt to fit within a token budget using the fast model.
   * Keeps the first portion intact (task context) and summarizes the rest.
   */
  private async summarizeToFit(prompt: string, targetTokens: number, label: string): Promise<string> {
    const cpt = SessionManager.CHARS_PER_TOKEN;
    // Keep first 50% intact (task context, role setup), summarize the rest
    const keepTokens = Math.floor(targetTokens * 0.5);
    const summaryTarget = targetTokens - keepTokens;
    const keepChars = keepTokens * cpt;
    const keptPortion = prompt.substring(0, keepChars);
    const restPortion = prompt.substring(keepChars);

    if (!restPortion.trim()) return keptPortion;

    // Chunk if the rest is too large for a single summarization call
    const maxChunkTokens = 100_000;
    const restTokens = Math.ceil(restPortion.length / cpt);
    const numChunks = Math.max(1, Math.ceil(restTokens / maxChunkTokens));
    const chunkChars = Math.ceil(restPortion.length / numChunks);
    const summaryPerChunk = Math.floor(summaryTarget / numChunks);

    const chunks: string[] = [];
    for (let i = 0; i < numChunks; i++) {
      chunks.push(restPortion.substring(i * chunkChars, (i + 1) * chunkChars));
    }

    // Summarize chunks in parallel
    const summaries = await Promise.all(
      chunks.map((chunk, i) => this.summarizeChunk(chunk, summaryPerChunk, label, i + 1, numChunks)),
    );

    const marker =
      numChunks > 1
        ? `[AI-summarized from ${numChunks} sections to fit token budget]`
        : "[AI-summarized to fit token budget]";

    return `${keptPortion}\n\n${marker}\n\n${summaries.join("\n\n")}`;
  }

  /** Summarize a single chunk using the fast model. Direct session call to avoid recursion. */
  private async summarizeChunk(
    content: string,
    targetTokens: number,
    label: string,
    chunkIndex: number,
    totalChunks: number,
  ): Promise<string> {
    const cpt = SessionManager.CHARS_PER_TOKEN;
    const targetChars = targetTokens * cpt;
    const chunkLabel = totalChunks > 1 ? `${label}/summarizer-${chunkIndex}` : `${label}/summarizer`;
    const session = await this.createSessionWithInstructions(
      SUMMARIZE_INSTRUCTIONS,
      this.pipeline.fastModel,
      chunkLabel,
    );
    try {
      const prompt = `Condense the following content to approximately ${targetChars} characters (~${targetTokens} tokens). Preserve all critical technical details.\n\n---\n\n${content}`;
      const chunkProgress = totalChunks > 1 ? ` (${chunkIndex}/${totalChunks})` : "";
      const response = await this.send(session, prompt, `Summarizing content${chunkProgress}…`);
      const truncateTarget = Math.floor((targetTokens * cpt) / 4);
      return response || smartTruncate(content, truncateTarget);
    } catch {
      const truncateTarget = Math.floor((targetTokens * cpt) / 4);
      return smartTruncate(content, truncateTarget);
    } finally {
      await this.destroySession(session);
    }
  }

  async callIsolated(agentName: string, prompt: string, model?: string, sessionKey?: string): Promise<string> {
    const maxAttempts = this.config.maxRetries;
    const resolvedModel = model ?? this.pipeline.primaryModel;
    const instructions = await this.loadAgentInstructions(agentName);
    const safePrompt = await this.fitToTokenBudget(instructions, prompt, agentName);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const session = await this.createAgentSession(agentName, model);
      if (sessionKey) this.recordSession(sessionKey, session, agentName, agentName);
      const ctx = { agent: agentName, model: resolvedModel, attempt, maxAttempts, sessionId: session.sessionId };
      try {
        const content = await this.send(session, safePrompt, `${agentName} is working…`);
        if (!content && attempt < maxAttempts) {
          this.logger.warn(msg.emptyResponse(agentName, attempt, maxAttempts), ctx);
          continue;
        }
        return content;
      } catch (err) {
        this.logger.stopSpinner();
        this.logger.error(msg.callError(agentName, attempt, maxAttempts), err, ctx);

        // Throw typed error for context-length so callers can recover
        const ctxErr = ContextLengthError.fromError(err);
        if (ctxErr) throw ctxErr;

        const decision = shouldRetry(err, attempt, maxAttempts);
        if (!decision.shouldRetry) throw err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`  ↻ Retrying (${decision.reason}), backoff ${decision.delayMs}ms`, ctx);
        if (decision.delayMs > 0) await sleep(decision.delayMs);
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
    collectAll?: boolean,
  ): Promise<string> {
    const maxAttempts = this.config.maxRetries;
    const label = agentLabel ?? "agent";
    const resolvedModel = model ?? this.pipeline.primaryModel;
    const safePrompt = await this.fitToTokenBudget(instructions, prompt, label);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const session = await this.createSessionWithInstructions(instructions, model, label);
      if (sessionKey) this.recordSession(sessionKey, session, "inline-agent", "inline-agent");
      const ctx = { agent: label, model: resolvedModel, attempt, maxAttempts, sessionId: session.sessionId };
      try {
        const content = await this.send(session, safePrompt, spinnerLabel, collectAll);
        if (!content && attempt < maxAttempts) {
          this.logger.warn(msg.emptyResponse("inline-agent", attempt, maxAttempts), ctx);
          continue;
        }
        return content;
      } catch (err) {
        this.logger.stopSpinner();
        this.logger.error(msg.callError("inline-agent", attempt, maxAttempts), err, ctx);

        const ctxErr = ContextLengthError.fromError(err);
        if (ctxErr) throw ctxErr;

        const decision = shouldRetry(err, attempt, maxAttempts);
        if (!decision.shouldRetry) throw err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`  ↻ Retrying (${decision.reason}), backoff ${decision.delayMs}ms`, ctx);
        if (decision.delayMs > 0) await sleep(decision.delayMs);
      } finally {
        await this.destroySession(session);
      }
    }
    return "";
  }

  /**
   * Classify whether a task requires the primary model or can use the fast model.
   * Uses the fast model itself to make the assessment — returns the selected model name.
   */
  async classifyModelForTask(taskDescription: string): Promise<string> {
    const instructions =
      "You are a task complexity classifier. Given a task description, decide if it needs a powerful model or if a fast/lightweight model suffices.\n\n" +
      "Reply with EXACTLY one word: PRIMARY or FAST.\n\n" +
      "Use PRIMARY for: complex architecture, multi-file refactoring, nuanced logic, security-sensitive code, novel algorithms.\n" +
      "Use FAST for: simple CRUD, config changes, renaming, adding tests for existing code, documentation, straightforward bug fixes, boilerplate.";

    const session = await this.createSessionWithInstructions(instructions, this.pipeline.fastModel, "model-classifier");
    try {
      const response = await this.send(session, `Task: ${taskDescription}`, "Classifying task complexity…");
      const answer = response.trim().toUpperCase();
      if (answer.includes("FAST")) {
        return this.pipeline.fastModel;
      }
      return this.pipeline.primaryModel;
    } catch {
      // On failure, default to primary model
      return this.pipeline.primaryModel;
    } finally {
      await this.destroySession(session);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
