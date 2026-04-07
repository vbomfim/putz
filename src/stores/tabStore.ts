/**
 * Tab and pane state management using Zustand.
 *
 * Manages the lifecycle of terminal tabs and their split-pane layouts.
 * Each tab contains a recursive PaneNode tree that defines the visual layout.
 *
 * Actions call Tauri IPC commands (pty_spawn, pty_close) to manage
 * PTY sessions associated with pane leaves.
 *
 * @module tabStore
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Tab, PaneNode } from "../types";
import { MAX_SPLIT_DEPTH } from "../types";
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
function closePtySession(sessionId: string): void {
  invoke("pty_close", { sessionId }).catch(() => {
    // Ignore — session may already be closed
  });
}

/** Collects all terminal session IDs from a PaneNode tree. */
function collectSessionIds(node: PaneNode): string[] {
  if (node.type === "leaf") {
    return [node.terminalSessionId];
  }
  return [
    ...collectSessionIds(node.children[0]),
    ...collectSessionIds(node.children[1]),
  ];
}

/** Calculates the maximum depth of a PaneNode tree. */
function getPaneDepth(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return (
    1 + Math.max(getPaneDepth(node.children[0]), getPaneDepth(node.children[1]))
  );
}

/**
 * Replaces a leaf node matching the given sessionId with a new split node.
 * Returns null if the sessionId was not found.
 */
function splitNodeBySession(
  node: PaneNode,
  sessionId: string,
  direction: "horizontal" | "vertical",
  newSessionId: string,
  currentDepth: number,
): PaneNode | null {
  if (node.type === "leaf") {
    if (node.terminalSessionId === sessionId) {
      if (currentDepth >= MAX_SPLIT_DEPTH) return null;
      return {
        type: "split",
        direction,
        children: [
          { type: "leaf", terminalSessionId: sessionId },
          { type: "leaf", terminalSessionId: newSessionId },
        ],
        ratio: 0.5,
      };
    }
    return null;
  }

  const leftResult = splitNodeBySession(
    node.children[0],
    sessionId,
    direction,
    newSessionId,
    currentDepth + 1,
  );
  if (leftResult) {
    return {
      ...node,
      children: [leftResult, node.children[1]],
    };
  }

  const rightResult = splitNodeBySession(
    node.children[1],
    sessionId,
    direction,
    newSessionId,
    currentDepth + 1,
  );
  if (rightResult) {
    return {
      ...node,
      children: [node.children[0], rightResult],
    };
  }

  return null;
}

/**
 * Removes a leaf node matching the given sessionId from a split.
 * Returns the sibling node (which takes over the space), or null if not found.
 */
function removeNodeBySession(
  node: PaneNode,
  sessionId: string,
): { result: PaneNode; removed: true } | null {
  if (node.type === "leaf") return null;

  const [left, right] = node.children;

  // Direct child is the target
  if (left.type === "leaf" && left.terminalSessionId === sessionId) {
    return { result: right, removed: true };
  }
  if (right.type === "leaf" && right.terminalSessionId === sessionId) {
    return { result: left, removed: true };
  }

  // Recurse into children
  const leftResult = removeNodeBySession(left, sessionId);
  if (leftResult) {
    return {
      result: {
        ...node,
        children: [leftResult.result, right],
      },
      removed: true,
    };
  }

  const rightResult = removeNodeBySession(right, sessionId);
  if (rightResult) {
    return {
      result: {
        ...node,
        children: [left, rightResult.result],
      },
      removed: true,
    };
  }

  return null;
}

/** Gets the first leaf session ID from a layout (for split-active-pane). */
function getFirstLeafSessionId(node: PaneNode): string {
  if (node.type === "leaf") return node.terminalSessionId;
  return getFirstLeafSessionId(node.children[0]);
}

// ─── Store Definition ────────────────────────────────────────────────

interface TabState {
  tabs: Tab[];
  activeTabId: string;
  tabCounter: number;

