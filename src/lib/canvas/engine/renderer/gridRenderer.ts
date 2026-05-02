/**
 * Grid background renderer — dot and line grids.
 *
 * Renders a subtle background grid in world coordinates.
 * Supports two modes:
 * - **dot**: small dots at grid intersections (default)
 * - **line**: thin horizontal and vertical lines (graph paper style)
 *
 * Grid spacing adapts to zoom level so the grid never becomes
 * too dense or too sparse.
 *
 * @module
 */

import type { Camera, GridType } from "../types/index";

/** Default base spacing in world units (used when gridSize not provided). */
const DEFAULT_BASE_SPACING = 20;

/**
 * Default dot color — subtle gray. Used as fallback when
 * CSS variable --grid-dot is not available (e.g., in tests).
 */
const DEFAULT_DOT_COLOR = "#e0e0e0";

/**
 * Default line color — subtle gray. Used as fallback when
 * CSS variable --grid-line is not available (e.g., in tests).
 */
const DEFAULT_LINE_COLOR = "#e0e0e0";

/** Dot radius in world units. */
const DOT_RADIUS = 1.5;

/** Line width in world units for line grid. */
const LINE_WIDTH = 0.5;

/**
 * Maximum grid elements before rendering is skipped to prevent
 * performance collapse at very low zoom levels. [CRITICAL]
 */
const MAX_GRID_ELEMENTS = 50_000;

/**
 * Get adaptive grid spacing based on current zoom level. [AC6]
 *
 * Uses the provided gridSize as the base spacing (defaults to 20).
 *
 * - zoom ≥ 0.5  → base spacing
 * - zoom ≥ 0.25 → 2× base
 * - zoom < 0.25 → 4× base
 */
export function getGridSpacing(zoom: number, gridSize?: number): number {
  const base = Math.max(1, gridSize ?? DEFAULT_BASE_SPACING);
  if (zoom < 0.25) return base * 4;
  if (zoom < 0.5) return base * 2;
  return base;
}

/**
 * Resolve the grid dot color from CSS custom property or fallback.
 *
 * Reads --grid-dot from the computed style of the document root.
 * Falls back to DEFAULT_DOT_COLOR if the variable is not set or
 * if running in a non-browser environment (e.g., tests).
 */
function getGridDotColor(): string {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--grid-dot")
      .trim();
    return value || DEFAULT_DOT_COLOR;
  } catch {
    return DEFAULT_DOT_COLOR;
  }
}

/**
 * Resolve the grid line color from CSS custom property or fallback.
 *
 * Reads --grid-line from the computed style of the document root.
 * Falls back to DEFAULT_LINE_COLOR if the variable is not set.
 */
function getGridLineColor(): string {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--grid-line")
      .trim();
    return value || DEFAULT_LINE_COLOR;
  } catch {
    return DEFAULT_LINE_COLOR;
  }
}

/**
 * Calculate visible world bounds and grid boundaries from camera state.
 */
function computeGridBounds(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  spacing: number,
) {
  const worldLeft = camera.x;
  const worldTop = camera.y;
  const worldRight = camera.x + viewportWidth / camera.zoom;
  const worldBottom = camera.y + viewportHeight / camera.zoom;

  return {
    startX: Math.floor(worldLeft / spacing) * spacing,
    startY: Math.floor(worldTop / spacing) * spacing,
    endX: Math.ceil(worldRight / spacing) * spacing,
    endY: Math.ceil(worldBottom / spacing) * spacing,
    worldLeft,
    worldTop,
    worldRight,
    worldBottom,
  };
}

/**
 * Render dot grid within the visible viewport.
 *
 * All dots are batched into a single path for performance.
 * Bails out early if the grid element count exceeds MAX_GRID_ELEMENTS
 * to prevent performance collapse at extreme zoom-out levels.
 */
function renderDotGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  gridSize?: number,
): void {
  const spacing = getGridSpacing(camera.zoom, gridSize);
  const bounds = computeGridBounds(
    camera,
    viewportWidth,
    viewportHeight,
    spacing,
  );

  // Guard: bail out if too many elements would be drawn [CRITICAL]
  const cols = Math.ceil((bounds.endX - bounds.startX) / spacing) + 1;
  const rows = Math.ceil((bounds.endY - bounds.startY) / spacing) + 1;
  if (cols * rows > MAX_GRID_ELEMENTS) return;

  ctx.save();
  ctx.fillStyle = getGridDotColor();

  // Batch all dots into a single path for performance [HIGH]
  ctx.beginPath();
  for (let x = bounds.startX; x <= bounds.endX; x += spacing) {
    for (let y = bounds.startY; y <= bounds.endY; y += spacing) {
      ctx.moveTo(x + DOT_RADIUS, y);
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  ctx.restore();
}

/**
 * Render line grid within the visible viewport.
 *
 * Draws thin horizontal and vertical lines at grid intervals,
 * creating a graph-paper effect. Lines span the full visible area.
 * Bails out early if the element count exceeds MAX_GRID_ELEMENTS.
 */
function renderLineGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  gridSize?: number,
): void {
  const spacing = getGridSpacing(camera.zoom, gridSize);
  const bounds = computeGridBounds(
    camera,
    viewportWidth,
    viewportHeight,
    spacing,
  );

  // Guard: bail out if too many lines would be drawn [CRITICAL]
  const cols = Math.ceil((bounds.endX - bounds.startX) / spacing) + 1;
  const rows = Math.ceil((bounds.endY - bounds.startY) / spacing) + 1;
  if (cols + rows > MAX_GRID_ELEMENTS) return;

  ctx.save();
  ctx.strokeStyle = getGridLineColor();
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();

  // Vertical lines
  for (let x = bounds.startX; x <= bounds.endX; x += spacing) {
    ctx.moveTo(x, bounds.startY);
    ctx.lineTo(x, bounds.endY);
  }

  // Horizontal lines
  for (let y = bounds.startY; y <= bounds.endY; y += spacing) {
    ctx.moveTo(bounds.startX, y);
    ctx.lineTo(bounds.endX, y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Render grid within the visible viewport.
 *
 * Dispatches to dot or line grid renderer based on gridType.
 * Defaults to dot grid when gridType is not specified.
 */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  gridType?: GridType,
  gridSize?: number,
): void {
  if (viewportWidth <= 0 || viewportHeight <= 0) return;

  if (gridType === "line") {
    renderLineGrid(ctx, camera, viewportWidth, viewportHeight, gridSize);
  } else {
    renderDotGrid(ctx, camera, viewportWidth, viewportHeight, gridSize);
  }
}
