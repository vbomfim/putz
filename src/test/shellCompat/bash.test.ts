// Layer 1: synthetic fixture rendering coverage.
// See docs/shell-compat-fixtures.md for capture instructions to upgrade to recorded fixtures.

/**
 * Shell Compatibility Tests — bash
 *
 * Validates that common bash features (prompt, history search, erase-in-line,
 * 256 colors, bracketed paste) render correctly through xterm.js.
 *
 * Uses synthetic PTY byte-stream fixtures fed into a headless Terminal.
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
  hasBracketedPasteMarkersVisible,
} from "../utils/shellCompatHarness";

const FIXTURES = join(import.meta.dirname, "fixtures");
function loadFixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES, name));
}

describe("bash shell compatibility", () => {
  let terminal: Terminal | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
  });

  describe("cold prompt render", () => {
    it("renders colored prompt with no garbage characters", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("user@host");
      expect(line).toContain("~/projects");
      expect(line).toContain("$");
      expect(line).not.toContain("\x1b");
    });

    it("applies bold green to user@host", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-cold-prompt.bytes"),
      );
      const cell = getCellInfo(terminal, 0, 0);

      expect(cell).not.toBeNull();
      expect(cell!.isBold).toBe(true);
      expect(cell!.fgColor).toBe(2); // green
      expect(cell!.isFgPalette).toBe(true);
    });
  });

  describe("history search (Ctrl+R)", () => {
    it("renders reverse-i-search banner", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-history-search.bytes"),
      );

      const searchRow = findRowWithText(terminal, "reverse-i-search");
      expect(searchRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, searchRow);
      expect(line).toContain("reverse-i-search");
      expect(line).toContain("git");
    });

    it("shows matched history entry", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-history-search.bytes"),
      );

      const searchRow = findRowWithText(terminal, "reverse-i-search");
      expect(searchRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, searchRow);
      expect(line).toContain("git commit");
    });

    it("no raw escape sequences visible in search display", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-history-search.bytes"),
      );

      for (let row = 0; row < terminal.rows; row++) {
        const text = getLineText(terminal, row, false);
        expect(text).not.toContain("\x1b");
      }
    });
  });

  describe("multi-line prompt redraw", () => {
    it("erases stale content with \\e[K and shows clean prompt", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-multiline-redraw.bytes"),
      );

      // Should show command output and a clean final prompt
      const outputRow = findRowWithText(terminal, "total 42");
      expect(outputRow).toBeGreaterThanOrEqual(0);

      // Final prompt should be clean
      const lastPrompt = findRowWithText(terminal, "$", outputRow + 1);
      expect(lastPrompt).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, lastPrompt);
      expect(line).toContain("user@host");
    });
  });

  describe("256 colors", () => {
    it("renders 256-color foreground for color 196 (red)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-256color.bytes"),
      );

      // Find the output line with "red" (skip the command line with printf)
      let redRow = -1;
      let redIdx = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText.includes("printf")) continue;
        const idx = rowText.indexOf("red");
        if (idx >= 0) {
          redRow = r;
          redIdx = idx;
          break;
        }
      }
      expect(redRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, redRow, redIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(196);
      expect(cell!.isFgPalette).toBe(true);
    });

    it("renders 256-color foreground for color 82 (green)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-256color.bytes"),
      );

      // Find the colored "green" on the output line (not the printf command line)
      let greenIdx = -1;
      let greenRow = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        // Skip the command line (contains printf)
        if (rowText.includes("printf")) continue;
        const idx = rowText.indexOf("green");
        if (idx >= 0) {
          greenIdx = idx;
          greenRow = r;
          break;
        }
      }
      expect(greenRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, greenRow, greenIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(82);
      expect(cell!.isFgPalette).toBe(true);
    });
  });

  describe("bracketed paste", () => {
    it("paste markers are not visible in buffer text", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-bracketed-paste.bytes"),
      );

      expect(hasBracketedPasteMarkersVisible(terminal)).toBe(false);
    });

    it("pasted content appears in buffer", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("bash-bracketed-paste.bytes"),
      );

      const pasteRow = findRowWithText(terminal, "pasted line");
      expect(pasteRow).toBeGreaterThanOrEqual(0);
    });
  });
});
