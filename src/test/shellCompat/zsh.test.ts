// Layer 1: synthetic fixture rendering coverage.
// See docs/shell-compat-fixtures.md for capture instructions to upgrade to recorded fixtures.

/**
 * Shell Compatibility Tests — zsh
 *
 * Validates that common zsh features (prompt, autosuggestions, erase-in-line,
 * 256 colors, CJK characters, OSC 7) render correctly through xterm.js.
 *
 * Uses synthetic PTY byte-stream fixtures fed into a headless Terminal.
 *
 * @see docs/shell-compat-fixtures.md for fixture inventory
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

describe("zsh shell compatibility", () => {
  let terminal: Terminal | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
  });

  describe("cold prompt render", () => {
    it("renders colored prompt with no garbage characters", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("user@host");
      expect(line).toContain("~/projects");
      expect(line).toContain("$");
      // No raw escape sequences visible
      expect(line).not.toContain("\x1b");
      expect(line).not.toContain("[0m");
    });

    it("applies bold green to user@host", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-cold-prompt.bytes"),
      );
      const cell = getCellInfo(terminal, 0, 0); // 'u' in user@host

      expect(cell).not.toBeNull();
      expect(cell!.char).toBe("u");
      expect(cell!.isBold).toBe(true);
      // Green = palette color 2 in SGR 1;32
      expect(cell!.fgColor).toBe(2);
      expect(cell!.isFgPalette).toBe(true);
    });
  });

  describe("inline autosuggestion", () => {
    it("shows ghost text after typed input", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-autosuggest.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("git");
      expect(line).toContain("status --short");
    });

    it("renders ghost text with dim attribute", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-autosuggest.bytes"),
      );
      const row = findRowWithText(terminal, "status");
      expect(row).toBeGreaterThanOrEqual(0);

      // Find the 's' in 'status' — it should be dim
      const line = getLineText(terminal, row);
      const statusIdx = line.indexOf("status");
      const cell = getCellInfo(terminal, row, statusIdx);

      expect(cell).not.toBeNull();
      expect(cell!.isDim).toBe(true);
    });

    it("cursor stays at end of typed text, not ghost text", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-autosuggest.bytes"),
      );
      const pos = getCursorPosition(terminal);

      // After "❯ git" cursor should be at column 5 (❯=1 + space + git=3)
      expect(pos.x).toBe(5);
    });
  });

  describe("multi-line prompt redraw", () => {
    it("erases stale content with \\e[K", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-multiline-redraw.bytes"),
      );

      // The fixture: line 0 = original prompt+command, line 1 = output,
      // line 2 = redrawn prompt with updated command (CR moves to col 0 of row 2)
      const redrawnRow = findRowWithText(terminal, "echo hello world");
      expect(redrawnRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, redrawnRow);
      expect(line).toContain("❯");
      expect(line).toContain("echo hello world");
    });

    it("no trailing artifacts from previous shorter text", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-multiline-redraw.bytes"),
      );

      const redrawnRow = findRowWithText(terminal, "echo hello world");
      expect(redrawnRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, redrawnRow, false);

      // After \e[K, everything after "echo hello world" should be blank
      const promptEnd =
        line.indexOf("echo hello world") + "echo hello world".length;
      const trailing = line.slice(promptEnd).trim();
      expect(trailing).toBe("");
    });
  });

  describe("256 colors", () => {
    it("renders 256-color foreground correctly", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-256color.bytes"),
      );

      // Find the output line with " hello" (not the printf command line)
      let helloRow = -1;
      let helloIdx = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText.includes("printf")) continue;
        const idx = rowText.indexOf("hello");
        if (idx >= 0) {
          helloRow = r;
          helloIdx = idx;
          break;
        }
      }
      expect(helloRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, helloRow, helloIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(82);
      expect(cell!.isFgPalette).toBe(true);
    });

    it("resets color after SGR 0", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-256color.bytes"),
      );

      // Find the prompt line after the colored output
      const lastPromptRow = findRowWithText(terminal, "❯", 1);
      expect(lastPromptRow).toBeGreaterThanOrEqual(0);

      // The space after ❯ should have default colors
      const line = getLineText(terminal, lastPromptRow);
      const spaceIdx = line.indexOf("❯") + 2;
      const cell = getCellInfo(terminal, lastPromptRow, spaceIdx);

      // Default fg color = -1 (not palette, not RGB)
      if (cell && cell.char.trim() === "") {
        expect(cell.isFgPalette).toBe(false);
      }
    });
  });

  describe("cursor movement", () => {
    it("cursor moves backward correctly", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-cursor-movement.bytes"),
      );
      const pos = getCursorPosition(terminal);

      // "❯ echo test" = 11 chars, cursor back 4 = position 7
      // ❯(1) + space(1) + echo(4) + space(1) = 7
      expect(pos.x).toBe(7);
    });

    it("buffer content is not corrupted by cursor movement", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("zsh-cursor-movement.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("echo test");
    });
  });

  describe("CJK characters", () => {
    it("renders wide characters correctly", async () => {
      terminal = await createTerminalFromBytes(loadFixture("zsh-cjk.bytes"));

      // Find the pure output line (row with just CJK, no prompt)
      let cjkRow = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText === "你好世界") {
          cjkRow = r;
          break;
        }
      }
      expect(cjkRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, cjkRow, 0);
      expect(cell).not.toBeNull();
      expect(cell!.char).toBe("你");
      expect(cell!.width).toBe(2);
    });

    it("cursor advances by 2 cells per CJK character", async () => {
      terminal = await createTerminalFromBytes(loadFixture("zsh-cjk.bytes"));

      // Find the pure output line
      let cjkRow = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText === "你好世界") {
          cjkRow = r;
          break;
        }
      }
      expect(cjkRow).toBeGreaterThanOrEqual(0);

      // 你(2) + 好(2) + 世(2) + 界(2) = 8 cells
      const cell2 = getCellInfo(terminal, cjkRow, 2);
      expect(cell2).not.toBeNull();
      expect(cell2!.char).toBe("好");
      expect(cell2!.width).toBe(2);
    });
  });

  describe("OSC 7 cwd update", () => {
    // NOTE: OSC 7 parsing depends on S2 landing. This test verifies
    // that OSC 7 sequences don't produce visible garbage — the actual
    // cwd event firing will be tested after S2 merges.
    it("OSC 7 sequences are not visible in buffer text", async () => {
      terminal = await createTerminalFromBytes(loadFixture("zsh-osc7.bytes"));

      // Check no raw OSC sequences in the visible buffer
      for (let row = 0; row < terminal.rows; row++) {
        const text = getLineText(terminal, row, false);
        expect(text).not.toContain("]7;");
        expect(text).not.toContain("file://");
      }
    });

    it("prompt renders correctly after OSC 7 sequence", async () => {
      terminal = await createTerminalFromBytes(loadFixture("zsh-osc7.bytes"));
      const promptRow = findRowWithText(terminal, "❯");
      expect(promptRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, promptRow);
      expect(line).toContain("cd /tmp");
    });

    it.todo(
      "fires cwdChanged event for OSC 7 (blocked by S2 #100 — enable after merge)",
    );
  });
});
