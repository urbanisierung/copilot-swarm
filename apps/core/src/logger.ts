import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LogLevel } from "./config.js";
import { logLevelValue } from "./config.js";
import type { ProgressTracker } from "./progress-tracker.js";

const LOG_DIR = path.join(os.tmpdir(), "copilot-swarm");
const MAX_LOG_FILES = 20;
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Optional context attached to log entries for structured debugging. */
export interface LogContext {
  agent?: string;
  model?: string;
  phase?: string;
  stream?: number;
  attempt?: number;
  maxAttempts?: number;
  sessionId?: string;
  duration?: number;
  [key: string]: unknown;
}

/** Structured error details for log entries. */
export interface LogErrorDetail {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  category?: string;
  retryable?: boolean;
  cause?: string;
}

/** Extract structured error details from an unknown error. */
export function serializeError(err: unknown): LogErrorDetail | undefined {
  if (err == null) return undefined;
  if (err instanceof Error) {
    const detail: LogErrorDetail = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if ("code" in err && typeof (err as Record<string, unknown>).code === "string") {
      detail.code = (err as Record<string, unknown>).code as string;
    }
    if (err.cause instanceof Error) {
      detail.cause = `${err.cause.name}: ${err.cause.message}`;
    }
    const classified = classifyError(err);
    detail.category = classified.category;
    detail.retryable = classified.retryable;
    return detail;
  }
  return { name: "UnknownError", message: String(err) };
}

/** Error classification result. */
export interface ErrorClassification {
  category: "transient" | "permanent" | "unknown";
  type: string;
  retryable: boolean;
}

/** Classify an error as transient (retryable) or permanent based on error inspection. */
export function classifyError(err: unknown): ErrorClassification {
  if (!(err instanceof Error)) return { category: "unknown", type: "unknown", retryable: false };

  const msg = err.message.toLowerCase();
  const code = "code" in err ? String((err as Record<string, unknown>).code) : "";

  // Rate limits
  if (msg.includes("rate limit") || msg.includes("429") || code === "rate_limit") {
    return { category: "transient", type: "rate_limit", retryable: true };
  }
  // Timeouts
  if (msg.includes("timeout") || msg.includes("timed out") || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return { category: "transient", type: "timeout", retryable: true };
  }
  // Network errors
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    msg.includes("network") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed")
  ) {
    return { category: "transient", type: "network", retryable: true };
  }
  // Context length exceeded (check before server errors — large token numbers can contain "500")
  if (
    msg.includes("context length") ||
    msg.includes("too many tokens") ||
    msg.includes("token limit") ||
    msg.includes("token count") ||
    msg.includes("exceeds the limit") ||
    msg.includes("exceeds the maximum")
  ) {
    return { category: "permanent", type: "context_length", retryable: false };
  }
  // Server errors (5xx)
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) {
    return { category: "transient", type: "server_error", retryable: true };
  }
  // Auth errors
  if (
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("forbidden")
  ) {
    return { category: "permanent", type: "auth", retryable: false };
  }
  // Bad request
  if (msg.includes("400") || msg.includes("bad request") || msg.includes("invalid")) {
    return { category: "permanent", type: "bad_request", retryable: false };
  }

  // Check error.cause — wrapper errors (e.g. "streams failed in wave") may wrap a retryable cause
  if (err.cause) {
    const causeClassification = classifyError(err.cause);
    if (causeClassification.retryable) return causeClassification;
  }

  return { category: "unknown", type: "unknown", retryable: false };
}

/** A single JSON Lines log entry. */
interface LogEntry {
  ts: string;
  level: string;
  msg: string;
  ctx?: LogContext;
  error?: LogErrorDetail;
}

/** Thin logging wrapper with structured file logging and centralized output control. */
export class Logger {
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private tracker: ProgressTracker | null = null;
  private readonly logFile: string | null;
  private readonly levelNum: number;
  private static readonly SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(
    private readonly verbose: boolean,
    runId: string,
    logLevel: LogLevel = "info",
  ) {
    this.levelNum = logLevelValue(logLevel);
    pruneOldLogs();
    this.logFile = this.initLogFile(runId);
  }

