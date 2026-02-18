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

  /** Temporarily leave TUI (e.g. for interactive user input). */
  pause(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write("\x1b[?25h"); // Show cursor
    process.stdout.write("\x1b[?1049l"); // Leave alternate screen
  }

  /** Re-enter TUI after a pause. */
  resume(): void {
    process.stdout.write("\x1b[?1049h"); // Alternate screen
    process.stdout.write("\x1b[?25l"); // Hide cursor
    this.interval = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER.length;
      this.render();
    }, RENDER_INTERVAL_MS);
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
    const model = this.tracker.primaryModel ? `\x1b[2m${this.tracker.primaryModel}\x1b[0m` : "";
    const ver = this.tracker.version ? `\x1b[2mv${this.tracker.version}\x1b[0m` : "";
    lines.push("");
    const titleBase = "  🐝 Copilot Swarm";
    const titleParts = [titleBase, ver, model].filter(Boolean);
    const titleLeft = titleParts.join("  ");
    lines.push(`${titleLeft}${this.pad(width - this.visLen(titleLeft) - elapsed.length)}${elapsed}`);

    // Show working directory below the title
    if (this.tracker.cwd) {
      const cwdLabel = `  \x1b[2m${this.smartCwd(this.tracker.cwd, width - 4)}\x1b[0m`;
      lines.push(cwdLabel);
    }
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

    // ── Write frame row-by-row — clear each line, truncate to cols to prevent wrapping ──
    const out: string[] = [];
    const maxLines = Math.min(lines.length, rows);
    for (let i = 0; i < maxLines; i++) {
      out.push(`\x1b[${i + 1};1H\x1b[2K${this.truncCols(lines[i], cols)}`);
    }
    process.stdout.write(out.join(""));
  }

  /** Truncate to terminal column width, stripping ANSI for length calculation. */
  private truncCols(s: string, cols: number): string {
    const vis = this.visLen(s);
    if (vis <= cols) return s;
    // Find the cut point accounting for ANSI escapes
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching ESC
    const ansiRe = /\x1b\[[0-9;]*m/g;
    let visCount = 0;
    let cutIdx = s.length;
    let lastEnd = 0;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: intentional assignment in loop condition
    while ((match = ansiRe.exec(s)) !== null) {
      const segLen = match.index - lastEnd;
      if (visCount + segLen >= cols - 1) {
        cutIdx = lastEnd + (cols - 1 - visCount);
        return `${s.substring(0, cutIdx)}…\x1b[0m`;
      }
      visCount += segLen;
      lastEnd = match.index + match[0].length;
    }
    // Remaining text after last escape
    if (visCount + (s.length - lastEnd) > cols) {
      cutIdx = lastEnd + (cols - 1 - visCount);
      return `${s.substring(0, cutIdx)}…`;
    }
    return s;
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

  /** Shorten a path to fit within maxLen. Keeps the last segments that fit, prefixed with …/ */
  private smartCwd(cwd: string, maxLen: number): string {
    if (cwd.length <= maxLen) return cwd;
    const sep = cwd.includes("/") ? "/" : "\\";
    const parts = cwd.split(sep);
    // Always try to keep at least the last segment
    let result = parts[parts.length - 1];
    for (let i = parts.length - 2; i >= 0; i--) {
      const candidate = `${parts[i]}${sep}${result}`;
      if (candidate.length + 2 > maxLen) break; // +2 for "…/"
      result = candidate;
    }
    if (result === cwd) return cwd;
    return `…${sep}${result}`;
  }
}
