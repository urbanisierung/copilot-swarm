/**
 * Interactive multi-line text editor for the terminal.
 * Uses raw stdin mode with ANSI rendering — no external dependencies.
 *
 * Two modes:
 * - `openTextarea()`: full-width single-pane editor
 * - `openSplitEditor(context)`: two-column layout with scrollable read-only context panel
 */

const FOOTER_HINT_SINGLE = " Ctrl+S actions \u2502 Esc menu ";
const FOOTER_HINT_SPLIT = " Tab switch \u2502 Ctrl+S actions \u2502 Esc menu ";

// ── Shared helpers ──

function wordLeftIn(lines: string[], curRow: number, curCol: number): { row: number; col: number } {
  if (curCol > 0) {
    const line = lines[curRow];
    let c = curCol;
    while (c > 0 && line[c - 1] === " ") c--;
    while (c > 0 && line[c - 1] !== " ") c--;
    return { row: curRow, col: c };
  }
  if (curRow > 0) return { row: curRow - 1, col: lines[curRow - 1].length };
  return { row: curRow, col: curCol };
}

function wordRightIn(lines: string[], curRow: number, curCol: number): { row: number; col: number } {
  const line = lines[curRow];
  if (curCol < line.length) {
    let c = curCol;
    while (c < line.length && line[c] !== " ") c++;
    while (c < line.length && line[c] === " ") c++;
    return { row: curRow, col: c };
  }
  if (curRow < lines.length - 1) return { row: curRow + 1, col: 0 };
  return { row: curRow, col: curCol };
}

function deleteWordBackIn(
  lines: string[],
  curRow: number,
  curCol: number,
): { lines: string[]; row: number; col: number } {
  if (curCol > 0) {
    const line = lines[curRow];
    let c = curCol;
    while (c > 0 && line[c - 1] === " ") c--;
    while (c > 0 && line[c - 1] !== " ") c--;
    lines[curRow] = line.substring(0, c) + line.substring(curCol);
    return { lines, row: curRow, col: c };
  }
  if (curRow > 0) {
    const col = lines[curRow - 1].length;
    lines[curRow - 1] += lines[curRow];
    lines.splice(curRow, 1);
    return { lines, row: curRow - 1, col };
  }
  return { lines, row: curRow, col: curCol };
}

/** Wrap text to a given width, preserving words where possible. */
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= width) {
      result.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      let cut = remaining.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      result.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut).trimStart();
    }
    result.push(remaining);
  }
  return result;
}

// ── Menu rendering (shared) ──

interface MenuItem {
  label: string;
  value: string;
}

function renderMenuOverlay(items: MenuItem[], selectedIdx: number, rows: number, cols: number): void {
  process.stdout.write("\x1b[?25l");
  const boxW = 30;
  const startRow = Math.floor((rows - items.length - 4) / 2);
  const startCol = Math.floor((cols - boxW) / 2);
  const inner = boxW - 2;
  const menuTitle = " Actions ";
  const mTitlePad = Math.max(0, inner - menuTitle.length);

  process.stdout.write(`\x1b[${startRow};${startCol}H\u250c${menuTitle}${"─".repeat(mTitlePad)}\u2510`);
  process.stdout.write(`\x1b[${startRow + 1};${startCol}H\u2502${" ".repeat(inner)}\u2502`);

  for (let idx = 0; idx < items.length; idx++) {
    const selected = idx === selectedIdx;
    const prefix = selected ? "\u203a " : "  ";
    const label = `${prefix}${items[idx].label}`;
    const pad = Math.max(0, inner - label.length);
    const row = startRow + 2 + idx;
    if (selected) {
      process.stdout.write(`\x1b[${row};${startCol}H\u2502\x1b[7m${label}${" ".repeat(pad)}\x1b[0m\u2502`);
    } else {
      process.stdout.write(`\x1b[${row};${startCol}H\u2502${label}${" ".repeat(pad)}\u2502`);
    }
  }

  const bottomRow = startRow + 2 + items.length;
  const hint = " \u2191\u2193 select  Enter confirm ";
  const hPad = Math.max(0, inner - hint.length);
  process.stdout.write(`\x1b[${bottomRow};${startCol}H\u2502\x1b[2m${hint}${" ".repeat(hPad)}\x1b[0m\u2502`);
  process.stdout.write(`\x1b[${bottomRow + 1};${startCol}H\u2514${"─".repeat(inner)}\u2518`);
}

