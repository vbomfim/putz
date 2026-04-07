/**
 * Theme and font state management using Zustand.
 *
 * Manages:
 * - Active terminal color theme (ID → resolved ThemeColors)
 * - Font configuration (family, size, ligatures, line height)
 * - UI theme mode (light / dark / system-follow)
 * - Per-session color scheme overrides
 * - Persistence to localStorage
 *
 * @module themeStore
 */
import { create } from "zustand";
import type {
  ThemeColors,
  FontSettings,
  UiThemeMode,
} from "../components/Terminal/themeTypes";
import {
  DEFAULT_FONT_SETTINGS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
} from "../components/Terminal/themeTypes";

/** localStorage key for persisting theme settings. */
const STORAGE_KEY = "putz-theme-settings";

/** Default theme ID — matches builtin-dracula from the backend. */
const DEFAULT_THEME_ID = "builtin-dracula";

/** Default UI theme mode. */
const DEFAULT_UI_THEME: UiThemeMode = "dark";

/** Persisted state shape (serialized to localStorage). */
interface PersistedThemeState {
  activeThemeId: string;
  fontSettings: FontSettings;
  uiTheme: UiThemeMode;
  sessionOverrides: Record<string, string>;
}

/** Loads persisted state from localStorage, returning defaults on failure. */
function loadPersistedState(): PersistedThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedThemeState>;
      return {
        activeThemeId: parsed.activeThemeId || DEFAULT_THEME_ID,
        fontSettings: parsed.fontSettings
          ? { ...DEFAULT_FONT_SETTINGS, ...parsed.fontSettings }
          : { ...DEFAULT_FONT_SETTINGS },
        uiTheme: parsed.uiTheme || DEFAULT_UI_THEME,
        sessionOverrides: parsed.sessionOverrides || {},
      };
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return {
    activeThemeId: DEFAULT_THEME_ID,
    fontSettings: { ...DEFAULT_FONT_SETTINGS },
    uiTheme: DEFAULT_UI_THEME,
    sessionOverrides: {},
  };
}

/** Saves state to localStorage. */
function persistState(state: PersistedThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

/** Applies the UI theme mode to the document body. */
function applyUiTheme(mode: UiThemeMode): void {
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;

  document.documentElement.setAttribute("data-ui-theme", resolved);
}

// ─── Store Definition ────────────────────────────────────────────────

interface ThemeState {
  /** Active theme ID (used to look up colors from the backend theme list). */
  activeThemeId: string;

  /** Resolved colors for the active theme (populated by loadThemes). */
  activeColors: ThemeColors | null;

  /** Font configuration. */
  fontSettings: FontSettings;

  /** UI theme mode for non-terminal chrome. */
  uiTheme: UiThemeMode;

  /** Per-session theme overrides: sessionId → themeId. */
  sessionOverrides: Record<string, string>;

  /** All available themes (populated by loadThemes). */
  themes: Array<{ id: string; name: string; isBuiltin: boolean }>;

  // ─── Actions ──────────────────────────────────────────────

  /** Sets the active theme ID and resolves colors. */
  setActiveTheme: (themeId: string, colors: ThemeColors) => void;

  /** Updates font settings. */
  setFontSettings: (settings: Partial<FontSettings>) => void;

  /** Sets the UI theme mode. */
  setUiTheme: (mode: UiThemeMode) => void;

  /** Sets a per-session theme override. */
  setSessionOverride: (sessionId: string, themeId: string) => void;

  /** Clears a per-session theme override. */
  clearSessionOverride: (sessionId: string) => void;

  /** Gets the effective theme ID for a session. */
  getEffectiveThemeId: (sessionId: string) => string;

  /** Sets the full list of available themes (called after loading from backend). */
  setThemes: (
    themes: Array<{ id: string; name: string; isBuiltin: boolean }>,
  ) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const persisted = loadPersistedState();

  // Apply UI theme on store creation
  if (typeof document !== "undefined") {
    applyUiTheme(persisted.uiTheme);
  }

  return {
    activeThemeId: persisted.activeThemeId,
    activeColors: null,
    fontSettings: persisted.fontSettings,
    uiTheme: persisted.uiTheme,
    sessionOverrides: persisted.sessionOverrides,
    themes: [],

    setActiveTheme: (themeId: string, colors: ThemeColors) => {
      set({ activeThemeId: themeId, activeColors: colors });
      const state = get();
      persistState({
        activeThemeId: themeId,
        fontSettings: state.fontSettings,
        uiTheme: state.uiTheme,
        sessionOverrides: state.sessionOverrides,
      });
    },

    setFontSettings: (settings: Partial<FontSettings>) => {
      set((prev) => {
        const updated = { ...prev.fontSettings, ...settings };
        // Clamp values
        updated.fontSize = Math.max(
          FONT_SIZE_MIN,
          Math.min(FONT_SIZE_MAX, updated.fontSize),
        );
        updated.lineHeight = Math.max(
          LINE_HEIGHT_MIN,
          Math.min(LINE_HEIGHT_MAX, updated.lineHeight),
        );

        persistState({
          activeThemeId: prev.activeThemeId,
          fontSettings: updated,
          uiTheme: prev.uiTheme,
          sessionOverrides: prev.sessionOverrides,
        });

        return { fontSettings: updated };
      });
    },

    setUiTheme: (mode: UiThemeMode) => {
      if (typeof document !== "undefined") {
        applyUiTheme(mode);
      }
      set({ uiTheme: mode });
      const state = get();
      persistState({
        activeThemeId: state.activeThemeId,
        fontSettings: state.fontSettings,
        uiTheme: mode,
        sessionOverrides: state.sessionOverrides,
      });
    },

    setSessionOverride: (sessionId: string, themeId: string) => {
      set((prev) => {
        const overrides = { ...prev.sessionOverrides, [sessionId]: themeId };
        persistState({
          activeThemeId: prev.activeThemeId,
          fontSettings: prev.fontSettings,
          uiTheme: prev.uiTheme,
          sessionOverrides: overrides,
        });
        return { sessionOverrides: overrides };
      });
    },

    clearSessionOverride: (sessionId: string) => {
      set((prev) => {
        const overrides = { ...prev.sessionOverrides };
        delete overrides[sessionId];
        persistState({
          activeThemeId: prev.activeThemeId,
          fontSettings: prev.fontSettings,
          uiTheme: prev.uiTheme,
          sessionOverrides: overrides,
        });
        return { sessionOverrides: overrides };
      });
    },

    getEffectiveThemeId: (sessionId: string) => {
      const state = get();
      return state.sessionOverrides[sessionId] || state.activeThemeId;
    },

    setThemes: (
      themes: Array<{ id: string; name: string; isBuiltin: boolean }>,
    ) => {
      set({ themes });
    },
  };
});
