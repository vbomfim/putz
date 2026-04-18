/**
 * Export canvas to PNG via offscreen canvas rendering.
 *
 * Calculates bounding box of all expressions, creates an offscreen
 * canvas with padding, and triggers a browser download. [CLEAN-CODE]
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import type { Theme } from '../store/uiStore';

/** Padding around exported image in pixels. */
export const EXPORT_PADDING = 20;

/** Background colors per theme. */
const BACKGROUND_COLORS: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#1e1e1e',
};

/** Bounding box for export calculation. */
export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the bounding box that encompasses all expressions.
 *
 * Returns null if there are no expressions to export.
 */
export function computeExportBounds(
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
): ExportBounds | null {
  if (expressionOrder.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of expressionOrder) {
    const expr = expressions[id];
    if (!expr) continue;

    const left = expr.position.x;
    const top = expr.position.y;
    const right = expr.position.x + expr.size.width;
    const bottom = expr.position.y + expr.size.height;

    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  if (!Number.isFinite(minX)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Trigger a browser file download from a Blob.
 *
 * Creates a temporary anchor element and clicks it to trigger download.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export all canvas expressions to PNG and trigger download.
 *
 * Renders expressions to an offscreen canvas (no grid), adds padding,
 * and downloads as `infinicanvas-export.png`.
 *
 * @param expressions - All expressions keyed by ID
 * @param expressionOrder - Z-order of expression IDs
 * @param theme - Current theme (affects background color)
 * @param renderCallback - Function that renders expressions to a canvas context
 */
export async function exportToPng(
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
  theme: Theme,
  renderCallback: (
    ctx: CanvasRenderingContext2D,
    expressions: Record<string, VisualExpression>,
    expressionOrder: string[],
    offsetX: number,
    offsetY: number,
  ) => void,
): Promise<void> {
  const bounds = computeExportBounds(expressions, expressionOrder);
  if (!bounds) return;

  const canvasWidth = bounds.width + EXPORT_PADDING * 2;
  const canvasHeight = bounds.height + EXPORT_PADDING * 2;

  const offscreen = document.createElement('canvas');
  offscreen.width = canvasWidth;
  offscreen.height = canvasHeight;

  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  // Fill background
  ctx.fillStyle = BACKGROUND_COLORS[theme];
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Translate so expressions start at padding offset
  const offsetX = -bounds.x + EXPORT_PADDING;
  const offsetY = -bounds.y + EXPORT_PADDING;
  ctx.translate(offsetX, offsetY);

  // Render expressions via callback
  renderCallback(ctx, expressions, expressionOrder, offsetX, offsetY);

  // Convert to blob and download
  return new Promise<void>((resolve) => {
    offscreen.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, 'infinicanvas-export.png');
      }
      resolve();
    }, 'image/png');
  });
}
