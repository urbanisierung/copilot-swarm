import type { ProgressTracker, StreamInfo, StreamStatus } from "./progress-tracker.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
  private prevLines: string[] = [];
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
    this.prevLines = []; // Force full redraw
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
    const ver = this.tracker.version ? `\x1b[2mv${this.tracker.version}\x1b[0m` : "";
    lines.push("");
    const titleBase = "  🐝 Copilot Swarm";
    const titleParts = [titleBase, ver].filter(Boolean);
    const titleLeft = titleParts.join("  ");
    lines.push(`${titleLeft}${this.pad(width - this.visLen(titleLeft) - elapsed.length)}${elapsed}`);

    // Show working directory below the title
    if (this.tracker.cwd) {
      const cwdLabel = `  \x1b[2m${this.smartCwd(this.tracker.cwd, width - 4)}\x1b[0m`;
      lines.push(cwdLabel);
    }
    lines.push(sep);
    lines.push("");

    // ── Phases (left) + Active Agents (right) — two-column layout ──
    const colLeft = Math.floor((width - 4) * 0.55);
    const colRight = width - 4 - colLeft - 2; // 2 for separator
    const phaseLines: string[] = [];
    for (const phase of this.tracker.phases) {
      // Normalize icon width: emojis (✅⏭) are 2 cells; spinner/○ are 1 cell
      let icon: string;
      let iconCells: number;
      if (phase.status === "active") {
        icon = spin;
        iconCells = 1;
      } else if (phase.status === "done") {
        icon = "✅";
        iconCells = 2;
      } else if (phase.status === "skipped") {
        icon = "⏭";
        iconCells = 2;
      } else {
        icon = "○";
        iconCells = 1;
      }
      const iconPad = " ".repeat(3 - iconCells); // align to 3 cols total (icon + gap)
      let line = `${icon}${iconPad}${phase.name}`;
      if (phase.status === "active" && this.tracker.activeAgent) {
        const agent = this.trunc(this.tracker.activeAgent, colLeft - this.visLen(line) - iconCells - 1);
        line += `  \x1b[2m${agent}\x1b[0m`;
      }
      phaseLines.push(line);
    }

    const agents = this.tracker.activeAgentList;
    const agentLines: string[] = [];
    if (agents.length > 0) {
      agentLines.push("\x1b[2mActive Agents\x1b[0m");
      const maxLabel = Math.max(...agents.map((a) => a.label.length));
      const maxModel = Math.max(...agents.map((a) => a.model.length));
      for (const a of agents) {
        const elapsed = this.fmtElapsed(Date.now() - a.startedAt);
        const paddedLabel = a.label.padEnd(maxLabel);
        const paddedModel = a.model.padEnd(maxModel);
        agentLines.push(`${spin}  ${paddedLabel}  \x1b[2m${paddedModel}  ${elapsed}\x1b[0m`);
      }
    }

    const maxRows = Math.max(phaseLines.length, agentLines.length);
    for (let r = 0; r < maxRows; r++) {
      const left = r < phaseLines.length ? phaseLines[r] : "";
      const right = r < agentLines.length ? agentLines[r] : "";
      const leftPad = colLeft - this.visLen(left);
      lines.push(`  ${left}${this.pad(leftPad)}  ${right}`);
    }
    lines.push("");

    // ── Streams ──
    if (this.tracker.streams.length > 0) {
      lines.push("  Streams");
      for (const s of this.tracker.streams) {
        const d = this.streamIcon(s, spin);
        const iconPad = " ".repeat(3 - d.cells); // normalize icon+gap to 3 cols
        const task = this.trunc(s.task, width - 24);
        lines.push(`    ${s.label}  ${d.icon}${iconPad}${d.label.padEnd(8)} ${task}`);
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

    // ── Write only changed lines — pad to full width instead of clearing to prevent flicker ──
    const out: string[] = [];
    const maxLines = Math.min(lines.length, rows);
    const newPrev: string[] = [];
    for (let i = 0; i < maxLines; i++) {
      const rendered = this.truncCols(lines[i], cols);
      newPrev.push(rendered);
      if (rendered !== this.prevLines[i]) {
        // Overwrite old content by padding to terminal width (no \x1b[2K)
        const padding = Math.max(0, cols - this.visLen(rendered));
        out.push(`\x1b[${i + 1};1H${rendered}${" ".repeat(padding)}`);
      }
    }
    // Clear leftover lines from a previous longer frame
    for (let i = maxLines; i < this.prevLines.length; i++) {
      out.push(`\x1b[${i + 1};1H\x1b[2K`);
    }
    this.prevLines = newPrev;
    if (out.length > 0) {
      process.stdout.write(out.join(""));
    }
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

  private streamIcon(s: StreamInfo, spin: string): { icon: string; label: string; cells: number } {
    const d = STREAM_DISPLAY[s.status];
    const active = s.status === "engineering" || s.status === "reviewing" || s.status === "testing";
    if (active) return { icon: spin, label: d.label, cells: 1 };
    // queued ○ = 1 cell; emojis (✅❌🔨🔍🧪⏭) = 2 cells
    const singleCell = s.status === "queued";
    return { icon: d.icon, label: d.label, cells: singleCell ? 1 : 2 };
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

  /** Approximate visible length (ignores ANSI escape sequences, accounts for wide chars). */
  private visLen(s: string): number {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching ESC
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
    let len = 0;
    for (const ch of stripped) {
      // Common emoji/wide chars used in this TUI occupy 2 cells
      const cp = ch.codePointAt(0) ?? 0;
      len += cp > 0x2fff || (cp >= 0x2300 && cp <= 0x23ff) || (cp >= 0x2600 && cp <= 0x27bf) ? 2 : 1;
    }
    return len;
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