/** Process common editing keys. Returns true if the key was handled. */
function handleEditorKey(
  ch: number,
  i: number,
  data: string,
  state: EditorState,
): { handled: boolean; newI: number; needsFullRender: boolean; needsCursorUpdate: boolean } {
  const needsFullRender = false;
  const needsCursorUpdate = false;
  const newI = i;

  if (ch === 1) {
    state.curCol = 0;
    return { handled: true, newI, needsFullRender, needsCursorUpdate: true };
  }
  if (ch === 5) {
    state.curCol = state.lines[state.curRow].length;
    return { handled: true, newI, needsFullRender, needsCursorUpdate: true };
  }
  if (ch === 23) {
    const r = deleteWordBackIn(state.lines, state.curRow, state.curCol);
    state.curRow = r.row;
    state.curCol = r.col;
    return { handled: true, newI, needsFullRender: true, needsCursorUpdate: false };
  }

  if (ch === 27 && i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
    const code = data.charCodeAt(i + 2);
    if (code === 49 && i + 5 <= data.length && data.charCodeAt(i + 3) === 59) {
      const mod = data.charCodeAt(i + 4);
      const dir = data.charCodeAt(i + 5);
      if (mod === 53) {
        if (dir === 68) {
          const r = wordLeftIn(state.lines, state.curRow, state.curCol);
          state.curRow = r.row;
          state.curCol = r.col;
        } else if (dir === 67) {
          const r = wordRightIn(state.lines, state.curRow, state.curCol);
          state.curRow = r.row;
          state.curCol = r.col;
        }
      }
      return { handled: true, newI: i + 5, needsFullRender: false, needsCursorUpdate: true };
    }
    if (code === 65) state.curRow--;
    else if (code === 66) state.curRow++;
    else if (code === 67) state.curCol++;
    else if (code === 68) state.curCol--;
    else if (code === 72) state.curCol = 0;
    else if (code === 70) state.curCol = state.lines[state.curRow].length;
    else if (code === 51 && i + 3 < data.length && data.charCodeAt(i + 3) === 126) {
      if (state.curCol < state.lines[state.curRow].length) {
        state.lines[state.curRow] =
          state.lines[state.curRow].substring(0, state.curCol) + state.lines[state.curRow].substring(state.curCol + 1);
      } else if (state.curRow < state.lines.length - 1) {
        state.lines[state.curRow] += state.lines[state.curRow + 1];
        state.lines.splice(state.curRow + 1, 1);
      }
      return { handled: true, newI: i + 3, needsFullRender: true, needsCursorUpdate: false };
    }
    return { handled: true, newI: i + 2, needsFullRender: false, needsCursorUpdate: true };
  }

  if (ch === 13) {
    const after = state.lines[state.curRow].substring(state.curCol);
    state.lines[state.curRow] = state.lines[state.curRow].substring(0, state.curCol);
    state.lines.splice(state.curRow + 1, 0, after);
    state.curRow++;
    state.curCol = 0;
    return { handled: true, newI, needsFullRender: true, needsCursorUpdate: false };
  }
  if (ch === 127) {
    if (state.curCol > 0) {
      state.lines[state.curRow] =
        state.lines[state.curRow].substring(0, state.curCol - 1) + state.lines[state.curRow].substring(state.curCol);
      state.curCol--;
    } else if (state.curRow > 0) {
      state.curCol = state.lines[state.curRow - 1].length;
      state.lines[state.curRow - 1] += state.lines[state.curRow];
      state.lines.splice(state.curRow, 1);
      state.curRow--;
    }
    return { handled: true, newI, needsFullRender: true, needsCursorUpdate: false };
  }
  if (ch === 8) {
    const r = deleteWordBackIn(state.lines, state.curRow, state.curCol);
    state.curRow = r.row;
    state.curCol = r.col;
    return { handled: true, newI, needsFullRender: true, needsCursorUpdate: false };
  }

  return { handled: false, newI, needsFullRender, needsCursorUpdate };
}

