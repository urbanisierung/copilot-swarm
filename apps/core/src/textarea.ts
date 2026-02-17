/**
 * Interactive multi-line text editor for the terminal.
 * Uses raw stdin mode with ANSI rendering — no external dependencies.
 * Arrow keys to navigate, Ctrl+S opens command palette, Esc cancels.
 */

const TITLE = " Task Description ";
const FOOTER_HINT = " Ctrl+S actions │ Esc cancel ";

type MenuChoice = "submit" | "cancel" | null;

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
  let menuOpen = false;
  let menuIdx = 0;
  const menuItems = [
    { label: "Submit", value: "submit" as const },
    { label: "Cancel", value: "cancel" as const },
  ];

  function clamp(): void {
    if (curRow < 0) curRow = 0;
    if (curRow >= lines.length) curRow = lines.length - 1;
    if (curCol < 0) curCol = 0;
    if (curCol > lines[curRow].length) curCol = lines[curRow].length;
    if (curRow < scroll) scroll = curRow;
    if (curRow >= scroll + editorHeight) scroll = curRow - editorHeight + 1;
  }

  /** Move cursor to the start of the previous word. */
  function wordLeft(): void {
    if (curCol > 0) {
      const line = lines[curRow];
      let c = curCol;
      while (c > 0 && line[c - 1] === " ") c--;
      while (c > 0 && line[c - 1] !== " ") c--;
      curCol = c;
    } else if (curRow > 0) {
      curRow--;
      curCol = lines[curRow].length;
    }
  }

  /** Move cursor to the end of the next word. */
  function wordRight(): void {
    const line = lines[curRow];
    if (curCol < line.length) {
      let c = curCol;
      while (c < line.length && line[c] !== " ") c++;
      while (c < line.length && line[c] === " ") c++;
      curCol = c;
    } else if (curRow < lines.length - 1) {
      curRow++;
      curCol = 0;
    }
  }

  /** Delete the word before the cursor (Ctrl+Backspace / Ctrl+W). */
  function deleteWordBack(): void {
    if (curCol > 0) {
      const line = lines[curRow];
      let c = curCol;
      while (c > 0 && line[c - 1] === " ") c--;
      while (c > 0 && line[c - 1] !== " ") c--;
      lines[curRow] = line.substring(0, c) + line.substring(curCol);
      curCol = c;
    } else if (curRow > 0) {
      curCol = lines[curRow - 1].length;
      lines[curRow - 1] += lines[curRow];
      lines.splice(curRow, 1);
      curRow--;
    }
  }

  /** Render a single editor line at the given screen row (1-based). */
  function renderLine(screenRow: number, lineIdx: number): void {
    const text = lineIdx < lines.length ? lines[lineIdx] : "";
    const display = text.substring(0, innerWidth);
    const pad = Math.max(0, innerWidth - display.length);
    process.stdout.write(`\x1b[${screenRow};1H\x1b[2K│ ${display}${" ".repeat(pad)} │`);
  }

  /** Full redraw — used only on initial render and structural changes. */
  function renderFull(): void {
    const titlePad = Math.max(0, cols - 2 - TITLE.length);
    const top = `┌${TITLE}${"─".repeat(titlePad)}┐`;
    const footerPad = Math.max(0, cols - 2 - FOOTER_HINT.length);
    const bottom = `└${"─".repeat(footerPad)}${FOOTER_HINT}┘`;

    process.stdout.write("\x1b[?25l"); // hide cursor during redraw
    process.stdout.write(`\x1b[1;1H\x1b[2K${top}`);

    for (let i = 0; i < editorHeight; i++) {
      renderLine(2 + i, scroll + i);
    }

    process.stdout.write(`\x1b[${2 + editorHeight};1H\x1b[2K${bottom}`);
    placeCursor();
    process.stdout.write("\x1b[?25h"); // show cursor
  }

  /** Place the cursor at its logical position. */
  function placeCursor(): void {
    const screenRow = 2 + (curRow - scroll);
    const screenCol = 3 + Math.min(curCol, innerWidth);
    process.stdout.write(`\x1b[${screenRow};${screenCol}H`);
  }

  /** Render the command palette overlay centered on screen. */
  function renderMenu(): void {
    process.stdout.write("\x1b[?25l"); // hide cursor
    const boxW = 26;
    const boxH = menuItems.length + 4;
    const startRow = Math.floor((rows - boxH) / 2);
    const startCol = Math.floor((cols - boxW) / 2);
    const inner = boxW - 2;
    const menuTitle = " Actions ";
    const mTitlePad = Math.max(0, inner - menuTitle.length);

    process.stdout.write(`\x1b[${startRow};${startCol}H┌${menuTitle}${"─".repeat(mTitlePad)}┐`);
    process.stdout.write(`\x1b[${startRow + 1};${startCol}H│${" ".repeat(inner)}│`);

    for (let idx = 0; idx < menuItems.length; idx++) {
      const item = menuItems[idx];
      const selected = idx === menuIdx;
      const prefix = selected ? "› " : "  ";
      const label = `${prefix}${item.label}`;
      const pad = Math.max(0, inner - label.length);
      const row = startRow + 2 + idx;
      if (selected) {
        process.stdout.write(`\x1b[${row};${startCol}H│\x1b[7m${label}${" ".repeat(pad)}\x1b[0m│`);
      } else {
        process.stdout.write(`\x1b[${row};${startCol}H│${label}${" ".repeat(pad)}│`);
      }
    }

    const bottomRow = startRow + 2 + menuItems.length;
    const hint = " ↑↓ select  Enter confirm ";
    const hPad = Math.max(0, inner - hint.length);
    process.stdout.write(`\x1b[${bottomRow};${startCol}H│\x1b[2m${hint}${" ".repeat(hPad)}\x1b[0m│`);
    process.stdout.write(`\x1b[${bottomRow + 1};${startCol}H└${"─".repeat(inner)}┘`);
  }

  return new Promise<string | undefined>((resolve) => {
    process.stdout.write("\x1b[?1049h"); // alternate screen
    process.stdout.write("\x1b[?25h"); // show cursor
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    renderFull();

    function cleanup(result: string | undefined): void {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?1049l"); // leave alternate screen
      resolve(result);
    }

    function handleMenuKey(data: string, idx: number): MenuChoice {
      const ch = data.charCodeAt(idx);
      // Enter — confirm selection
      if (ch === 13) return menuItems[menuIdx].value;
      // Escape — close menu
      if (ch === 27 && !(idx + 2 < data.length && data.charCodeAt(idx + 1) === 91)) {
        return null;
      }
      // Arrow keys
      if (ch === 27 && idx + 2 < data.length && data.charCodeAt(idx + 1) === 91) {
        const code = data.charCodeAt(idx + 2);
        if (code === 65) menuIdx = (menuIdx - 1 + menuItems.length) % menuItems.length;
        else if (code === 66) menuIdx = (menuIdx + 1) % menuItems.length;
        renderMenu();
      }
      return undefined as unknown as MenuChoice;
    }

    function onData(data: string): void {
      // Menu mode
      if (menuOpen) {
        for (let i = 0; i < data.length; i++) {
          const ch = data.charCodeAt(i);
          if (ch === 27 && i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
            handleMenuKey(data, i);
            i += 2;
            continue;
          }
          if (ch === 13) {
            menuOpen = false;
            const choice = menuItems[menuIdx].value;
            if (choice === "submit") {
              const text = lines.join("\n").trim();
              cleanup(text || undefined);
              return;
            }
            // cancel
            cleanup(undefined);
            return;
          }
          if (ch === 27 || ch === 3) {
            // Close menu, return to editor
            menuOpen = false;
            renderFull();
            return;
          }
        }
        return;
      }

      let needsFullRender = false;
      let needsCursorUpdate = false;

      for (let i = 0; i < data.length; i++) {
        const ch = data.charCodeAt(i);

        // Ctrl+C — cancel
        if (ch === 3) {
          cleanup(undefined);
          return;
        }

        // Ctrl+S (19) — open command palette
        if (ch === 19) {
          menuOpen = true;
          menuIdx = 0;
          renderFull();
          renderMenu();
          return;
        }

        // Ctrl+D (4) — submit
        if (ch === 4) {
          const text = lines.join("\n").trim();
          cleanup(text || undefined);
          return;
        }

        // Ctrl+A (1) — beginning of line
        if (ch === 1) {
          curCol = 0;
          needsCursorUpdate = true;
          continue;
        }

        // Ctrl+E (5) — end of line
        if (ch === 5) {
          curCol = lines[curRow].length;
          needsCursorUpdate = true;
          continue;
        }

        // Ctrl+W (23) — delete word back
        if (ch === 23) {
          deleteWordBack();
          clamp();
          needsFullRender = true;
          continue;
        }

        // LF (10) — Ctrl+Enter in some terminals: treat as submit via palette
        if (ch === 10) {
          menuOpen = true;
          menuIdx = 0;
          renderFull();
          renderMenu();
          return;
        }

        // Escape / escape sequences
        if (ch === 27) {
          if (i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
            const code = data.charCodeAt(i + 2);

            // Check for modifier sequences: ESC [ 1 ; <mod> <dir>
            if (code === 49 && i + 5 <= data.length && data.charCodeAt(i + 3) === 59) {
              const mod = data.charCodeAt(i + 4);
              const dir = data.charCodeAt(i + 5);
              // mod 53 = Ctrl (modifier 5)
              if (mod === 53) {
                if (dir === 68)
                  wordLeft(); // Ctrl+Left
                else if (dir === 67) wordRight(); // Ctrl+Right
              }
              i += 5;
              clamp();
              needsCursorUpdate = true;
              continue;
            }

            if (code === 65) {
              curRow--;
            } else if (code === 66) {
              curRow++;
            } else if (code === 67) {
              curCol++;
            } else if (code === 68) {
              curCol--;
            } else if (code === 72) {
              curCol = 0;
            } else if (code === 70) {
              curCol = lines[curRow].length;
            } else if (code === 51 && i + 3 < data.length && data.charCodeAt(i + 3) === 126) {
              // Delete key
              if (curCol < lines[curRow].length) {
                lines[curRow] = lines[curRow].substring(0, curCol) + lines[curRow].substring(curCol + 1);
              } else if (curRow < lines.length - 1) {
                lines[curRow] += lines[curRow + 1];
                lines.splice(curRow + 1, 1);
              }
              i++;
              needsFullRender = true;
              i += 2;
              clamp();
              continue;
            }
            i += 2;
            clamp();
            needsCursorUpdate = true;
            continue;
          }

          // Plain Escape — open command palette (instead of immediate cancel)
          menuOpen = true;
          menuIdx = 1; // default to Cancel
          renderFull();
          renderMenu();
          return;
        }

        // Enter (CR) — new line
        if (ch === 13) {
          const after = lines[curRow].substring(curCol);
          lines[curRow] = lines[curRow].substring(0, curCol);
          lines.splice(curRow + 1, 0, after);
          curRow++;
          curCol = 0;
          clamp();
          needsFullRender = true;
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
          needsFullRender = true;
          continue;
        }

        // Ctrl+Backspace — some terminals send ESC + DEL (127), others send 0x08
        if (ch === 8) {
          deleteWordBack();
          clamp();
          needsFullRender = true;
          continue;
        }

        // Printable characters
        if (ch >= 32) {
          lines[curRow] = lines[curRow].substring(0, curCol) + data[i] + lines[curRow].substring(curCol);
          curCol++;
          clamp();
          // Only need to re-render the current line for single character edits
          renderLine(2 + (curRow - scroll), curRow);
          placeCursor();
        }
      }

      if (needsFullRender) {
        renderFull();
      } else if (needsCursorUpdate) {
        placeCursor();
      }
    }

    process.stdin.on("data", onData);
  });
}
