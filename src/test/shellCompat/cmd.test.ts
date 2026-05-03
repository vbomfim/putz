/**
 * Shell Compatibility Tests — Windows Command Prompt (cmd.exe)
 *
 * Validates that cmd.exe basic features (prompt, ANSI color support)
 * render correctly through xterm.js.
 *
 * Uses synthetic PTY byte-stream fixtures. These fixtures are generated
 * on macOS but represent the escape sequences that cmd.exe would produce
 * on Windows 10+ with ANSI support enabled.
 *
 * Note: cmd.exe has very limited escape sequence usage compared to modern
 * shells. It has no autosuggestion, syntax highlighting, or inline prediction.
 * Tests focus on basic prompt rendering and ANSI color output.
 *
 * @see docs/shell-compat-fixtures.md for capture instructions
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Terminal } from "@xterm/xterm";
import {
  createTerminalFromBytes,
  getCellInfo,
  getLineText,
  findRowWithText,
} from "../../lib/terminal/shellCompatHarness";

const FIXTURES = join(import.meta.dirname, "fixtures");
function loadFixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES, name));
}

describe("cmd.exe shell compatibility", () => {
  let terminal: Terminal | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
  });

  describe("cold prompt render", () => {
    it("renders cmd.exe prompt with drive path", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("cmd-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("C:\\Users\\dev>");
      expect(line).not.toContain("\x1b");
    });
  });

  describe("256 colors (Windows 10+)", () => {
    it("renders 256-color foreground for color 82 (green)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("cmd-256color.bytes"),
      );

      // Find the output line with "green text" (not the echo command)
      let greenRow = -1;
      let greenIdx = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText.includes("echo")) continue;
        const idx = rowText.indexOf("green text");
        if (idx >= 0) {
          greenRow = r;
          greenIdx = idx;
          break;
        }
      }
      expect(greenRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, greenRow, greenIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(82);
      expect(cell!.isFgPalette).toBe(true);
    });

    it("resets color after SGR 0", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("cmd-256color.bytes"),
      );

      // Find the final prompt after colored output
      const lastPromptRow = findRowWithText(terminal, "C:\\Users\\dev>", 1);
      expect(lastPromptRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, lastPromptRow, 0);
      expect(cell).not.toBeNull();
      // Default color = no palette
      expect(cell!.isFgPalette).toBe(false);
    });
  });
});
