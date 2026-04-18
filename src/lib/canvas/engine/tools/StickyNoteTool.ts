/**
 * Sticky note drawing tool.
 *
 * Click+drag → preview → on release creates a sticky-note expression
 * with a pastel background color and placeholder text.
 *
 * @module
 */

import { nanoid } from 'nanoid';
import type { VisualExpression, ExpressionData } from '../../protocol';
import type { ToolHandler, DrawPreview } from './BaseTool';
import { useCanvasStore } from '../store/canvasStore';

const MIN_DIMENSION = 10;

const LOCAL_AUTHOR = {
  type: 'human' as const,
  id: 'local-user',
  name: 'You',
};

/** Pastel colors that cycle for new sticky notes. */
const STICKY_COLORS = [
  '#FFE082', // yellow
  '#F8BBD0', // pink
  '#C8E6C9', // green
  '#BBDEFB', // blue
  '#E1BEE7', // purple
  '#FFE0B2', // orange
];

let colorIndex = 0;

function nextColor(): string {
  const color = STICKY_COLORS[colorIndex % STICKY_COLORS.length]!;
  colorIndex++;
  return color;
}

/**
 * Tool handler for drawing sticky notes on the canvas.
 */
export class StickyNoteTool implements ToolHandler {
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  onPointerDown(worldX: number, worldY: number): void {
    this.isDrawing = true;
    this.startX = worldX;
    this.startY = worldY;
    this.currentX = worldX;
    this.currentY = worldY;
  }

  onPointerMove(worldX: number, worldY: number): void {
    if (!this.isDrawing) return;
    this.currentX = worldX;
    this.currentY = worldY;
  }

  onPointerUp(worldX: number, worldY: number): void {
    if (!this.isDrawing) return;

    this.currentX = worldX;
    this.currentY = worldY;
    this.isDrawing = false;

    const { x, y, width, height } = this.computeBounds();

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      this.reset();
      return;
    }

    const now = Date.now();
    const id = nanoid();
    const color = nextColor();

    const data: ExpressionData = {
      kind: 'sticky-note',
      text: '',
      color,
    };

    const store = useCanvasStore.getState();

    const expression: VisualExpression = {
      id,
      kind: 'sticky-note',
      position: { x, y },
      size: { width, height },
      angle: 0,
      style: {
        ...store.lastUsedStyle,
        fontFamily: 'Architects Daughter, cursive',
      },
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data,
    };

    store.addExpression(expression);
    store.setSelectedIds(new Set([id]));

    this.reset();
  }

  onCancel(): void {
    this.isDrawing = false;
    this.reset();
  }

  getPreview(): DrawPreview | null {
    if (!this.isDrawing) return null;
    if (this.currentX === this.startX && this.currentY === this.startY) {
      return null;
    }
    const { x, y, width, height } = this.computeBounds();
    return { kind: 'sticky-note', x, y, width, height };
  }

  private computeBounds() {
    const x = Math.min(this.startX, this.currentX);
    const y = Math.min(this.startY, this.currentY);
    const width = Math.abs(this.currentX - this.startX);
    const height = Math.abs(this.currentY - this.startY);
    return { x, y, width, height };
  }

  private reset(): void {
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
  }
}
