/**
 * useKeyboardShortcuts — centralized keyboard shortcut system.
 *
 * Consolidates all global keyboard shortcuts into a single hook:
 *
 * **Tool switching (single keys, no modifier):**
 * - `V` / `1` → Select
 * - `R` / `2` → Rectangle
 * - `O` / `3` → Ellipse
 * - `D` / `4` → Diamond
 * - `L` / `5` → Line
 * - `A` / `6` → Arrow
 * - `P` / `7` → Freehand/Pen
 * - `T` / `8` → Text
 *
 * **Actions (with modifiers):**
 * - `Ctrl+Z` / `Cmd+Z` → Undo
 * - `Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y` → Redo
 * - `Ctrl+C` / `Cmd+C` → Copy selected to internal clipboard
 * - `Ctrl+V` / `Cmd+V` → Paste from internal clipboard (+20 offset)
 * - `Ctrl+X` / `Cmd+X` → Cut selected (copy + delete)
 * - `Ctrl+D` / `Cmd+D` → Duplicate selected
 * - `Ctrl+A` / `Cmd+A` → Select all
 * - `Ctrl+G` / `Cmd+G` → Group selected expressions
 * - `Ctrl+Shift+G` / `Cmd+Shift+G` → Ungroup selected expressions
 * - `Ctrl+'` / `Cmd+'` → Toggle grid visibility
 * - `Ctrl+Shift+'` → Toggle snap to grid
 * - `Delete` / `Backspace` → Delete selected
 * - `Escape` → Cancel current operation / deselect
 * - `?` → Toggle shortcuts help panel
 *
 * **Guards:**
 * - Shortcuts are disabled when typing in input/textarea/contentEditable
 * - Default browser behavior is prevented for captured shortcuts
 * - Mac Cmd key is treated as Ctrl
 *
 * @module
 */

import { useEffect, useCallback, useState } from "react";
import { nanoid } from "nanoid";
import type { VisualExpression } from "../../protocol";
import { useCanvasStoreApi } from "../store/canvasStore";
import type { CanvasStoreApi } from "../store/canvasStore";
import type { ToolType } from "../types/index";

// ── Constants ──────────────────────────────────────────────

/** Duplicate / paste offset in world units. */
const DUPLICATE_OFFSET = 20;

// ── Internal clipboard ────────────────────────────────────

/** Deep clones of copied expressions (module-scoped, internal only). */
let clipboard: VisualExpression[] = [];

/** Tracks how many times paste has been invoked since last copy. */
let pasteCount = 0;

/** Map of single keys (lowercase) to tool types. */
const KEY_TO_TOOL: Readonly<Record<string, ToolType>> = {
  v: "select",
  "1": "select",
  r: "rectangle",
  "2": "rectangle",
  o: "ellipse",
  "3": "ellipse",
  d: "diamond",
  "4": "diamond",
  l: "arrow",
  "5": "arrow",
  a: "arrow",
  "6": "arrow",
  p: "freehand",
  "7": "freehand",
  t: "text",
  "8": "text",
};

// ── Types ──────────────────────────────────────────────────

/** Options for the keyboard shortcuts hook. */
export interface UseKeyboardShortcutsOptions {
  /**
   * Callback to cancel an active drawing operation.
   * Provided by useDrawingInteraction to cancel mid-draw state.
   */
  cancelDraw: () => void;
  /**
   * Callback to start inline editing on a selected expression.
   * Provided by useInlineEditor. If not provided, type-to-edit is disabled.
   */
  startEditing?: (id: string, initialChar?: string) => void;
}

/** Return value of the keyboard shortcuts hook. */
export interface KeyboardShortcutsState {
  /** Whether the shortcuts help panel is currently visible. */
  showShortcutsHelp: boolean;
  /** Toggle or set the help panel visibility. */
  setShowShortcutsHelp: (show: boolean) => void;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Check whether the event target is a text input element.
 *
 * Shortcuts should be suppressed when the user is typing in a
 * form control or contentEditable element.
 */
function isTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    target.contentEditable === "true"
  );
}

