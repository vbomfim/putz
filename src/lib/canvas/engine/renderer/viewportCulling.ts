/**
 * Viewport culling — skip rendering off-screen expressions.
 *
 * Computes the visible world area from the camera and viewport dimensions,
 * then checks if an expression's bounding box intersects it. Expressions
 * fully outside the viewport are skipped to save draw calls.
 *
 * @module
 */

import type { Camera } from '../types/index';

/** Axis-aligned bounding box in world coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World-coordinate viewport bounds. */
export interface WorldViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Calculate visible world-coordinate bounds from camera and viewport size. [AC12]
 *
 * The camera's (x, y) represents the top-left corner of the visible world area.
 * Viewport dimensions are in screen pixels, divided by zoom to get world extent.
 */
export function getWorldViewport(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): WorldViewport {
  return {
    left: camera.x,
    top: camera.y,
    right: camera.x + viewportWidth / camera.zoom,
    bottom: camera.y + viewportHeight / camera.zoom,
  };
}

/**
 * Check whether a bounding box intersects the visible viewport. [AC12]
 *
 * Uses AABB intersection: two rectangles overlap if and only if
 * they overlap on both the X and Y axes.
 *
 * Zero-size bounding boxes are never visible.
 */
export function isVisible(
  bbox: BoundingBox,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (bbox.width <= 0 || bbox.height <= 0) return false;

  const viewport = getWorldViewport(camera, viewportWidth, viewportHeight);

  const bboxRight = bbox.x + bbox.width;
  const bboxBottom = bbox.y + bbox.height;

  return (
    bboxRight > viewport.left &&
    bbox.x < viewport.right &&
    bboxBottom > viewport.top &&
    bbox.y < viewport.bottom
  );
}
