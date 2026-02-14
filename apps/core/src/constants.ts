/** Copilot SDK session event names. */
export const SessionEvent = {
  MESSAGE_DELTA: "assistant.message_delta",
  TOOL_EXECUTION_START: "tool.execution_start",
  INTENT: "assistant.intent",
} as const;

/** Response keywords used by agents to signal decisions. */
export const ResponseKeyword = {
  APPROVED: "APPROVED",
  ALL_PASSED: "ALL_PASSED",
  CLARIFICATION_NEEDED: "CLARIFICATION_NEEDED",
  REQUIREMENTS_CLEAR: "REQUIREMENTS_CLEAR",
} as const;

/** Marker prefix for frontend tasks in task decomposition. */
export const FRONTEND_MARKER = "[FRONTEND]";

/** Keywords that indicate a task involves frontend work. */
export const FRONTEND_KEYWORDS = [
  "frontend",
  "ui",
  "component",
  "page",
  "view",
  "layout",
  "style",
  "react",
  "design",
] as const;

/** System message injection mode for Copilot sessions. */
export const SYSTEM_MESSAGE_MODE = "append" as const;

/** Prefix for built-in agent instruction references. */
export const BUILTIN_AGENT_PREFIX = "builtin:" as const;
