/**
 * Contract tests for theme IPC types.
 *
 * Validates that frontend TypeScript types match the expected
 * Rust backend IPC contract. Tests serialization, field names,
 * and type compatibility.
 *
 * Tags: [TDD], [AC-1], [AC-6]
 */
import { describe, it, expect } from "vitest";
import type {
  ThemeColors,
  Theme,
  CreateThemeInput,
  UpdateThemeInput,
  ThemeExport,
  FontSettings,
  UiThemeMode,
} from "../components/Terminal/themeTypes";
import {
  THEME_COLOR_FIELDS,
  DEFAULT_FONT_SETTINGS,
  MONOSPACE_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
} from "../components/Terminal/themeTypes";

describe("Theme contract types", () => {
  // ─── ThemeColors ───────────────────────────────────────────

  it("ThemeColors has all 22 color fields", () => {
    const colors: ThemeColors = {
      foreground: "#e0e0e0",
      background: "#1a1a2e",
      cursor: "#e0e0e0",
      cursorAccent: "#1a1a2e",
      selectionBackground: "#0f346080",
      selectionForeground: "",
      black: "#1a1a2e",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#6272a4",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#e0e0e0",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    };
    expect(Object.keys(colors)).toHaveLength(22);
  });

  it("ThemeColors uses camelCase field names matching Rust serde", () => {
    const colors: ThemeColors = {
      foreground: "#fff",
      background: "#000",
      cursor: "#fff",
      cursorAccent: "#000",
      selectionBackground: "#333",
      selectionForeground: "",
      black: "#000",
      red: "#f00",
      green: "#0f0",
      yellow: "#ff0",
      blue: "#00f",
      magenta: "#f0f",
      cyan: "#0ff",
      white: "#fff",
      brightBlack: "#888",
      brightRed: "#f88",
      brightGreen: "#8f8",
      brightYellow: "#ff8",
      brightBlue: "#88f",
      brightMagenta: "#f8f",
      brightCyan: "#8ff",
      brightWhite: "#fff",
    };
    // Verify camelCase fields (matching Rust serde rename_all = "camelCase")
    expect(colors).toHaveProperty("cursorAccent");
    expect(colors).toHaveProperty("selectionBackground");
    expect(colors).toHaveProperty("selectionForeground");
    expect(colors).toHaveProperty("brightBlack");
    expect(colors).toHaveProperty("brightWhite");
  });

  // ─── Theme ─────────────────────────────────────────────────

  it("Theme has all required fields", () => {
    const theme: Theme = {
      id: "theme-1",
      name: "Test Theme",
      colors: {
        foreground: "#fff",
        background: "#000",
        cursor: "#fff",
        cursorAccent: "#000",
        selectionBackground: "#333",
        selectionForeground: "",
        black: "#000",
        red: "#f00",
        green: "#0f0",
        yellow: "#ff0",
        blue: "#00f",
        magenta: "#f0f",
        cyan: "#0ff",
        white: "#fff",
        brightBlack: "#888",
        brightRed: "#f88",
        brightGreen: "#8f8",
        brightYellow: "#ff8",
        brightBlue: "#88f",
        brightMagenta: "#f8f",
        brightCyan: "#8ff",
        brightWhite: "#fff",
      },
      isBuiltin: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(theme.id).toBe("theme-1");
    expect(theme.name).toBe("Test Theme");
    expect(theme.isBuiltin).toBe(true);
    expect(theme.createdAt).toBeTruthy();
    expect(theme.updatedAt).toBeTruthy();
    expect(theme.colors).toBeDefined();
  });

  // ─── CreateThemeInput ──────────────────────────────────────

  it("CreateThemeInput has name and colors", () => {
    const input: CreateThemeInput = {
      name: "My Theme",
      colors: {
        foreground: "#fff",
        background: "#000",
        cursor: "#fff",
        cursorAccent: "#000",
        selectionBackground: "#333",
        selectionForeground: "",
        black: "#000",
        red: "#f00",
        green: "#0f0",
        yellow: "#ff0",
        blue: "#00f",
        magenta: "#f0f",
        cyan: "#0ff",
        white: "#fff",
        brightBlack: "#888",
        brightRed: "#f88",
        brightGreen: "#8f8",
        brightYellow: "#ff8",
        brightBlue: "#88f",
        brightMagenta: "#f8f",
        brightCyan: "#8ff",
        brightWhite: "#fff",
      },
    };
    expect(input.name).toBe("My Theme");
    expect(input.colors.foreground).toBe("#fff");
  });

  // ─── UpdateThemeInput ──────────────────────────────────────

  it("UpdateThemeInput fields are optional", () => {
    const nameOnly: UpdateThemeInput = { name: "Updated" };
    expect(nameOnly.name).toBe("Updated");
    expect(nameOnly.colors).toBeUndefined();

    const empty: UpdateThemeInput = {};
    expect(empty.name).toBeUndefined();
    expect(empty.colors).toBeUndefined();
  });

  // ─── ThemeExport ───────────────────────────────────────────

  it("ThemeExport has version, name, colors", () => {
    const exported: ThemeExport = {
      version: 1,
      name: "Exported Theme",
      colors: {
        foreground: "#fff",
        background: "#000",
        cursor: "#fff",
        cursorAccent: "#000",
        selectionBackground: "#333",
        selectionForeground: "",
        black: "#000",
        red: "#f00",
        green: "#0f0",
        yellow: "#ff0",
        blue: "#00f",
        magenta: "#f0f",
        cyan: "#0ff",
        white: "#fff",
        brightBlack: "#888",
        brightRed: "#f88",
        brightGreen: "#8f8",
        brightYellow: "#ff8",
        brightBlue: "#88f",
        brightMagenta: "#f8f",
        brightCyan: "#8ff",
        brightWhite: "#fff",
      },
    };
    expect(exported.version).toBe(1);
    expect(exported.name).toBe("Exported Theme");
  });

  // ─── THEME_COLOR_FIELDS ────────────────────────────────────

  it("THEME_COLOR_FIELDS has 22 entries", () => {
    expect(THEME_COLOR_FIELDS).toHaveLength(22);
  });

  it("THEME_COLOR_FIELDS groups are correct", () => {
    const terminal = THEME_COLOR_FIELDS.filter(
      (f) => f.group === "terminal",
    );
    const ansi = THEME_COLOR_FIELDS.filter((f) => f.group === "ansi");
    const ansiBright = THEME_COLOR_FIELDS.filter(
      (f) => f.group === "ansi-bright",
    );
    expect(terminal).toHaveLength(6); // fg, bg, cursor, cursorAccent, selBg, selFg
    expect(ansi).toHaveLength(8); // 8 standard ANSI
    expect(ansiBright).toHaveLength(8); // 8 bright ANSI
  });

  // ─── FontSettings ─────────────────────────────────────────

  it("FontSettings has all required fields", () => {
    const settings: FontSettings = {
      fontFamily: "monospace",
      fontSize: 14,
      ligatures: false,
      lineHeight: 1.2,
    };
    expect(settings.fontFamily).toBe("monospace");
    expect(settings.fontSize).toBe(14);
    expect(settings.ligatures).toBe(false);
    expect(settings.lineHeight).toBe(1.2);
  });

  it("DEFAULT_FONT_SETTINGS has valid defaults", () => {
    expect(DEFAULT_FONT_SETTINGS.fontSize).toBeGreaterThanOrEqual(FONT_SIZE_MIN);
    expect(DEFAULT_FONT_SETTINGS.fontSize).toBeLessThanOrEqual(FONT_SIZE_MAX);
    expect(DEFAULT_FONT_SETTINGS.lineHeight).toBeGreaterThanOrEqual(LINE_HEIGHT_MIN);
    expect(DEFAULT_FONT_SETTINGS.lineHeight).toBeLessThanOrEqual(LINE_HEIGHT_MAX);
    expect(DEFAULT_FONT_SETTINGS.fontFamily).toContain("monospace");
  });

  // ─── UiThemeMode ───────────────────────────────────────────

  it("UiThemeMode accepts all valid values", () => {
    const modes: UiThemeMode[] = ["light", "dark", "system"];
    expect(modes).toHaveLength(3);
  });

  // ─── MONOSPACE_FONTS ───────────────────────────────────────

  it("MONOSPACE_FONTS has at least 5 entries", () => {
    expect(MONOSPACE_FONTS.length).toBeGreaterThanOrEqual(5);
  });

  it("MONOSPACE_FONTS each have value and label", () => {
    for (const font of MONOSPACE_FONTS) {
      expect(font.value).toBeTruthy();
      expect(font.label).toBeTruthy();
    }
  });

  // ─── Font size constraints ─────────────────────────────────

  it("FONT_SIZE_MIN is 8", () => {
    expect(FONT_SIZE_MIN).toBe(8);
  });

  it("FONT_SIZE_MAX is 32", () => {
    expect(FONT_SIZE_MAX).toBe(32);
  });

  it("LINE_HEIGHT_MIN is 1.0", () => {
    expect(LINE_HEIGHT_MIN).toBe(1.0);
  });

  it("LINE_HEIGHT_MAX is 2.0", () => {
    expect(LINE_HEIGHT_MAX).toBe(2.0);
  });
});
