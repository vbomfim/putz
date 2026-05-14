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
import type { Region, LayoutNode, RegionTab } from "../types";
import {
  migrateWorkspaceLayout,
  CURRENT_SCHEMA_VERSION,
  clearRemovedFeatureStorage,
} from "../utils/migratePersistence";
import { getAllSessionCwds } from "../components/Terminal/cwdRegistry";

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

/** localStorage key for the settings store — read at boot to gate restore. */
const SETTINGS_STORAGE_KEY = "putz-settings";

/**
 * Reads the user's `restoreTabsOnLaunch` preference directly from
 * localStorage WITHOUT importing settingsStore.
 *
 * Why peek instead of import: `settingsStore` and `workspaceStore` are
 * sibling stores. `loadPersistedState` runs at workspaceStore module
 * init time. Adding an import would create a fragile cross-store init
 * order dependency — if settingsStore's eager `loadPersistedSettings`
 * touched anything in workspaceStore (now or in future), we'd loop.
 * The localStorage read is the single source of truth either way; the
 * settingsStore JSON shape on disk is stable (see PersistedSettings).
 *
 * Defaults to `true` (the documented opt-out behavior) on any read or
 * parse error so a hostile localStorage shim cannot accidentally
 * disable restore.
 */
function readRestoreTabsOnLaunchSetting(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { restoreTabsOnLaunch?: unknown };
    if (typeof parsed.restoreTabsOnLaunch === "boolean") {
      return parsed.restoreTabsOnLaunch;
    }
    return true;
  } catch {
    return true;
  }
}