  // Search state
  isSearchOpen: boolean;

  // Logging state — tracks which sessions have active logging
  loggingSessions: Set<string>;

  // Tab lifecycle
  addTab: () => Promise<void>;
  removeTab: (id: string) => void;
  activateTab: (id: string) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  renameTab: (id: string, title: string) => void;
  duplicateTab: (id: string) => Promise<void>;
  closeOtherTabs: (keepId: string) => void;
  closeAllTabs: () => void;

  // Tab navigation
  activateNextTab: () => void;
  activatePreviousTab: () => void;
  activateTabByIndex: (index: number) => void;

  // Pane management
  splitPane: (
    tabId: string,
    paneSessionId: string,
    direction: "horizontal" | "vertical",
  ) => Promise<void>;
  splitActivePane: (direction: "horizontal" | "vertical") => Promise<void>;
  unsplitPane: (tabId: string, paneSessionId: string) => void;
  resizePane: (tabId: string, ratio: number) => void;

  // Search
  toggleSearch: () => void;
  closeSearch: () => void;

  // Logging
  toggleLogging: () => void;
  setLogging: (sessionId: string, active: boolean) => void;
  isLogging: (sessionId: string) => boolean;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: "",
  tabCounter: 0,
  isSearchOpen: false,
  loggingSessions: new Set<string>(),