// ── Hook ───────────────────────────────────────────────────

/**
 * Centralized keyboard shortcut hook.
 *
 * Call in the root Canvas/App component. Registers a single global
 * `keydown` listener that dispatches to all shortcut handlers.
 */
export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions,
): KeyboardShortcutsState {
  const storeApi = useCanvasStoreApi();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // ── Guard: skip when typing in text inputs ──
      if (isTextInput(event.target)) return;

      const key = event.key;
      const keyLower = key.toLowerCase();
      const isModifier = event.ctrlKey || event.metaKey;

      // ── Help panel toggle: ? ──
      if (key === "?") {
        setShowShortcutsHelp((prev) => !prev);
        return;
      }

      // ── Escape: cancel / deselect / close help / close waypoint panel ──
      if (key === "Escape") {
        // Close help panel if open
        setShowShortcutsHelp(false);

        // Exit presentation mode if active
        const { presentationIndex, waypointPanelOpen } = storeApi.getState();
        if (presentationIndex >= 0) {
          storeApi.getState().exitPresentation();
        }
        // Close waypoint panel if open
        if (waypointPanelOpen) {
          storeApi.getState().setWaypointPanelOpen(false);
          return;
        }

        // Cancel active draw operation
        options.cancelDraw();

        // Deselect all
        storeApi.getState().setSelectedIds(new Set());

        // Switch to select tool
        storeApi.getState().setActiveTool("select");
        return;
      }

      // ── Waypoint navigation (arrow keys, no modifier, panel open) ──
      if (!isModifier && !event.shiftKey && !event.altKey) {
        const { waypointPanelOpen: panelOpen, waypoints } = storeApi.getState();
        if (panelOpen && waypoints.length > 0) {
          if (key === "ArrowRight" || key === "ArrowDown") {
            event.preventDefault();
            storeApi.getState().nextWaypoint();
            return;
          }
          if (key === "ArrowLeft" || key === "ArrowUp") {
            event.preventDefault();
            storeApi.getState().prevWaypoint();
            return;
          }
        }
      }

      // ── Modifier-based shortcuts ──
      if (isModifier) {
        // Ctrl+Shift+Z / Cmd+Shift+Z → redo (check shift FIRST)
        if (keyLower === "z" && event.shiftKey) {
          event.preventDefault();
          storeApi.getState().redo();
          return;
        }

        // Ctrl+Z / Cmd+Z → undo
        if (keyLower === "z" && !event.shiftKey) {
          event.preventDefault();
          storeApi.getState().undo();
          return;
        }

        // Ctrl+Y / Cmd+Y → redo
        if (keyLower === "y") {
          event.preventDefault();
          storeApi.getState().redo();
          return;
        }

        // Ctrl+A / Cmd+A → select all
        if (keyLower === "a") {
          event.preventDefault();
          const { expressionOrder } = storeApi.getState();
          storeApi.getState().setSelectedIds(new Set(expressionOrder));
          return;
        }

        // Ctrl+D / Cmd+D → duplicate selected
        if (keyLower === "d") {
          event.preventDefault();
          duplicateSelected(storeApi);
          return;
        }

        // Ctrl+C / Cmd+C → copy selected to internal clipboard
        if (keyLower === "c") {
          event.preventDefault();
          copySelected(storeApi);
          return;
        }

        // Ctrl+V / Cmd+V → paste from internal clipboard
        if (keyLower === "v") {
          event.preventDefault();
          pasteFromClipboard(storeApi);
          return;
        }

        // Ctrl+X / Cmd+X → cut selected (copy + delete)
        if (keyLower === "x") {
          event.preventDefault();
          cutSelected(storeApi);
          return;
        }

        // Ctrl+Shift+G / Cmd+Shift+G → ungroup selected (check shift FIRST)
        if (keyLower === "g" && event.shiftKey) {
          event.preventDefault();
          ungroupSelected(storeApi);
          return;
        }

        // Ctrl+G / Cmd+G → group selected
        if (keyLower === "g" && !event.shiftKey) {
          event.preventDefault();
          groupSelected(storeApi);
          return;
        }

        // Ctrl+' / Cmd+' → toggle grid visibility
        if (key === "'" || key === "'") {
          event.preventDefault();
          storeApi.getState().toggleGrid();
          return;
        }

        // Ctrl+] → bring to front
        if (key === "]") {
          event.preventDefault();
          const ids = Array.from(storeApi.getState().selectedIds);
          if (ids.length > 0) storeApi.getState().bringToFront(ids);
          return;
        }

        // Ctrl+[ → send to back
        if (key === "[") {
          event.preventDefault();
          const ids = Array.from(storeApi.getState().selectedIds);
          if (ids.length > 0) storeApi.getState().sendToBack(ids);
          return;
        }

        // Ctrl+ArrowUp → bring forward
        if (key === "ArrowUp") {
          event.preventDefault();
          const ids = Array.from(storeApi.getState().selectedIds);
          if (ids.length > 0) storeApi.getState().bringForward(ids);
          return;
        }

        // Ctrl+ArrowDown → send backward
        if (key === "ArrowDown") {
          event.preventDefault();
          const ids = Array.from(storeApi.getState().selectedIds);
          if (ids.length > 0) storeApi.getState().sendBackward(ids);
          return;
        }

        // Ctrl+Shift+' → toggle snap to grid
        if (key === "'" && event.shiftKey) {
          event.preventDefault();
          storeApi.getState().toggleSnapEnabled();
          return;
        }

        // Other modifier combos — not handled, let browser process
        return;
      }

      // ── Delete / Backspace → delete selected (group-aware) ──
      if (key === "Delete" || key === "Backspace") {
        const state = storeApi.getState();
        if (state.activeTool !== "select") return;

        const { selectedIds, expressions } = state;
        if (selectedIds.size === 0) return;

        event.preventDefault();
        // Expand selection to include all group members
        const expandedIds = state.expandSelectionToGroups(selectedIds);
        const deletableIds = Array.from(expandedIds).filter(
          (id) => !expressions[id]?.meta.locked,
        );
        if (deletableIds.length > 0) {
          storeApi.getState().deleteExpressions(deletableIds);
        }
        return;
      }

      // ── Type-to-edit: printable key with selected shape ──
      if (!isModifier && key.length === 1 && !event.altKey) {
        const { selectedIds } = storeApi.getState();
        if (selectedIds.size === 1 && options.startEditing) {
          const id = selectedIds.values().next().value;
          if (id) {
            const expr = storeApi.getState().expressions[id];
            if (
              expr &&
              (expr.kind === "text" ||
                expr.kind === "rectangle" ||
                expr.kind === "ellipse" ||
                expr.kind === "diamond" ||
                expr.kind === "sticky-note")
            ) {
              event.preventDefault();
              options.startEditing(id, key);
              return;
            }
          }
        }
      }

      // ── Tool switching (single key, no modifier) ──
      if (!event.shiftKey && !event.altKey) {
        const tool = KEY_TO_TOOL[keyLower];
        if (tool) {
          storeApi.getState().setActiveTool(tool);
          return;
        }
      }
    },
    [options, storeApi],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, storeApi]);

  return { showShortcutsHelp, setShowShortcutsHelp };
}

