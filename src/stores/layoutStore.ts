/**
 * Layout state management using Zustand.
 *
 * Manages the region-based window layout where each region has its own
 * tab bar and tabs. Regions are arranged in a binary tree of splits.
 *
 * Replaces the old tab + PaneNode architecture with:
 * - Regions (containers with tab bars)
 * - LayoutNode tree (binary splits of regions)
 *
 * Actions call Tauri IPC commands (pty_spawn, pty_close, browser_close)
 * to manage sessions associated with region tabs.
 *
 * @module layoutStore
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Region, RegionTab, LayoutNode, TabPosition } from "../types";
import { BROWSER_SESSION_PREFIX } from "../types";
import { TERMINAL_CONFIG } from "../components/Terminal";

/** Maximum allowed length for tab titles. */
export const MAX_TITLE_LENGTH = 100;

/** Generates a UUID v4 using crypto API. */
function generateId(): string {
  return crypto.randomUUID();
}

/** Spawns a new PTY session via Tauri IPC. */
async function spawnPtySession(): Promise<string> {
  return invoke<string>("pty_spawn", {
    cols: TERMINAL_CONFIG.defaultCols,
    rows: TERMINAL_CONFIG.defaultRows,
  });
}

/** Closes a PTY session via Tauri IPC (fire-and-forget). */
import { cleanupPortalTarget } from "../components/Region/RegionContainer";

function closePtySession(sessionId: string): void {
  invoke("pty_close", { sessionId }).catch(() => {
    // Ignore — session may already be closed
  });
}

/** Closes a browser webview via Tauri IPC (fire-and-forget). */
function closeBrowserSession(browserId: string): void {
  invoke("browser_close", { tabId: browserId }).catch(() => {
    // Ignore — webview may already be closed
  });
}

/** Closes a tab's session based on its type. */
function closeTabSession(tab: RegionTab): void {
  if (tab.type === "browser") {
    closeBrowserSession(tab.sessionId);
  } else {
    closePtySession(tab.sessionId);
  }
}

/**
 * Replaces a region leaf node matching regionId with a new subtree.
 * Returns the updated tree, or null if the regionId was not found.
 */
function replaceRegionNode(
  node: LayoutNode,
  regionId: string,
  replacement: LayoutNode,
): LayoutNode | null {
  if (node.type === "region") {
    return node.regionId === regionId ? replacement : null;
  }

  const leftResult = replaceRegionNode(node.children[0], regionId, replacement);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }

  const rightResult = replaceRegionNode(node.children[1], regionId, replacement);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }

  return null;
}

/**
 * Removes a region from the layout tree, replacing its parent split
 * with the sibling node.
 * Returns the updated tree, or null if not found or if it's the root.
 */
function removeRegionFromLayout(
  node: LayoutNode,
  regionId: string,
): LayoutNode | null {
  if (node.type === "region") {
    // Can't remove the root region itself
    return null;
  }

  const [left, right] = node.children;

  // Direct child is the target — return sibling
  if (left.type === "region" && left.regionId === regionId) {
    return right;
  }
  if (right.type === "region" && right.regionId === regionId) {
    return left;
  }

  // Recurse into children
  const leftResult = removeRegionFromLayout(left, regionId);
  if (leftResult) {
    return { ...node, children: [leftResult, right] };
  }

  const rightResult = removeRegionFromLayout(right, regionId);
  if (rightResult) {
    return { ...node, children: [left, rightResult] };
  }

  return null;
}

/**
 * Finds the first region ID in a LayoutNode tree (depth-first, left-first).
 */
function findFirstRegionId(node: LayoutNode): string {
  if (node.type === "region") return node.regionId;
  return findFirstRegionId(node.children[0]);
}

/** Creates a default initial region. */
function createInitialRegion(): { region: Region; regionId: string } {
  const regionId = generateId();
  return {
    regionId,
    region: { id: regionId, tabs: [], activeTabId: "", tabPosition: "top" as TabPosition },
  };
}

