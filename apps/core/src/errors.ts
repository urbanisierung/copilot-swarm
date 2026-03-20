import { classifyError } from "./logger.js";

// ---------------------------------------------------------------------------
// Context-length error
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /token count of (\d+) exceeds.*?limit of (\d+)/i;
const TOKEN_PATTERN_ALT = /(\d+)\s*tokens?\s*exceeds?\s*(?:the\s*)?(?:limit|maximum)\s*(?:of\s*)?(\d+)/i;

/** Typed error for prompt-too-large failures. Carries token metrics for recovery. */
export class ContextLengthError extends Error {
  readonly promptTokens: number;
  readonly limit: number;
  readonly overage: number;

  constructor(original: Error, promptTokens: number, limit: number) {
    super(original.message);
    this.name = "ContextLengthError";
    this.promptTokens = promptTokens;
    this.limit = limit;
    this.overage = promptTokens - limit;
    this.cause = original;
    if (original.stack) this.stack = original.stack;
  }

  /** Parse token counts from an API error message. Returns null if not a context-length error. */
  static fromError(err: unknown): ContextLengthError | null {
    if (!(err instanceof Error)) return null;
    const classification = classifyError(err);
    if (classification.type !== "context_length") return null;

    const msg = err.message;
    const match = msg.match(TOKEN_PATTERN) ?? msg.match(TOKEN_PATTERN_ALT);
    if (match) {
      return new ContextLengthError(err, Number(match[1]), Number(match[2]));
    }
    // Context-length error but couldn't parse exact numbers
    return new ContextLengthError(err, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Retry decision helpers
// ---------------------------------------------------------------------------

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  /** Suggested delay in ms before retrying (0 = immediate). */
  delayMs: number;
}

/** Decide whether an error should be retried, and with what backoff. */
export function shouldRetry(err: unknown, attempt: number, maxAttempts: number): RetryDecision {
  if (attempt >= maxAttempts) {
    return { shouldRetry: false, reason: "max attempts reached", delayMs: 0 };
  }

  const classification = classifyError(err);

  if (classification.type === "context_length") {
    return { shouldRetry: false, reason: "context length exceeded — needs recovery, not retry", delayMs: 0 };
  }

  if (!classification.retryable) {
    return { shouldRetry: false, reason: `permanent error: ${classification.type}`, delayMs: 0 };
  }

  // Exponential backoff for transient errors: 1s, 2s, 4s, 8s...
  const delayMs =
    classification.type === "rate_limit"
      ? Math.min(1000 * 2 ** attempt, 30_000) // rate limits get longer backoff
      : Math.min(1000 * 2 ** (attempt - 1), 16_000);

  return { shouldRetry: true, reason: `transient error: ${classification.type}`, delayMs };
}

// ---------------------------------------------------------------------------
// Prompt component model for pre-flight checks and reduction
// ---------------------------------------------------------------------------

export interface PromptComponent {
  label: string;
  content: string;
  /** Lower priority = more important. Components with higher priority get trimmed first. */
  priority: number;
  /** Whether this component can be dropped entirely. */
  droppable: boolean;
  /** Max tokens before truncation (optional, uses full content if unset). */
  maxTokens?: number;
}

export interface TokenBudgetReport {
  totalTokens: number;
  limit: number;
  overBudget: boolean;
  overage: number;
  components: Array<{ label: string; tokens: number; percentage: number }>;
}

/** Estimate tokens for a prompt (system message + user prompt combined). */
export function estimateCallTokens(components: PromptComponent[], contextLimit: number): TokenBudgetReport {
  const RESPONSE_RESERVE = 0.3; // 30% for response
  const limit = Math.floor(contextLimit * (1 - RESPONSE_RESERVE));

  const breakdown = components.map((c) => {
    const tokens = Math.ceil(c.content.length / 4);
    return { label: c.label, tokens, percentage: 0 };
  });

  const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);
  for (const b of breakdown) {
    b.percentage = totalTokens > 0 ? Math.round((b.tokens / totalTokens) * 100) : 0;
  }

  return {
    totalTokens,
    limit,
    overBudget: totalTokens > limit,
    overage: Math.max(0, totalTokens - limit),
    components: breakdown,
  };
}

/**
 * Progressively reduce prompt components to fit within a token budget.
 * Mutates component content in priority order (highest priority number first).
 * Returns the reduced components and whether reduction succeeded.
 */
export function reducePrompt(
  components: PromptComponent[],
  contextLimit: number,
): { components: PromptComponent[]; succeeded: boolean; report: TokenBudgetReport } {
  const RESPONSE_RESERVE = 0.3;
  const limit = Math.floor(contextLimit * (1 - RESPONSE_RESERVE));
  const result = components.map((c) => ({ ...c, content: c.content }));

  // Sort by priority desc (highest number = least important = trim first)
  const trimOrder = [...result].sort((a, b) => b.priority - a.priority);

  for (const comp of trimOrder) {
    const total = result.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0);
    if (total <= limit) break;

    const target = result.find((c) => c.label === comp.label);
    if (!target) continue;

    // Try truncation first
    if (target.maxTokens) {
      const charLimit = target.maxTokens * 4;
      if (target.content.length > charLimit) {
        target.content = `${target.content.substring(0, charLimit)}\n\n[… truncated to fit token budget …]`;
        continue;
      }
    }

    // Halve the content
    const currentTokens = Math.ceil(target.content.length / 4);
    if (currentTokens > 500) {
      const halfChars = Math.floor(target.content.length / 2);
      target.content = `${target.content.substring(0, halfChars)}\n\n[… truncated to fit token budget …]`;
      const newTotal = result.reduce((sum, c) => sum + Math.ceil(c.content.length / 4), 0);
      if (newTotal <= limit) break;
    }

    // Drop entirely if droppable
    if (target.droppable) {
      target.content = "";
    }
  }

