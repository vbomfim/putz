/**
 * Workspace state management using Zustand.
 *
 * Manages named workspace collections. Each workspace owns a layout state.
 * Uses Approach A: saves/restores layoutStore state on workspace switch.
 *
 * Persisted to localStorage.
 *
 * @module workspaceStore
 */
import { create } from "zustand";

import { useLayoutStore } from "./layoutStore";
import type { Region, LayoutNode } from "../types";

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

/** Saved layout snapshot for a workspace. */
interface WorkspaceLayout {
  layout: LayoutNode;
  regions: Record<string, Region>;
  focusedRegionId: string;
}

/** A named collection of tabs (now region-based). */
export interface Workspace {
  id: string;
  name: string;
  color: string;
  /** Saved layout state for this workspace. */
  savedLayout: WorkspaceLayout | null;
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
          // Keep workspace names/colors, clear layouts (PTY sessions die on restart)
          workspaces: parsed.workspaces.map((w) => ({
            ...w,
            savedLayout: null,
          })),
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
        savedLayout: null,
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

/** Captures the current layoutStore state as a workspace snapshot. */
function captureLayoutState(): WorkspaceLayout {
  const { layout, regions, focusedRegionId } = useLayoutStore.getState();
  return { layout, regions, focusedRegionId };
}

/** Restores a workspace's layout into layoutStore. */
function restoreLayoutState(snapshot: WorkspaceLayout | null): void {
  if (snapshot) {
    useLayoutStore.setState({
      layout: snapshot.layout,
      regions: snapshot.regions,
      focusedRegionId: snapshot.focusedRegionId,
    });
  } else {
    // Empty workspace — create a fresh single-region layout
    const regionId = generateId();
    useLayoutStore.setState({
      layout: { type: "region", regionId },
      regions: { [regionId]: { id: regionId, tabs: [], activeTabId: "", tabPosition: "top" as const } },
      focusedRegionId: regionId,
    });
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
   * Saves current layout → loads target workspace layout.
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
        savedLayout: null,
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

      // Switch to the new workspace — App.tsx auto-creates a tab when empty
      get().switchWorkspace(newWorkspace.id);
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
        restoreLayoutState(target.savedLayout);
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

      // 1. Save current layout into current workspace
      const currentLayout = captureLayoutState();

      // 2. Restore target workspace layout
      const targetWorkspace = workspaces.find((w) => w.id === id)!;
      restoreLayoutState(targetWorkspace.savedLayout);

      // 3. Update workspace store
      set((state) => {
        const updated = {
          workspaces: state.workspaces.map((w) => {
            if (w.id === activeWorkspaceId) {
              return { ...w, savedLayout: currentLayout };
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
