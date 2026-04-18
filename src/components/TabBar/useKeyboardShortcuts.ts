/**
 * useKeyboardShortcuts — Global keyboard shortcut handler for tab management.
 *
 * Registers window-level keydown listeners for tab and region operations.
 * Uses modifier keys (Ctrl/Cmd) to avoid conflicting with terminal input.
 *
 * @module useKeyboardShortcuts
 */
import { useEffect, useCallback } from "react";
import { useLayoutStore } from "../../stores/layoutStore";
import { useBroadcastStore } from "../../stores/broadcastStore";
import { useSettingsStore } from "../../stores/settingsStore";

/** Callback for bookmark actions triggered by keyboard shortcut. */
export interface KeyboardShortcutCallbacks {
  onAddBookmark?: () => void;
}

// Module-level callbacks — set by App.tsx via setKeyboardShortcutCallbacks
let shortcutCallbacks: KeyboardShortcutCallbacks = {};

/** Registers callbacks for keyboard shortcut actions managed by App.tsx. */
export function setKeyboardShortcutCallbacks(
  callbacks: KeyboardShortcutCallbacks,
): void {
  shortcutCallbacks = callbacks;
}

/**
 * Returns true if the DOM focus is inside a terminal's xterm element.
 * When xterm is focused, Ctrl+D must propagate to the terminal as EOF —
 * we must NOT intercept it for bookmarks.
 *
 * Implementation note:
 * - The selector `.xterm` is xterm.js v5's root container class.
 * - xterm.js focuses an inner `.xterm-helper-textarea`, which
 *   `closest(".xterm")` walks up to find the container.
 * - If we ever upgrade xterm.js, re-verify this selector — the class
 *   name is not part of xterm's public API and could change.
 */
function isXtermFocused(): boolean {
  return document.activeElement?.closest(".xterm") != null;
}

/** Registers global keyboard shortcuts for tab and region management. */
export function useKeyboardShortcuts(): void {
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const addBrowserTab = useLayoutStore((s) => s.addBrowserTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const nextTab = useLayoutStore((s) => s.nextTab);
  const prevTab = useLayoutStore((s) => s.prevTab);
  const splitRegion = useLayoutStore((s) => s.splitRegion);
  const toggleSearch = useLayoutStore((s) => s.toggleSearch);
  const toggleLogging = useLayoutStore((s) => s.toggleLogging);
  const toggleBroadcast = useBroadcastStore((s) => s.toggle);
  const toggleShortcutsPanel = useSettingsStore((s) => s.toggleShortcutsPanel);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();

      // Ctrl+T / Cmd+T — New terminal tab in focused region
      if (key === "t" && !e.shiftKey) {
        e.preventDefault();
        addTerminalTab();
        return;
      }

      // Ctrl+Shift+B — New browser tab in focused region
      if (key === "b" && e.shiftKey) {
        e.preventDefault();
        addBrowserTab(undefined, "");
        return;
      }

      // Ctrl+Shift+W — Close active tab in focused region
      if (key === "w" && e.shiftKey) {
        e.preventDefault();
        const state = useLayoutStore.getState();
        const region = state.regions[state.focusedRegionId];
        if (region && region.activeTabId) {
          closeTab(state.focusedRegionId, region.activeTabId);
        }
        return;
      }

      // Ctrl+Tab — Next tab in focused region
      if (e.key === "Tab" && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        nextTab();
        return;
      }

      // Ctrl+Shift+Tab — Previous tab in focused region
      if (e.key === "Tab" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        prevTab();
        return;
      }

      // Ctrl+Shift+D — Split focused region horizontally (top/bottom)
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        splitRegion("horizontal");
        return;
      }

      // Cmd+D / Ctrl+D — Add bookmark for focused tab
      // CRITICAL: bail when xterm is focused — Ctrl+D is EOF in terminals
      if (key === "d" && !e.shiftKey) {
        if (isXtermFocused()) return; // let terminal handle Ctrl+D
        e.preventDefault();
        shortcutCallbacks.onAddBookmark?.();
        return;
      }

      // Ctrl+Shift+E — Split focused region vertically (side by side)
      if (key === "e" && e.shiftKey) {
        e.preventDefault();
        splitRegion("vertical");
        return;
      }

      // Ctrl+F — Toggle scrollback search
      if (key === "f" && !e.shiftKey) {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // Ctrl+Shift+L — Toggle session logging
      if (key === "l" && e.shiftKey) {
        e.preventDefault();
        toggleLogging();
        return;
      }

      // Ctrl+Shift+A — Toggle broadcast mode
      if (key === "a" && e.shiftKey) {
        e.preventDefault();
        const state = useLayoutStore.getState();
        const allRegionIds = Object.keys(state.regions);
        toggleBroadcast(allRegionIds, state.focusedRegionId);
        return;
      }

      // Ctrl+Shift+? — Toggle keyboard shortcuts panel
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        toggleShortcutsPanel();
        return;
      }

      // Ctrl+Shift+H — Toggle highlighting (placeholder)
      if (key === "h" && e.shiftKey) {
        e.preventDefault();
        return;
      }
    },
    [
      addTerminalTab,
      addBrowserTab,
      closeTab,
      nextTab,
      prevTab,
      splitRegion,
      toggleSearch,
      toggleLogging,
      toggleBroadcast,
      toggleShortcutsPanel,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
