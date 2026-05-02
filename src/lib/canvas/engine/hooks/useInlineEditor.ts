/**
 * Inline editor hook — double-click to edit text and shape labels.
 *
 * Listens for `dblclick` events on the canvas element. When a double-click
 * lands on an editable expression (text, sticky-note, rectangle, ellipse,
 * diamond), opens inline editing mode.
 *
 * Editable expression kinds and their editable fields:
 * - `text` → `data.text` (delete expression if empty on save)
 * - `sticky-note` → `data.text` (delete expression if empty on save)
 * - `rectangle` → `data.label` (remove label if empty on save)
 * - `ellipse` → `data.label` (remove label if empty on save)
 * - `diamond` → `data.label` (remove label if empty on save)
 *
 * @module
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useCanvasStoreApi } from "../store/canvasStore";
import { screenToWorld } from "../camera";
import { findExpressionAtPoint } from "../interaction/selectionManager";

/** Hit-test tolerance in screen pixels (matches useSelectionInteraction). */
const HIT_TOLERANCE_PX = 5;

/**
 * Configuration for each editable expression kind.
 *
 * - `field`: which property of `data` holds the editable text
 * - `deleteOnEmpty`: if true, the expression is deleted when text is empty;
 *   if false, the field is set to `undefined` (label removed)
 */
interface EditableKindConfig {
  field: "text" | "label";
  deleteOnEmpty: boolean;
}

/** Exported for testing — which expression kinds support inline editing. */
export const EDITABLE_KINDS: Record<string, EditableKindConfig> = {
  text: { field: "text", deleteOnEmpty: true },
  "sticky-note": { field: "text", deleteOnEmpty: true },
  rectangle: { field: "label", deleteOnEmpty: false },
  ellipse: { field: "label", deleteOnEmpty: false },
  diamond: { field: "label", deleteOnEmpty: false },
  stencil: { field: "label", deleteOnEmpty: false },
};

/** Public interface returned by the useInlineEditor hook. */
export interface InlineEditorState {
  /** ID of the expression currently being edited, or null. */
  editingId: string | null;
  /** Begin editing an expression by ID. Optionally seed with an initial character. */
  startEditing: (id: string, initialChar?: string) => void;
  /** Commit the current edit with the given text. Clears editing state. */
  commitEdit: (newText: string) => void;
  /** Cancel the current edit without modifying the expression. */
  cancelEdit: () => void;
  /** Get the current editable text for the expression being edited. */
  getEditingText: () => string;
}

/**
 * Hook for inline editing of text and shape labels via double-click.
 *
 * Attaches a `dblclick` event listener to the provided canvas ref.
 * Only activates when the active tool is `select`.
 */
export function useInlineEditor(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): InlineEditorState {
  const storeApi = useCanvasStoreApi();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialChar, setInitialChar] = useState<string>("");

  // Ref keeps editingId in sync for stable callbacks
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editingId;

  // ── Start editing ──────────────────────────────────────────

  const startEditing = useCallback(
    (id: string, seedChar?: string) => {
      const state = storeApi.getState();
      const expression = state.expressions[id];

      if (!expression) return;
      if (expression.meta.locked) return;
      if (!EDITABLE_KINDS[expression.kind]) return;

      setInitialChar(seedChar ?? "");
      setEditingId(id);
    },
    [storeApi],
  );

  // ── Get current text for the editing expression ────────────

  const getEditingText = useCallback((): string => {
    const id = editingIdRef.current;
    if (!id) return "";

    const state = storeApi.getState();
    const expression = state.expressions[id];
    if (!expression) return "";

    const config = EDITABLE_KINDS[expression.kind];
    if (!config) return "";

    const data = expression.data as unknown as Record<string, unknown>;
    const value = data[config.field];
    const existingText = typeof value === "string" ? value : "";
    return existingText || initialChar;
  }, [initialChar, storeApi]);

  // ── Commit edit ────────────────────────────────────────────

  const commitEdit = useCallback(
    (newText: string) => {
      const id = editingIdRef.current;
      if (!id) return;

      const state = storeApi.getState();
      const expression = state.expressions[id];

      if (!expression) {
        setEditingId(null);
        return;
      }

      const config = EDITABLE_KINDS[expression.kind];
      if (!config) {
        setEditingId(null);
        return;
      }

      const trimmed = newText.trim();

      if (!trimmed) {
        // Empty text handling
        if (config.deleteOnEmpty) {
          // Text and sticky-note: delete the expression
          state.deleteExpressions([id]);
        } else {
          // Shapes: remove the label (set to undefined)
          const updatedData = { ...expression.data } as unknown as Record<
            string,
            unknown
          >;
          delete updatedData[config.field];
          state.updateExpression(id, {
            data: updatedData as unknown as typeof expression.data,
          });
        }
      } else {
        // Non-empty text: update the field
        const updatedData = {
          ...expression.data,
          [config.field]: trimmed,
        };
        state.updateExpression(id, {
          data: updatedData as typeof expression.data,
        });
      }

      setEditingId(null);
      setInitialChar("");
    },
    [storeApi],
  );

  // ── Cancel edit ────────────────────────────────────────────

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setInitialChar("");
  }, []);

  // ── Double-click listener ──────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDblClick = (e: MouseEvent) => {
      const state = storeApi.getState();

      // Only respond in select mode
      if (state.activeTool !== "select") return;

      const { camera, expressions, expressionOrder } = state;
      const worldTolerance = HIT_TOLERANCE_PX / camera.zoom;

      // Convert screen position to world coordinates
      const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);

      // Find expression under cursor
      const hitId = findExpressionAtPoint(
        worldPoint,
        expressions,
        expressionOrder,
        worldTolerance,
      );

      if (!hitId) return;

      const expression = expressions[hitId];
      if (!expression) return;

      // Only start editing for editable kinds
      if (!EDITABLE_KINDS[expression.kind]) return;

      // Don't edit locked expressions
      if (expression.meta.locked) return;

      setEditingId(hitId);
    };

    canvas.addEventListener("dblclick", handleDblClick);

    return () => {
      canvas.removeEventListener("dblclick", handleDblClick);
    };
  }, [canvasRef, storeApi]);

  return {
    editingId,
    startEditing,
    commitEdit,
    cancelEdit,
    getEditingText,
  };
}
