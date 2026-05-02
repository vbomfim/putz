/**
 * useUndoRedoShortcuts — keyboard shortcuts for undo/redo.
 *
 * Registers global keydown listeners for:
 * - Ctrl+Z / Cmd+Z → undo
 * - Ctrl+Shift+Z / Cmd+Shift+Z → redo
 * - Ctrl+Y / Cmd+Y → redo
 *
 * Prevents default browser behavior for these key combinations.
 *
 * @module
 */

import { useEffect } from "react";
import { useCanvasStoreApi } from "../store/canvasStore";
import { isEditableTarget } from "../utils/isEditableTarget";

/**
 * Hook that registers global keyboard shortcuts for undo/redo.
 *
 * Call this in your root Canvas or App component. The hook manages
 * its own lifecycle — listeners are added on mount, removed on unmount.
 */
export function useUndoRedoShortcuts(): void {
  const storeApi = useCanvasStoreApi();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // Skip when user is typing in editable elements [S7-6]
      if (isEditableTarget(event.target)) return;

      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;

      const key = event.key.toLowerCase();

      // Ctrl+Shift+Z / Cmd+Shift+Z → redo (check shift FIRST to avoid undo match)
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        storeApi.getState().redo();
        return;
      }

      // Ctrl+Z / Cmd+Z → undo
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        storeApi.getState().undo();
        return;
      }

      // Ctrl+Y / Cmd+Y → redo
      if (key === "y") {
        event.preventDefault();
        storeApi.getState().redo();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [storeApi]);
}
