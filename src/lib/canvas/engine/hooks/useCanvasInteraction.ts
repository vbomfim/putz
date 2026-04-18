/**
 * Canvas interaction hook — pan and zoom.
 *
 * Pan: Space + drag or middle-click drag. Cursor changes to grab / grabbing. [AC1]
 * Zoom: Mouse scroll wheel, centered on cursor position. [AC2]
 * Horizontal pan: Shift + scroll wheel. [#70]
 * Pan delta divided by zoom for consistent speed at all levels. [AC7]
 *
 * @module
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { zoomAtPoint, MIN_ZOOM, MAX_ZOOM } from '../camera';
import { isEditableTarget } from '../utils/isEditableTarget';

/** Zoom sensitivity — how much one scroll "step" changes zoom. */
const ZOOM_SENSITIVITY = 0.001;

export interface CanvasInteraction {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  cursor: string;
}

/**
 * Hook for canvas pan/zoom interactions.
 *
 * Attaches keyboard and mouse event listeners for Space+drag panning
 * and scroll-wheel zooming. Returns a ref to attach to the canvas
 * element and the current cursor style.
 */
export function useCanvasInteraction(): CanvasInteraction {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState('default');

  // Mutable refs to avoid stale closures in event handlers
  const spaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const isMiddlePanningRef = useRef(false);
  const rightClickMovedRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // ── Pan: Space + drag [AC1] ──────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip when user is typing in editable elements [S7-6]
    if (isEditableTarget(e.target)) return;

    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      spaceHeldRef.current = true;
      setCursor('grab');
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    // Skip when user is typing in editable elements [S7-6]
    if (isEditableTarget(e.target)) return;

    if (e.code === 'Space') {
      spaceHeldRef.current = false;
      isPanningRef.current = false;
      setCursor('default');
    }
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (spaceHeldRef.current) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setCursor('grabbing');
    } else if (e.button === 1 || e.button === 2) {
      // Middle-click or right-click drag pan
      e.preventDefault();
      isMiddlePanningRef.current = true;
      rightClickMovedRef.current = false;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      setCursor('grabbing');
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanningRef.current && !isMiddlePanningRef.current) return;

    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    if (isMiddlePanningRef.current && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      rightClickMovedRef.current = true;
    }

    // [AC7] Divide pan delta by zoom for consistent speed
    const { camera } = useCanvasStore.getState();
    useCanvasStore.getState().setCamera({
      x: camera.x - dx / camera.zoom,
      y: camera.y - dy / camera.zoom,
      zoom: camera.zoom,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setCursor(spaceHeldRef.current ? 'grab' : 'default');
    }
    if (isMiddlePanningRef.current) {
      // Right-click without drag → deselect tool + deselect objects
      if (!rightClickMovedRef.current) {
        const { activeTool } = useCanvasStore.getState();
        if (activeTool !== 'select') {
          useCanvasStore.getState().setActiveTool('select');
        }
        useCanvasStore.getState().setSelectedIds(new Set());
      }
      isMiddlePanningRef.current = false;
      rightClickMovedRef.current = false;
      setCursor('default');
    }
  }, []);

  // ── Zoom: scroll wheel [AC2] ─────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const { camera, setCamera } = useCanvasStore.getState();

    // Shift+scroll → horizontal pan instead of zoom
    if (e.shiftKey) {
      setCamera({
        x: camera.x + e.deltaY / camera.zoom,
        y: camera.y,
        zoom: camera.zoom,
      });
      return;
    }

    // Calculate new zoom level
    const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
    const newZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, camera.zoom * (1 + zoomDelta)),
    );

    // Use zoomAtPoint so the world point under cursor stays fixed [AC3]
    const newCamera = zoomAtPoint(camera, e.offsetX, e.offsetY, newZoom);
    setCamera(newCamera);
  }, []);

  // ── Prevent context menu on canvas (right-click used for pan) ──

  const preventContextMenu = useCallback((e: Event) => {
    e.preventDefault();
  }, []);

  // ── Effect: attach/detach event listeners ────────────────

  useEffect(() => {
    const canvas = canvasRef.current;

    // Key events go on window (canvas may not have focus)
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    if (canvas) {
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      // { passive: false } to prevent browser scroll
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      // Suppress right-click context menu (right-click is used for pan)
      canvas.addEventListener('contextmenu', preventContextMenu);
    }

    // Also listen on window for mouseup (in case cursor leaves canvas)
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleMouseUp);

      if (canvas) {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('contextmenu', preventContextMenu);
      }
    };
  }, [handleKeyDown, handleKeyUp, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel]);

  return { canvasRef, cursor };
}
