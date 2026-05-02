/**
 * Touch/trackpad gesture utilities — pure math + React hook.
 *
 * Pure functions for pinch distance, midpoint, and pan delta
 * calculations. The hook integrates these with PointerEvents
 * for two-finger gestures (pinch zoom + pan). [CLEAN-CODE]
 *
 * Prevents browser zoom by intercepting wheel events with ctrlKey.
 *
 * @module
 */

import { useEffect, useRef, useCallback } from "react";
import { useCanvasStoreApi } from "../store/canvasStore";
import { zoomAtPoint, clampZoom } from "../camera";

// ── Pure math functions (exported for testing) ───────────────

/**
 * Compute the distance between two touch points.
 */
export function computePinchDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the midpoint between two touch points.
 */
export function computeMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
}

/**
 * Compute the pan delta between two midpoint positions.
 */
export function computePanDelta(
  current: { x: number; y: number },
  previous: { x: number; y: number },
): { dx: number; dy: number } {
  return {
    dx: current.x - previous.x,
    dy: current.y - previous.y,
  };
}

// ── Pointer tracking state ───────────────────────────────────

interface PointerState {
  id: number;
  x: number;
  y: number;
}

/**
 * Hook for touch/trackpad gestures on the canvas element.
 *
 * Supports:
 * - Pinch to zoom: two-finger pinch zooms centered between touch points
 * - Two-finger drag: pans canvas without Space key
 * - Browser zoom prevention: intercepts Ctrl+wheel events
 *
 * Uses PointerEvent API for unified mouse/touch/pen handling.
 *
 * @param canvasRef - Ref to the canvas element
 */
export function useTouchGestures(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): void {
  const storeApi = useCanvasStoreApi();
  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const lastDistanceRef = useRef<number | null>(null);
  const lastMidpointRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    pointersRef.current.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const pointers = pointersRef.current;
      if (!pointers.has(e.pointerId)) return;

      // Update this pointer's position
      pointers.set(e.pointerId, {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      });

      // Two-finger gesture
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const p1 = pts[0]!;
        const p2 = pts[1]!;

        const distance = computePinchDistance(p1.x, p1.y, p2.x, p2.y);
        const midpoint = computeMidpoint(p1.x, p1.y, p2.x, p2.y);

        // Pinch zoom
        if (lastDistanceRef.current !== null) {
          const scale = distance / lastDistanceRef.current;
          if (Math.abs(scale - 1) > 0.01) {
            const { camera, setCamera } = storeApi.getState();
            const newZoom = clampZoom(camera.zoom * scale);
            const newCamera = zoomAtPoint(
              camera,
              midpoint.x,
              midpoint.y,
              newZoom,
            );
            setCamera(newCamera);
          }
        }

        // Two-finger pan
        if (lastMidpointRef.current !== null) {
          const delta = computePanDelta(midpoint, lastMidpointRef.current);
          if (Math.abs(delta.dx) > 0.5 || Math.abs(delta.dy) > 0.5) {
            const { camera, setCamera } = storeApi.getState();
            setCamera({
              x: camera.x - delta.dx / camera.zoom,
              y: camera.y - delta.dy / camera.zoom,
              zoom: camera.zoom,
            });
          }
        }

        lastDistanceRef.current = distance;
        lastMidpointRef.current = midpoint;
      }
    },
    [storeApi],
  );

  const handlePointerUp = useCallback((e: PointerEvent) => {
    pointersRef.current.delete(e.pointerId);

    // Reset gesture state when fewer than 2 fingers
    if (pointersRef.current.size < 2) {
      lastDistanceRef.current = null;
      lastMidpointRef.current = null;
    }
  }, []);

  const handlePointerCancel = useCallback((e: PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    lastDistanceRef.current = null;
    lastMidpointRef.current = null;
  }, []);

  /**
   * Prevent browser zoom on Ctrl+wheel (trackpad pinch gesture).
   * The canvas already handles wheel zoom in useCanvasInteraction.
   */
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, []);

  // ── Attach/detach listeners ──────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [
    canvasRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleWheel,
  ]);
}
