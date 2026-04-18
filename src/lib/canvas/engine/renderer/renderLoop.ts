/**
 * requestAnimationFrame-based render loop.
 *
 * Each frame: clear canvas → apply camera transform → render pages →
 * render grid → render primitives in z-order.
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import { DEFAULT_LAYER_ID } from '../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import type { Camera, GridType } from '../types/index';
import type { DrawPreview } from '../tools/BaseTool';
import { applyTransform } from '../camera';
import { renderGrid } from './gridRenderer';
import { renderPages } from './pageRenderer';
import { renderExpressions } from './primitiveRenderer';
import { renderSelection } from './selectionRenderer';
import { renderDrawPreview } from './drawPreviewRenderer';
import * as dragSnapState from '../hooks/useManipulationInteraction';

/** Marquee overlay visual styles (matches useSelectionInteraction constants). */
const MARQUEE_STROKE_COLOR = '#4A90D9';
const MARQUEE_FILL_COLOR = 'rgba(74, 144, 217, 0.1)';
const MARQUEE_DASH_PATTERN: readonly number[] = [6, 3];

export interface RenderLoop {
  start(): void;
  stop(): void;
  updateSize(width: number, height: number): void;
  captureAfterPaint(callback: () => void): void;
}

/** Callback that returns the current expression state for rendering. */
export interface ExpressionProvider {
  /** All expressions on the canvas, keyed by ID. */
  getExpressions(): Record<string, VisualExpression>;
  /** Ordered list of expression IDs representing z-order (back to front). */
  getExpressionOrder(): string[];
}

/** Callback that returns the current selection state for rendering. */
export interface SelectionProvider {
  /** Set of currently selected expression IDs. */
  getSelectedIds(): Set<string>;
}

/** Callback that returns layer visibility and ordering info for rendering. */
export interface LayerProvider {
  /** Set of layer IDs whose expressions should be rendered. */
  getVisibleLayerIds(): Set<string>;
  /** Get expression order sorted by layer order, then by position in expressionOrder. */
  getLayerSortedOrder(expressionOrder: string[], expressions: Record<string, VisualExpression>): string[];
}

/** Callback that returns the current draw preview for rendering. */
export interface DrawPreviewProvider {
  /** Current draw preview from the active tool, or null. */
  getDrawPreview(): DrawPreview | null;
}

/** Callback that returns the current marquee rectangle for rendering. */
export interface MarqueeProvider {
  /** Screen-space marquee rectangle during drag, or null when idle. */
  getMarquee(): { x: number; y: number; width: number; height: number } | null;
}

/** Callback that returns the ID of the expression currently being inline-edited. */
export interface EditingProvider {
  /** ID of the expression being edited, or null. */
  getEditingId(): string | null;
}

/** Callback that returns the current grid display settings. */
export interface GridProvider {
  /** Whether the background grid should be rendered. */
  getGridVisible(): boolean;
  /** Grid display type — dots or lines. */
  getGridType(): GridType;
  /** Grid spacing in world units. */
  getGridSize(): number;
}

/** Callback that returns the current page/paper boundary settings. */
export interface PageProvider {
  /** Whether page boundaries should be rendered. */
  getPageVisible(): boolean;
  /** Page dimensions in world units. */
  getPageSize(): { width: number; height: number };
}

/**
 * Create a render loop bound to a canvas context.
 *
 * Uses requestAnimationFrame for smooth 60fps rendering. [AC8]
 * The `getCamera` callback is called each frame to get the latest
 * camera state — this avoids stale closures and ensures synchronous
 * camera updates are reflected immediately.
 *
 * The optional `roughCanvas` and `expressionProvider` enable primitive
 * rendering. When provided, expressions are rendered in z-order after
 * the grid, with viewport culling applied.
 */
