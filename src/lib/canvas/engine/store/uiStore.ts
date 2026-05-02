/**
 * UI preferences store — Zustand state for theme and UI settings.
 *
 * Manages theme preference (light/dark) with localStorage persistence.
 * Follows the same Zustand pattern as canvasStore. [CUSTOM]
 *
 * @module
 */

import { create } from "zustand";

/** Supported theme values. */
export type Theme = "light" | "dark";

/** localStorage key for theme persistence. */
export const THEME_STORAGE_KEY = "infinicanvas:theme";

/** UI preferences state shape. */
export interface UiState {
  /** Current active theme. */
  theme: Theme;
}

/** Actions available on the UI store. */
export interface UiActions {
  /** Set the theme to a specific value and persist to localStorage. */
  setTheme: (theme: Theme) => void;
  /** Toggle between light and dark theme. */
  toggleTheme: () => void;
  /** Load persisted theme from localStorage. */
  loadPersistedTheme: () => void;
}

/**
 * Apply the theme to the document root element.
 *
 * Sets the `data-theme` attribute on `<html>` so CSS variables
 * can respond to the current theme via `:root[data-theme="..."]`.
 */
export function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Persist theme preference to localStorage.
 *
 * Silently fails if localStorage is unavailable (e.g., private browsing).
 */
function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable — continue without persistence
  }
}

/**
 * Read persisted theme from localStorage.
 *
 * Returns 'light' as default if no valid value is found.
 */
function readPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return "light";
}

/** Zustand store for UI preferences (theme, etc.). */
export const useUiStore = create<UiState & UiActions>()((set, get) => ({
  theme: "light",

  setTheme: (theme: Theme) => {
    set({ theme });
    persistTheme(theme);
  },

  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    set({ theme: next });
    persistTheme(next);
  },

  loadPersistedTheme: () => {
    const theme = readPersistedTheme();
    set({ theme });
  },
}));
