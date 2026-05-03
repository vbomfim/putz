/**
 * VT Correctness Test Corpus — CSI/SGR Sequences
 *
 * Fixtures adapted from microsoft/terminal (MIT) and xtermjs/xterm.js (MIT).
 * Only test inputs and expected outcomes were ported — no implementation code.
 *
 * Tests feed raw byte sequences through a headless xterm.js Terminal via
 * shellCompatHarness and assert on buffer state, cursor position, and
 * cell attributes.
 *
 * @see THIRD_PARTY.md for full attribution
 * @see https://github.com/vbomfim/putz/issues/107
 */
import { describe, it, expect } from "vitest";
import {
  createTerminalFromBytes,
  getLineText,
  getCursorPosition,
  getCellInfo,
} from "../utils/shellCompatHarness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// ===========================================================================
// Cursor Movement (CUU, CUD, CUF, CUB, CUP)
// Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovement (MIT)
// ===========================================================================

describe("VT Corpus: CSI sequences", () => {
  describe("Cursor Movement", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithValues (MIT)
    it("CUU (cursor up) moves cursor up by N", async () => {
      // Place cursor at row 5, then move up 3
      const bytes = enc("\x1b[6;1H\x1b[3A");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(2); // row 6-1=5 (0-indexed), up 3 = row 2
      expect(pos.x).toBe(0);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithValues (MIT)
    it("CUD (cursor down) moves cursor down by N", async () => {
      const bytes = enc("\x1b[1;1H\x1b[5B");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(5);
      expect(pos.x).toBe(0);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithValues (MIT)
    it("CUF (cursor forward) moves cursor right by N", async () => {
      const bytes = enc("\x1b[1;1H\x1b[10C");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.x).toBe(10);
      expect(pos.y).toBe(0);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithValues (MIT)
    it("CUB (cursor back) moves cursor left by N", async () => {
      const bytes = enc("\x1b[1;20H\x1b[5D");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.x).toBe(14); // col 20-1=19, back 5 = 14
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithoutValues (MIT)
    it("CUU without param defaults to 1", async () => {
      const bytes = enc("\x1b[3;1H\x1b[A");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(1); // row 3-1=2, up 1 = 1
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithoutValues (MIT)
    it("CUD without param defaults to 1", async () => {
      const bytes = enc("\x1b[1;1H\x1b[B");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(1);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithoutValues (MIT)
    it("CUF without param defaults to 1", async () => {
      const bytes = enc("\x1b[1;1H\x1b[C");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(1);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiCursorMovementWithoutValues (MIT)
    it("CUB without param defaults to 1", async () => {
      const bytes = enc("\x1b[1;5H\x1b[D");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(3); // col 5-1=4, back 1 = 3
      term.dispose();
    });

    // Source: putz-custom
    it("CUP (cursor position) moves to row;col", async () => {
      const bytes = enc("\x1b[10;20H");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(9); // 1-indexed to 0-indexed
      expect(pos.x).toBe(19);
      term.dispose();
    });

    // Source: putz-custom
    it("CUP without params defaults to 1;1 (home)", async () => {
      const bytes = enc("\x1b[5;5H\x1b[H");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(0);
      expect(pos.x).toBe(0);
      term.dispose();
    });

    // Source: putz-custom
    it("CUP with only row param defaults col to 1", async () => {
      const bytes = enc("\x1b[5H");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(4);
      expect(pos.x).toBe(0);
      term.dispose();
    });

    // Source: putz-custom (boundary)
    it("cursor movement stops at top edge (CUU beyond row 0)", async () => {
      const bytes = enc("\x1b[1;1H\x1b[999A");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(0);
      term.dispose();
    });

    // Source: putz-custom (boundary)
    it("cursor movement stops at left edge (CUB beyond col 0)", async () => {
      const bytes = enc("\x1b[1;1H\x1b[999D");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(0);
      term.dispose();
    });

    // Source: putz-custom (boundary)
    it("cursor movement stops at right edge", async () => {
      const bytes = enc("\x1b[1;1H\x1b[999C");
      const term = await createTerminalFromBytes(bytes, { cols: 80 });
      expect(getCursorPosition(term).x).toBe(79);
      term.dispose();
    });

    // Source: putz-custom (boundary)
    it("cursor movement stops at bottom edge", async () => {
      const bytes = enc("\x1b[1;1H\x1b[999B");
      const term = await createTerminalFromBytes(bytes, { rows: 24 });
      expect(getCursorPosition(term).y).toBe(23);
      term.dispose();
    });
  });

  // ===========================================================================
  // SGR (Select Graphic Rendition)
  // Source: microsoft/terminal OutputEngineTest.cpp TestSetGraphicsRendition (MIT)
  // ===========================================================================

  describe("SGR — Text Attributes", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp Test 1: default case (MIT)
    it("SGR 0 (reset) clears all attributes", async () => {
      const bytes = enc("\x1b[1mBold\x1b[0mNormal");
      const term = await createTerminalFromBytes(bytes);
      const boldCell = getCellInfo(term, 0, 0);
      const normalCell = getCellInfo(term, 4, 0);
      expect(boldCell.isBold).toBe(true);
      expect(normalCell.isBold).toBe(false);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 2: clear/0 case (MIT)
    it("SGR with no params acts as reset (same as SGR 0)", async () => {
      const bytes = enc("\x1b[1mBold\x1b[mReset");
      const term = await createTerminalFromBytes(bytes);
      const resetCell = getCellInfo(term, 4, 0);
      expect(resetCell.isBold).toBe(false);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3: handful of options (MIT)
    it("SGR 1 (bold/intense)", async () => {
      const bytes = enc("\x1b[1mtest");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).isBold).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3 (MIT)
    it("SGR 4 (underline)", async () => {
      const bytes = enc("\x1b[4mtest");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).isUnderline).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3 (MIT)
    it("SGR 7 (inverse/negative)", async () => {
      const bytes = enc("\x1b[7mtest");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).isInverse).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 2 (dim/faint)", async () => {
      const bytes = enc("\x1b[2mtest");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).isDim).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 3 (italic)", async () => {
      const bytes = enc("\x1b[3mtest");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).isItalic).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3: combined attributes (MIT)
    it("SGR 1;4;7 (bold + underline + inverse combined)", async () => {
      const bytes = enc("\x1b[1;4;7mtest");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.isBold).toBe(true);
      expect(cell.isUnderline).toBe(true);
      expect(cell.isInverse).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3: foreground colors (MIT)
    it("SGR 30-37 (standard foreground colors)", async () => {
      // SGR 31 = red foreground
      const bytes = enc("\x1b[31mR");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.fgColor).toBe(1); // Red is color index 1
      expect(cell.isFgPalette).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 3 (MIT)
    it("SGR 40-47 (standard background colors)", async () => {
      // SGR 42 = green background
      const bytes = enc("\x1b[42mG");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.bgColor).toBe(2); // Green is color index 2
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 38;5;N (256-color foreground)", async () => {
      const bytes = enc("\x1b[38;5;196mR");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.fgColor).toBe(196);
      expect(cell.isFgPalette).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 48;5;N (256-color background)", async () => {
      const bytes = enc("\x1b[48;5;21mB");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.bgColor).toBe(21);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 38;2;R;G;B (24-bit true-color foreground)", async () => {
      const bytes = enc("\x1b[38;2;255;128;0mO");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.isFgRgb).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 90-97 (bright foreground colors)", async () => {
      // SGR 91 = bright red foreground
      const bytes = enc("\x1b[91mR");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.fgColor).toBe(9); // Bright red is index 9
      expect(cell.isFgPalette).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("SGR 100-107 (bright background colors)", async () => {
      // SGR 101 = bright red background
      const bytes = enc("\x1b[101mR");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.bgColor).toBe(9); // Bright red bg index 9
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 5.a: empty param at end (MIT)
    it("SGR 1; (trailing semicolon = default 0 appended)", async () => {
      const bytes = enc("\x1b[1;mtest");
      const term = await createTerminalFromBytes(bytes);
      // 1; means bold + reset → result is reset
      const cell = getCellInfo(term, 0, 0);
      expect(cell.isBold).toBe(false);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 5.b: empty param in middle (MIT)
    it("SGR 1;;1 (empty param in middle = default 0)", async () => {
      const bytes = enc("\x1b[1;;1mtest");
      const term = await createTerminalFromBytes(bytes);
      // 1 (bold) ; ; (reset) ; 1 (bold) → result is bold
      const cell = getCellInfo(term, 0, 0);
      expect(cell.isBold).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 5.c: empty param at start (MIT)
    it("SGR ;31;1 (leading semicolon = default 0 prepended)", async () => {
      const bytes = enc("\x1b[;31;1mtest");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.fgColor).toBe(1); // Red
      expect(cell.isBold).toBe(true);
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp Test 4: many options >16 (MIT)
    it("SGR with 17 params (>16) is handled", async () => {
      // 1;4;1;4;1;4;1;4;1;4;1;4;1;4;1;4;1
      const bytes = enc("\x1b[1;4;1;4;1;4;1;4;1;4;1;4;1;4;1;4;1mtest");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      // Final state: bold + underline (they toggle on/off)
      expect(cell.isBold).toBe(true);
      expect(cell.isUnderline).toBe(true);
      term.dispose();
    });
  });

  // ===========================================================================
  // Erase Commands (ED, EL)
  // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
  // ===========================================================================

  describe("Erase Commands", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("ED 0 (erase below) clears from cursor to end of screen", async () => {
      const bytes = enc("AAAA\r\nBBBB\r\n\x1b[1;1H\x1b[0J");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      expect(getLineText(term, 1)).toBe("");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("ED 1 (erase above) clears from start of screen to cursor", async () => {
      const bytes = enc("AAAA\r\nBBBB\r\n\x1b[2;3H\x1b[1J");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      // Line 1 partially erased up to cursor position
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("ED 2 (erase entire screen) clears all content", async () => {
      const bytes = enc("AAAA\r\nBBBB\r\nCCCC\r\n\x1b[2J");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      expect(getLineText(term, 1)).toBe("");
      expect(getLineText(term, 2)).toBe("");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("EL 0 (erase to right) clears from cursor to end of line", async () => {
      const bytes = enc("ABCDEF\r\n\x1b[1;3H\x1b[0K");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("AB");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("EL 1 (erase to left) clears from start of line to cursor", async () => {
      const bytes = enc("ABCDEF\r\n\x1b[1;4H\x1b[1K");
      const term = await createTerminalFromBytes(bytes);
      // First 4 chars erased (positions 0-3), DEF remains at positions 4-5
      const line = getLineText(term, 0, false);
      expect(line.slice(4, 6)).toBe("EF");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestErase (MIT)
    it("EL 2 (erase entire line) clears the whole line", async () => {
      const bytes = enc("ABCDEF\r\n\x1b[1;3H\x1b[2K");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });
  });

  // ===========================================================================
  // Scroll Regions (DECSTBM)
  // ===========================================================================

  describe("Scroll Regions", () => {
    // Source: putz-custom
    it("DECSTBM sets scroll region and constrains cursor", async () => {
      // Set scroll region to rows 5-10, then move cursor down beyond
      const bytes = enc("\x1b[5;10r\x1b[5;1H\x1b[999B");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(9); // 0-indexed row 9 = row 10
      term.dispose();
    });

    // Source: putz-custom
    it("DECSTBM reset (no params) restores full screen scrolling", async () => {
      const bytes = enc("\x1b[5;10r\x1b[r\x1b[1;1H\x1b[999B");
      const term = await createTerminalFromBytes(bytes, { rows: 24 });
      expect(getCursorPosition(term).y).toBe(23);
      term.dispose();
    });
  });

  // ===========================================================================
  // Alternate Screen Buffer (DECSET/DECRST 1049)
  // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes (MIT)
  // ===========================================================================

  describe("Alternate Screen Buffer", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes mode 1049 (MIT)
    it("DECSET 1049 switches to alternate buffer, DECRST restores", async () => {
      const bytes = enc(
        "main buffer text\x1b[?1049h\x1b[2J\x1b[1;1Halt text\x1b[?1049l",
      );
      const term = await createTerminalFromBytes(bytes);
      // After restoring normal buffer, original text should be visible
      expect(getLineText(term, 0)).toBe("main buffer text");
      term.dispose();
    });

    // Source: putz-custom
    it("alternate buffer is initially empty", async () => {
      const bytes = enc("hello\x1b[?1049h");
      const term = await createTerminalFromBytes(bytes);
      // In alt buffer, screen should be cleared
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });
  });

  // ===========================================================================
  // Bracketed Paste Mode (DECSET/DECRST 2004)
  // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes (MIT)
  // ===========================================================================

  describe("Bracketed Paste Mode", () => {
    // Source: putz-custom (adapted from microsoft/terminal TestPrivateModes)
    it("DECSET 2004 enables bracketed paste mode", async () => {
      const bytes = enc("\x1b[?2004h");
      const term = await createTerminalFromBytes(bytes);
      expect(term.modes.bracketedPasteMode).toBe(true);
      term.dispose();
    });

    // Source: putz-custom
    it("DECRST 2004 disables bracketed paste mode", async () => {
      const bytes = enc("\x1b[?2004h\x1b[?2004l");
      const term = await createTerminalFromBytes(bytes);
      expect(term.modes.bracketedPasteMode).toBe(false);
      term.dispose();
    });
  });

  // ===========================================================================
  // CSI Parameter Parsing
  // Source: xtermjs/xterm.js Params.test.ts (MIT)
  // ===========================================================================

  describe("CSI Parameter Parsing", () => {
    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts CSI_ENTRY (MIT)
    it("CSI with single param", async () => {
      // CSI 5 A = cursor up 5
      const bytes = enc("\x1b[3;1H\x1b[2A");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(0);
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts CSI_PARAM (MIT)
    it("CSI with multiple semicolon-separated params", async () => {
      // CSI 10;20 H = cursor to row 10, col 20
      const bytes = enc("\x1b[10;20H");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(9);
      expect(pos.x).toBe(19);
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts CSI_ENTRY (MIT)
    it("CSI with no params uses defaults", async () => {
      const bytes = enc("\x1b[5;5H\x1b[A");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(3); // Default 1, from row 4
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts CSI_ENTRY colon (MIT)
    it("CSI with colon subparam separator is accepted", async () => {
      // Colon-separated subparams (e.g., SGR 58:2:R:G:B underline color)
      // This should not crash the parser
      const bytes = enc("\x1b[58:2:255:0:0mtest\x1b[0m");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("test");
      term.dispose();
    });
  });

  // ===========================================================================
  // Cursor Save/Restore (DECSC/DECRC)
  // Source: microsoft/terminal OutputEngineTest.cpp TestCursorSaveLoad (MIT)
  // ===========================================================================

  describe("Cursor Save/Restore", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestCursorSaveLoad (MIT)
    it("DECSC/DECRC saves and restores cursor position", async () => {
      const bytes = enc("\x1b[5;10H\x1b7\x1b[1;1H\x1b8");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(4); // Restored to row 5 (0-indexed = 4)
      expect(pos.x).toBe(9); // Restored to col 10 (0-indexed = 9)
      term.dispose();
    });

    // Source: putz-custom
    it("CSI s/u (ANSI save/restore) also works", async () => {
      const bytes = enc("\x1b[5;10H\x1b[s\x1b[1;1H\x1b[u");
      const term = await createTerminalFromBytes(bytes);
      const pos = getCursorPosition(term);
      expect(pos.y).toBe(4);
      expect(pos.x).toBe(9);
      term.dispose();
    });
  });

  // ===========================================================================
  // Line Feed and Carriage Return
  // Source: microsoft/terminal OutputEngineTest.cpp TestLineFeed (MIT)
  // ===========================================================================

  describe("Line Feed / Carriage Return", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestLineFeed (MIT)
    it("LF (0x0a) moves cursor down one line", async () => {
      const bytes = enc("line1\nline2");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("line1");
      expect(getLineText(term, 1)).toContain("line2");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestLineFeed (MIT)
    it("CR+LF moves cursor to start of next line", async () => {
      const bytes = enc("line1\r\nline2");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("line1");
      expect(getLineText(term, 1)).toBe("line2");
      term.dispose();
    });

    // Source: putz-custom
    it("CR alone moves cursor to start of current line", async () => {
      const bytes = enc("ABCDE\rXY");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("XYCDE");
      term.dispose();
    });

    // Source: putz-custom
    it("VT (0x0b) and FF (0x0c) act like LF", async () => {
      const bytes = enc("A\x0bB\x0cC");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("A");
      expect(getLineText(term, 1)).toContain("B");
      expect(getLineText(term, 2)).toContain("C");
      term.dispose();
    });
  });

  // ===========================================================================
  // Tab Characters
  // Source: microsoft/terminal OutputEngineTest.cpp TestTabClear (MIT)
  // ===========================================================================

  describe("Tab Characters", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestTabClear (MIT)
    it("HT (0x09) advances cursor to next tab stop", async () => {
      const bytes = enc("A\tB");
      const term = await createTerminalFromBytes(bytes);
      // Default tab stop is every 8 columns
      const line = getLineText(term, 0, false);
      expect(line.charAt(0)).toBe("A");
      expect(line.charAt(8)).toBe("B");
      term.dispose();
    });

    // Source: putz-custom
    it("multiple tabs advance correctly", async () => {
      const bytes = enc("A\t\tB");
      const term = await createTerminalFromBytes(bytes);
      const line = getLineText(term, 0, false);
      expect(line.charAt(0)).toBe("A");
      expect(line.charAt(16)).toBe("B");
      term.dispose();
    });
  });

  // ===========================================================================
  // Insert/Delete Lines (IL, DL)
  // ===========================================================================

  describe("Insert/Delete Lines", () => {
    // Source: putz-custom
    it("IL (insert line) pushes content down", async () => {
      const bytes = enc("Line1\r\nLine2\r\nLine3\x1b[2;1H\x1b[1L");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("Line1");
      expect(getLineText(term, 1)).toBe(""); // Inserted blank line
      expect(getLineText(term, 2)).toBe("Line2");
      term.dispose();
    });

    // Source: putz-custom
    it("DL (delete line) removes line and pulls content up", async () => {
      const bytes = enc("Line1\r\nLine2\r\nLine3\x1b[2;1H\x1b[1M");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("Line1");
      expect(getLineText(term, 1)).toBe("Line3");
      term.dispose();
    });
  });

  // ===========================================================================
  // ESC Sequences
  // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts (MIT)
  // ===========================================================================

  describe("ESC Sequences", () => {
    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts 'trans ESCAPE --> GROUND' (MIT)
    it("ESC c (RIS - full reset) clears screen and resets state", async () => {
      const bytes = enc("text here\x1bcafter reset");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("after reset");
      term.dispose();
    });

    // Source: putz-custom
    it("ESC D (IND - index/line feed) moves cursor down", async () => {
      const bytes = enc("\x1b[1;1Htest\x1bD");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(1);
      term.dispose();
    });

    // Source: putz-custom
    it("ESC M (RI - reverse index) moves cursor up", async () => {
      const bytes = enc("\x1b[2;1H\x1bM");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).y).toBe(0);
      term.dispose();
    });
  });

  // ===========================================================================
  // DEC Private Modes
  // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes (MIT)
  // ===========================================================================

  describe("DEC Private Modes", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes mode 25 (MIT)
    it("DECSET/DECRST 25 controls cursor visibility", async () => {
      // Hide cursor
      const bytes = enc("\x1b[?25l");
      const term = await createTerminalFromBytes(bytes);
      // xterm.js: options.cursorBlink may change, but the cursor visibility
      // is managed internally. We verify no crash.
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestPrivateModes mode 7 (MIT)
    it("DECSET/DECRST 7 controls auto-wrap mode", async () => {
      // Enable auto-wrap, write text longer than terminal width
      const bytes = enc("\x1b[?7h" + "A".repeat(85));
      const term = await createTerminalFromBytes(bytes, { cols: 80 });
      // Text should wrap to next line
      expect(getLineText(term, 1)).toContain("A");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestMultipleModes (MIT)
    it("multiple mode sets in one sequence", async () => {
      // Not all terminals support this, but xterm.js should handle gracefully
      const bytes = enc("\x1b[?25l\x1b[?7h");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });
  });

  // ===========================================================================
  // Control Characters
  // Source: microsoft/terminal OutputEngineTest.cpp TestControlCharacters (MIT)
  // ===========================================================================

  describe("Control Characters", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestControlCharacters (MIT)
    it("BEL (0x07) is consumed and does not produce visible output", async () => {
      const bytes = enc("before\x07after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("beforeafter");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestControlCharacters (MIT)
    it("BS (0x08) moves cursor back one position", async () => {
      const bytes = enc("abc\x08X");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("abX");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestControlCharacters (MIT)
    it("NUL (0x00) is silently ignored", async () => {
      const bytes = new Uint8Array([0x41, 0x00, 0x42]); // A NUL B
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("AB");
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts GROUND execute (MIT)
    it("ENQ (0x05) is consumed silently", async () => {
      const bytes = enc("A\x05B");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("AB");
      term.dispose();
    });
  });

  // ===========================================================================
  // Printing / Ground State
  // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts GROUND print (MIT)
  // ===========================================================================

  describe("Ground State — Printable Characters", () => {
    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts 'state GROUND print action' (MIT)
    it("printable ASCII range 0x20-0x7e renders correctly", async () => {
      const chars = [];
      for (let i = 0x20; i <= 0x7e; i++) {
        chars.push(String.fromCharCode(i));
      }
      const text = chars.join("");
      const bytes = enc(text);
      const term = await createTerminalFromBytes(bytes, { cols: 120 });
      const line = getLineText(term, 0);
      expect(line).toContain(" !\"#$%&'()*+,-./0123456789");
      term.dispose();
    });

    // Source: putz-custom
    it("DEL (0x7f) is not printed", async () => {
      const bytes = new Uint8Array([0x41, 0x7f, 0x42]);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("AB");
      term.dispose();
    });
  });
});
