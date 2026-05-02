/**
 * Metadata tooltip — hover tooltip for expression metadata.
 *
 * Pure functions for relative time formatting and tooltip data
 * construction, plus a React hook for hover-delay behavior.
 *
 * Shows author name, creation time (relative), and expression kind
 * after 800ms hover over an expression. Hides on mouseleave or
 * pointer move. [CLEAN-CODE]
 *
 * @module
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { VisualExpression } from "../../protocol";
import { screenToWorld } from "../camera";
import { useCanvasStoreApi } from "../store/canvasStore";
import { findExpressionAtPoint } from "../interaction/selectionManager";

/** Tooltip delay in milliseconds. */
const TOOLTIP_DELAY_MS = 800;

/** Movement threshold to cancel tooltip (screen pixels). */
const MOVE_THRESHOLD_PX = 5;

// ── Pure functions (exported for testing) ────────────────────

/**
 * Format a timestamp as a relative time string.
 *
 * Examples: "just now", "5 minutes ago", "2 hours ago", "3 days ago".
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 2) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  if (diffHour < 2) return "1 hour ago";
  if (diffHour < 24) return `${diffHour} hours ago`;
  if (diffDay < 2) return "1 day ago";
  return `${diffDay} days ago`;
}

/** Tooltip data extracted from an expression. */
export interface TooltipData {
  authorName: string;
  kind: string;
  createdAt: number;
}

/**
 * Build tooltip display data from an expression.
 */
export function buildTooltipData(expr: VisualExpression): TooltipData {
  const author = expr.meta?.author;
  const authorName =
    author && "name" in author && author.name ? author.name : "Unknown";

  return {
    authorName,
    kind: expr.kind,
    createdAt: expr.meta?.createdAt ?? Date.now(),
  };
}

// ── Tooltip state ────────────────────────────────────────────

/** Screen-positioned tooltip info. */
export interface TooltipInfo {
  x: number;
  y: number;
  data: TooltipData;
}

/**
 * Hook for metadata tooltip on expression hover.
 *
 * Tracks pointer position on the canvas and shows a tooltip
 * after 800ms hover delay. Hides on mouse leave or significant
 * pointer movement.
 *
 * @param canvasRef - Ref to the canvas element
 * @returns Current tooltip info (null if hidden)
 */
export function useMetadataTooltip(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): TooltipInfo | null {
  const storeApi = useCanvasStoreApi();
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTooltip = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTooltip(null);
    lastPosRef.current = null;
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const screenX = e.offsetX;
      const screenY = e.offsetY;

      // Check if pointer moved significantly → cancel pending tooltip
      if (lastPosRef.current) {
        const dx = screenX - lastPosRef.current.x;
        const dy = screenY - lastPosRef.current.y;
        if (
          Math.abs(dx) > MOVE_THRESHOLD_PX ||
          Math.abs(dy) > MOVE_THRESHOLD_PX
        ) {
          clearTooltip();
        }
      }

      lastPosRef.current = { x: screenX, y: screenY };

      // Clear any existing timer
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

      // Start new delay
      timerRef.current = setTimeout(() => {
        const { camera, expressions, expressionOrder } = storeApi.getState();
        const worldPoint = screenToWorld(screenX, screenY, camera);

        // Use 5px tolerance in world units (adjusted for zoom)
        const tolerance = 5 / camera.zoom;
        const hitId = findExpressionAtPoint(
          worldPoint,
          expressions as Record<string, VisualExpression>,
          expressionOrder,
          tolerance,
        );

        if (hitId) {
          const expr = expressions[hitId] as VisualExpression;
          if (expr) {
            const data = buildTooltipData(expr);
            setTooltip({ x: e.clientX, y: e.clientY, data });
          } else {
            setTooltip(null);
          }
        } else {
          setTooltip(null);
        }
      }, TOOLTIP_DELAY_MS);
    },
    [clearTooltip, storeApi],
  );

  const handlePointerLeave = useCallback(() => {
    clearTooltip();
  }, [clearTooltip]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [canvasRef, handlePointerMove, handlePointerLeave]);

  return tooltip;
}
