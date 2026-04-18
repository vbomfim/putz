/**
 * Freehand drawing tool.
 *
 * Captures [x, y, pressure] points on pointermove → creates freehand
 * expression. Minimum 2 points required. Stays in freehand mode after
 * creation (no auto-switch to Select).
 *
 * @module
 */

import { nanoid } from 'nanoid';
import type { VisualExpression } from '../../protocol';
import type { ToolHandler, DrawPreview } from './BaseTool';
import type { CanvasStoreApi } from '../store/canvasStore';

/** Minimum number of points to create a freehand stroke. */
const MIN_POINTS = 2;

/** Human author for locally-drawn expressions. */
const LOCAL_AUTHOR = {
  type: 'human' as const,
  id: 'local-user',
  name: 'You',
};

/** Tool handler for freehand/pen drawing on the canvas. */
export class FreehandTool implements ToolHandler {
  private readonly store: CanvasStoreApi;
  private isDrawing = false;
  private points: [number, number, number][] = [];

  constructor(store: CanvasStoreApi) {
    this.store = store;
  }

  onPointerDown(worldX: number, worldY: number, event: PointerEvent): void {
    this.isDrawing = true;
    this.points = [[worldX, worldY, event.pressure ?? 0.5]];
  }

  onPointerMove(worldX: number, worldY: number, event: PointerEvent): void {
    if (!this.isDrawing) return;
    this.points.push([worldX, worldY, event.pressure ?? 0.5]);
  }

  onPointerUp(worldX: number, worldY: number, event: PointerEvent): void {
    if (!this.isDrawing) return;

    this.points.push([worldX, worldY, event.pressure ?? 0.5]);
    this.isDrawing = false;

    if (this.points.length < MIN_POINTS) {
      this.reset();
      return;
    }

    const { position, size } = computeBoundingBox(this.points);
    const now = Date.now();
    const id = nanoid();

    const expression: VisualExpression = {
      id,
      kind: 'freehand',
      position,
      size,
      angle: 0,
      style: (() => {
        const s = this.store.getState();
        return { ...s.lastUsedStyle };
      })(),
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data: { kind: 'freehand', points: [...this.points] },
    };

    const store = this.store.getState();
    store.addExpression(expression);
    store.setSelectedIds(new Set([id]));
    // Freehand stays in freehand mode — do NOT switch to select

    this.reset();
  }

  onCancel(): void {
    this.isDrawing = false;
    this.reset();
  }

  getPreview(): DrawPreview | null {
    if (!this.isDrawing || this.points.length < 2) return null;

    const { position, size } = computeBoundingBox(this.points);
    const points2D: [number, number][] = this.points.map(([x, y]) => [x, y]);

    return {
      kind: 'freehand',
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      points: points2D,
    };
  }

  private reset(): void {
    this.points = [];
  }
}

/** Compute axis-aligned bounding box from 3-element point arrays. */
function computeBoundingBox(points: [number, number, number][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  return {
    position: { x: minX, y: minY },
    size: { width: maxX - minX, height: maxY - minY },
  };
}