/** Saved layout snapshot for a workspace. */
interface WorkspaceLayout {
  layout: LayoutNode;
  regions: Record<string, Region>;
  focusedRegionId: string;
  /** Schema version — used by migrateWorkspaceLayout to skip already-migrated data. */
  schemaVersion?: number;
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

/** Loads persisted workspace state from localStorage.
 *
 * T1 — UNCLAMPED: We now keep `savedLayout` from disk. Each workspace's
 * snapshot is migrated through {@link migrateWorkspaceLayout} on load
 * (defense-in-depth against corruption); a workspace whose snapshot is
 * irrecoverable falls back to `savedLayout: null` so a fresh terminal
 * is created when that workspace becomes active. One bad workspace
 * MUST NOT poison the others.
 */
function loadPersistedState(): PersistedWorkspaceState {
  // Sweep storage keys belonging to features removed in this build
  // (Command Templates / Command History). Idempotent. Wrapped in
  // try/catch — a hostile localStorage shim must not crash startup.
  try {
    clearRemovedFeatureStorage();
  } catch {
    // Best-effort PII sweep — never block boot on storage failure.
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
      if (parsed.workspaces && parsed.workspaces.length > 0) {
        // Bug 2 fix: if the user has opted out of tab restore, drop
        // every workspace's `savedLayout` BEFORE it reaches any
        // consumer (RegionContainer's inactive-workspace render path,
        // switchWorkspace's restoreLayoutState, App.tsx's
        // restoreActiveWorkspace boot call). Dropping at the load
        // boundary means no downstream code path can leak a stale
        // tab title or wire up a dead sessionId.
        const restoreEnabled = readRestoreTabsOnLaunchSetting();
        const cleaned = parsed.workspaces
          .map(sanitizeWorkspaceFromDisk)
          .map((w) =>
            restoreEnabled ? w : { ...w, savedLayout: null },
          );
        return {
          workspaces: cleaned,
          activeWorkspaceId:
            typeof parsed.activeWorkspaceId === "string" &&
            cleaned.some((w) => w.id === parsed.activeWorkspaceId)
              ? parsed.activeWorkspaceId
              : cleaned[0].id,
        };
      }
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return createDefaultState();
}

/**
 * Sanitizes a single persisted workspace.
 *
 * - Coerces `id`/`name`/`color`/`createdAt` to safe primitive shapes.
 * - Runs `savedLayout` through the migration pipeline; on failure,
 *   nulls the snapshot (the workspace itself survives).
 *
 * Privacy: never logs snapshot contents — only structural failures.
 *
 * Exported for unit testing — the boot path uses it via
 * {@link loadPersistedState}.
 */
export function sanitizeWorkspaceFromDisk(w: Partial<Workspace>): Workspace {
  const id = typeof w.id === "string" && w.id.length > 0 ? w.id : generateId();
  const name =
    typeof w.name === "string" && w.name.trim().length > 0
      ? w.name.trim()
      : "Untitled";
  const color = typeof w.color === "string" ? w.color : WORKSPACE_COLORS[0];
  const createdAt = typeof w.createdAt === "number" ? w.createdAt : Date.now();

  let savedLayout: WorkspaceLayout | null = null;
  if (w.savedLayout && typeof w.savedLayout === "object") {
    try {
      const migrated = migrateWorkspaceLayout(
        w.savedLayout as unknown as Record<string, unknown>,
      );
      if (migrated) {
        // Tag terminal tabs with pendingRestore so lazy PTY spawn works
        // when this workspace becomes active (via switchWorkspace or boot).
        // Old PTYs are dead after restart — the tab needs a fresh spawn.
        const regions = { ...migrated.regions };
        for (const [rid, region] of Object.entries(regions)) {
          regions[rid] = {
            ...region,
            tabs: region.tabs.map((tab) =>
              tab.type === "terminal"
                ? {
                    ...tab,
                    pendingRestore: {
                      cwd: tab.cwd ?? undefined,
                    },
                  }
                : tab,
            ),
          };
        }
        savedLayout = {
          layout: migrated.layout as LayoutNode,
          regions: regions as Record<string, Region>,
          focusedRegionId: migrated.focusedRegionId,
          schemaVersion: migrated.schemaVersion,
        };
      }
    } catch {
      // Single-workspace corruption — null the snapshot and keep going.
      savedLayout = null;
    }
  }

  return { id, name, color, createdAt, savedLayout };
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

/** Captures the current layoutStore state as a workspace snapshot.
 *
 * T2: enriches each terminal tab with its last known cwd from
 * cwdRegistry so restored terminals re-open in the right directory.
 * Non-terminal tabs are left untouched.
 *
 * NEVER persisted: scrollback, typed input, env vars, PTY output.
 * The contract is intentionally lean — only the structural shape
 * needed to recreate the layout.
 */
function captureLayoutState(): WorkspaceLayout {
  const { layout, regions, focusedRegionId } = useLayoutStore.getState();
  const cwds = getAllSessionCwds();
  const enrichedRegions: Record<string, Region> = {};
  for (const [rid, region] of Object.entries(regions)) {
    enrichedRegions[rid] = {
      ...region,
      tabs: region.tabs.map((tab) => {
        // Defensive strip: pendingRestore is RUNTIME-ONLY and must
        // never round-trip through localStorage (CR HIGH #2). It is
        // re-attached on next load via sanitizeWorkspaceFromDisk.
        const { pendingRestore: _drop, ...rest } = tab;
        void _drop;
        if (rest.type !== "terminal") return rest as RegionTab;
        const cwd = cwds.get(rest.sessionId);
        return cwd ? ({ ...rest, cwd } as RegionTab) : (rest as RegionTab);
      }),
    };
  }
  return {
    layout,
    regions: enrichedRegions,
    focusedRegionId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Restores a workspace's layout into layoutStore.
 *
 * Applies migration to guard against stale tab data that may have been
 * captured in a previous session before decommissioned features were removed.
 * See: migration schema v1→v2 (migratePersistence.ts).
 *
 * On any exception (migration throws, setState rejects, schema invariant
 * violation), falls back to fresh state — corrupt snapshot must not crash startup.
 */
function restoreLayoutState(snapshot: WorkspaceLayout | null): void {
  if (snapshot) {
    try {
      useLayoutStore.setState({
        layout: snapshot.layout,
        regions: snapshot.regions,
        focusedRegionId: snapshot.focusedRegionId,
      });
      // Trigger lazy PTY spawn for all pending terminal tabs.
      // Done here (after setState) rather than in React effects because
      // workspace switch timing means effects fire before regions are set.
      for (const [rid, region] of Object.entries(snapshot.regions)) {
        for (const tab of region.tabs) {
          if (tab.type === "terminal" && tab.pendingRestore) {
            void useLayoutStore
              .getState()
              .materializeRestoredTab(rid, tab.id);
          }
        }
      }
      return;
    } catch {
      // fall through to fresh state
    }
    restoreLayoutState(null);
    return;
  } else {
    // Empty workspace — create a fresh single-region layout
    const regionId = generateId();
    useLayoutStore.setState({
      layout: { type: "region", regionId },
      regions: {
        [regionId]: {
          id: regionId,
          tabs: [],
          activeTabId: "",
          tabPosition: "top" as const,
        },
      },
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

  /**
   * Captures the current layoutStore state into the active workspace's
   * `savedLayout` and persists immediately. Used by `flushNow()` and
   * by the debounced subscription. Idempotent.
   */
  captureActiveWorkspace: () => void;

  /**
   * Forces an immediate capture+persist with no debounce. Called from
   * the Tauri `window-close-requested` / `beforeunload` handler so the
   * very last change isn't lost when the user closes the window inside
   * the debounce window. Safe to call multiple times.
   */
  flushNow: () => void;
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
        color:
          color ||
          WORKSPACE_COLORS[get().workspaces.length % WORKSPACE_COLORS.length],
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
      return (
        workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0]
      );
    },

    captureActiveWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      if (!workspaces.some((w) => w.id === activeWorkspaceId)) return;
      const snapshot = captureLayoutState();
      set((state) => {
        const updated = {
          workspaces: state.workspaces.map((w) =>
            w.id === activeWorkspaceId ? { ...w, savedLayout: snapshot } : w,
          ),
          activeWorkspaceId: state.activeWorkspaceId,
        };
        persistState(updated);
        return updated;
      });
    },

    flushNow: () => {
      get().captureActiveWorkspace();
    },
  };
});

// ─── Debounced auto-capture subscription ──────────────────────────────
//
// Subscribe to layoutStore changes and capture the active workspace's
// snapshot ~1s after the most recent change. The 1s window batches
// rapid tab activity (typing in title rename, drag-reorder, etc.) into
// a single localStorage write.
//
// `flushNow()` short-circuits the debounce on app close.

const SAVE_DEBOUNCE_MS = 1000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoCapture(): void {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      useWorkspaceStore.getState().captureActiveWorkspace();
    } catch {
      // Persistence failure must never crash the UI.
    }
  }, SAVE_DEBOUNCE_MS);
}

