/**
 * TypeScript type definitions for terminal theme configuration.
 *
 * Mirrors the Rust backend's theme models (serde camelCase).
 * Keep in sync with src-tauri/src/theme/models.rs.
 */

/** The 22 terminal colors that compose a theme. */
export interface ThemeColors {
  /** Terminal foreground text color. */
  foreground: string;
  /** Terminal background color. */
  background: string;
  /** Cursor color. */
  cursor: string;
  /** Cursor accent (text under cursor). */
  cursorAccent: string;
  /** Selection background color (supports alpha via #RRGGBBAA). */
  selectionBackground: string;
  /** Selection foreground color (empty = auto). */
  selectionForeground: string;
  /** ANSI color 0 — Black. */
  black: string;
  /** ANSI color 1 — Red. */
  red: string;
  /** ANSI color 2 — Green. */
  green: string;
  /** ANSI color 3 — Yellow. */
  yellow: string;
  /** ANSI color 4 — Blue. */
  blue: string;
  /** ANSI color 5 — Magenta. */
  magenta: string;
  /** ANSI color 6 — Cyan. */
  cyan: string;
  /** ANSI color 7 — White. */
  white: string;
  /** ANSI color 8 — Bright Black. */
  brightBlack: string;
  /** ANSI color 9 — Bright Red. */
  brightRed: string;
  /** ANSI color 10 — Bright Green. */
  brightGreen: string;
  /** ANSI color 11 — Bright Yellow. */
  brightYellow: string;
  /** ANSI color 12 — Bright Blue. */
  brightBlue: string;
  /** ANSI color 13 — Bright Magenta. */
  brightMagenta: string;
  /** ANSI color 14 — Bright Cyan. */
  brightCyan: string;
  /** ANSI color 15 — Bright White. */
  brightWhite: string;
}

/** A named terminal color theme. */
export interface Theme {
  /** Unique theme identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The 22 terminal colors. */
  colors: ThemeColors;
  /** Whether this is a built-in theme. */
  isBuiltin: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-modified timestamp. */
  updatedAt: string;
}

/** Input DTO for creating a new theme. */
export interface CreateThemeInput {
  name: string;
  colors: ThemeColors;
}

/** Input DTO for updating an existing theme. */
export interface UpdateThemeInput {
  name?: string;
  colors?: ThemeColors;
}

/** DTO for importing/exporting a theme. */
export interface ThemeExport {
  version: number;
  name: string;
  colors: ThemeColors;
}

/** Ordered list of all color fields in ThemeColors for iteration. */
export const THEME_COLOR_FIELDS: Array<{
  key: keyof ThemeColors;
  label: string;
  group: "terminal" | "ansi" | "ansi-bright";
}> = [
  { key: "foreground", label: "Foreground", group: "terminal" },
  { key: "background", label: "Background", group: "terminal" },
  { key: "cursor", label: "Cursor", group: "terminal" },
  { key: "cursorAccent", label: "Cursor Accent", group: "terminal" },
  {
    key: "selectionBackground",
    label: "Selection Background",
    group: "terminal",
  },
  {
    key: "selectionForeground",
    label: "Selection Foreground",
    group: "terminal",
  },
  { key: "black", label: "Black", group: "ansi" },
  { key: "red", label: "Red", group: "ansi" },
  { key: "green", label: "Green", group: "ansi" },
  { key: "yellow", label: "Yellow", group: "ansi" },
  { key: "blue", label: "Blue", group: "ansi" },
  { key: "magenta", label: "Magenta", group: "ansi" },
  { key: "cyan", label: "Cyan", group: "ansi" },
  { key: "white", label: "White", group: "ansi" },
  { key: "brightBlack", label: "Bright Black", group: "ansi-bright" },
  { key: "brightRed", label: "Bright Red", group: "ansi-bright" },
  { key: "brightGreen", label: "Bright Green", group: "ansi-bright" },
  { key: "brightYellow", label: "Bright Yellow", group: "ansi-bright" },
  { key: "brightBlue", label: "Bright Blue", group: "ansi-bright" },
  { key: "brightMagenta", label: "Bright Magenta", group: "ansi-bright" },
  { key: "brightCyan", label: "Bright Cyan", group: "ansi-bright" },
  { key: "brightWhite", label: "Bright White", group: "ansi-bright" },
];

/** Font configuration settings. */
export interface FontSettings {
  /** Font family (CSS value). */
  fontFamily: string;
  /** Font size in pixels (8–32). */
  fontSize: number;
  /** Whether to enable font ligatures. */
  ligatures: boolean;
  /** Line height multiplier (1.0–2.0). */
  lineHeight: number;
}

/** UI theme mode for non-terminal chrome. */
export type UiThemeMode = "light" | "dark" | "system";

/** Default font settings. */
export const DEFAULT_FONT_SETTINGS: FontSettings = {
  fontFamily:
    '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
  fontSize: 14,
  ligatures: false,
  lineHeight: 1.2,
};

/** Common monospace font families for the dropdown. */
export const MONOSPACE_FONTS: Array<{ value: string; label: string }> = [
  {
    value:
      '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
    label: "JetBrains Mono",
  },
  {
    value: '"Fira Code", "JetBrains Mono", "Cascadia Code", monospace',
    label: "Fira Code",
  },
  {
    value: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
    label: "Cascadia Code",
  },
  { value: "Menlo, Monaco, monospace", label: "Menlo" },
  { value: "Monaco, Menlo, monospace", label: "Monaco" },
  {
    value: '"Courier New", Courier, monospace',
    label: "Courier New",
  },
  {
    value: '"Source Code Pro", monospace',
    label: "Source Code Pro",
  },
  {
    value: '"IBM Plex Mono", monospace',
    label: "IBM Plex Mono",
  },
  {
    value: '"Hack", monospace',
    label: "Hack",
  },
  { value: "monospace", label: "System Monospace" },
];

/** Font size constraints. */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/** Line height constraints. */
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.0;
