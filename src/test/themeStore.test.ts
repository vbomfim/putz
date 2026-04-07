/**
 * Unit tests for theme store.
 *
 * Tags: [TDD], [AC-1], [AC-3], [AC-4], [AC-5]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "../stores/themeStore";
import type { ThemeColors } from "../components/Terminal/themeTypes";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function sampleColors(): ThemeColors {
  return {
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
}

describe("themeStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset store to initial state
    useThemeStore.setState({
      activeThemeId: "builtin-dracula",
      activeColors: null,
      fontSettings: {
        fontFamily:
          '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        ligatures: false,
        lineHeight: 1.2,
      },
      uiTheme: "dark",
      sessionOverrides: {},
      themes: [],
    });
  });

  // ─── Active Theme ──────────────────────────────────────────

  it("starts with default theme ID", () => {
    const state = useThemeStore.getState();
    expect(state.activeThemeId).toBe("builtin-dracula");
  });

  it("setActiveTheme updates ID and colors", () => {
    const colors = sampleColors();
    useThemeStore.getState().setActiveTheme("builtin-nord", colors);
    const state = useThemeStore.getState();
    expect(state.activeThemeId).toBe("builtin-nord");
    expect(state.activeColors).toEqual(colors);
  });

  it("setActiveTheme persists to localStorage", () => {
    const colors = sampleColors();
    useThemeStore.getState().setActiveTheme("builtin-nord", colors);
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[
        localStorageMock.setItem.mock.calls.length - 1
      ][1],
    );
    expect(stored.activeThemeId).toBe("builtin-nord");
  });

  // ─── Font Settings ─────────────────────────────────────────

  it("starts with default font settings", () => {
    const state = useThemeStore.getState();
    expect(state.fontSettings.fontSize).toBe(14);
    expect(state.fontSettings.ligatures).toBe(false);
    expect(state.fontSettings.lineHeight).toBe(1.2);
  });

  it("setFontSettings updates partial settings", () => {
    useThemeStore.getState().setFontSettings({ fontSize: 18 });
    const state = useThemeStore.getState();
    expect(state.fontSettings.fontSize).toBe(18);
    // Other settings unchanged
    expect(state.fontSettings.ligatures).toBe(false);
  });

  it("setFontSettings clamps fontSize to min", () => {
    useThemeStore.getState().setFontSettings({ fontSize: 4 });
    expect(useThemeStore.getState().fontSettings.fontSize).toBe(8);
  });

  it("setFontSettings clamps fontSize to max", () => {
    useThemeStore.getState().setFontSettings({ fontSize: 50 });
    expect(useThemeStore.getState().fontSettings.fontSize).toBe(32);
  });

  it("setFontSettings clamps lineHeight to min", () => {
    useThemeStore.getState().setFontSettings({ lineHeight: 0.5 });
    expect(useThemeStore.getState().fontSettings.lineHeight).toBe(1.0);
  });

  it("setFontSettings clamps lineHeight to max", () => {
    useThemeStore.getState().setFontSettings({ lineHeight: 3.0 });
    expect(useThemeStore.getState().fontSettings.lineHeight).toBe(2.0);
  });

  it("setFontSettings persists to localStorage", () => {
    useThemeStore.getState().setFontSettings({ fontSize: 20 });
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  // ─── UI Theme ──────────────────────────────────────────────

  it("starts with dark UI theme", () => {
    expect(useThemeStore.getState().uiTheme).toBe("dark");
  });

  it("setUiTheme updates the mode", () => {
    useThemeStore.getState().setUiTheme("light");
    expect(useThemeStore.getState().uiTheme).toBe("light");
  });

  it("setUiTheme accepts system mode", () => {
    useThemeStore.getState().setUiTheme("system");
    expect(useThemeStore.getState().uiTheme).toBe("system");
  });

  it("setUiTheme persists to localStorage", () => {
    useThemeStore.getState().setUiTheme("light");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it("setUiTheme applies data attribute to document", () => {
    useThemeStore.getState().setUiTheme("light");
    expect(
      document.documentElement.getAttribute("data-ui-theme"),
    ).toBe("light");
  });

  // ─── Session Overrides ─────────────────────────────────────

  it("starts with no session overrides", () => {
    expect(useThemeStore.getState().sessionOverrides).toEqual({});
  });

  it("setSessionOverride adds an override", () => {
    useThemeStore.getState().setSessionOverride("session-1", "builtin-nord");
    expect(useThemeStore.getState().sessionOverrides).toEqual({
      "session-1": "builtin-nord",
    });
  });

  it("clearSessionOverride removes an override", () => {
    useThemeStore.getState().setSessionOverride("session-1", "builtin-nord");
    useThemeStore.getState().clearSessionOverride("session-1");
    expect(useThemeStore.getState().sessionOverrides).toEqual({});
  });

  it("getEffectiveThemeId returns override if set", () => {
    useThemeStore.getState().setSessionOverride("session-1", "builtin-nord");
    expect(
      useThemeStore.getState().getEffectiveThemeId("session-1"),
    ).toBe("builtin-nord");
  });

  it("getEffectiveThemeId returns active theme if no override", () => {
    expect(
      useThemeStore.getState().getEffectiveThemeId("session-1"),
    ).toBe("builtin-dracula");
  });

  it("session overrides persist to localStorage", () => {
    useThemeStore.getState().setSessionOverride("s1", "builtin-monokai");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  // ─── Themes List ───────────────────────────────────────────

  it("starts with empty themes list", () => {
    expect(useThemeStore.getState().themes).toEqual([]);
  });

  it("setThemes populates the themes list", () => {
    useThemeStore.getState().setThemes([
      { id: "t1", name: "Theme 1", isBuiltin: true },
      { id: "t2", name: "Theme 2", isBuiltin: false },
    ]);
    expect(useThemeStore.getState().themes).toHaveLength(2);
  });
});
