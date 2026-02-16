import type { ProgressTracker, StreamInfo, StreamStatus } from "./progress-tracker.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PHASE_ICON: Record<string, string> = {
  pending: "○",
  done: "✅",
  skipped: "⏭",
};

const STREAM_DISPLAY: Record<StreamStatus, { icon: string; label: string }> = {
  queued: { icon: "○", label: "Queued" },
  engineering: { icon: "🔨", label: "Coding" },
  reviewing: { icon: "🔍", label: "Review" },
  testing: { icon: "🧪", label: "Testing" },
  done: { icon: "✅", label: "Done" },
  failed: { icon: "❌", label: "Failed" },
  skipped: { icon: "⏭", label: "Skipped" },
};

const RENDER_INTERVAL_MS = 100;

export class TuiRenderer {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private cleanedUp = false;
  private readonly onExit = () => this.cleanup();

  constructor(private readonly tracker: ProgressTracker) {}

  start(): void {
    process.stdout.write("\x1b[?1049h"); // Alternate screen
    process.stdout.write("\x1b[?25l"); // Hide cursor

    process.on("exit", this.onExit);

    this.interval = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.render();
    }, RENDER_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.render();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    process.stdout.write("\x1b[?25h"); // Show cursor
    process.stdout.write("\x1b[?1049l"); // Leave alternate screen
    process.removeListener("exit", this.onExit);
  }

  private render(): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const width = Math.min(cols, 120);
    const lines: string[] = [];
    const spin = SPINNER[this.frame];
    const sep = `  ${"─".repeat(width - 4)}`;

    // ── Header ──
    const elapsed = this.fmtElapsed(this.tracker.elapsedMs);
    lines.push("");
    lines.push(`  🐝 Copilot Swarm${this.pad(width - 20 - elapsed.length)}${elapsed}`);
    lines.push(sep);
    lines.push("");

    // ── Phases ──
    for (const phase of this.tracker.phases) {
      const icon = phase.status === "active" ? spin : (PHASE_ICON[phase.status] ?? "○");
      let line = `  ${icon}  ${phase.name}`;
      if (phase.status === "active" && this.tracker.activeAgent) {
        const agent = this.trunc(this.tracker.activeAgent, width - this.visLen(line) - 4);
        line += `  \x1b[2m${agent}\x1b[0m`;
      }
      lines.push(line);
    }
    lines.push("");

    // ── Streams ──
    if (this.tracker.streams.length > 0) {
      lines.push("  Streams");
      for (const s of this.tracker.streams) {
        const d = this.streamIcon(s, spin);
        const task = this.trunc(s.task, width - 24);
        lines.push(`    ${s.label}  ${d.icon} ${d.label.padEnd(8)} ${task}`);
      }
      lines.push("");
    }

    // ── Activity log ──
    lines.push(sep);
    const footerH = 3;
    const logSpace = Math.max(3, rows - lines.length - footerH);
    const recent = this.tracker.logs.slice(-logSpace);

    lines.push("  Activity");
    for (const log of recent) {
      const t = log.time.toTimeString().slice(0, 5);
      const pfx = log.level === "warn" ? "⚠" : log.level === "error" ? "✖" : " ";
      const text = this.trunc(this.clean(log.message), width - 14);
      lines.push(`  ${pfx} ${t}  ${text}`);
    }

    // ── Pad remaining rows ──
    while (lines.length < rows - footerH) {
      lines.push("");
    }

    // ── Footer ──
    lines.push(sep);
    const progress = `Phase ${this.tracker.completedPhaseCount}/${this.tracker.totalPhaseCount}`;
    const hint = "  \x1b[2m--no-tui for plain output\x1b[0m";
    // hint visible length = 26
    const fPad = width - 26 - progress.length;
    lines.push(`${hint}${this.pad(Math.max(1, fPad))}${progress}`);

    // ── Write frame ──
    process.stdout.write("\x1b[H");
    process.stdout.write(lines.join("\n"));
  }

  private streamIcon(s: StreamInfo, spin: string): { icon: string; label: string } {
    const d = STREAM_DISPLAY[s.status];
    const active = s.status === "engineering" || s.status === "reviewing" || s.status === "testing";
    return { icon: active ? spin : d.icon, label: d.label };
  }

  private fmtElapsed(ms: number): string {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  private trunc(text: string, max: number): string {
    if (max <= 0) return "";
    const flat = text.replace(/\n/g, " ");
    if (flat.length <= max) return flat;
    return `${flat.substring(0, max - 1)}…`;
  }

  /** Remove leading emoji + whitespace for cleaner log display. */
  private clean(message: string): string {
    return message.replace(/^\s*(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})+\s*/u, "").trim();
  }

  /** Approximate visible length (ignores ANSI escape sequences). */
  private visLen(s: string): number {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching ESC
    return s.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  private pad(n: number): string {
    return " ".repeat(Math.max(0, n));
  }
}