// ── Private helpers ────────────────────────────────────────

/**
 * Duplicate all selected (unlocked) expressions with a +20,+20 offset.
 * Group-aware: expands selection to include all group members and
 * preserves group structure in the duplicates with new group IDs.
 */
function duplicateSelected(store: CanvasStoreApi): void {
  const state = store.getState();
  const { selectedIds } = state;
  if (selectedIds.size === 0) return;

  // Expand selection to include all group members
  const expandedIds = state.expandSelectionToGroups(selectedIds);

  // Use group-aware duplication from the store
  const newIds = state.duplicateGrouped(expandedIds);

  // Select the new duplicates
  store.getState().setSelectedIds(new Set(newIds));
}

// ── Clipboard operations (exported for testing) ────────────

/**
 * Copy all selected expressions to the internal clipboard.
 *
 * Stores deep clones so pasting is independent of future mutations.
 * Resets the paste counter for offset tracking.
 */
export function copySelected(store: CanvasStoreApi): void {
  const { selectedIds, expressions } = store.getState();
  if (selectedIds.size === 0) return;

  clipboard = [];
  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;
    clipboard.push(structuredClone(expr));
  }
  pasteCount = 0;
}

/**
 * Paste expressions from the internal clipboard.
 *
 * Creates clones with new IDs. Each subsequent paste increases
 * the offset by +20,+20 from the original positions.
 */