interface EditorState {
  lines: string[];
  curRow: number;
  curCol: number;
}

// ── Single-pane editor ──

export async function openTextarea(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const editorHeight = Math.max(5, rows - 4);
  const innerWidth = cols - 4;
  const title = " Task Description ";

  const state: EditorState = { lines: [""], curRow: 0, curCol: 0 };
  let scroll = 0;
  let menuOpen = false;
  let menuIdx = 0;
  const menuItems: MenuItem[] = [
    { label: "Submit", value: "submit" },
    { label: "Cancel", value: "cancel" },
  ];

  function clamp(): void {
    if (state.curRow < 0) state.curRow = 0;
    if (state.curRow >= state.lines.length) state.curRow = state.lines.length - 1;
    if (state.curCol < 0) state.curCol = 0;
    if (state.curCol > state.lines[state.curRow].length) state.curCol = state.lines[state.curRow].length;
    if (state.curRow < scroll) scroll = state.curRow;
    if (state.curRow >= scroll + editorHeight) scroll = state.curRow - editorHeight + 1;
  }

  function renderLine(screenRow: number, lineIdx: number): void {
    const text = lineIdx < state.lines.length ? state.lines[lineIdx] : "";
    const display = text.substring(0, innerWidth);
    const pad = Math.max(0, innerWidth - display.length);
    process.stdout.write(`\x1b[${screenRow};1H\x1b[2K\u2502 ${display}${" ".repeat(pad)} \u2502`);
  }

  function renderFull(): void {
    const titlePad = Math.max(0, cols - 2 - title.length);
    const top = `\u250c${title}${"─".repeat(titlePad)}\u2510`;
    const footerPad = Math.max(0, cols - 2 - FOOTER_HINT_SINGLE.length);
    const bottom = `\u2514${"─".repeat(footerPad)}${FOOTER_HINT_SINGLE}\u2518`;

    process.stdout.write("\x1b[?25l");
    process.stdout.write(`\x1b[1;1H\x1b[2K${top}`);
    for (let i = 0; i < editorHeight; i++) renderLine(2 + i, scroll + i);
    process.stdout.write(`\x1b[${2 + editorHeight};1H\x1b[2K${bottom}`);
    placeCursor();
    process.stdout.write("\x1b[?25h");
  }

  function placeCursor(): void {
    const screenRow = 2 + (state.curRow - scroll);
    const screenCol = 3 + Math.min(state.curCol, innerWidth);
    process.stdout.write(`\x1b[${screenRow};${screenCol}H`);
  }

  return new Promise<string | undefined>((resolve) => {
    process.stdout.write("\x1b[?1049h");
    process.stdout.write("\x1b[?25h");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    renderFull();

    function cleanup(result: string | undefined): void {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?1049l");
      resolve(result);
    }

    function onData(data: string): void {
      if (menuOpen) {
        for (let i = 0; i < data.length; i++) {
          const ch = data.charCodeAt(i);
          if (ch === 27 && i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
            const code = data.charCodeAt(i + 2);
            if (code === 65) menuIdx = (menuIdx - 1 + menuItems.length) % menuItems.length;
            else if (code === 66) menuIdx = (menuIdx + 1) % menuItems.length;
            renderMenuOverlay(menuItems, menuIdx, rows, cols);
            i += 2;
            continue;
          }
          if (ch === 13) {
            menuOpen = false;
            if (menuItems[menuIdx].value === "submit") {
              cleanup(state.lines.join("\n").trim() || undefined);
            } else {
              cleanup(undefined);
            }
            return;
          }
          if (ch === 27 || ch === 3) {
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

        if (ch === 3) {
          cleanup(undefined);
          return;
        }
        if (ch === 19 || ch === 10) {
          menuOpen = true;
          menuIdx = 0;
          renderFull();
          renderMenuOverlay(menuItems, menuIdx, rows, cols);
          return;
        }
        if (ch === 4) {
          cleanup(state.lines.join("\n").trim() || undefined);
          return;
        }

        // Try shared editor key handler
        const result = handleEditorKey(ch, i, data, state);
        if (result.handled) {
          i = result.newI;
          if (result.needsFullRender) needsFullRender = true;
          if (result.needsCursorUpdate) needsCursorUpdate = true;
          clamp();
          continue;
        }

        // Esc → menu
        if (ch === 27) {
          menuOpen = true;
          menuIdx = 1;
          renderFull();
          renderMenuOverlay(menuItems, menuIdx, rows, cols);
          return;
        }

        // Printable characters
        if (ch >= 32) {
          state.lines[state.curRow] =
            state.lines[state.curRow].substring(0, state.curCol) +
            data[i] +
            state.lines[state.curRow].substring(state.curCol);
          state.curCol++;
          clamp();
          renderLine(2 + (state.curRow - scroll), state.curRow);
          placeCursor();
        }
      }

      if (needsFullRender) renderFull();
      else if (needsCursorUpdate) placeCursor();
    }

    process.stdin.on("data", onData);
  });
}

// ── Split-pane editor ──

export interface SplitEditorOptions {
  /** Title for the left (editor) panel. */
  editorTitle?: string;
  /** Title for the right (context) panel. */
  contextTitle?: string;
}

/**
 * Opens a two-column editor: left side is an editable textarea, right side is a
 * scrollable read-only context panel showing agent questions or other reference text.
 *
 * Returns the user's typed text, or `undefined` if cancelled.
 * Returns empty string `""` if the user chose "Skip".
 *
 * Keyboard:
 *   Tab          — switch focus between left (editor) and right (context) panels
 *   Arrow keys   — navigate cursor (left) or scroll (right)
 *   PgUp/PgDown  — page scroll in context panel
 *   Ctrl+S / Esc — open command palette
 *   Ctrl+D       — submit directly
 */
export async function openSplitEditor(contextText: string, options?: SplitEditorOptions): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const bodyHeight = Math.max(5, rows - 4);

  // Panel widths: split roughly 50/50
  const dividerCol = Math.floor(cols / 2);
  const leftInner = dividerCol - 3;
  const rightInner = cols - dividerCol - 4;

  const editorTitle = ` ${options?.editorTitle ?? "Your Answer"} `;
  const contextTitle = ` ${options?.contextTitle ?? "Agent Questions"} `;

  // Editor state (left panel)
  const state: EditorState = { lines: [""], curRow: 0, curCol: 0 };
  let edScroll = 0;

  // Context state (right panel)
  const ctxLines = wrapText(contextText, rightInner);
  let ctxScroll = 0;
  const ctxMaxScroll = Math.max(0, ctxLines.length - bodyHeight);

  let focus: "left" | "right" = "left";
  let menuOpen = false;
  let menuIdx = 0;
  const menuItems: MenuItem[] = [
    { label: "Submit", value: "submit" },
    { label: "Skip (use AI judgment)", value: "skip" },
    { label: "Cancel", value: "cancel" },
  ];

  function clampEditor(): void {
    if (state.curRow < 0) state.curRow = 0;
    if (state.curRow >= state.lines.length) state.curRow = state.lines.length - 1;
    if (state.curCol < 0) state.curCol = 0;
    if (state.curCol > state.lines[state.curRow].length) state.curCol = state.lines[state.curRow].length;
    if (state.curRow < edScroll) edScroll = state.curRow;
    if (state.curRow >= edScroll + bodyHeight) edScroll = state.curRow - bodyHeight + 1;
  }

  function clampCtx(): void {
    if (ctxScroll < 0) ctxScroll = 0;
    if (ctxScroll > ctxMaxScroll) ctxScroll = ctxMaxScroll;
  }

  function renderRow(screenRow: number, bodyIdx: number): void {
    const edLineIdx = edScroll + bodyIdx;
    const edText = edLineIdx < state.lines.length ? state.lines[edLineIdx] : "";
    const edDisplay = edText.substring(0, leftInner);
    const edPad = Math.max(0, leftInner - edDisplay.length);
    const leftDim = focus === "right" ? "\x1b[2m" : "";
    const leftReset = focus === "right" ? "\x1b[0m" : "";

    const ctxLineIdx = ctxScroll + bodyIdx;
    const ctxText = ctxLineIdx < ctxLines.length ? ctxLines[ctxLineIdx] : "";
    const ctxDisplay = ctxText.substring(0, rightInner);
    const ctxPad = Math.max(0, rightInner - ctxDisplay.length);
    const rightDim = focus === "left" ? "\x1b[2m" : "";
    const rightReset = focus === "left" ? "\x1b[0m" : "";

    process.stdout.write(
      `\x1b[${screenRow};1H\x1b[2K` +
        `\u2502${leftDim} ${edDisplay}${" ".repeat(edPad)} ${leftReset}\u2502` +
        `${rightDim} ${ctxDisplay}${" ".repeat(ctxPad)} ${rightReset}\u2502`,
    );
  }

  function renderFull(): void {
    process.stdout.write("\x1b[?25l");

    // Top border
    const leftTitlePad = Math.max(0, dividerCol - 1 - editorTitle.length);
    const rightTitlePad = Math.max(0, cols - dividerCol - 1 - contextTitle.length);
    process.stdout.write(
      `\x1b[1;1H\x1b[2K\u250c${editorTitle}${"─".repeat(leftTitlePad)}\u252c${contextTitle}${"─".repeat(rightTitlePad)}\u2510`,
    );

    for (let i = 0; i < bodyHeight; i++) renderRow(2 + i, i);

    // Bottom border
    const bottomLeftW = dividerCol - 1;
    const bottomRightW = cols - dividerCol - 1;
    const hintLen = FOOTER_HINT_SPLIT.length;
    const bottomDash = Math.max(0, bottomRightW - hintLen);
    process.stdout.write(
      `\x1b[${2 + bodyHeight};1H\x1b[2K\u2514${"─".repeat(bottomLeftW)}\u2534${"─".repeat(bottomDash)}${FOOTER_HINT_SPLIT}\u2518`,
    );

    // Scroll indicator
    if (ctxLines.length > bodyHeight) {
      const pct = ctxMaxScroll > 0 ? Math.round((ctxScroll / ctxMaxScroll) * 100) : 0;
      const indicator = ` ${pct}% `;
      process.stdout.write(`\x1b[${2 + bodyHeight};${cols - indicator.length}H\x1b[2m${indicator}\x1b[0m`);
    }

    placeCursorSplit();
    process.stdout.write("\x1b[?25h");
  }

  function placeCursorSplit(): void {
    if (focus === "left") {
      const screenRow = 2 + (state.curRow - edScroll);
      const screenCol = 3 + Math.min(state.curCol, leftInner);
      process.stdout.write(`\x1b[?25h\x1b[${screenRow};${screenCol}H`);
    } else {
      process.stdout.write("\x1b[?25l");
    }
  }

  return new Promise<string | undefined>((resolve) => {
    process.stdout.write("\x1b[?1049h");
    process.stdout.write("\x1b[?25h");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    renderFull();

    function cleanup(result: string | undefined): void {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?25h");
      process.stdout.write("\x1b[?1049l");
      resolve(result);
    }

    function onData(data: string): void {
      // Menu mode
      if (menuOpen) {
        for (let i = 0; i < data.length; i++) {
          const ch = data.charCodeAt(i);
          if (ch === 27 && i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
            const code = data.charCodeAt(i + 2);
            if (code === 65) menuIdx = (menuIdx - 1 + menuItems.length) % menuItems.length;
            else if (code === 66) menuIdx = (menuIdx + 1) % menuItems.length;
            renderMenuOverlay(menuItems, menuIdx, rows, cols);
            i += 2;
            continue;
          }
          if (ch === 13) {
            menuOpen = false;
            const choice = menuItems[menuIdx].value;
            if (choice === "submit") {
              cleanup(state.lines.join("\n").trim() || undefined);
              return;
            }
            if (choice === "skip") {
              cleanup("");
              return;
            }
            cleanup(undefined);
            return;
          }
          if (ch === 27 || ch === 3) {
            menuOpen = false;
            renderFull();
            return;
          }
        }
        return;
      }

      // Context panel focused (right)
      if (focus === "right") {
        for (let i = 0; i < data.length; i++) {
          const ch = data.charCodeAt(i);
          if (ch === 3) {
            cleanup(undefined);
            return;
          }
          if (ch === 9) {
            focus = "left";
            renderFull();
            return;
          }
          if (ch === 19 || ch === 10) {
            menuOpen = true;
            menuIdx = 0;
            renderFull();
            renderMenuOverlay(menuItems, menuIdx, rows, cols);
            return;
          }
          if (ch === 4) {
            cleanup(state.lines.join("\n").trim() || undefined);
            return;
          }
          if (ch === 27) {
            if (i + 2 < data.length && data.charCodeAt(i + 1) === 91) {
              const code = data.charCodeAt(i + 2);
              if (code === 65) ctxScroll--;
              else if (code === 66) ctxScroll++;
              else if (code === 53 && i + 3 < data.length && data.charCodeAt(i + 3) === 126) {
                ctxScroll -= bodyHeight;
                i++;
              } else if (code === 54 && i + 3 < data.length && data.charCodeAt(i + 3) === 126) {
                ctxScroll += bodyHeight;
                i++;
              } else if (code === 72) {
                ctxScroll = 0;
              } else if (code === 70) {
                ctxScroll = ctxMaxScroll;
              }
              i += 2;
              clampCtx();
              renderFull();
              continue;
            }
            menuOpen = true;
            menuIdx = 1;
            renderFull();
            renderMenuOverlay(menuItems, menuIdx, rows, cols);
            return;
          }
        }
        return;
      }

      // Editor panel focused (left)
      let needsFullRender = false;
      let needsCursorUpdate = false;

      for (let i = 0; i < data.length; i++) {
        const ch = data.charCodeAt(i);

        if (ch === 3) {
          cleanup(undefined);
          return;
        }
        if (ch === 9) {
          focus = "right";
          renderFull();
          return;
        }
        if (ch === 19 || ch === 10) {
          menuOpen = true;
          menuIdx = 0;
          renderFull();
          renderMenuOverlay(menuItems, menuIdx, rows, cols);
          return;
        }
        if (ch === 4) {
          cleanup(state.lines.join("\n").trim() || undefined);
          return;
        }

        const result = handleEditorKey(ch, i, data, state);
        if (result.handled) {
          i = result.newI;
          if (result.needsFullRender) needsFullRender = true;
          if (result.needsCursorUpdate) needsCursorUpdate = true;
          clampEditor();
          continue;
        }

        // Esc → menu
        if (ch === 27) {
          menuOpen = true;
          menuIdx = 1;
          renderFull();
          renderMenuOverlay(menuItems, menuIdx, rows, cols);
          return;
        }

        // Printable characters
        if (ch >= 32) {
          state.lines[state.curRow] =
            state.lines[state.curRow].substring(0, state.curCol) +
            data[i] +
            state.lines[state.curRow].substring(state.curCol);
          state.curCol++;
          clampEditor();
          renderRow(2 + (state.curRow - edScroll), state.curRow - edScroll);
          placeCursorSplit();
        }
      }

      if (needsFullRender) renderFull();
      else if (needsCursorUpdate) placeCursorSplit();
    }

    process.stdin.on("data", onData);
  });
}
