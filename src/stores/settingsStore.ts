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
      };
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return { toolbarVisible: false, workspaceBarVisible: true };
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
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persisted = loadPersistedSettings();

  return {
    toolbarVisible: persisted.toolbarVisible,
    workspaceBarVisible: persisted.workspaceBarVisible,
    shortcutsPanelOpen: false,

    toggleToolbar: () => {
      const newValue = !get().toolbarVisible;
      set({ toolbarVisible: newValue });
      persistSettings({ toolbarVisible: newValue, workspaceBarVisible: get().workspaceBarVisible });
    },

    setToolbarVisible: (visible: boolean) => {
      set({ toolbarVisible: visible });
      persistSettings({ toolbarVisible: visible, workspaceBarVisible: get().workspaceBarVisible });
    },

    toggleWorkspaceBar: () => {
      const newValue = !get().workspaceBarVisible;
      set({ workspaceBarVisible: newValue });
      persistSettings({ toolbarVisible: get().toolbarVisible, workspaceBarVisible: newValue });
    },

    toggleShortcutsPanel: () => {
      set((state) => ({ shortcutsPanelOpen: !state.shortcutsPanelOpen }));
    },

    setShortcutsPanelOpen: (open: boolean) => {
      set({ shortcutsPanelOpen: open });
    },
  };
});
