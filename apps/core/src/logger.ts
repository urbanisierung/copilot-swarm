import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProgressTracker } from "./progress-tracker.js";

const LOG_DIR = path.join(os.tmpdir(), "copilot-swarm");

/** Thin logging wrapper for centralized output control. */
export class Logger {
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private tracker: ProgressTracker | null = null;
  private readonly logFile: string | null;
  private static readonly SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(
    private readonly verbose: boolean,
    runId: string,
  ) {
    this.logFile = this.initLogFile(runId);
  }

  /** Try to create the log file. Returns the path on success, null on failure. */
  private initLogFile(runId: string): string | null {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const filePath = path.join(LOG_DIR, `swarm-${runId}.log`);
      fs.writeFileSync(filePath, `# Copilot Swarm log — ${new Date().toISOString()}\n`);
      return filePath;
    } catch {
      return null;
    }
  }

  /** Append a line to the log file (fire-and-forget). */
  private appendLog(level: string, message: string): void {
    if (!this.logFile) return;
    try {
      const ts = new Date().toISOString();
      fs.appendFileSync(this.logFile, `${ts} [${level}] ${message}\n`);
    } catch {
      // Non-blocking — silently ignore write failures
    }
  }

  /** Path to the current run's log file, or null if logging failed to initialize. */
  get logFilePath(): string | null {
    return this.logFile;
  }

  /** Attach a progress tracker — routes all output to the TUI. */
  setTracker(tracker: ProgressTracker | null): void {
    this.tracker = tracker;
  }

  info(message: string): void {
    this.appendLog("INFO", message);
    if (this.tracker) {
      this.tracker.addLog(message);
      return;
    }
    console.log(message);
  }

  warn(message: string): void {
    this.appendLog("WARN", message);
    if (this.tracker) {
      this.tracker.addLog(message, "warn");
      return;
    }
    console.warn(message);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : String(err ?? "");
    const full = detail ? `${message}: ${detail}` : message;
    this.appendLog("ERROR", full);
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

  /** Log only when verbose mode is enabled. Always written to log file. */
  debug(message: string): void {
    this.appendLog("DEBUG", message);
    if (this.tracker) return;
    if (this.verbose) {
      console.log(message);
    }
  }

  /** Show an animated spinner with a message. No-op in verbose mode (streaming output is enough). */
  startSpinner(message: string): void {
    this.appendLog("INFO", `[spinner] ${message}`);
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
