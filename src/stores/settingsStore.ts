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

/** Default values for newline-shortcut sub-settings — all enabled. */
const DEFAULT_NEWLINE_SHORTCUTS: NewlineShortcutSettings = {
  ctrlEnter: true,
  shiftEnter: true,
  altEnter: true,
};

/** Per-shortcut toggles for terminal newline-insertion bindings. */
export interface NewlineShortcutSettings {
  ctrlEnter: boolean;
  shiftEnter: boolean;
  altEnter: boolean;
}

/** Persisted state shape. */
interface PersistedSettings {
  workspaceBarVisible: boolean;
  bookmarksBarVisible: boolean;
  backgroundEffect: string;
  backgroundOpacity: number;
  backgroundColorMode: string;
  backgroundCustomColor: string;
  backgroundSpeed: number;
  backgroundSize: string;
  defaultShell: string;
  swarmEnabled: boolean;
  /** Sidebar position. "hidden" hides the entire colleague sidebar. */
  swarmSidebarPosition: "left" | "right" | "hidden";
  /** Whether the swarm sidebar is in narrow icon-only mode. */
  swarmSidebarCollapsed: boolean;
  copilotCardDismissed: boolean;
  newlineShortcuts: NewlineShortcutSettings;
  /**
   * Whether tabs/workspaces are restored from disk on app start.
   * Default: true. Setting this to false reverts to legacy "fresh boot"
   * behavior (one new terminal tab in the active workspace).
   */
  restoreTabsOnLaunch: boolean;
}

