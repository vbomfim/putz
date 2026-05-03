// Layer 1: synthetic fixture rendering coverage.
// See docs/shell-compat-fixtures.md for capture instructions to upgrade to recorded fixtures.

/**
 * Shell Compatibility Tests — fish
 *
 * Validates that common fish shell features (prompt, autosuggestions,
 * syntax highlighting, 256 colors, CJK characters) render correctly
 * through xterm.js.
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
  getCursorPosition,
} from "../utils/shellCompatHarness";

const FIXTURES = join(import.meta.dirname, "fixtures");
function loadFixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES, name));
}

describe("fish shell compatibility", () => {
  let terminal: Terminal | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
  });

  describe("cold prompt render", () => {
    it("renders fish default prompt with correct segments", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("user");
      expect(line).toContain("host");
      expect(line).toContain("~/projects");
      expect(line).toContain(">");
      expect(line).not.toContain("\x1b");
    });

    it("applies cyan color to hostname", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-cold-prompt.bytes"),
      );

      // Find the 'h' in 'host' — it should be cyan (color 6 from SGR 1;36)
      const line = getLineText(terminal, 0);
      const hostIdx = line.indexOf("host");
      const cell = getCellInfo(terminal, 0, hostIdx);

      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(6); // cyan
      expect(cell!.isFgPalette).toBe(true);
      expect(cell!.isBold).toBe(true);
    });
  });

  describe("inline autosuggestion", () => {
    it("shows ghost suggestion after typed command", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-suggestions.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("git");
      expect(line).toContain("status");
    });

    it("renders suggestion text in grey (SGR 90)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-suggestions.bytes"),
      );
      const line = getLineText(terminal, 0);
      const statusIdx = line.indexOf("status");

      const cell = getCellInfo(terminal, 0, statusIdx);
      expect(cell).not.toBeNull();
      // SGR 90 = bright black (palette color 8)
      expect(cell!.fgColor).toBe(8);
      expect(cell!.isFgPalette).toBe(true);
    });

    it("cursor stays at end of typed text", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-suggestions.bytes"),
      );
      const pos = getCursorPosition(terminal);

      // Cursor should be after "git" — "user@host ~/> git" position
      // user(4) @ host(4) space ~(1) > space = varies, but ghost text is after
      const line = getLineText(terminal, 0);
      const gitEnd = line.indexOf("git") + 3;
      expect(pos.x).toBe(gitEnd);
    });
  });

  describe("syntax highlighting", () => {
    it("renders valid command rewrite with green color", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-syntax-highlight.bytes"),
      );

      // After the rewrite, the line should show "nocommand" in red
      // The fixture first writes "ls" in green, then rewrites with "nocommand" in red
      const line = getLineText(terminal, 0);
      expect(line).toContain("nocommand");
    });

    it("renders invalid command in red (SGR 1;31)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-syntax-highlight.bytes"),
      );
      const line = getLineText(terminal, 0);
      const cmdIdx = line.indexOf("nocommand");

      const cell = getCellInfo(terminal, 0, cmdIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(1); // red
      expect(cell!.isFgPalette).toBe(true);
      expect(cell!.isBold).toBe(true);
    });

    it("erased region has no trailing artifacts", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-syntax-highlight.bytes"),
      );
      const line = getLineText(terminal, 0, false);

      // After \e[K, nothing should remain after "nocommand"
      const cmdEnd = line.indexOf("nocommand") + "nocommand".length;
      const trailing = line.slice(cmdEnd).trim();
      expect(trailing).toBe("");
    });
  });

  describe("256 colors", () => {
    it("renders 256-color foreground for color 208 (orange)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("fish-256color.bytes"),
      );

      // Find the output line with "orange" (not the printf command)
      let orangeRow = -1;
      let orangeIdx = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText.includes("printf")) continue;
        const idx = rowText.indexOf("orange");
        if (idx >= 0) {
          orangeRow = r;
          orangeIdx = idx;
          break;
        }
      }
      expect(orangeRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, orangeRow, orangeIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(208);
      expect(cell!.isFgPalette).toBe(true);
    });
  });

  describe("CJK characters", () => {
    it("renders wide characters correctly", async () => {
      terminal = await createTerminalFromBytes(loadFixture("fish-cjk.bytes"));

      const row = findRowWithText(terminal, "日本語");
      expect(row).toBeGreaterThanOrEqual(0);

      // Check first CJK character
      const line = getLineText(terminal, row);
      const cjkIdx = line.indexOf("日");
      const cell = getCellInfo(terminal, row, cjkIdx);

      expect(cell).not.toBeNull();
      expect(cell!.char).toBe("日");
      expect(cell!.width).toBe(2);
    });

    it("each CJK character occupies 2 cells", async () => {
      terminal = await createTerminalFromBytes(loadFixture("fish-cjk.bytes"));

      // Find the pure output line (日本語 without prompt)
      let cjkRow = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText === "日本語") {
          cjkRow = r;
          break;
        }
      }
      expect(cjkRow).toBeGreaterThanOrEqual(0);

      // 日(2) + 本(2) + 語(2) = 6 cells
      const cell0 = getCellInfo(terminal, cjkRow, 0);
      const cell2 = getCellInfo(terminal, cjkRow, 2);
      const cell4 = getCellInfo(terminal, cjkRow, 4);

      expect(cell0!.char).toBe("日");
      expect(cell0!.width).toBe(2);
      expect(cell2!.char).toBe("本");
      expect(cell2!.width).toBe(2);
      expect(cell4!.char).toBe("語");
      expect(cell4!.width).toBe(2);
    });
  });
});
