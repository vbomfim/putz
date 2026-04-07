/**
 * Broadcast state management using Zustand.
 *
 * Manages the broadcast mode where keystrokes from the active tab
 * are simultaneously sent to selected target tabs.
 *
 * @module broadcastStore
 */
import { create } from "zustand";
import type { PaneNode } from "../types";

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

export { collectSessionIds };

interface BroadcastState {
  /** Whether broadcast mode is active. */
  isActive: boolean;
  /** Set of tab IDs that should receive broadcast input. */
  targetTabIds: Set<string>;

  /** Toggle broadcast mode on/off. When enabling with no targets, auto-selects all other tabs. */
  toggle: (allTabIds: string[], activeTabId: string) => void;
  /** Add a tab to the broadcast targets. */
  addTab: (tabId: string) => void;
  /** Remove a tab from the broadcast targets. */
  removeTab: (tabId: string) => void;
  /** Replace the entire target set. */
  setTargets: (tabIds: string[]) => void;
  /** Deactivate broadcast mode. */
  deactivate: () => void;
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  isActive: false,
  targetTabIds: new Set<string>(),

  toggle: (allTabIds: string[], activeTabId: string) => {
    const { isActive } = get();

    if (isActive) {
      // Deactivate
      set({ isActive: false, targetTabIds: new Set<string>() });
    } else {
      // Activate — auto-select all other tabs as targets
      const targets = new Set(
        allTabIds.filter((id) => id !== activeTabId),
      );
      // Need at least one target to enable broadcast
      if (targets.size === 0) return;
      set({ isActive: true, targetTabIds: targets });
    }
  },

  addTab: (tabId: string) => {
    set((state) => {
      const newTargets = new Set(state.targetTabIds);
      newTargets.add(tabId);
      return { targetTabIds: newTargets };
    });
  },

  removeTab: (tabId: string) => {
    set((state) => {
      const newTargets = new Set(state.targetTabIds);
      newTargets.delete(tabId);
      // If no targets remain, deactivate broadcast
      if (newTargets.size === 0) {
        return { targetTabIds: newTargets, isActive: false };
      }
      return { targetTabIds: newTargets };
    });
  },

  setTargets: (tabIds: string[]) => {
    const newTargets = new Set(tabIds);
    if (newTargets.size === 0 && get().isActive) {
      set({ targetTabIds: newTargets, isActive: false });
    } else {
      set({ targetTabIds: newTargets });
    }
  },

  deactivate: () => {
    set({ isActive: false, targetTabIds: new Set<string>() });
  },
}));
