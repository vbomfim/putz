/**
 * useKeyboardShortcuts — Global keyboard shortcut handler for tab management.
 *
 * Registers window-level keydown listeners for tab and pane operations.
 * Uses modifier keys (Ctrl/Cmd) to avoid conflicting with terminal input.
 *
 * @module useKeyboardShortcuts
 */
import { useEffect, useCallback } from "react";
import { useTabStore } from "../../stores/tabStore";

/** Registers global keyboard shortcuts for tab and pane management. */
export function useKeyboardShortcuts(): void {
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const activateNextTab = useTabStore((s) => s.activateNextTab);
  const activatePreviousTab = useTabStore((s) => s.activatePreviousTab);
  const activateTabByIndex = useTabStore((s) => s.activateTabByIndex);
  const splitActivePane = useTabStore((s) => s.splitActivePane);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();

      // Ctrl+T / Cmd+T — New tab
      if (key === "t" && !e.shiftKey) {
        e.preventDefault();
        addTab();
        return;
      }

      // Ctrl+Shift+W / Cmd+Shift+W — Close active tab
      // (Ctrl+W conflicts with backward-kill-word in terminal shells)
      if (key === "w" && e.shiftKey) {
        e.preventDefault();
        const { activeTabId } = useTabStore.getState();
        if (activeTabId) {
          removeTab(activeTabId);
        }
        return;
      }

      // Ctrl+Tab — Next tab
      if (e.key === "Tab" && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        activateNextTab();
        return;
      }

      // Ctrl+Shift+Tab — Previous tab
      if (e.key === "Tab" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        activatePreviousTab();
        return;
      }

      // Ctrl+1-9 — Activate tab by index
      if (key >= "1" && key <= "9" && !e.shiftKey) {
        e.preventDefault();
        activateTabByIndex(parseInt(key, 10) - 1);
        return;
      }

      // Ctrl+Shift+D — Split horizontal
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        splitActivePane("horizontal");
        return;
      }

      // Ctrl+Shift+E — Split vertical
      // (Ctrl+D conflicts with shell EOF signal)
      if (key === "e" && e.shiftKey) {
        e.preventDefault();
        splitActivePane("vertical");
        return;
      }
    },
    [
      addTab,
      removeTab,
      activateNextTab,
      activatePreviousTab,
      activateTabByIndex,
      splitActivePane,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