  const report = estimateCallTokens(result, contextLimit);
  return { components: result, succeeded: !report.overBudget, report };
}

// ---------------------------------------------------------------------------
// AI recovery agent instructions
// ---------------------------------------------------------------------------

export const AI_RECOVERY_INSTRUCTIONS = `You are an error recovery specialist. A prompt to an AI model failed because it exceeded the token limit.

Your job: analyze the component breakdown and decide what to reduce so the prompt fits within the budget.

You will receive:
- The token limit and current total
- A breakdown of each prompt component (label, token count, whether it's droppable)

Respond with EXACTLY a JSON array of recovery actions. Each action is one of:
- {"action":"truncate","label":"<component label>","maxTokens":<number>} — truncate to N tokens
- {"action":"drop","label":"<component label>"} — remove entirely
- {"action":"summarize","label":"<component label>","maxTokens":<number>} — ask caller to summarize to N tokens

Rules:
1. Remove the MINIMUM needed to fit within budget
2. Never drop or truncate the "task" or "error report" components — those are critical
3. Prefer truncating large components (repo context, implementation) over dropping them
4. If spec is very large, truncate it rather than drop it
5. Output ONLY the JSON array, no explanation`;

/** Build the prompt for the AI recovery agent. */
export function buildRecoveryPrompt(
  error: ContextLengthError,
  components: PromptComponent[],
  contextLimit: number,
): string {
  const RESPONSE_RESERVE = 0.3;
  const limit = Math.floor(contextLimit * (1 - RESPONSE_RESERVE));
  const breakdown = components.map((c) => ({
    label: c.label,
    tokens: Math.ceil(c.content.length / 4),
    priority: c.priority,
    droppable: c.droppable,
  }));
  const total = breakdown.reduce((sum, b) => sum + b.tokens, 0);

  return [
    `Token limit: ${limit} (model hard limit: ${error.limit || contextLimit})`,
    `Current total: ${total} tokens (overage: ${Math.max(0, total - limit)})`,
    "",
    "Component breakdown:",
    ...breakdown.map((b) => `  - ${b.label}: ${b.tokens} tokens (priority: ${b.priority}, droppable: ${b.droppable})`),
    "",
    "Decide what to reduce. Output JSON array of actions.",
  ].join("\n");
}

/** Parse the AI recovery agent's response into typed actions. */
export function parseRecoveryActions(
  raw: string,
): Array<{ action: "truncate" | "drop" | "summarize"; label: string; maxTokens?: number }> {
  // Extract JSON array from response (may have markdown fencing)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a: unknown) =>
        typeof a === "object" &&
        a !== null &&
        "action" in a &&
        "label" in a &&
        typeof (a as Record<string, unknown>).action === "string" &&
        typeof (a as Record<string, unknown>).label === "string",
    );
  } catch {
    return [];
  }
}

/** Apply recovery actions to prompt components. Returns reduced components. */
export function applyRecoveryActions(
  components: PromptComponent[],
  actions: Array<{ action: string; label: string; maxTokens?: number }>,
): PromptComponent[] {
  const result = components.map((c) => ({ ...c }));
  for (const action of actions) {
    const target = result.find((c) => c.label === action.label);
    if (!target) continue;

    switch (action.action) {
      case "drop":
        if (target.droppable) target.content = "";
        break;
      case "truncate":
      case "summarize": {
        const max = action.maxTokens ?? Math.ceil(target.content.length / 8);
        const charLimit = max * 4;
        if (target.content.length > charLimit) {
          target.content = `${target.content.substring(0, charLimit)}\n\n[… truncated by AI recovery agent …]`;
        }
        break;
      }
    }
  }
  return result;
}