// Track structural fingerprint so we don't waste a write on transient
// state shifts that don't affect the persisted shape (e.g. focus blink).
let lastFingerprint = "";

function fingerprintLayout(state: ReturnType<typeof useLayoutStore.getState>): string {
  // Cheap structural signature — region IDs, tab IDs, types, file paths.
  // Excludes scrollback / sessionId regeneration churn.
  const parts: string[] = [];
  for (const [rid, region] of Object.entries(state.regions)) {
    parts.push(rid + "|" + region.activeTabId + "|" + region.tabPosition);
    for (const t of region.tabs) {
      parts.push(
        t.id +
          ":" +
          t.type +
          ":" +
          (t.title ?? "") +
          ":" +
          (t.cwd ?? "") +
          ":" +
          (t.editorFilePath ?? ""),
      );
    }
  }
  parts.push("focus=" + state.focusedRegionId);
  return parts.join(";");
}

// Defer subscription installation to the next microtask. Required
// because workspaceStore is part of an import cycle with layoutStore
// (layoutStore → RegionContainer → workspaceStore). At the moment
// this module's top-level executes, `useLayoutStore` may still be the
// uninitialised export sentinel. By the time the microtask drains,
// all modules in the cycle are fully initialised.
queueMicrotask(() => {
  try {
    useLayoutStore.subscribe((state) => {
      const fp = fingerprintLayout(state);
      if (fp === lastFingerprint) return;
      lastFingerprint = fp;
      scheduleAutoCapture();
    });
  } catch (err) {
    // Subscription failure must never crash the app — auto-capture is
    // a best-effort enhancement; switchWorkspace still persists on user
    // action even without it.
    console.warn(
      "[workspaceStore] auto-capture subscription failed:",
      err,
    );
  }
});


