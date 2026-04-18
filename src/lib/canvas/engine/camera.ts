/**
 * Camera math — pure coordinate-transform functions.
 *
 * All functions are side-effect free. The camera model uses:
 *   screen = (world - camera) × zoom
 *   world  = screen / zoom + camera
 *
 * Transform matrix (applied via setTransform):
 *   [zoom, 0, 0, zoom, -camera.x × zoom, -camera.y × zoom]
 *
 * @module
 */

import type { VisualExpression } from '../protocol';
import type { Camera } from './types/index';

/** User-facing zoom bounds for zoom controls. */
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 1000;

/** Zoom increment per button press (20%). */
export const ZOOM_STEP = 0.2;

/** Padding fraction for fit-to-content (10% total = 5% each side). */
const FIT_PADDING = 0.1;

/**
 * Convert screen (pixel) coordinates to world coordinates.
 *
 * Inverse of {@link worldToScreen}. [AC4]
 */
export function screenToWorld(
  sx: number,
  sy: number,
  camera: Camera,
): { x: number; y: number } {
  return {
    x: sx / camera.zoom + camera.x,
    y: sy / camera.zoom + camera.y,
  };
}

/**
 * Convert world coordinates to screen (pixel) coordinates.
 *
 * Inverse of {@link screenToWorld}. [AC4]
 */
export function worldToScreen(
  wx: number,
  wy: number,
  camera: Camera,
): { x: number; y: number } {
  return {
    x: (wx - camera.x) * camera.zoom,
    y: (wy - camera.y) * camera.zoom,
  };
}

/**
 * Apply camera transform to a canvas 2D context.
 *
 * After this call, all drawing operations use world coordinates. [AC5]
 */
export function applyTransform(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  dpr: number = 1,
): void {
  // Combine DPR scaling with camera transform so rendering is crisp
  // and coordinates map correctly on HiDPI displays
  const scale = camera.zoom * dpr;
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    -camera.x * scale || 0,
    -camera.y * scale || 0,
  );
}

/**
 * Calculate new camera after zooming at a specific screen point.
 *
 * The world point under the cursor stays fixed after the zoom. [AC3]
 * Algorithm: compute the world point under the cursor, then solve for
 * the new camera offset so that same world point maps back to the
 * same screen position at the new zoom level.
 */
export function zoomAtPoint(
  camera: Camera,
  screenX: number,
  screenY: number,
  newZoom: number,
): Camera {
  // World point under cursor before zoom
  const worldPoint = screenToWorld(screenX, screenY, camera);

  // New camera offset: world = screen / newZoom + newCamera
  // → newCamera = world - screen / newZoom
  return {
    x: worldPoint.x - screenX / newZoom,
    y: worldPoint.y - screenY / newZoom,
    zoom: newZoom,
  };
}

/**
 * Clamp a zoom value within [MIN_ZOOM, MAX_ZOOM]. [CLEAN-CODE]
 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Compute camera to fit all expressions in the viewport.
 *
 * Centers the bounding box of all expressions and calculates
 * zoom to fit with 10% padding. Returns origin at 100% zoom
 * for empty canvas. [CLEAN-CODE]
 *
 * @param expressions - All expressions on the canvas
 * @param expressionOrder - Z-ordered expression IDs
 * @param viewportWidth - Viewport width in screen pixels
 * @param viewportHeight - Viewport height in screen pixels
 */
export function computeFitToContent(
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  // Empty canvas → origin at 100%
  if (expressionOrder.length === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  // Compute bounding box of all expressions
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

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
    count++;
  }

  // All IDs were missing from expressions → treat as empty
  if (count === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Guard against zero-dimension expressions (point-like)
  if (contentWidth === 0 || contentHeight === 0) {
    return {
      x: centerX - viewportWidth / 2,
      y: centerY - viewportHeight / 2,
      zoom: 1,
    };
  }

  // Effective viewport with padding
  const effectiveWidth = viewportWidth * (1 - FIT_PADDING);
  const effectiveHeight = viewportHeight * (1 - FIT_PADDING);

  // Calculate zoom to fit content
  const zoomX = effectiveWidth / contentWidth;
  const zoomY = effectiveHeight / contentHeight;
  const zoom = clampZoom(Math.min(zoomX, zoomY));

  // Camera offset so center maps to viewport center
  // screen_center = (center - camera) * zoom → camera = center - screen_center / zoom
  return {
    x: centerX - (viewportWidth / 2) / zoom,
    y: centerY - (viewportHeight / 2) / zoom,
    zoom,
  };
}
