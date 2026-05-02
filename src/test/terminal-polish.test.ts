/**
 * Unit tests for terminal UX polish features.
 *
 * Tests for: right-click paste, Ctrl+Shift+C/V copy/paste,
 * visual bell, tab title from escape sequences, word separators,
 * clickable URLs, font size zoom, graceful app exit, and reconnect on wake.
 *
 * Tags: [TDD], [POLISH]
 */
import { describe, it, expect } from "vitest";
import { TERMINAL_CONFIG } from "../components/Terminal/types";
import {
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
  WORD_SEPARATOR,
  clampFontSize,
} from "../components/Terminal/terminalPolish";

// ─── Fix 5: Word Separator ──────────────────────────────────────────

describe("Word Separator Configuration", () => {
  it("does not include dot as a separator (for IPs and domains)", () => {
    expect(WORD_SEPARATOR).not.toContain(".");
  });

  it("does not include slash as a separator (for file paths)", () => {
    expect(WORD_SEPARATOR).not.toContain("/");
  });

  it("does not include hyphen as a separator (for hostnames)", () => {
    expect(WORD_SEPARATOR).not.toContain("-");
  });

  it("includes space as a separator", () => {
    expect(WORD_SEPARATOR).toContain(" ");
  });

  it("includes common delimiters (parens, brackets, quotes)", () => {
    expect(WORD_SEPARATOR).toContain("(");
    expect(WORD_SEPARATOR).toContain(")");
    expect(WORD_SEPARATOR).toContain("[");
    expect(WORD_SEPARATOR).toContain("]");
    expect(WORD_SEPARATOR).toContain("{");
    expect(WORD_SEPARATOR).toContain("}");
  });
});

// ─── Fix 7: Font Size Zoom ──────────────────────────────────────────

describe("Font Size Zoom Constants", () => {
  it("minimum font size is 8", () => {
    expect(FONT_SIZE_MIN).toBe(8);
  });

  it("maximum font size is 32", () => {
    expect(FONT_SIZE_MAX).toBe(32);
  });

  it("default font size matches TERMINAL_CONFIG", () => {
    expect(FONT_SIZE_DEFAULT).toBe(TERMINAL_CONFIG.fontSize);
  });
});

describe("clampFontSize", () => {
  it("returns value within range unchanged", () => {
    expect(clampFontSize(14)).toBe(14);
    expect(clampFontSize(20)).toBe(20);
  });

  it("clamps to minimum when too small", () => {
    expect(clampFontSize(4)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(0)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(-1)).toBe(FONT_SIZE_MIN);
  });

  it("clamps to maximum when too large", () => {
    expect(clampFontSize(40)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(100)).toBe(FONT_SIZE_MAX);
  });

  it("handles boundary values", () => {
    expect(clampFontSize(FONT_SIZE_MIN)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(FONT_SIZE_MAX)).toBe(FONT_SIZE_MAX);
  });
});

// ─── Fix 3: Bell Handling ───────────────────────────────────────────

describe("Bell CSS Animation", () => {
  /**
   * Validates that the bell flash class name is defined.
   * The actual CSS animation is tested visually; this validates the constant
   * used to add/remove the class.
   */
  it("bell flash CSS class constant is defined", async () => {
    const { BELL_FLASH_CLASS, BELL_FLASH_DURATION_MS } =
      await import("../components/Terminal/terminalPolish");
    expect(BELL_FLASH_CLASS).toBe("tab--bell-flash");
    expect(BELL_FLASH_DURATION_MS).toBe(300);
  });
});

// ─── Fix 9: Reconnect on Wake ───────────────────────────────────────

describe("Reconnect on Wake Constants", () => {
  it("defines a reconnect grace period", async () => {
    const { WAKE_RECONNECT_GRACE_MS } =
      await import("../components/Terminal/terminalPolish");
    expect(WAKE_RECONNECT_GRACE_MS).toBeGreaterThan(0);
    expect(WAKE_RECONNECT_GRACE_MS).toBeLessThanOrEqual(5000);
  });
});