// ─── Store Definition ────────────────────────────────────────────────

interface LayoutState {
  /** The binary tree of region splits. */
  layout: LayoutNode;
  /** All regions indexed by ID. */
  regions: Record<string, Region>;
  /** The currently focused region. */
  focusedRegionId: string;
  /** Global tab counter for unique tab titles. */
  tabCounter: number;

  // Search state (preserved from tabStore)
  isSearchOpen: boolean;

  // Logging state — tracks which sessions have active logging
  loggingSessions: Set<string>;

  // ─── Region Tab Actions ───────────────────────────────────────────

  /** Adds a terminal tab to a region (defaults to focused region). */
  addTerminalTab: (regionId?: string) => Promise<void>;

  /** Adds a browser tab to a region (defaults to focused region). */
  addBrowserTab: (regionId?: string, url?: string) => void;

  /** Closes a tab in a region. If last tab, closes the region. */
  closeTab: (regionId: string, tabId: string) => void;

  /** Activates a tab within a region. */
  activateTab: (regionId: string, tabId: string) => void;

  /** Renames a tab within a region. */
  renameTab: (regionId: string, tabId: string, title: string) => void;

  /** Updates the browserUrl on a browser tab (persists across remounts). */
  updateTabBrowserUrl: (regionId: string, tabId: string, url: string) => void;

  // ─── Split / Close Region Actions ─────────────────────────────────

  /** Splits the focused region, creating a new region alongside it. */
  splitRegion: (direction: "horizontal" | "vertical") => Promise<void>;

  /** Closes a region, expanding the sibling to fill the space. */
  closeRegion: (regionId: string) => void;

  // ─── Focus ────────────────────────────────────────────────────────

  /** Sets which region is focused. */
  setFocusedRegion: (regionId: string) => void;

  // ─── Tab Navigation ───────────────────────────────────────────────

  /** Navigate to next tab in focused region. */
  nextTab: (regionId?: string) => void;

  /** Navigate to previous tab in focused region. */
  prevTab: (regionId?: string) => void;

  // ─── Tab Position ────────────────────────────────────────────────

  /** Sets the tab bar position for a region. */
  setTabPosition: (regionId: string, position: TabPosition) => void;

  /** Toggles the tab bar position: top → bottom → left → right → top. */
  toggleTabPosition: (regionId: string) => void;

  // ─── Search ───────────────────────────────────────────────────────

  toggleSearch: () => void;
  closeSearch: () => void;

  // ─── Logging ──────────────────────────────────────────────────────

  toggleLogging: () => void;
  setLogging: (sessionId: string, active: boolean) => void;
  isLogging: (sessionId: string) => boolean;

  // ─── Helpers ──────────────────────────────────────────────────────

  /** Returns the session ID of the active tab in the focused region, or null. */
  getActiveSessionId: () => string | null;

  /** Returns the focused region. */
  getFocusedRegion: () => Region | null;

  /** Returns all session IDs across all regions (for broadcast). */
  getAllSessionIds: () => string[];
}

