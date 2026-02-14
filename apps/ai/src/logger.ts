/** Thin logging wrapper for centralized output control. */
export class Logger {
  constructor(private readonly verbose: boolean) {}

  info(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(message);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : String(err ?? "");
    console.error(detail ? `${message}: ${detail}` : message);
  }

  /** Write raw text to stdout (no newline). Used for streaming deltas. */
  write(text: string): void {
    if (this.verbose) {
      process.stdout.write(text);
    }
  }

  /** Write a newline to stdout. Used after streaming completes. */
  newline(): void {
    if (this.verbose) {
      process.stdout.write("\n");
    }
  }

  /** Log only when verbose mode is enabled. */
  debug(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }
}
