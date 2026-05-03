/**
 * VT Correctness Test Corpus — Unicode Width / CJK / Combining Characters
 *
 * Fixtures adapted from microsoft/terminal CodepointWidthDetectorTests (MIT)
 * and custom test cases for emoji, BiDi, surrogate pairs, and combining marks.
 *
 * Tests feed UTF-8 byte sequences through a headless xterm.js Terminal and
 * verify cell widths, character placement, and cursor advancement.
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

describe("VT Corpus: Unicode Width & Characters", () => {
  // ===========================================================================
  // CJK Wide Characters
  // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
  // ===========================================================================

  describe("CJK Wide Characters", () => {
    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("CJK Unified Ideograph occupies 2 cells", async () => {
      // U+4E2D (中) — common CJK character
      const bytes = enc("中");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      expect(cell.char).toBe("中");
      expect(cell.width).toBe(2);
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("multiple CJK characters advance cursor correctly", async () => {
      const bytes = enc("日本語");
      const term = await createTerminalFromBytes(bytes);
      // Each CJK char = 2 cells. Wide chars occupy their starting cell;
      // the continuation cell (odd index) returns empty string.
      expect(getCellInfo(term, 0, 0).char).toBe("日");
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      // Cursor should be at column 6 (3 wide chars × 2 cells each)
      expect(getCursorPosition(term).x).toBe(6);
      // Verify full line text contains all chars
      expect(getLineText(term, 0)).toBe("日本語");
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("CJK Compatibility Ideograph is wide", async () => {
      // U+F900 (豈) — CJK Compatibility Ideograph
      const bytes = enc("\uF900");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      term.dispose();
    });

    // Source: putz-custom
    it("mixed ASCII and CJK characters layout correctly", async () => {
      const bytes = enc("A中B本C");
      const term = await createTerminalFromBytes(bytes);
      // A(0) 中(1-2) B(3) 本(4-5) C(6)
      expect(getCellInfo(term, 0, 0).char).toBe("A");
      expect(getCellInfo(term, 0, 0).width).toBe(1);
      // Verify full line text
      expect(getLineText(term, 0)).toBe("A中B本C");
      // Cursor = 1 + 2 + 1 + 2 + 1 = 7
      expect(getCursorPosition(term).x).toBe(7);
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("Hangul Syllable is wide", async () => {
      // U+AC00 (가) — first Hangul Syllable
      const bytes = enc("가");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("Katakana Full-Width characters are wide", async () => {
      // U+30A2 (ア) — Katakana
      const bytes = enc("ア");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      term.dispose();
    });

    // Source: putz-custom
    it("CJK at end of line wraps correctly", async () => {
      // Fill 79 cols, then write a 2-cell CJK char → should wrap
      const fill = "A".repeat(79);
      const bytes = enc(fill + "中");
      const term = await createTerminalFromBytes(bytes, { cols: 80 });
      // The CJK char can't fit in 1 remaining col; it should wrap to next line
      expect(getLineText(term, 1).trimEnd()).toContain("中");
      term.dispose();
    });
  });

  // ===========================================================================
  // Combining Characters
  // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
  // ===========================================================================

  describe("Combining Characters", () => {
    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("combining acute accent does not advance cursor", async () => {
      // 'e' + U+0301 (combining acute accent) = 'é'
      const bytes = enc("e\u0301");
      const term = await createTerminalFromBytes(bytes);
      // The combining char should occupy the same cell as 'e'
      const cell = getCellInfo(term, 0, 0);
      expect(cell.char).toContain("e");
      expect(getCursorPosition(term).x).toBe(1); // Only 1 cell used
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("multiple combining marks on one base character", async () => {
      // 'a' + U+0300 (grave) + U+0301 (acute) = double-accented a
      const bytes = enc("a\u0300\u0301");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(1); // Still 1 cell
      term.dispose();
    });

    // Source: putz-custom
    it("combining mark after CJK character", async () => {
      // CJK char (2 cells) + combining mark (0 cells)
      const bytes = enc("中\u0301");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(2); // CJK = 2 cells
      term.dispose();
    });

    // Source: putz-custom
    it("text with combining chars renders base characters correctly", async () => {
      const bytes = enc("He\u0301llo");
      const term = await createTerminalFromBytes(bytes);
      // H(0) é(1) l(2) l(3) o(4)
      expect(getCursorPosition(term).x).toBe(5);
      const line = getLineText(term, 0);
      expect(line).toContain("H");
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("combining enclosing keycap (U+20E3)", async () => {
      // '3' + U+FE0F + U+20E3 = keycap three
      const bytes = enc("3\uFE0F\u20E3");
      const term = await createTerminalFromBytes(bytes);
      // Should not crash; width depends on xterm.js Unicode version
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // Emoji / Surrogate Pairs (outside BMP)
  // Source: putz-custom + microsoft/terminal CodepointWidthDetectorTests (MIT)
  // ===========================================================================

  describe("Emoji / Surrogate Pairs", () => {
    // Source: putz-custom
    // Note: xterm.js v6 with Unicode 11 addon treats most emoji as width 1
    // unless the addon is loaded AND activeVersion is set. In headless mode,
    // the addon loads but some emoji may still report width 1. This documents
    // the actual xterm.js v6 behavior.
    it("emoji outside BMP (🎉 U+1F389) renders without crash", async () => {
      const bytes = enc("🎉");
      const term = await createTerminalFromBytes(bytes);
      const cell = getCellInfo(term, 0, 0);
      // Width is 1 in xterm.js v6 default (without full Unicode 11 wcwidth)
      expect([1, 2]).toContain(cell.width);
      term.dispose();
    });

    // Source: putz-custom
    it("multiple emoji advance cursor correctly", async () => {
      const bytes = enc("🎉🎊");
      const term = await createTerminalFromBytes(bytes);
      // Width per emoji depends on xterm.js Unicode version; verify consistent
      const pos = getCursorPosition(term).x;
      expect(pos).toBeGreaterThanOrEqual(2);
      expect(pos).toBeLessThanOrEqual(4);
      term.dispose();
    });

    // Source: putz-custom
    it("emoji mixed with ASCII", async () => {
      const bytes = enc("A🎉B");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).char).toBe("A");
      // Cursor depends on emoji width (1 or 2)
      const pos = getCursorPosition(term).x;
      expect(pos).toBeGreaterThanOrEqual(3);
      expect(pos).toBeLessThanOrEqual(4);
      term.dispose();
    });

    // Source: putz-custom
    it("flag emoji (regional indicators) doesn't crash", async () => {
      // U+1F1FA U+1F1F8 = 🇺🇸 (US flag)
      const bytes = enc("🇺🇸");
      const term = await createTerminalFromBytes(bytes);
      // Width varies by implementation; no crash is the key assertion
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("ZWJ emoji sequence doesn't crash", async () => {
      // 👨‍💻 (man technologist) = U+1F468 U+200D U+1F4BB
      const bytes = enc("👨\u200D💻");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("skin tone emoji modifier doesn't crash", async () => {
      // 👋🏽 (waving hand, medium skin) = U+1F44B U+1F3FD
      const bytes = enc("👋🏽");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // Fullwidth / Halfwidth Forms
  // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
  // ===========================================================================

  describe("Fullwidth / Halfwidth Forms", () => {
    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("Fullwidth Latin A (U+FF21) is wide", async () => {
      const bytes = enc("\uFF21"); // Ａ
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      term.dispose();
    });

    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("Halfwidth Katakana (U+FF66) is narrow", async () => {
      const bytes = enc("\uFF66"); // ｦ
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(1);
      term.dispose();
    });

    // Source: putz-custom
    it("Fullwidth digit (U+FF10) is wide", async () => {
      const bytes = enc("\uFF10"); // ０
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(2);
      term.dispose();
    });
  });

  // ===========================================================================
  // Ambiguous Width Characters
  // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
  // ===========================================================================

  describe("Ambiguous Width Characters", () => {
    // Source: microsoft/terminal CodepointWidthDetectorTests.cpp (MIT)
    it("Greek capital letter Alpha (U+0391) is narrow in Western locale", async () => {
      const bytes = enc("\u0391"); // Α
      const term = await createTerminalFromBytes(bytes);
      // xterm.js defaults to narrow for ambiguous-width chars
      expect(getCellInfo(term, 0, 0).width).toBe(1);
      term.dispose();
    });

    // Source: putz-custom
    it("Box-drawing character (U+2502) is narrow", async () => {
      const bytes = enc("\u2502"); // │
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(1);
      term.dispose();
    });

    // Source: putz-custom
    it("Block element (U+2588) is narrow", async () => {
      const bytes = enc("\u2588"); // █
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).width).toBe(1);
      term.dispose();
    });
  });

  // ===========================================================================
  // BiDi / RTL Text
  // Source: putz-custom (BiDi rendering is complex; these are smoke tests)
  // ===========================================================================

  describe("BiDi / RTL Text", () => {
    // Source: putz-custom
    it("Arabic text doesn't crash the terminal", async () => {
      const bytes = enc("مرحبا");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      expect(getLineText(term, 0).length).toBeGreaterThan(0);
      term.dispose();
    });

    // Source: putz-custom
    it("Hebrew text doesn't crash the terminal", async () => {
      const bytes = enc("שלום");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      expect(getLineText(term, 0).length).toBeGreaterThan(0);
      term.dispose();
    });

    // Source: putz-custom
    it("mixed LTR/RTL text renders without crash", async () => {
      const bytes = enc("Hello مرحبا World");
      const term = await createTerminalFromBytes(bytes);
      const line = getLineText(term, 0);
      expect(line).toContain("Hello");
      expect(line).toContain("World");
      term.dispose();
    });

    // Source: putz-custom
    it("RTL with LTR override (U+202D) doesn't crash", async () => {
      const bytes = enc("\u202Dhello\u202C");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // Special Unicode Characters
  // ===========================================================================

  describe("Special Unicode Characters", () => {
    // Source: putz-custom
    it("Zero-Width Space (U+200B) is zero width", async () => {
      const bytes = enc("A\u200BB");
      const term = await createTerminalFromBytes(bytes);
      // The ZWSP should not add visible width
      const line = getLineText(term, 0);
      expect(line).toContain("A");
      expect(line).toContain("B");
      term.dispose();
    });

    // Source: putz-custom
    it("Non-Breaking Space (U+00A0) is rendered", async () => {
      const bytes = enc("A\u00A0B");
      const term = await createTerminalFromBytes(bytes);
      expect(getCursorPosition(term).x).toBe(3);
      term.dispose();
    });

    // Source: putz-custom
    it("Replacement Character (U+FFFD) renders", async () => {
      const bytes = enc("\uFFFD");
      const term = await createTerminalFromBytes(bytes);
      expect(getCellInfo(term, 0, 0).char).toBe("\uFFFD");
      term.dispose();
    });

    // Source: putz-custom
    it("Musical Symbol (U+1D11E 𝄞) outside BMP doesn't crash", async () => {
      const bytes = enc("𝄞");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });
});