export function createRenderLoop(
  ctx: CanvasRenderingContext2D,
  getCamera: () => Camera,
  initialWidth: number,
  initialHeight: number,
  roughCanvas?: RoughCanvas,
  expressionProvider?: ExpressionProvider,
  selectionProvider?: SelectionProvider,
  drawPreviewProvider?: DrawPreviewProvider,
  dpr: number = 1,
  marqueeProvider?: MarqueeProvider,
  editingProvider?: EditingProvider,
  gridProvider?: GridProvider,
  pageProvider?: PageProvider,
  layerProvider?: LayerProvider,
): RenderLoop {
  let width = initialWidth;
  let height = initialHeight;
  let frameId: number | null = null;
  let running = false;

  function renderFrame() {
    if (!running) return;

    const camera = getCamera();

    // 1. Clear canvas — use DPR-scaled identity for full clear
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 2. Apply camera transform (includes DPR scaling)
    applyTransform(ctx, camera, dpr);

    // 2.5 Render page/paper boundaries (desk bg + page rects, before grid)
    if (pageProvider?.getPageVisible()) {
      const pageSize = pageProvider.getPageSize();
      const exprs = expressionProvider
        ? expressionProvider.getExpressions()
        : {};
      renderPages(ctx, camera, width, height, pageSize, exprs);
    }

    // 3. Render grid (in world coordinates)
    if (!gridProvider || gridProvider.getGridVisible()) {
      const gridType = gridProvider?.getGridType() ?? 'dot';
      const gridSize = gridProvider?.getGridSize() ?? 20;
      renderGrid(ctx, camera, width, height, gridType, gridSize);
    }

    // 4. Render expressions in z-order [AC1], filtered by visible layers [#109]
    if (roughCanvas && expressionProvider) {
      const expressions = expressionProvider.getExpressions();
      let order = expressionProvider.getExpressionOrder();

      // Apply layer sorting and visibility filtering
      if (layerProvider) {
        order = layerProvider.getLayerSortedOrder(order, expressions);
        const visibleLayerIds = layerProvider.getVisibleLayerIds();
        order = order.filter((id) => {
          const expr = expressions[id];
          if (!expr) return false;
          const layerId = expr.layerId ?? DEFAULT_LAYER_ID;
          return visibleLayerIds.has(layerId);
        });
      }

      renderExpressions(
        ctx,
        roughCanvas,
        expressions,
        order,
        camera,
        width,
        height,
        editingProvider?.getEditingId() ?? null,
      );
    }

    // 5. Render selection UI (bounding boxes + handles)
    if (expressionProvider && selectionProvider) {
      renderSelection(
        ctx,
        selectionProvider.getSelectedIds(),
        expressionProvider.getExpressions(),
        camera,
      );
    }

    // 6. Render draw preview (transient dashed outline during tool drag)
    if (drawPreviewProvider) {
      const preview = drawPreviewProvider.getDrawPreview();
      if (preview) {
        renderDrawPreview(ctx, preview, camera.zoom);
      }
    }

    // 6b. Render drag snap indicator (blue circle during arrow endpoint drag)
    if (dragSnapState.currentDragSnapPoint) {
      const sp = dragSnapState.currentDragSnapPoint;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 10 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#4A90D9';
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();
    }

    // 7. Render marquee overlay (screen-space, after all world-space rendering)
    if (marqueeProvider) {
      const marquee = marqueeProvider.getMarquee();
      if (marquee) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = MARQUEE_FILL_COLOR;
        ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
        ctx.strokeStyle = MARQUEE_STROKE_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash(MARQUEE_DASH_PATTERN as number[]);
        ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
        ctx.setLineDash([]);
      }
    }

    // Screenshot capture — runs after painting, before next frame
    if (screenshotCallback) {
      const cb = screenshotCallback;
      screenshotCallback = null;
      cb();
    }

    // Check for global screenshot request (from gateway connection)
    const globalReq = (window as unknown as Record<string, unknown>).__infinicanvas_screenshot as
      { requestId: string; respond: (img: string, w: number, h: number) => void } | undefined;
    if (globalReq) {
      (window as unknown as Record<string, unknown>).__infinicanvas_screenshot = undefined;
      try {
        const canvasEl = ctx.canvas;
        const imageBase64 = canvasEl.toDataURL('image/png');
        globalReq.respond(imageBase64, canvasEl.width, canvasEl.height);
      } catch {
        globalReq.respond('', 0, 0);
      }
    }

    // Schedule next frame
    frameId = requestAnimationFrame(renderFrame);
  }

  let screenshotCallback: (() => void) | null = null;

  return {
    start() {
      if (running) return;
      running = true;
      frameId = requestAnimationFrame(renderFrame);
    },

    stop() {
      running = false;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },

    updateSize(newWidth: number, newHeight: number) {
      width = newWidth;
      height = newHeight;
    },

    /** Schedule a callback to run right after the next paint (for screenshots). */
    captureAfterPaint(callback: () => void) {
      screenshotCallback = callback;
    },
  };
}
