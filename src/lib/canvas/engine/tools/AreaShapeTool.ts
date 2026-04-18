/**
 * Shared helper for area-based drawing tools (rectangle, ellipse, diamond).
 *
 * Implements the common pattern: click+drag → dashed preview →
 * on release if area > 10×10, create expression.
 *
 * @module
 */

import { nanoid } from 'nanoid';
import type { VisualExpression, ExpressionData } from '../../protocol';
import type { ToolHandler, DrawPreview } from './BaseTool';
import type { CanvasStoreApi } from '../store/canvasStore';

/** Minimum dimension (width or height) to create a shape. */
const MIN_DIMENSION = 10;

/** Human author for locally-drawn expressions. */
const LOCAL_AUTHOR = {
  type: 'human' as const,
  id: 'local-user',
  name: 'You',
};

/** Shape kind for area-based tools. */
export type AreaShapeKind = 'rectangle' | 'ellipse' | 'diamond';

/**
 * Base class for area-based drawing tools.
 *
 * Handles the common drag-to-create pattern with preview rendering.
 * Subclasses only need to specify the shape kind.
 */
export class AreaShapeTool implements ToolHandler {
  private readonly shapeKind: AreaShapeKind;
  private readonly store: CanvasStoreApi;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  /** When true, constrain to equal width/height (square/circle). */
  private constrain = false;

  constructor(kind: AreaShapeKind, store: CanvasStoreApi) {
    this.shapeKind = kind;
    this.store = store;
  }

  onPointerDown(worldX: number, worldY: number, _event: PointerEvent): void {
    this.isDrawing = true;
    this.startX = worldX;
    this.startY = worldY;
    this.currentX = worldX;
    this.currentY = worldY;
  }

  onPointerMove(worldX: number, worldY: number, event: PointerEvent): void {
    if (!this.isDrawing) return;
    this.currentX = worldX;
    this.currentY = worldY;
    this.constrain = event.ctrlKey || event.metaKey;
  }

  onPointerUp(worldX: number, worldY: number, event: PointerEvent): void {
    if (!this.isDrawing) {
      return;
    }

    this.currentX = worldX;
    this.currentY = worldY;
    this.constrain = event.ctrlKey || event.metaKey;
    this.isDrawing = false;

    const { x, y, width, height } = this.computeBounds();

    // Only create if dimensions exceed minimum threshold
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      this.reset();
      return;
    }

    const now = Date.now();
    const id = nanoid();

    const data: ExpressionData = { kind: this.shapeKind };

    const state = this.store.getState();
    const style = { ...state.lastUsedStyle };

    const expression: VisualExpression = {
      id,
      kind: this.shapeKind,
      position: { x, y },
      size: { width, height },
      angle: 0,
      style,
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data,
    };

    state.addExpression(expression);
    state.setSelectedIds(new Set([id]));

    this.reset();
  }

  onCancel(): void {
    this.isDrawing = false;
    this.reset();
  }

  getPreview(): DrawPreview | null {
    if (!this.isDrawing) return null;

    // Don't show preview until pointer has moved from start
    if (this.currentX === this.startX && this.currentY === this.startY) {
      return null;
    }

    const { x, y, width, height } = this.computeBounds();
    return { kind: this.shapeKind, x, y, width, height };
  }

  /** Compute normalized bounds (handles negative drag and Ctrl-constrain). */
  private computeBounds() {
    let width = Math.abs(this.currentX - this.startX);
    let height = Math.abs(this.currentY - this.startY);

    // Ctrl/Cmd constrains to equal dimensions (square/circle/equilateral)
    if (this.constrain) {
      const side = Math.max(width, height);
      width = side;
      height = side;
    }

    const x = Math.min(this.startX, this.currentX);
    const y = Math.min(this.startY, this.currentY);
    return { x, y, width, height };
  }

  /** Reset internal state. */
  private reset(): void {
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.constrain = false;
  }
}