  addTab: async () => {
    let sessionId: string;
    try {
      sessionId = await spawnPtySession();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PTY spawn error";
      console.error("[tabStore] Failed to spawn PTY session:", message);
      return;
    }

    const nextCounter = get().tabCounter + 1;
    const tab: Tab = {
      id: generateId(),
      title: `Terminal ${nextCounter}`,
      layout: { type: "leaf", terminalSessionId: sessionId },
      status: "local",
      createdAt: Date.now(),
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      tabCounter: nextCounter,
    }));
  },

  removeTab: (id: string) => {
    const { tabs } = get();
    const tabIndex = tabs.findIndex((t) => t.id === id);
    if (tabIndex === -1) return;

    const tab = tabs[tabIndex];

    // Close all PTY sessions in the tab's layout tree
    const sessionIds = collectSessionIds(tab.layout);
    for (const sessionId of sessionIds) {
      closePtySession(sessionId);
    }

    const newTabs = tabs.filter((t) => t.id !== id);

    // Determine new active tab
    let newActiveId = get().activeTabId;
    if (newActiveId === id) {
      if (newTabs.length === 0) {
        newActiveId = "";
      } else {
        // Activate the next tab, or the last one if we removed the last
        const nextIndex = Math.min(tabIndex, newTabs.length - 1);
        newActiveId = newTabs[nextIndex].id;
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveId,
    });
  },

  activateTab: (id: string) => {
    const { tabs } = get();
    if (tabs.some((t) => t.id === id)) {
      set({ activeTabId: id });
    }
  },

  moveTab: (fromIndex: number, toIndex: number) => {
    const { tabs } = get();
    if (
      fromIndex < 0 ||
      fromIndex >= tabs.length ||
      toIndex < 0 ||
      toIndex >= tabs.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    set({ tabs: newTabs });
  },

  renameTab: (id: string, title: string) => {
    const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
    if (!trimmed) return;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    }));
  },

  duplicateTab: async (id: string) => {
    const { tabs } = get();
    const sourceTab = tabs.find((t) => t.id === id);
    if (!sourceTab) return;

    let sessionId: string;
    try {
      sessionId = await spawnPtySession();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PTY spawn error";
      console.error("[tabStore] Failed to spawn PTY for duplicate:", message);
      return;
    }

    const nextCounter = get().tabCounter + 1;
    const newTab: Tab = {
      id: generateId(),
      title: `Terminal ${nextCounter}`,
      layout: { type: "leaf", terminalSessionId: sessionId },
      status: "local",
      createdAt: Date.now(),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
      tabCounter: nextCounter,
    }));
  },

  closeOtherTabs: (keepId: string) => {
    const { tabs } = get();
    if (!tabs.some((t) => t.id === keepId)) return;

    for (const tab of tabs) {
      if (tab.id !== keepId) {
        const sessionIds = collectSessionIds(tab.layout);
        for (const sessionId of sessionIds) {
          closePtySession(sessionId);
        }
      }
    }
    set({
      tabs: tabs.filter((t) => t.id === keepId),
      activeTabId: keepId,
    });
  },

  closeAllTabs: () => {
    const { tabs } = get();
    for (const tab of tabs) {
      const sessionIds = collectSessionIds(tab.layout);
      for (const sessionId of sessionIds) {
        closePtySession(sessionId);
      }
    }
    set({ tabs: [], activeTabId: "" });
  },

  activateNextTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    set({ activeTabId: tabs[nextIndex].id });
  },

  activatePreviousTab: () => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    set({ activeTabId: tabs[prevIndex].id });
  },

  activateTabByIndex: (index: number) => {
    const { tabs } = get();
    if (index >= 0 && index < tabs.length) {
      set({ activeTabId: tabs[index].id });
    }
  },

  splitPane: async (
    tabId: string,
    paneSessionId: string,
    direction: "horizontal" | "vertical",
  ) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Check depth before splitting
    const currentDepth = getPaneDepth(tab.layout);
    if (currentDepth >= MAX_SPLIT_DEPTH) return;

    let newSessionId: string;
    try {
      newSessionId = await spawnPtySession();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown PTY spawn error";
      console.error("[tabStore] Failed to spawn PTY for split:", message);
      return;
    }

    const newLayout = splitNodeBySession(
      tab.layout,
      paneSessionId,
      direction,
      newSessionId,
      1,
    );

    if (!newLayout) {
      // Split failed — close the session we just spawned
      closePtySession(newSessionId);
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, layout: newLayout } : t,
      ),
    }));
  },

  splitActivePane: async (direction: "horizontal" | "vertical") => {
    const { activeTabId, tabs, splitPane } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    // Split the first leaf pane in the active tab
    const firstSession = getFirstLeafSessionId(activeTab.layout);
    await splitPane(activeTabId, firstSession, direction);
  },

  unsplitPane: (tabId: string, paneSessionId: string) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const result = removeNodeBySession(tab.layout, paneSessionId);
    if (!result) return;

    // Close the removed session
    closePtySession(paneSessionId);

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, layout: result.result } : t,
      ),
    }));
  },

  resizePane: (tabId: string, ratio: number) => {
    const clampedRatio = Math.max(0.1, Math.min(0.9, ratio));

    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.layout.type !== "split") return t;
        return {
          ...t,
          layout: { ...t.layout, ratio: clampedRatio },
        };
      }),
    }));
  },

  // ─── Search ──────────────────────────────────────────────────────────

  toggleSearch: () => {
    set((state) => ({ isSearchOpen: !state.isSearchOpen }));
  },

  closeSearch: () => {
    set({ isSearchOpen: false });
  },

  // ─── Logging ─────────────────────────────────────────────────────────

  toggleLogging: () => {
    const { activeTabId, tabs, loggingSessions } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    const sessionId = getFirstLeafSessionId(activeTab.layout);
    const newLogging = new Set(loggingSessions);

    if (newLogging.has(sessionId)) {
      // Stop logging
      newLogging.delete(sessionId);
      invoke("logging_stop", { sessionId }).catch(() => {
        // Ignore — may not have been started
      });
    } else {
      // Start logging with default config
      newLogging.add(sessionId);
      invoke("logging_start", {
        sessionId,
        config: {
          directory: "",
          sessionName: activeTab.title.replace(/\s+/g, "-").toLowerCase(),
          timestamps: true,
          stripAnsi: true,
          maxFileSize: 100 * 1024 * 1024,
          flushIntervalMs: 100,
        },
      }).catch(() => {
        // Rollback on failure
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
}));