/** Loads persisted settings from localStorage, returning defaults on failure. */
function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        workspaceBarVisible: parsed.workspaceBarVisible ?? true,
        bookmarksBarVisible: parsed.bookmarksBarVisible ?? false,
        backgroundEffect: parsed.backgroundEffect ?? "none",
        backgroundOpacity: parsed.backgroundOpacity ?? 0.15,
        backgroundColorMode: parsed.backgroundColorMode ?? "theme",
        backgroundCustomColor: parsed.backgroundCustomColor ?? "#50fa7b",
        backgroundSpeed: parsed.backgroundSpeed ?? 1,
        backgroundSize: parsed.backgroundSize ?? "large",
        defaultShell: parsed.defaultShell ?? "",
        swarmEnabled: parsed.swarmEnabled ?? false,
        swarmSidebarPosition:
          parsed.swarmSidebarPosition === "right" ||
          parsed.swarmSidebarPosition === "hidden"
            ? parsed.swarmSidebarPosition
            : "left",
        swarmSidebarCollapsed: parsed.swarmSidebarCollapsed ?? false,
        copilotCardDismissed: parsed.copilotCardDismissed ?? false,
        newlineShortcuts: {
          ctrlEnter:
            parsed.newlineShortcuts?.ctrlEnter ??
            DEFAULT_NEWLINE_SHORTCUTS.ctrlEnter,
          shiftEnter:
            parsed.newlineShortcuts?.shiftEnter ??
            DEFAULT_NEWLINE_SHORTCUTS.shiftEnter,
          altEnter:
            parsed.newlineShortcuts?.altEnter ??
            DEFAULT_NEWLINE_SHORTCUTS.altEnter,
        },
        restoreTabsOnLaunch:
          typeof parsed.restoreTabsOnLaunch === "boolean"
            ? parsed.restoreTabsOnLaunch
            : true,
      };
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return {
    workspaceBarVisible: true,
    bookmarksBarVisible: false,
    backgroundEffect: "none",
    backgroundOpacity: 0.15,
    backgroundColorMode: "theme",
    backgroundCustomColor: "#50fa7b",
    backgroundSpeed: 1,
    backgroundSize: "large",
    defaultShell: "",
    swarmEnabled: false,
    swarmSidebarPosition: "left",
    swarmSidebarCollapsed: false,
    copilotCardDismissed: false,
    newlineShortcuts: { ...DEFAULT_NEWLINE_SHORTCUTS },
    restoreTabsOnLaunch: true,
  };
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
  /** Whether the keyboard shortcuts panel is open. */
  shortcutsPanelOpen: boolean;

  /** Whether the workspace bar is visible. */
  workspaceBarVisible: boolean;

  /** Whether the bookmarks bar is visible. */
  bookmarksBarVisible: boolean;

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

  /** Avatar/effect size: small, medium, large. */
  backgroundSize: string;

  /** Default shell path (empty = system default). */
  defaultShell: string;

  /** Whether the Copilot swarm broker is enabled. */
  swarmEnabled: boolean;

  /** Sidebar position for the swarm colleague list. */
  swarmSidebarPosition: "left" | "right" | "hidden";

  /** Whether the swarm sidebar is in narrow icon-only mode. */
  swarmSidebarCollapsed: boolean;

  /** Whether the user has dismissed the Copilot integration discovery card. */
  copilotCardDismissed: boolean;

  /** Per-shortcut toggles for terminal newline-insertion bindings. */
  newlineShortcuts: NewlineShortcutSettings;

  /**
   * Whether tabs/workspaces are restored from disk on app start (T3).
   * Default: true.
   */
  restoreTabsOnLaunch: boolean;

  /** Toggles the workspace bar visibility and persists to localStorage. */
  toggleWorkspaceBar: () => void;

  /** Toggles the bookmarks bar visibility and persists to localStorage. */
  toggleBookmarksBar: () => void;

  /** Sets bookmarks bar visibility explicitly and persists to localStorage. */
  setBookmarksBarVisible: (visible: boolean) => void;

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

  /** Sets the avatar/effect size. */
  setBackgroundSize: (size: string) => void;

  /** Sets the default shell. */
  setDefaultShell: (shell: string) => void;

  /** Sets the swarm enabled state. */
  setSwarmEnabled: (enabled: boolean) => void;

  /** Sets the sidebar position. */
  setSwarmSidebarPosition: (position: "left" | "right" | "hidden") => void;

  /** Toggles the sidebar collapsed state. */
  toggleSwarmSidebarCollapsed: () => void;

  /** Persistently dismiss (or restore) the Copilot integration discovery card. */
  setCopilotCardDismissed: (dismissed: boolean) => void;

  /** Toggle a single newline-shortcut binding and persist. */
  setNewlineShortcut: (
    key: keyof NewlineShortcutSettings,
    enabled: boolean,
  ) => void;

  /** Toggle restore-tabs-on-launch and persist. */
  setRestoreTabsOnLaunch: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persisted = loadPersistedSettings();

  const persist = () => {
    const s = get();
    persistSettings({
      workspaceBarVisible: s.workspaceBarVisible,
      bookmarksBarVisible: s.bookmarksBarVisible,
      backgroundEffect: s.backgroundEffect,
      backgroundOpacity: s.backgroundOpacity,
      backgroundColorMode: s.backgroundColorMode,
      backgroundCustomColor: s.backgroundCustomColor,
      backgroundSpeed: s.backgroundSpeed,
      backgroundSize: s.backgroundSize,
      defaultShell: s.defaultShell,
      swarmEnabled: s.swarmEnabled,
      swarmSidebarPosition: s.swarmSidebarPosition,
      swarmSidebarCollapsed: s.swarmSidebarCollapsed,
      copilotCardDismissed: s.copilotCardDismissed,
      newlineShortcuts: s.newlineShortcuts,
      restoreTabsOnLaunch: s.restoreTabsOnLaunch,
    });
  };

  return {
    workspaceBarVisible: persisted.workspaceBarVisible,
    bookmarksBarVisible: persisted.bookmarksBarVisible,
    backgroundEffect: persisted.backgroundEffect,
    backgroundOpacity: persisted.backgroundOpacity,
    backgroundColorMode: persisted.backgroundColorMode,
    backgroundCustomColor: persisted.backgroundCustomColor,
    backgroundSpeed: persisted.backgroundSpeed,
    backgroundSize: persisted.backgroundSize,
    defaultShell: persisted.defaultShell,
    swarmEnabled: persisted.swarmEnabled,
    swarmSidebarPosition: persisted.swarmSidebarPosition,
    swarmSidebarCollapsed: persisted.swarmSidebarCollapsed,
    copilotCardDismissed: persisted.copilotCardDismissed,
    newlineShortcuts: persisted.newlineShortcuts,
    restoreTabsOnLaunch: persisted.restoreTabsOnLaunch,
    shortcutsPanelOpen: false,

    toggleWorkspaceBar: () => {
      set({ workspaceBarVisible: !get().workspaceBarVisible });
      persist();
    },

    toggleBookmarksBar: () => {
      set({ bookmarksBarVisible: !get().bookmarksBarVisible });
      persist();
    },

    setBookmarksBarVisible: (visible: boolean) => {
      set({ bookmarksBarVisible: visible });
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

    setBackgroundSize: (size: string) => {
      set({ backgroundSize: size });
      persist();
    },

    setDefaultShell: (shell: string) => {
      set({ defaultShell: shell });
      persist();
    },

    setSwarmEnabled: (enabled: boolean) => {
      set({ swarmEnabled: enabled });
      persist();
    },

    setSwarmSidebarPosition: (position: "left" | "right" | "hidden") => {
      set({ swarmSidebarPosition: position });
      persist();
    },

    toggleSwarmSidebarCollapsed: () => {
      set({ swarmSidebarCollapsed: !get().swarmSidebarCollapsed });
      persist();
    },

    setCopilotCardDismissed: (dismissed: boolean) => {
      set({ copilotCardDismissed: dismissed });
      persist();
    },

    setNewlineShortcut: (
      key: keyof NewlineShortcutSettings,
      enabled: boolean,
    ) => {
      set({
        newlineShortcuts: { ...get().newlineShortcuts, [key]: enabled },
      });
      persist();
    },

    setRestoreTabsOnLaunch: (enabled: boolean) => {
      set({ restoreTabsOnLaunch: enabled });
      persist();
    },
  };
});
