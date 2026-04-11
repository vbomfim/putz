/**
 * Application settings state management using Zustand.
 *
 * Manages global UI settings such as toolbar visibility and
 * shortcuts panel state. Persisted to localStorage.
 *
 * @module settingsStore
 */
import { create } from "zustand";

/** localStorage key for persisting settings. */
const STORAGE_KEY = "putz-settings";

/** Persisted state shape. */
interface PersistedSettings {
  toolbarVisible: boolean;
  workspaceBarVisible: boolean;
  backgroundEffect: string;
  backgroundOpacity: number;
  backgroundColorMode: string;
  backgroundCustomColor: string;
  backgroundSpeed: number;
}

/** Loads persisted settings from localStorage, returning defaults on failure. */
function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        toolbarVisible: parsed.toolbarVisible ?? false,
        workspaceBarVisible: parsed.workspaceBarVisible ?? true,
        backgroundEffect: parsed.backgroundEffect ?? "none",
        backgroundOpacity: parsed.backgroundOpacity ?? 0.15,
        backgroundColorMode: parsed.backgroundColorMode ?? "theme",
        backgroundCustomColor: parsed.backgroundCustomColor ?? "#50fa7b",
        backgroundSpeed: parsed.backgroundSpeed ?? 1,
      };
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return { toolbarVisible: false, workspaceBarVisible: true, backgroundEffect: "none", backgroundOpacity: 0.15, backgroundColorMode: "theme", backgroundCustomColor: "#50fa7b", backgroundSpeed: 1 };
}

/** Saves settings to localStorage. */
function persistSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

// ─── Store Definition ────────────────────────────────────────────────

interface SettingsState {
  /** Whether the toolbar is visible. */
  toolbarVisible: boolean;

  /** Whether the keyboard shortcuts panel is open. */
  shortcutsPanelOpen: boolean;

  /** Whether the workspace bar is visible. */
  workspaceBarVisible: boolean;

  /** Terminal background effect. */
  backgroundEffect: string;

  /** Terminal background opacity (0-1). */
  backgroundOpacity: number;

  /** Color mode: "theme" | "custom" | "rainbow". */
  backgroundColorMode: string;

  /** Custom color hex when mode is "custom". */
  backgroundCustomColor: string;

  /** Animation speed multiplier (0.2 - 3). */
  backgroundSpeed: number;

  /** Toggles toolbar visibility and persists to localStorage. */
  toggleToolbar: () => void;

  /** Sets toolbar visibility explicitly and persists to localStorage. */
  setToolbarVisible: (visible: boolean) => void;

  /** Toggles the workspace bar visibility and persists to localStorage. */
  toggleWorkspaceBar: () => void;

  /** Toggles the keyboard shortcuts panel open/closed. */
  toggleShortcutsPanel: () => void;

  /** Sets shortcuts panel state explicitly. */
  setShortcutsPanelOpen: (open: boolean) => void;

  /** Sets the terminal background effect. */
  setBackgroundEffect: (effect: string) => void;

  /** Sets the terminal background opacity. */
  setBackgroundOpacity: (opacity: number) => void;

  /** Sets the color mode. */
  setBackgroundColorMode: (mode: string) => void;

  /** Sets the custom color. */
  setBackgroundCustomColor: (color: string) => void;

  /** Sets the animation speed. */
  setBackgroundSpeed: (speed: number) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persisted = loadPersistedSettings();

  const persist = () => {
    const s = get();
    persistSettings({
      toolbarVisible: s.toolbarVisible,
      workspaceBarVisible: s.workspaceBarVisible,
      backgroundEffect: s.backgroundEffect,
      backgroundOpacity: s.backgroundOpacity,
      backgroundColorMode: s.backgroundColorMode,
      backgroundCustomColor: s.backgroundCustomColor,
      backgroundSpeed: s.backgroundSpeed,
    });
  };

  return {
    toolbarVisible: persisted.toolbarVisible,
    workspaceBarVisible: persisted.workspaceBarVisible,
    backgroundEffect: persisted.backgroundEffect,
    backgroundOpacity: persisted.backgroundOpacity,
    backgroundColorMode: persisted.backgroundColorMode,
    backgroundCustomColor: persisted.backgroundCustomColor,
    backgroundSpeed: persisted.backgroundSpeed,
    shortcutsPanelOpen: false,

    toggleToolbar: () => {
      set({ toolbarVisible: !get().toolbarVisible });
      persist();
    },

    setToolbarVisible: (visible: boolean) => {
      set({ toolbarVisible: visible });
      persist();
    },

    toggleWorkspaceBar: () => {
      set({ workspaceBarVisible: !get().workspaceBarVisible });
      persist();
    },

    toggleShortcutsPanel: () => {
      set((state) => ({ shortcutsPanelOpen: !state.shortcutsPanelOpen }));
    },

    setShortcutsPanelOpen: (open: boolean) => {
      set({ shortcutsPanelOpen: open });
    },

    setBackgroundEffect: (effect: string) => {
      set({ backgroundEffect: effect });
      persist();
    },

    setBackgroundOpacity: (opacity: number) => {
      set({ backgroundOpacity: opacity });
      persist();
    },

    setBackgroundColorMode: (mode: string) => {
      set({ backgroundColorMode: mode });
      persist();
    },

    setBackgroundCustomColor: (color: string) => {
      set({ backgroundCustomColor: color });
      persist();
    },

    setBackgroundSpeed: (speed: number) => {
      set({ backgroundSpeed: speed });
      persist();
    },
  };
});
