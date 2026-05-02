/**
 * Page/paper boundary renderer — visible page edges with auto-expansion.
 *
 * Renders a grid of paper-like pages on a "desk" background.
 * Pages auto-expand as expressions extend beyond current boundaries,
 * providing spatial orientation and print-output mapping.
 *
 * Only pages visible in the current viewport are rendered (culled).
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";
import type { Camera } from "../types/index";
import { getWorldViewport } from "./viewportCulling";

// ── Standard page sizes (at 96 DPI) ─────────────────────────

/** Standard page size presets in pixels at 96 DPI. */
export const PAGE_SIZES: Record<
  string,
  { width: number; height: number } | null
> = {
  A4: { width: 1122, height: 794 },
  "A4-portrait": { width: 794, height: 1122 },
  Letter: { width: 1100, height: 850 },
  "Letter-portrait": { width: 850, height: 1100 },
  A3: { width: 1587, height: 1122 },
  Custom: null,
};

// ── Visual constants ─────────────────────────────────────────

/** Desk background color — slightly darker than page. */
const DESK_COLOR = "#E8E8E8";

/** Page fill color — white paper. */
const PAGE_COLOR = "#FFFFFF";

/** Page border color — subtle gray. */
const PAGE_BORDER_COLOR = "#D0D0D0";

/** Page border width in world units. */
const PAGE_BORDER_WIDTH = 1;

/** Shadow blur radius in world units. */
const SHADOW_BLUR = 4;

/** Shadow offset in world units. */
const SHADOW_OFFSET = 2;

/** Shadow color. */
const SHADOW_COLOR = "rgba(0, 0, 0, 0.15)";

/** Maximum pages to render per frame to prevent performance collapse. */
const MAX_VISIBLE_PAGES = 200;

// ── Page grid computation ────────────────────────────────────

/** Result of page grid computation — which page cells are needed. */
export interface PageGrid {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

/**
 * Compute the page grid needed to cover all expressions.
 *
 * Determines the bounding box of all expressions, then snaps it
 * outward to page-size boundaries. Returns the column and row
 * range of pages needed.
 *
 * When no expressions exist, returns a single page at origin (0, 0).
 * Always includes the origin page (0, 0) in the grid.
 * Returns a single origin page if pageSize dimensions are non-positive.
 */
export function computePageGrid(
  expressions: Record<string, VisualExpression>,
  pageSize: { width: number; height: number },
): PageGrid {
  // Guard against invalid page dimensions (division by zero)
  if (pageSize.width <= 0 || pageSize.height <= 0) {
    return { startCol: 0, startRow: 0, endCol: 0, endRow: 0 };
  }

  // Calculate bounding box of all expressions
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasExpressions = false;

  for (const id in expressions) {
    const expr = expressions[id]!;
    // Skip zero-size expressions — they have no spatial extent
    if (expr.size.width <= 0 || expr.size.height <= 0) continue;
    hasExpressions = true;
    minX = Math.min(minX, expr.position.x);
    minY = Math.min(minY, expr.position.y);
    maxX = Math.max(maxX, expr.position.x + expr.size.width);
    maxY = Math.max(maxY, expr.position.y + expr.size.height);
  }

  if (!hasExpressions) {
    return { startCol: 0, startRow: 0, endCol: 0, endRow: 0 };
  }

  // Snap outward to page boundaries
  const startCol = Math.floor(minX / pageSize.width);
  const startRow = Math.floor(minY / pageSize.height);
  const endCol = Math.floor((maxX - 1) / pageSize.width);
  const endRow = Math.floor((maxY - 1) / pageSize.height);

  // Ensure origin page is always included
  return {
    startCol: Math.min(startCol, 0),
    startRow: Math.min(startRow, 0),
    endCol: Math.max(endCol, 0),
    endRow: Math.max(endRow, 0),
  };
}

// ── Page rendering ───────────────────────────────────────────

/**
 * Render paper/page boundaries on the canvas.
 *
 * Fills the visible area with a "desk" background color, then draws
 * white page rectangles with drop shadows and borders. Pages form
 * a grid pattern and auto-expand to cover all expressions.
 *
 * Only pages visible in the current viewport are drawn (viewport culling).
 *
 * Must be called in world coordinates (after camera transform is applied).
 */
export function renderPages(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  pageSize: { width: number; height: number },
  expressions: Record<string, VisualExpression>,
): void {
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const viewport = getWorldViewport(camera, canvasWidth, canvasHeight);
  const grid = computePageGrid(expressions, pageSize);

  // 1. Fill visible area with desk background
  ctx.save();
  ctx.fillStyle = DESK_COLOR;
  ctx.fillRect(
    viewport.left,
    viewport.top,
    viewport.right - viewport.left,
    viewport.bottom - viewport.top,
  );

  // 2. Render visible pages
  let visibleCount = 0;

  for (let col = grid.startCol; col <= grid.endCol; col++) {
    for (let row = grid.startRow; row <= grid.endRow; row++) {
      const pageX = col * pageSize.width;
      const pageY = row * pageSize.height;

      // Viewport culling — skip pages not visible
      if (
        pageX + pageSize.width < viewport.left ||
        pageX > viewport.right ||
        pageY + pageSize.height < viewport.top ||
        pageY > viewport.bottom
      ) {
        continue;
      }

      // Guard: limit visible pages for performance
      if (++visibleCount > MAX_VISIBLE_PAGES) break;

      // Draw shadow
      ctx.save();
      ctx.shadowColor = SHADOW_COLOR;
      ctx.shadowBlur = SHADOW_BLUR / camera.zoom;
      ctx.shadowOffsetX = SHADOW_OFFSET / camera.zoom;
      ctx.shadowOffsetY = SHADOW_OFFSET / camera.zoom;
      ctx.fillStyle = PAGE_COLOR;
      ctx.fillRect(pageX, pageY, pageSize.width, pageSize.height);
      ctx.restore();

      // Draw border (on top, no shadow)
      ctx.strokeStyle = PAGE_BORDER_COLOR;
      ctx.lineWidth = PAGE_BORDER_WIDTH / camera.zoom;
      ctx.strokeRect(pageX, pageY, pageSize.width, pageSize.height);
    }
    if (visibleCount > MAX_VISIBLE_PAGES) break;
  }

  ctx.restore();
}