export function pasteFromClipboard(store: CanvasStoreApi): void {
  if (clipboard.length === 0) return;

  pasteCount += 1;
  const offset = pasteCount * DUPLICATE_OFFSET;
  const newIds: string[] = [];

  for (const original of clipboard) {
    const newId = nanoid();
    const clone = structuredClone(original);
    clone.id = newId;
    clone.position = {
      x: original.position.x + offset,
      y: original.position.y + offset,
    };
    const now = Date.now();
    clone.meta = {
      ...clone.meta,
      createdAt: now,
      updatedAt: now,
    };

    store.getState().addExpression(clone);
    newIds.push(newId);
  }

  store.getState().setSelectedIds(new Set(newIds));
}

/**
 * Cut selected expressions: copy to clipboard, then delete originals.
 * Group-aware: expands selection to include all group members.
 *
 * Locked expressions are excluded from deletion (same as Delete key).
 */
export function cutSelected(store: CanvasStoreApi): void {
  const state = store.getState();
  const { selectedIds, expressions } = state;
  if (selectedIds.size === 0) return;

  // Copy to clipboard first
  copySelected(store);

  // Expand selection to include all group members, then delete
  const expandedIds = state.expandSelectionToGroups(selectedIds);
  const deletableIds = Array.from(expandedIds).filter(
    (id) => !expressions[id]?.meta.locked,
  );
  if (deletableIds.length > 0) {
    store.getState().deleteExpressions(deletableIds);
  }
}

/**
 * Reset clipboard state. Exported for test cleanup only.
 * @internal
 */
export function _resetClipboard(): void {
  clipboard = [];
  pasteCount = 0;
}

// ── Group/Ungroup helpers (#71) ────────────────────────────

/**
 * Group all currently selected expressions.
 *
 * Requires at least 2 selected expressions. Creates a new group and
 * assigns a shared `parentId` to all members.
 */
function groupSelected(store: CanvasStoreApi): void {
  const { selectedIds } = store.getState();
  if (selectedIds.size < 2) return;

  const ids = Array.from(selectedIds);
  store.getState().groupExpressions(ids);
}

/**
 * Ungroup selected expressions if they all share the same parentId.
 *
 * Only ungroups when every selected expression belongs to the same group.
 * Mixed selections (multiple groups or ungrouped items) are skipped.
 */
function ungroupSelected(store: CanvasStoreApi): void {
  const { selectedIds, expressions } = store.getState();
  if (selectedIds.size === 0) return;

  // Collect all parentIds from selected expressions
  const parentIds = new Set<string>();
  for (const id of selectedIds) {
    const parentId = expressions[id]?.parentId;
    if (parentId) {
      parentIds.add(parentId);
    }
  }

  // Only ungroup if there's exactly one shared group
  if (parentIds.size !== 1) return;

  const groupId = [...parentIds][0]!;
  store.getState().ungroupExpressions(groupId);
}
