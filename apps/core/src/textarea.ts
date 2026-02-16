/**
 * Interactive multi-line text editor for the terminal.
 * Uses raw stdin mode with ANSI rendering — no external dependencies.
 * Arrow keys to navigate, Enter for newlines, Ctrl+Enter (or Ctrl+D) to submit, Esc to cancel.
 */

const TITLE = " Task Description ";
const FOOTER_HINT = " Ctrl+Enter submit │ Esc cancel ";

export async function openTextarea(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const editorHeight = Math.max(5, rows - 4);
  const innerWidth = cols - 4;

  const lines: string[] = [""];
  let curRow = 0;
  let curCol = 0;
  let scroll = 0;

  function clamp(): void {
    if (curRow < 0) curRow = 0;
    if (curRow >= lines.length) curRow = lines.length - 1;
    if (curCol < 0) curCol = 0;
    if (curCol > lines[curRow].length) curCol = lines[curRow].length;
    if (curRow < scroll) scroll = curRow;
    if (curRow >= scroll + editorHeight) scroll = curRow - editorHeight + 1;
  }

  function render(): void {
    const titlePad = Math.max(0, cols - 2 - TITLE.length);
    const top = `┌${TITLE}${"─".repeat(titlePad)}┐`;

    const footerPad = Math.max(0, cols - 2 - FOOTER_HINT.length);
    const bottom = `└${"─".repeat(footerPad)}${FOOTER_HINT}┘`;

    process.stdout.write("\x1b[2J\x1b[1;1H");
    process.stdout.write(`${top}\n`);

    for (let i = 0; i < editorHeight; i++) {
      const idx = scroll + i;
      const text = idx < lines.length ? lines[idx] : "";
      const display = text.substring(0, innerWidth);
      const pad = Math.max(0, innerWidth - display.length);
      process.stdout.write(`│ ${display}${" ".repeat(pad)} │\n`);
    }

    process.stdout.write(bottom);

    const screenRow = 2 + (curRow - scroll);
    const screenCol = 3 + curCol;
    process.stdout.write(`\x1b[${screenRow};${screenCol}H`);
  }

  return new Promise<string | undefined>((resolve) => {
    process.stdout.write("\x1b[?1049h"); // alternate screen
    process.stdout.write("\x1b[?25h"); // show cursor
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    render();

    function cleanup(result: string | undefined): void {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?1049l"); // leave alternate screen
      resolve(result);
    }

    function onData(data: string): void {
      for (let i = 0; i < data.length; i++) {
        const ch = data.charCodeAt(i);

        // Ctrl+C — cancel
        if (ch === 3) {
          cleanup(undefined);
          return;
        }

        // Ctrl+D (4) or LF (10, Ctrl+Enter in most terminals) — submit
        if (ch === 4 || ch === 10) {
          const text = lines.join("\n").trim();
          cleanup(text || undefined);
          return;
        }

        // Escape / escape sequences
        if (ch === 27) {
          if (i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
            const code = data.charCodeAt(i + 2);
            if (code === 65) curRow--;
            else if (code === 66) curRow++;
            else if (code === 67) curCol++;
            else if (code === 68) curCol--;
            else if (code === 72) curCol = 0;
            else if (code === 70) curCol = lines[curRow].length;
            else if (code === 51 && i + 3 < data.length && data.charCodeAt(i + 3) === 126) {
              // Delete key
              if (curCol < lines[curRow].length) {
                lines[curRow] = lines[curRow].substring(0, curCol) + lines[curRow].substring(curCol + 1);
              } else if (curRow < lines.length - 1) {
                lines[curRow] += lines[curRow + 1];
                lines.splice(curRow + 1, 1);
              }
              i++;
            }
            i += 2;
          } else {
            // Plain Escape — cancel
            cleanup(undefined);
            return;
          }
          clamp();
          render();
          continue;
        }

        // Enter (CR) — new line
        if (ch === 13) {
          const after = lines[curRow].substring(curCol);
          lines[curRow] = lines[curRow].substring(0, curCol);
          lines.splice(curRow + 1, 0, after);
          curRow++;
          curCol = 0;
          clamp();
          render();
          continue;
        }

        // Backspace
        if (ch === 127) {
          if (curCol > 0) {
            lines[curRow] = lines[curRow].substring(0, curCol - 1) + lines[curRow].substring(curCol);
            curCol--;
          } else if (curRow > 0) {
            curCol = lines[curRow - 1].length;
            lines[curRow - 1] += lines[curRow];
            lines.splice(curRow, 1);
            curRow--;
          }
          clamp();
          render();
          continue;
        }

        // Printable characters (ASCII + Unicode)
        if (ch >= 32) {
          lines[curRow] = lines[curRow].substring(0, curCol) + data[i] + lines[curRow].substring(curCol);
          curCol++;
          render();
        }
      }
    }

    process.stdin.on("data", onData);
  });
}