  /** Try to create the log file. Returns the path on success, null on failure. */
  private initLogFile(runId: string): string | null {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const filePath = path.join(LOG_DIR, `swarm-${runId}.jsonl`);
      const header: LogEntry = { ts: new Date().toISOString(), level: "info", msg: "Copilot Swarm log started" };
      fs.writeFileSync(filePath, `${JSON.stringify(header)}\n`);
      return filePath;
    } catch {
      return null;
    }
  }

  /** Append a structured JSON log entry (fire-and-forget). */
  private appendLog(level: string, message: string, ctx?: LogContext, errorDetail?: LogErrorDetail): void {
    if (!this.logFile) return;
    try {
      const entry: LogEntry = { ts: new Date().toISOString(), level, msg: message };
      if (ctx && Object.keys(ctx).length > 0) entry.ctx = ctx;
      if (errorDetail) entry.error = errorDetail;
      fs.appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`);
    } catch {
      // Non-blocking — silently ignore write failures
    }
  }

  /** Check if a given level should be logged. */
  private shouldLog(level: LogLevel): boolean {
    return logLevelValue(level) <= this.levelNum;
  }

  /** Path to the current run's log file, or null if logging failed to initialize. */
  get logFilePath(): string | null {
    return this.logFile;
  }

  /** Attach a progress tracker — routes all output to the TUI. */
  setTracker(tracker: ProgressTracker | null): void {
    this.tracker = tracker;
  }

  info(message: string, ctx?: LogContext): void {
    if (this.shouldLog("info")) this.appendLog("info", message, ctx);
    if (this.tracker) {
      this.tracker.addLog(message);
      return;
    }
    console.log(message);
  }

  warn(message: string, ctx?: LogContext): void {
    if (this.shouldLog("warn")) this.appendLog("warn", message, ctx);
    if (this.tracker) {
      this.tracker.addLog(message, "warn");
      return;
    }
    console.warn(message);
  }

  error(message: string, err?: unknown, ctx?: LogContext): void {
    const errorDetail = serializeError(err);
    const detail = errorDetail?.message ?? "";
    const full = detail ? `${message}: ${detail}` : message;
    if (this.shouldLog("error")) this.appendLog("error", message, ctx, errorDetail);
    if (this.tracker) {
      this.tracker.addLog(full, "error");
      return;
    }
    console.error(full);
  }

  /** Write raw text to stdout (no newline). Used for streaming deltas. */
  write(text: string): void {
    if (this.tracker) return;
    if (this.verbose) {
      process.stdout.write(text);
    }
  }

  /** Write a newline to stdout. Used after streaming completes. */
  newline(): void {
    if (this.tracker) return;
    if (this.verbose) {
      process.stdout.write("\n");
    }
  }

  /** Log only when debug level is enabled. Always written to log file when level allows. */
  debug(message: string, ctx?: LogContext): void {
    if (this.shouldLog("debug")) this.appendLog("debug", message, ctx);
    if (this.tracker) return;
    if (this.verbose) {
      console.log(message);
    }
  }

  /** Show an animated spinner with a message. No-op in verbose mode (streaming output is enough). */
  startSpinner(message: string): void {
    this.appendLog("info", `[spinner] ${message}`);
    if (this.tracker) {
      this.tracker.setActiveAgent(message);
      return;
    }
    if (this.verbose) return;
    this.stopSpinner();
    this.spinnerFrame = 0;
    const frames = Logger.SPINNER_FRAMES;
    process.stdout.write(`${frames[0]} ${message}`);
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % frames.length;
      process.stdout.write(`\r${frames[this.spinnerFrame]} ${message}`);
    }, 80);
  }

  /** Stop the spinner and clear the line. */
  stopSpinner(): void {
    if (this.tracker) {
      this.tracker.setActiveAgent(null);
      return;
    }
    if (this.spinnerInterval !== null) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      process.stdout.write("\r\x1b[K");
    }
  }
}

/** Remove old log files (>7 days or >20 files). */
function pruneOldLogs(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("swarm-") && (f.endsWith(".jsonl") || f.endsWith(".log")))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const now = Date.now();
    for (let i = 0; i < files.length; i++) {
      if (i >= MAX_LOG_FILES || now - files[i].mtime > MAX_LOG_AGE_MS) {
        try {
          fs.unlinkSync(path.join(LOG_DIR, files[i].name));
        } catch {
          // Ignore individual deletion failures
        }
      }
    }
  } catch {
    // Non-blocking — don't fail if pruning fails
  }
}

/** List recent log files sorted by newest first. */
export function listRecentLogs(): { name: string; path: string; size: string }[] {
  try {
    if (!fs.existsSync(LOG_DIR)) return [];
    return fs
      .readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("swarm-") && (f.endsWith(".jsonl") || f.endsWith(".log")))
      .map((f) => {
        const fullPath = path.join(LOG_DIR, f);
        const stat = fs.statSync(fullPath);
        const kb = (stat.size / 1024).toFixed(1);
        return { name: f, path: fullPath, size: `${kb} KB`, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map(({ name, path: p, size }) => ({ name, path: p, size }));
  } catch {
    return [];
  }
}
