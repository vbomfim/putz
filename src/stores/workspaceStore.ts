/**
 * Workspace state management using Zustand.
 *
 * Manages named workspace collections. Each workspace owns a set of tabs.
 * Uses Approach A: saves/restores tabStore state on workspace switch.
 *
 * Persisted to localStorage.
 *
 * @module workspaceStore
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "./tabStore";
import type { Tab } from "../types";

/** Preset workspace accent colors (Catppuccin palette). */
export const WORKSPACE_COLORS = [
  "#89b4fa", // blue
  "#a6e3a1", // green
  "#f38ba8", // red
  "#fab387", // peach
  "#cba6f7", // mauve
  "#f9e2af", // yellow
  "#94e2d5", // teal
  "#f5c2e7", // pink
] as const;

/** localStorage key for persisting workspace state. */
const STORAGE_KEY = "putz-workspaces";

/** A named collection of tabs. */
export interface Workspace {
  id: string;
  name: string;
  color: string;
  tabs: Tab[];
  activeTabId: string;
  createdAt: number;
}

/** Persisted workspace state shape. */
interface PersistedWorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
}

/** Generates a UUID v4 using crypto API. */
function generateId(): string {
  return crypto.randomUUID();
}

/** Loads persisted workspace state from localStorage. */
function loadPersistedState(): PersistedWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
      if (parsed.workspaces && parsed.workspaces.length > 0) {
        return {
          workspaces: parsed.workspaces,
          activeWorkspaceId: parsed.activeWorkspaceId || parsed.workspaces[0].id,
        };
      }
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return createDefaultState();
}

/** Creates default state with a single "Default" workspace. */
function createDefaultState(): PersistedWorkspaceState {
  return {
    workspaces: [
      {
        id: "default",
        name: "Default",
        color: "#89b4fa",
        tabs: [],
        activeTabId: "",
        createdAt: Date.now(),
      },
    ],
    activeWorkspaceId: "default",
  };
}

/** Saves workspace state to localStorage. */
function persistState(state: PersistedWorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

// ─── Store Definition ────────────────────────────────────────────────

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;

  /** Creates a new workspace with the given name and optional color. */
  addWorkspace: (name: string, color?: string) => void;

  /** Removes a workspace by ID. Cannot remove the last workspace. */
  removeWorkspace: (id: string) => void;

  /** Renames a workspace. Trims whitespace; rejects empty names. */
  renameWorkspace: (id: string, name: string) => void;

  /** Updates a workspace's accent color. */
  setWorkspaceColor: (id: string, color: string) => void;

  /**
   * Switches to a different workspace.
   * Saves current tabStore state → loads target workspace tabs.
   */
  switchWorkspace: (id: string) => void;

  /** Returns the currently active workspace. */
  getActiveWorkspace: () => Workspace;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const persisted = loadPersistedState();

  return {
    workspaces: persisted.workspaces,
    activeWorkspaceId: persisted.activeWorkspaceId,

    addWorkspace: (name: string, color?: string) => {
      const newWorkspace: Workspace = {
        id: generateId(),
        name: name.trim() || "Untitled",
        color: color || WORKSPACE_COLORS[get().workspaces.length % WORKSPACE_COLORS.length],
        tabs: [],
        activeTabId: "",
        createdAt: Date.now(),
      };

      set((state) => {
        const updated = {
          workspaces: [...state.workspaces, newWorkspace],
          activeWorkspaceId: state.activeWorkspaceId,
        };
        persistState(updated);
        return updated;
      });
    },

    removeWorkspace: (id: string) => {
      const { workspaces, activeWorkspaceId } = get();

      // Cannot remove the last workspace
      if (workspaces.length <= 1) return;

      // Cannot remove a workspace that doesn't exist
      if (!workspaces.some((w) => w.id === id)) return;

      const remaining = workspaces.filter((w) => w.id !== id);
      const newActiveId =
        activeWorkspaceId === id ? remaining[0].id : activeWorkspaceId;

      // If we're deleting the active workspace, switch to the first remaining
      if (activeWorkspaceId === id) {
        const target = remaining[0];
        useTabStore.setState({
          tabs: target.tabs,
          activeTabId: target.activeTabId,
        });
      }

      const updated = {
        workspaces: remaining,
        activeWorkspaceId: newActiveId,
      };
      set(updated);
      persistState(updated);
    },

    renameWorkspace: (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      set((state) => {
        const updated = {
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, name: trimmed } : w,
          ),
          activeWorkspaceId: state.activeWorkspaceId,
        };
        persistState(updated);
        return updated;
      });
    },

    setWorkspaceColor: (id: string, color: string) => {
      set((state) => {
        const updated = {
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, color } : w,
          ),
          activeWorkspaceId: state.activeWorkspaceId,
        };
        persistState(updated);
        return updated;
      });
    },

    switchWorkspace: (id: string) => {
      const { workspaces, activeWorkspaceId } = get();

      // Ignore if already active or target doesn't exist
      if (id === activeWorkspaceId) return;
      if (!workspaces.some((w) => w.id === id)) return;

      // 1. Save current tabStore state into current workspace
      const tabState = useTabStore.getState();
      const currentTabs = tabState.tabs;
      const currentActiveTabId = tabState.activeTabId;

      // 2. Hide all browser webviews from current workspace tabs
      for (const tab of currentTabs) {
        if (tab.contentType === "browser") {
          invoke("browser_set_visible", { tabId: tab.id, visible: false }).catch(() => {});
        }
      }

      // 3. Load target workspace tabs into tabStore
      const targetWorkspace = workspaces.find((w) => w.id === id)!;

      useTabStore.setState({
        tabs: targetWorkspace.tabs,
        activeTabId: targetWorkspace.activeTabId,
      });

      // 4. Show browser webviews in the new active tab (if any)
      const newActiveTab = targetWorkspace.tabs.find((t) => t.id === targetWorkspace.activeTabId);
      if (newActiveTab?.contentType === "browser") {
        invoke("browser_set_visible", { tabId: newActiveTab.id, visible: true }).catch(() => {});
      }

      // 5. Update workspace store
      set((state) => {
        const updated = {
          workspaces: state.workspaces.map((w) => {
            if (w.id === activeWorkspaceId) {
              return { ...w, tabs: currentTabs, activeTabId: currentActiveTabId };
            }
            return w;
          }),
          activeWorkspaceId: id,
        };
        persistState(updated);
        return updated;
      });
    },

    getActiveWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
    },
  };
});
