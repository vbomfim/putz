/**
 * Shell Compatibility Tests — PowerShell (PSReadLine)
 *
 * Validates that common PowerShell + PSReadLine features (prompt,
 * inline predictions, history search, 256 colors) render correctly
 * through xterm.js.
 *
 * Uses synthetic PTY byte-stream fixtures. These fixtures are generated
 * on macOS but represent the escape sequences that pwsh would produce.
 * Real Windows-captured fixtures can replace them when available.
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
  getCursorPosition,
} from "../../lib/terminal/shellCompatHarness";

const FIXTURES = join(import.meta.dirname, "fixtures");
function loadFixture(name: string): Uint8Array {
  return readFileSync(join(FIXTURES, name));
}

describe("pwsh (PSReadLine) shell compatibility", () => {
  let terminal: Terminal | null = null;

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
  });

  describe("cold prompt render", () => {
    it("renders PowerShell prompt with path", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("PS");
      expect(line).toContain("C:\\Users\\dev");
      expect(line).toContain(">");
      expect(line).not.toContain("\x1b");
    });

    it("applies yellow color to path segment", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-cold-prompt.bytes"),
      );
      const line = getLineText(terminal, 0);

      // Find the 'C' in path
      const pathIdx = line.indexOf("C:\\");
      const cell = getCellInfo(terminal, 0, pathIdx);

      expect(cell).not.toBeNull();
      // SGR 33 = yellow (palette index 3)
      expect(cell!.fgColor).toBe(3);
      expect(cell!.isFgPalette).toBe(true);
    });
  });

  describe("inline prediction (PSReadLine)", () => {
    it("shows grey prediction text after typed input", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-psreadline.bytes"),
      );
      const line = getLineText(terminal, 0);

      expect(line).toContain("Get-");
      expect(line).toContain("ChildItem");
    });

    it("renders prediction in grey (SGR 90)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-psreadline.bytes"),
      );
      const line = getLineText(terminal, 0);

      // Find 'C' in 'ChildItem'
      const predIdx = line.indexOf("ChildItem");
      const cell = getCellInfo(terminal, 0, predIdx);

      expect(cell).not.toBeNull();
      // SGR 90 = bright black (palette color 8)
      expect(cell!.fgColor).toBe(8);
      expect(cell!.isFgPalette).toBe(true);
    });

    it("cursor stays after typed text, before prediction", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-psreadline.bytes"),
      );
      const pos = getCursorPosition(terminal);
      const line = getLineText(terminal, 0);

      // Cursor should be right after "Get-"
      const getEnd = line.indexOf("Get-") + "Get-".length;
      expect(pos.x).toBe(getEnd);
    });
  });

  describe("history search (Ctrl+R)", () => {
    it("renders reverse search banner", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-history-search.bytes"),
      );

      const searchRow = findRowWithText(terminal, "bck-i-search");
      expect(searchRow).toBeGreaterThanOrEqual(0);
    });

    it("shows search term in banner", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-history-search.bytes"),
      );

      const searchRow = findRowWithText(terminal, "bck-i-search");
      expect(searchRow).toBeGreaterThanOrEqual(0);

      const line = getLineText(terminal, searchRow);
      expect(line).toContain("git");
    });

    it("renders search banner with reverse video", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-history-search.bytes"),
      );

      const searchRow = findRowWithText(terminal, "bck-i-search");
      expect(searchRow).toBeGreaterThanOrEqual(0);

      // First cell of the banner should be inverse
      const line = getLineText(terminal, searchRow);
      const bannerIdx = line.indexOf("bck-i-search");
      const cell = getCellInfo(terminal, searchRow, bannerIdx);

      expect(cell).not.toBeNull();
      expect(cell!.isInverse).toBe(true);
    });
  });

  describe("256 colors", () => {
    it("renders 256-color foreground for color 82 (green)", async () => {
      terminal = await createTerminalFromBytes(
        loadFixture("pwsh-256color.bytes"),
      );

      // Find output line with "colored" (not the command line)
      let colorRow = -1;
      let colorIdx = -1;
      for (let r = 0; r < terminal.rows; r++) {
        const rowText = getLineText(terminal, r);
        if (rowText.includes("Write-Host")) continue;
        const idx = rowText.indexOf("colored");
        if (idx >= 0) {
          colorRow = r;
          colorIdx = idx;
          break;
        }
      }
      expect(colorRow).toBeGreaterThanOrEqual(0);

      const cell = getCellInfo(terminal, colorRow, colorIdx);
      expect(cell).not.toBeNull();
      expect(cell!.fgColor).toBe(82);
      expect(cell!.isFgPalette).toBe(true);
    });
  });
});
