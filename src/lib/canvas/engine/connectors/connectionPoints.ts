/**
 * Connection point computation for shapes.
 *
 * Computes 8 connection points (4 edges + 4 corners) for any bindable shape.
 * Points are derived from shape bounds — never stored. Used for hover UI,
 * snap detection, and connector endpoints.
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";
import { BINDABLE_KINDS } from "./constants";

/** Named position of a connection point on a shape. */
export type ShapeConnectionPointPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** A computed connection point on a shape in world coordinates. */
export interface ShapeConnectionPoint {
  /** Named position on the shape. */
  position: ShapeConnectionPointPosition;
  /** World X coordinate. */
  x: number;
  /** World Y coordinate. */
  y: number;
}

/**
 * Compute all 8 connection points for a shape expression.
 *
 * Returns 4 edge midpoints + 4 corner points. The coordinates are
 * shape-specific: rectangles use box corners, ellipses use parametric
 * angles, diamonds use edge midpoints for corners.
 *
 * Returns an empty array for non-bindable kinds (arrow, line, etc.).
 * [CLEAN-CODE] [SRP]
 */
export function getConnectionPoints(
  expr: VisualExpression,
): ShapeConnectionPoint[] {
  if (!BINDABLE_KINDS.has(expr.kind)) return [];

  const { x, y } = expr.position;
  const { width, height } = expr.size;

  if (expr.kind === "ellipse") {
    return computeEllipseConnectionPoints(x, y, width, height);
  }

  if (expr.kind === "diamond") {
    return computeDiamondConnectionPoints(x, y, width, height);
  }

  // Rectangle, sticky-note, stencil — all use box geometry
  return computeRectangleConnectionPoints(x, y, width, height);
}

/**
 * Find the nearest connection point within snap distance.
 *
 * Computes all 8 connection points for the expression, then returns
 * the one closest to (worldX, worldY) if within snapDistance.
 * Returns null if none is close enough or the expression is not bindable.
 * [CLEAN-CODE] [SRP]
 */
export function findNearestConnectionPoint(
  worldX: number,
  worldY: number,
  expr: VisualExpression,
  snapDistance: number,
): ShapeConnectionPoint | null {
  if (snapDistance <= 0) return null;

  const points = getConnectionPoints(expr);
  if (points.length === 0) return null;

  let closest: ShapeConnectionPoint | null = null;
  let closestDist = Infinity;

  for (const pt of points) {
    const dist = Math.hypot(worldX - pt.x, worldY - pt.y);
    if (dist <= snapDistance && dist < closestDist) {
      closest = pt;
      closestDist = dist;
    }
  }

  return closest;
}

// ── Shape-specific point computation ─────────────────────────

/** Compute connection points for rectangle-like shapes (rectangle, sticky-note, stencil). */
function computeRectangleConnectionPoints(
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeConnectionPoint[] {
  const cx = x + width / 2;
  const cy = y + height / 2;

  return [
    // Edge midpoints
    { position: "top", x: cx, y },
    { position: "right", x: x + width, y: cy },
    { position: "bottom", x: cx, y: y + height },
    { position: "left", x, y: cy },
    // Corners
    { position: "top-left", x, y },
    { position: "top-right", x: x + width, y },
    { position: "bottom-left", x, y: y + height },
    { position: "bottom-right", x: x + width, y: y + height },
  ];
}

/** Compute connection points for ellipse shapes using parametric angles. */
function computeEllipseConnectionPoints(
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeConnectionPoint[] {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const cos45 = Math.cos(Math.PI / 4);
  const sin45 = Math.sin(Math.PI / 4);

  return [
    // Cardinal points (0°, 90°, 180°, 270°)
    { position: "top", x: cx, y: cy - ry },
    { position: "right", x: cx + rx, y: cy },
    { position: "bottom", x: cx, y: cy + ry },
    { position: "left", x: cx - rx, y: cy },
    // Diagonal points (45°, 135°, 225°, 315°)
    { position: "top-right", x: cx + rx * cos45, y: cy - ry * sin45 },
    { position: "top-left", x: cx - rx * cos45, y: cy - ry * sin45 },
    { position: "bottom-right", x: cx + rx * cos45, y: cy + ry * sin45 },
    { position: "bottom-left", x: cx - rx * cos45, y: cy + ry * sin45 },
  ];
}

/**
 * Compute connection points for diamond shapes.
 *
 * Edge midpoints are at the diamond's vertices.
 * Corner points are at the midpoints of the diamond's edges (between vertices).
 */
function computeDiamondConnectionPoints(
  x: number,
  y: number,
  width: number,
  height: number,
): ShapeConnectionPoint[] {
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Diamond vertices
  const top = { x: cx, y };
  const right = { x: x + width, y: cy };
  const bottom = { x: cx, y: y + height };
  const left = { x, y: cy };

  return [
    // Vertices as edge connection points
    { position: "top", x: top.x, y: top.y },
    { position: "right", x: right.x, y: right.y },
    { position: "bottom", x: bottom.x, y: bottom.y },
    { position: "left", x: left.x, y: left.y },
    // Edge midpoints as corner connection points
    {
      position: "top-right",
      x: (top.x + right.x) / 2,
      y: (top.y + right.y) / 2,
    },
    { position: "top-left", x: (top.x + left.x) / 2, y: (top.y + left.y) / 2 },
    {
      position: "bottom-right",
      x: (bottom.x + right.x) / 2,
      y: (bottom.y + right.y) / 2,
    },
    {
      position: "bottom-left",
      x: (bottom.x + left.x) / 2,
      y: (bottom.y + left.y) / 2,
    },
  ];
}