/** Creates the initial store state with one empty region. */
function createInitialState() {
  const { regionId, region } = createInitialRegion();
  return {
    layout: { type: "region" as const, regionId },
    regions: { [regionId]: region },
    focusedRegionId: regionId,
    tabCounter: 0,
    isSearchOpen: false,
    loggingSessions: new Set<string>(),
  };
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...createInitialState(),

  // ─── Tab Management ─────────────────────────────────────────────────

  addTerminalTab: async (regionId?: string) => {
    const targetRegionId = regionId || get().focusedRegionId;
    const region = get().regions[targetRegionId];
    if (!region) return;

    let sessionId: string;
    try {
      sessionId = await spawnPtySession();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PTY spawn error";
      console.error("[layoutStore] Failed to spawn PTY session:", message);
      return;
    }

    const nextCounter = get().tabCounter + 1;
    const tab: RegionTab = {
      id: generateId(),
      title: `Terminal ${nextCounter}`,
      type: "terminal",
      sessionId,
      status: "local",
    };

    set((state) => ({
      regions: {
        ...state.regions,
        [targetRegionId]: {
          ...state.regions[targetRegionId],
          tabs: [...state.regions[targetRegionId].tabs, tab],
          activeTabId: tab.id,
        },
      },
      tabCounter: nextCounter,
    }));

    // Auto-focus the new terminal
    setTimeout(() => {
      if (typeof document === "undefined") return;
      const el = document.querySelector(
        `[data-session-id="${sessionId}"] .xterm-helper-textarea`,
      ) as HTMLElement;
      el?.focus();
    }, 100);
  },

  addBrowserTab: (regionId?: string, url?: string) => {
    const targetRegionId = regionId || get().focusedRegionId;
    const region = get().regions[targetRegionId];
    if (!region) return;

    const browserUrl = url || "";
    const sessionId = `${BROWSER_SESSION_PREFIX}${generateId()}`;
    const nextCounter = get().tabCounter + 1;

    let title: string;
    try {
      const parsed = new URL(browserUrl);
      title = parsed.hostname || browserUrl;
    } catch {
      title = browserUrl.length > 40 ? browserUrl.slice(0, 37) + "..." : browserUrl || "New Tab";
    }

    const tab: RegionTab = {
      id: generateId(),
      title,
      type: "browser",
      sessionId,
      browserUrl,
      status: "local",
    };

    set((state) => ({
      regions: {
        ...state.regions,
        [targetRegionId]: {
          ...state.regions[targetRegionId],
          tabs: [...state.regions[targetRegionId].tabs, tab],
          activeTabId: tab.id,
        },
      },
      tabCounter: nextCounter,
    }));
  },

  closeTab: (regionId: string, tabId: string) => {
    const { regions } = get();
    const region = regions[regionId];
    if (!region) return;

    const tabIndex = region.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = region.tabs[tabIndex];

    // Close the session
    closeTabSession(tab);

    const newTabs = region.tabs.filter((t) => t.id !== tabId);

    // If this was the last tab, try to close the region
    if (newTabs.length === 0) {
      // If there are other regions, close this one (sibling expands)
      if (get().layout.type === "split") {
        get().closeRegion(regionId);
        return;
      }
      // Only region — clear tabs but keep the region
      set((state) => ({
        regions: {
          ...state.regions,
          [regionId]: {
            ...state.regions[regionId],
            tabs: [],
            activeTabId: "",
          },
        },
      }));
      return;
    }

    // Determine new active tab
    let newActiveId = region.activeTabId;
    if (newActiveId === tabId) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1);
      newActiveId = newTabs[nextIndex].id;
    }

    set((state) => ({
      regions: {
        ...state.regions,
        [regionId]: {
          ...state.regions[regionId],
          tabs: newTabs,
          activeTabId: newActiveId,
        },
      },
    }));
  },

  activateTab: (regionId: string, tabId: string) => {
    const region = get().regions[regionId];
    if (!region) return;
    if (!region.tabs.some((t) => t.id === tabId)) return;

    set((state) => ({
      regions: {
        ...state.regions,
        [regionId]: {
          ...state.regions[regionId],
          activeTabId: tabId,
        },
      },
      focusedRegionId: regionId,
    }));

    // Auto-focus the terminal element after React renders
    const tab = region.tabs.find((t) => t.id === tabId);
    if (tab && tab.type === "terminal") {
      setTimeout(() => {
        const el = document.querySelector(
          `[data-session-id="${tab.sessionId}"] .xterm-helper-textarea`,
        ) as HTMLElement;
        el?.focus();
      }, 50);
    }
  },

  renameTab: (regionId: string, tabId: string, title: string) => {
    const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
    if (!trimmed) return;

    set((state) => {
      const region = state.regions[regionId];
      if (!region) return state;

      return {
        regions: {
          ...state.regions,
          [regionId]: {
            ...region,
            tabs: region.tabs.map((t) =>
              t.id === tabId ? { ...t, title: trimmed } : t,
            ),
          },
        },
      };
    });
  },

  updateTabBrowserUrl: (regionId: string, tabId: string, url: string) => {
    set((state) => {
      const region = state.regions[regionId];
      if (!region) return state;
      return {
        regions: {
          ...state.regions,
          [regionId]: {
            ...region,
            tabs: region.tabs.map((t) =>
              t.id === tabId ? { ...t, browserUrl: url } : t,
            ),
          },
        },
      };
    });
  },

  // ─── Split / Close Region ──────────────────────────────────────────

  splitRegion: async (direction: "horizontal" | "vertical") => {
    const { focusedRegionId, regions, layout } = get();
    const currentRegion = regions[focusedRegionId];
    if (!currentRegion || currentRegion.tabs.length === 0) return;

    // Spawn a new PTY for the new region
    let sessionId: string;
    try {
      sessionId = await spawnPtySession();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PTY spawn error";
      console.error("[layoutStore] Failed to spawn PTY for split:", message);
      return;
    }

    const nextCounter = get().tabCounter + 1;
    const newRegionId = generateId();
    const newTab: RegionTab = {
      id: generateId(),
      title: `Terminal ${nextCounter}`,
      type: "terminal",
      sessionId,
      status: "local",
    };

    const newRegion: Region = {
      id: newRegionId,
      tabs: [newTab],
      activeTabId: newTab.id,
      tabPosition: "top",
    };

    // Build the split node replacing the focused region's leaf
    const splitNode: LayoutNode = {
      type: "split",
      direction,
      children: [
        { type: "region", regionId: focusedRegionId },
        { type: "region", regionId: newRegionId },
      ],
      ratio: 0.5,
    };

    const newLayout = replaceRegionNode(layout, focusedRegionId, splitNode);
    if (!newLayout) {
      // Should not happen, but close the spawned session
      closePtySession(sessionId);
      return;
    }

    set((state) => ({
      layout: newLayout,
      regions: {
        ...state.regions,
        [newRegionId]: newRegion,
      },
      focusedRegionId: newRegionId,
      tabCounter: nextCounter,
    }));

    // Auto-focus the new terminal
    setTimeout(() => {
      const el = document.querySelector(
        `[data-session-id="${sessionId}"] .xterm-helper-textarea`,
      ) as HTMLElement;
      el?.focus();
    }, 200);
  },

  closeRegion: (regionId: string) => {
    const { regions, layout } = get();
    const region = regions[regionId];

    // Can't close the last region
    if (layout.type === "region") return;

    // Close all sessions in the region
    if (region) {
      for (const tab of region.tabs) {
        closeTabSession(tab);
      }
    }

    // Remove region from layout tree
    const newLayout = removeRegionFromLayout(layout, regionId);
    if (!newLayout) return;

    // Remove region from regions map
    const newRegions = { ...regions };
    delete newRegions[regionId];
    cleanupPortalTarget(regionId);

    // Focus the first remaining region
    const newFocusedRegionId = findFirstRegionId(newLayout);

    set({
      layout: newLayout,
      regions: newRegions,
      focusedRegionId: newFocusedRegionId,
    });
  },

  // ─── Focus ────────────────────────────────────────────────────────

  setFocusedRegion: (regionId: string) => {
    if (get().regions[regionId]) {
      set({ focusedRegionId: regionId });
    }
  },

  // ─── Tab Navigation ───────────────────────────────────────────────

  nextTab: (regionId?: string) => {
    const targetRegionId = regionId || get().focusedRegionId;
    const region = get().regions[targetRegionId];
    if (!region || region.tabs.length <= 1) return;

    const currentIndex = region.tabs.findIndex(
      (t) => t.id === region.activeTabId,
    );
    const nextIndex = (currentIndex + 1) % region.tabs.length;
    get().activateTab(targetRegionId, region.tabs[nextIndex].id);
  },

  prevTab: (regionId?: string) => {
    const targetRegionId = regionId || get().focusedRegionId;
    const region = get().regions[targetRegionId];
    if (!region || region.tabs.length <= 1) return;

    const currentIndex = region.tabs.findIndex(
      (t) => t.id === region.activeTabId,
    );
    const prevIndex =
      (currentIndex - 1 + region.tabs.length) % region.tabs.length;
    get().activateTab(targetRegionId, region.tabs[prevIndex].id);
  },

  // ─── Tab Position ────────────────────────────────────────────────

  setTabPosition: (regionId: string, position: TabPosition) => {
    const region = get().regions[regionId];
    if (!region) return;

    set((state) => ({
      regions: {
        ...state.regions,
        [regionId]: {
          ...state.regions[regionId],
          tabPosition: position,
        },
      },
    }));
  },

  toggleTabPosition: (regionId: string) => {
    const region = get().regions[regionId];
    if (!region) return;

    const cycle: TabPosition[] = ["top", "bottom", "left", "right"];
    const currentIndex = cycle.indexOf(region.tabPosition);
    const nextIndex = (currentIndex + 1) % cycle.length;
    get().setTabPosition(regionId, cycle[nextIndex]);
  },

  // ─── Search ───────────────────────────────────────────────────────

  toggleSearch: () => {
    set((state) => ({ isSearchOpen: !state.isSearchOpen }));
  },

  closeSearch: () => {
    set({ isSearchOpen: false });
  },

  // ─── Logging ──────────────────────────────────────────────────────

  toggleLogging: () => {
    const sessionId = get().getActiveSessionId();
    if (!sessionId) return;

    const { loggingSessions, focusedRegionId, regions } = get();
    const region = regions[focusedRegionId];
    const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
    const newLogging = new Set(loggingSessions);

    if (newLogging.has(sessionId)) {
      newLogging.delete(sessionId);
      invoke("logging_stop", { sessionId }).catch(() => {
        const rollback = new Set(get().loggingSessions);
        rollback.add(sessionId);
        set({ loggingSessions: rollback });
      });
    } else {
      newLogging.add(sessionId);
      invoke("logging_start", {
        sessionId,
        config: {
          directory: "",
          sessionName: (activeTab?.title || "terminal")
            .replace(/\s+/g, "-")
            .toLowerCase(),
          timestamps: true,
          stripAnsi: true,
          maxFileSize: 100 * 1024 * 1024,
          flushIntervalMs: 100,
        },
      }).catch(() => {
        const rollback = new Set(get().loggingSessions);
        rollback.delete(sessionId);
        set({ loggingSessions: rollback });
      });
    }

    set({ loggingSessions: newLogging });
  },

  setLogging: (sessionId: string, active: boolean) => {
    set((state) => {
      const newLogging = new Set(state.loggingSessions);
      if (active) {
        newLogging.add(sessionId);
      } else {
        newLogging.delete(sessionId);
      }
      return { loggingSessions: newLogging };
    });
  },

  isLogging: (sessionId: string) => {
    return get().loggingSessions.has(sessionId);
  },

  // ─── Helpers ──────────────────────────────────────────────────────

  getActiveSessionId: () => {
    const { focusedRegionId, regions } = get();
    const region = regions[focusedRegionId];
    if (!region) return null;
    const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
    return activeTab?.sessionId || null;
  },

  getFocusedRegion: () => {
    const { focusedRegionId, regions } = get();
    return regions[focusedRegionId] || null;
  },

  getAllSessionIds: () => {
    const { regions } = get();
    const ids: string[] = [];
    for (const region of Object.values(regions)) {
      for (const tab of region.tabs) {
        ids.push(tab.sessionId);
      }
    }
    return ids;
  },
}));
