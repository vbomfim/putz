/**
 * Drawing interaction hook — wires tool handlers into canvas pointer events.
 *
 * When the active tool is not 'select', this hook intercepts pointer events,
 * converts screen coordinates to world space, and dispatches to the active
 * tool handler. Exposes a cancelDraw callback for the central keyboard
 * shortcuts hook to invoke on ESC.
 *
 * @module
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { screenToWorld } from '../camera';
import { RectangleTool } from '../tools/RectangleTool';
import { EllipseTool } from '../tools/EllipseTool';
import { DiamondTool } from '../tools/DiamondTool';
import { ArrowTool } from '../tools/ArrowTool';
import { FreehandTool } from '../tools/FreehandTool';
import { TextTool } from '../tools/TextTool';
import { StickyNoteTool } from '../tools/StickyNoteTool';
import type { ToolHandler, DrawPreview } from '../tools/BaseTool';

export interface DrawingInteraction {
  /** Current draw preview for the render loop, or null. */
  getDrawPreview(): DrawPreview | null;
  /** Text tool instance for overlay input positioning. */
  textTool: TextTool;
  /** Cancel any active draw operation and reset text tool state. */
  cancelDraw(): void;
}

/**
 * Hook for drawing tool interactions on the canvas.
 *
 * Creates tool handler instances and routes pointer events to the
 * active tool when in drawing mode (activeTool !== 'select').
 */
export function useDrawingInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): DrawingInteraction {
  // Create stable tool handler instances
  const toolHandlers = useMemo(() => {
    const textTool = new TextTool();
    return {
      rectangle: new RectangleTool(),
      ellipse: new EllipseTool(),
      diamond: new DiamondTool(),
      arrow: new ArrowTool(),
      freehand: new FreehandTool(),
      text: textTool,
      'sticky-note': new StickyNoteTool(),
    } as Record<string, ToolHandler>;
  }, []);

  const textTool = useMemo(() => toolHandlers.text as TextTool, [toolHandlers]);

  /** Get the handler for the currently active tool. */
  const getActiveHandler = useCallback((): ToolHandler | null => {
    const { activeTool } = useCanvasStore.getState();
    if (activeTool === 'select') return null;
    return toolHandlers[activeTool] ?? null;
  }, [toolHandlers]);

  // Track which handler was active during the current drag to prevent
  // handler switching mid-draw
  const activeDrawHandlerRef = useRef<ToolHandler | null>(null);

  // ── Pointer handlers ───────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const handler = getActiveHandler();
      if (!handler) return;

      // Only react to primary button (left click)
      if (e.button !== 0) return;

      const { camera } = useCanvasStore.getState();
      const world = screenToWorld(e.offsetX, e.offsetY, camera);

      // Capture pointer to receive events even when cursor leaves canvas
      const target = e.currentTarget as Element;
      target.setPointerCapture(e.pointerId);

      activeDrawHandlerRef.current = handler;
      handler.onPointerDown(world.x, world.y, e);
    },
    [getActiveHandler],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const handler = activeDrawHandlerRef.current;
      const { camera, activeTool } = useCanvasStore.getState();
      const world = screenToWorld(e.offsetX, e.offsetY, camera);

      if (handler) {
        handler.onPointerMove(world.x, world.y, e);
      } else if (activeTool === 'arrow') {
        // Forward hover moves for snap preview even when not drawing
        const tool = toolHandlers[activeTool];
        if (tool) {
          tool.onPointerMove(world.x, world.y, e);
        }
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const handler = activeDrawHandlerRef.current;
      if (!handler) return;

      const { camera } = useCanvasStore.getState();
      const world = screenToWorld(e.offsetX, e.offsetY, camera);

      handler.onPointerUp(world.x, world.y, e);
      activeDrawHandlerRef.current = null;

      // Release pointer capture
      const target = e.currentTarget as Element;
      target.releasePointerCapture(e.pointerId);
    },
    [],
  );

  // ── Cancel draw function (exposed for useKeyboardShortcuts) ──

  const cancelDraw = useCallback(() => {
    // Cancel any active draw operation
    const handler = activeDrawHandlerRef.current;
    if (handler) {
      handler.onCancel();
      activeDrawHandlerRef.current = null;
    }

    // Also cancel text input if waiting
    textTool.onCancel();
  }, [textTool]);

  // ── Effect: attach/detach event listeners ──────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasRef, handlePointerDown, handlePointerMove, handlePointerUp]);

  // ── Public API ─────────────────────────────────────────────

  const getDrawPreview = useCallback((): DrawPreview | null => {
    // Check the actively-dragging handler first
    const handler = activeDrawHandlerRef.current;
    if (handler) {
      return handler.getPreview();
    }

    // Fallback: check current active tool handler
    const activeHandler = getActiveHandler();
    return activeHandler?.getPreview() ?? null;
  }, [getActiveHandler]);

  return { getDrawPreview, textTool, cancelDraw };
}
