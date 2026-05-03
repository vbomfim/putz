/**
 * Shell Compatibility Test Harness
 *
 * Pure function that feeds pre-recorded PTY byte streams into a headless
 * xterm.js Terminal and returns the populated instance for assertions.
 *
 * Usage:
 *   const term = await createTerminalFromBytes(fixtureBytes);
 *   const line = term.buffer.active.getLine(0)?.translateToString(true);
 *   expect(line).toContain("expected text");
 *
 * @module shellCompatHarness
 */

// NOTE: This module imports @xterm/xterm directly (NOT the global mock).
// Test files using this harness must call vi.importActual('@xterm/xterm')
// or use the re-exported createTerminalFromBytes which handles this internally.
//
// The Terminal is used headless — no DOM, no canvas — so it works in jsdom.

export interface ShellCompatOptions {
  /** Terminal column count (default: 80) */
  cols?: number;
  /** Terminal row count (default: 24) */
  rows?: number;
  /** Timeout in ms to wait for write to flush (default: 500) */
  flushTimeoutMs?: number;
}

export interface CellInfo {
  /** Character(s) at this cell */
  char: string;
  /** Cell width (1 for normal, 2 for wide/CJK, 0 for continuation) */
  width: number;
  /** Foreground color index (-1 = default) */
  fgColor: number;
  /** Whether foreground is a 256-palette color */
  isFgPalette: boolean;
  /** Whether foreground is an RGB color */
  isFgRgb: boolean;
  /** Background color index (-1 = default) */
  bgColor: number;
  /** Whether background is a 256-palette color */
  isBgPalette: boolean;
  /** Bold attribute */
  isBold: boolean;
  /** Dim/faint attribute */
  isDim: boolean;
  /** Italic attribute */
  isItalic: boolean;
  /** Underline attribute */
  isUnderline: boolean;
  /** Inverse/reverse video attribute */
  isInverse: boolean;
}

/**
 * Creates a headless xterm.js Terminal, writes the given bytes into it,
 * and returns the terminal with its fully-populated buffer.
 *
 * The returned Terminal is NOT disposed — the caller (test) should dispose
 * it in afterEach/afterAll if desired.
 */
export async function createTerminalFromBytes(
  bytes: Uint8Array,
  options: ShellCompatOptions = {},
): Promise<import("@xterm/xterm").Terminal> {
  const { cols = 80, rows = 24, flushTimeoutMs = 500 } = options;

  // Import the real xterm.js module, bypassing any vi.mock in test setup.
  // When running under Vitest, vi.importActual resolves the un-mocked module.
  // Outside Vitest (production), plain dynamic import works directly.
  let RealTerminal: typeof import("@xterm/xterm").Terminal;
  try {
    const vi =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__vitest_index__?.vi ?? (await import("vitest")).vi;
    const xtermModule = (await vi.importActual(
      "@xterm/xterm",
    )) as typeof import("@xterm/xterm");
    RealTerminal = xtermModule.Terminal;
  } catch {
    // Not in Vitest context — use regular import
    const xtermModule = await import("@xterm/xterm");
    RealTerminal = xtermModule.Terminal;
  }

  const terminal = new RealTerminal({
    cols,
    rows,
    allowProposedApi: true,
    scrollback: 1000,
  });

  // Write bytes and wait for the parser to flush
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(`Terminal write did not flush within ${flushTimeoutMs}ms`),
        ),
      flushTimeoutMs,
    );
    terminal.write(bytes, () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return terminal;
}

/**
 * Extract cell information from a specific position in the terminal buffer.
 * Returns null if the line or cell doesn't exist.
 */
export function getCellInfo(
  terminal: import("@xterm/xterm").Terminal,
  row: number,
  col: number,
): CellInfo | null {
  const line = terminal.buffer.active.getLine(row);
  if (!line) return null;

  const cell = line.getCell(col);
  if (!cell) return null;

  return {
    char: cell.getChars(),
    width: cell.getWidth(),
    fgColor: cell.getFgColor(),
    isFgPalette: cell.isFgPalette(),
    isFgRgb: cell.isFgRGB(),
    bgColor: cell.getBgColor(),
    isBgPalette: cell.isBgPalette(),
    isBold: cell.isBold() !== 0,
    isDim: cell.isDim() !== 0,
    isItalic: cell.isItalic() !== 0,
    isUnderline: cell.isUnderline() !== 0,
    isInverse: cell.isInverse() !== 0,
  };
}

/**
 * Get the text content of a specific line in the terminal buffer.
 * Returns empty string if line doesn't exist.
 *
 * @param trimRight - If true (default), trims trailing whitespace
 */
export function getLineText(
  terminal: import("@xterm/xterm").Terminal,
  row: number,
  trimRight = true,
): string {
  const line = terminal.buffer.active.getLine(row);
  if (!line) return "";
  return line.translateToString(trimRight);
}

/**
 * Check whether any cell in the given row range contains visible bracketed
 * paste markers (\x1b[200~ or \x1b[201~). These should NEVER appear as
 * visible text in a properly functioning terminal.
 */
export function hasBracketedPasteMarkersVisible(
  terminal: import("@xterm/xterm").Terminal,
  startRow = 0,
  endRow?: number,
): boolean {
  const end = endRow ?? terminal.buffer.active.length;
  for (let row = startRow; row < end; row++) {
    const text = getLineText(terminal, row, false);
    if (text.includes("[200~") || text.includes("[201~")) {
      return true;
    }
  }
  return false;
}

/**
 * Find the first row containing the given text (case-sensitive).
 * Returns -1 if not found.
 */
export function findRowWithText(
  terminal: import("@xterm/xterm").Terminal,
  needle: string,
  startRow = 0,
): number {
  const end = terminal.buffer.active.length;
  for (let row = startRow; row < end; row++) {
    const text = getLineText(terminal, row, false);
    if (text.includes(needle)) {
      return row;
    }
  }
  return -1;
}

/**
 * Get cursor position in the active buffer.
 */
export function getCursorPosition(terminal: import("@xterm/xterm").Terminal): {
  x: number;
  y: number;
} {
  return {
    x: terminal.buffer.active.cursorX,
    y: terminal.buffer.active.cursorY,
  };
}
