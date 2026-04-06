/**
 * Contract tests for terminal types and configuration.
 *
 * Validates that terminal configuration values match the acceptance
 * criteria from Issue #3: scrollback, font, dimensions, theme.
 *
 * Tags: [CONTRACT], [AC-6], [AC-7]
 */
import { describe, it, expect } from "vitest";
import { TERMINAL_CONFIG, DEFAULT_TERMINAL_THEME } from "../components/Terminal/types";

describe("Terminal Configuration Contract", () => {
  /**
   * [CONTRACT] [AC-6] Scrollback buffer must be 10,000 lines.
   */
  it("scrollback is 10,000 lines", () => {
    expect(TERMINAL_CONFIG.scrollback).toBe(10_000);
  });

  /**
   * [CONTRACT] Font size must be 14px.
   */
  it("default font size is 14px", () => {
    expect(TERMINAL_CONFIG.fontSize).toBe(14);
  });

  /**
   * [CONTRACT] Font family must include monospace fonts.
   */
  it("font family includes monospace fallbacks", () => {
    expect(TERMINAL_CONFIG.fontFamily).toContain("monospace");
  });

  /**
   * [CONTRACT] Default dimensions must be 80x24 (standard terminal).
   */
  it("default dimensions are 80 columns by 24 rows", () => {
    expect(TERMINAL_CONFIG.defaultCols).toBe(80);
    expect(TERMINAL_CONFIG.defaultRows).toBe(24);
  });
});

describe("Terminal Theme Contract", () => {
  /**
   * [CONTRACT] Theme must have a dark background matching the app's --bg-primary.
   */
  it("background matches app bg-primary (#1a1a2e)", () => {
    expect(DEFAULT_TERMINAL_THEME.background).toBe("#1a1a2e");
  });

  /**
   * [CONTRACT] Theme must have a light foreground for readability.
   */
  it("foreground is light (#e0e0e0)", () => {
    expect(DEFAULT_TERMINAL_THEME.foreground).toBe("#e0e0e0");
  });

  /**
   * [CONTRACT] [AC-3] Theme must include all 16 ANSI colors.
   */
  it("includes all 16 ANSI colors", () => {
    const colors = [
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ] as const;

    for (const color of colors) {
      expect(DEFAULT_TERMINAL_THEME[color]).toBeDefined();
      expect(DEFAULT_TERMINAL_THEME[color]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  /**
   * [CONTRACT] Theme must have cursor colors defined.
   */
  it("has cursor colors defined", () => {
    expect(DEFAULT_TERMINAL_THEME.cursor).toBeDefined();
    expect(DEFAULT_TERMINAL_THEME.cursorAccent).toBeDefined();
  });

  /**
   * [CONTRACT] Theme must have selection background with transparency.
   */
  it("has selection background with alpha channel", () => {
    expect(DEFAULT_TERMINAL_THEME.selectionBackground).toBeDefined();
    // Should have alpha (8 hex chars)
    expect(DEFAULT_TERMINAL_THEME.selectionBackground).toMatch(
      /^#[0-9a-fA-F]{8}$/,
    );
  });
});
