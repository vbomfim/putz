/**
 * Selection interaction hook — click, shift+click, and marquee selection.
 *
 * Integrates with the canvas pointer events when the Select tool is active:
 * - **Click select**: click on shape → setSelectedIds({id})
 * - **Click deselect**: click empty space → setSelectedIds(empty)
 * - **Shift+click**: toggle ID in selectedIds
 * - **Marquee select**: drag on empty space → dashed blue rectangle →
 *   on release, select all intersecting expressions
 *
 * Coordinates are converted from screen to world using `screenToWorld`.
 * Drag threshold: 5px diagonal to distinguish click from drag.
 *
 * @module
 */

import { useRef, useEffect, useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { screenToWorld } from '../camera';
import { findExpressionAtPoint, findExpressionsInMarquee } from '../interaction/selectionManager';
import { detectPointerTarget } from '../interaction/manipulationHelpers';

/** Minimum drag distance (in screen pixels) to trigger marquee. */
const DRAG_THRESHOLD = 5;

/** Default hit-test tolerance in screen pixels. */
const HIT_TOLERANCE_PX = 5;

/** Marquee visual styles. */
const MARQUEE_STROKE_COLOR = '#4A90D9';
const MARQUEE_FILL_COLOR = 'rgba(74, 144, 217, 0.1)';
const MARQUEE_DASH_PATTERN = [6, 3];

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionInteraction {
  /** Current marquee rectangle in screen coordinates (null when not dragging). */
  marquee: MarqueeRect | null;
  /** Get the current marquee rectangle (live read from ref — safe for per-frame use). */
  getMarquee: () => MarqueeRect | null;
  /** Render the marquee overlay onto the given canvas context. */
  renderMarquee: (ctx: CanvasRenderingContext2D) => void;
  /** ID of the group currently "entered" via double-click, or null. */
  enteredGroupId: string | null;
}

/**
 * Hook for selection interactions on the canvas.
 *
 * Attaches pointer event handlers to the provided canvas ref.
 * Only active when the current tool is 'select'.
 */
export function useSelectionInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): SelectionInteraction {
  const marqueeRef = useRef<MarqueeRect | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ sx: number; sy: number } | null>(null);
  const enteredGroupIdRef = useRef<string | null>(null);

  // ── Pointer handlers ───────────────────────────────────────

  const handlePointerDown = useCallback((e: PointerEvent) => {
    const state = useCanvasStore.getState();
    if (state.activeTool !== 'select') return;

    // Only react to primary button (left click)
    if (e.button !== 0) return;

    // Check if clicking on an already-selected shape — let manipulation hook handle it
    const camera = state.camera;
    const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);

    // Bail out if clicking on a resize/point handle — manipulation hook handles those
    const pointerTarget = detectPointerTarget(worldPoint, state.expressions, state.selectedIds, camera);
    if (pointerTarget.kind === 'handle' || pointerTarget.kind === 'point-handle') {
      return;
    }

    const hitId = findExpressionAtPoint(
      worldPoint,
      state.expressions,
      state.expressionOrder,
      HIT_TOLERANCE_PX / camera.zoom,
    );
    if (hitId && state.selectedIds.has(hitId) && !e.shiftKey) {
      // Already selected — manipulation hook will handle the drag
      return;
    }

    // Capture pointer to receive events even when cursor leaves canvas [S5-4]
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);

    dragStartRef.current = { sx: e.offsetX, sy: e.offsetY };
    isDraggingRef.current = false;
    marqueeRef.current = null;
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragStartRef.current) return;

    const state = useCanvasStore.getState();
    if (state.activeTool !== 'select') return;

    const dx = e.offsetX - dragStartRef.current.sx;
    const dy = e.offsetY - dragStartRef.current.sy;
    const distance = Math.hypot(dx, dy);

    if (distance >= DRAG_THRESHOLD) {
      isDraggingRef.current = true;

      // Update marquee in screen coordinates
      marqueeRef.current = {
        x: dragStartRef.current.sx,
        y: dragStartRef.current.sy,
        width: dx,
        height: dy,
      };
    }
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragStartRef.current) return;

    const state = useCanvasStore.getState();
    if (state.activeTool !== 'select') {
      dragStartRef.current = null;
      marqueeRef.current = null;
      isDraggingRef.current = false;
      return;
    }

    const { camera, expressions, expressionOrder, selectedIds, setSelectedIds } = state;
    const worldTolerance = HIT_TOLERANCE_PX / camera.zoom;

    if (isDraggingRef.current && marqueeRef.current) {
      // ── Marquee selection ────────────────────────────────
      const { x, y, width, height } = marqueeRef.current;

      // Convert marquee corners to world coordinates
      const topLeft = screenToWorld(
        Math.min(x, x + width),
        Math.min(y, y + height),
        camera,
      );
      const bottomRight = screenToWorld(
        Math.max(x, x + width),
        Math.max(y, y + height),
        camera,
      );

      const worldMarquee = {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      };

      const hitIds = findExpressionsInMarquee(worldMarquee, expressions);

      if (e.shiftKey) {
        // Shift+marquee: add to current selection
        const newIds = new Set(selectedIds);
        for (const id of hitIds) {
          newIds.add(id);
        }
        setSelectedIds(newIds);
      } else {
        setSelectedIds(new Set(hitIds));
      }
    } else {
      // ── Click selection (group-aware) ────────────────────
      const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);
      const hitId = findExpressionAtPoint(worldPoint, expressions, expressionOrder, worldTolerance);

      if (hitId) {
        const hitExpr = expressions[hitId];
        const hitParentId = hitExpr?.parentId;

        if (e.shiftKey) {
          // Shift+click: toggle in selection
          const newIds = new Set(selectedIds);
          if (newIds.has(hitId)) {
            newIds.delete(hitId);
          } else {
            newIds.add(hitId);
          }
          setSelectedIds(newIds);
        } else if (hitParentId && enteredGroupIdRef.current === hitParentId) {
          // Already inside this group — select only this member
          setSelectedIds(new Set([hitId]));
        } else if (hitParentId) {
          // Click on grouped expression — select ALL group members
          const groupMembers = state.getGroupMembers(hitParentId);
          setSelectedIds(new Set(groupMembers));
          // Exit any entered group since we're selecting a full group
          enteredGroupIdRef.current = null;
        } else {
          // Click on ungrouped expression — select only this one
          setSelectedIds(new Set([hitId]));
          enteredGroupIdRef.current = null;
        }
      } else {
        // Click on empty space: deselect all and exit entered group
        if (!e.shiftKey) {
          setSelectedIds(new Set());
          enteredGroupIdRef.current = null;
        }
      }
    }

    // Reset drag state
    dragStartRef.current = null;
    marqueeRef.current = null;
    isDraggingRef.current = false;

    // Release pointer capture [S5-4]
    const target = e.currentTarget as Element;
    target.releasePointerCapture(e.pointerId);
  }, []);

  // ── Double-click: enter group ────────────────────────────────

  const handleDblClick = useCallback((e: MouseEvent) => {
    const state = useCanvasStore.getState();
    if (state.activeTool !== 'select') return;

    const { camera, expressions, expressionOrder } = state;
    const worldTolerance = HIT_TOLERANCE_PX / camera.zoom;
    const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);
    const hitId = findExpressionAtPoint(worldPoint, expressions, expressionOrder, worldTolerance);

    if (!hitId) return;

    const hitExpr = expressions[hitId];
    if (!hitExpr?.parentId) return;

    // Enter the group — select only this individual member
    enteredGroupIdRef.current = hitExpr.parentId;
    state.setSelectedIds(new Set([hitId]));
  }, []);

  // ── Effect: attach/detach event listeners ──────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('dblclick', handleDblClick);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('dblclick', handleDblClick);
    };
  }, [canvasRef, handlePointerDown, handlePointerMove, handlePointerUp, handleDblClick]);

  // ── Marquee rendering ──────────────────────────────────────

  const renderMarquee = useCallback((ctx: CanvasRenderingContext2D) => {
    const rect = marqueeRef.current;
    if (!rect) return;

    ctx.save();

    // Reset to screen coordinates for marquee overlay
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Fill
    ctx.fillStyle = MARQUEE_FILL_COLOR;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Dashed border
    ctx.strokeStyle = MARQUEE_STROKE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(MARQUEE_DASH_PATTERN);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.setLineDash([]);

    ctx.restore();
  }, []);

  const getMarquee = useCallback(() => marqueeRef.current, []);

  return {
    marquee: marqueeRef.current,
    getMarquee,
    renderMarquee,
    enteredGroupId: enteredGroupIdRef.current,
  };
}
