/**
 * Connector helper functions for arrow bindings.
 *
 * Pure functions for snap detection, anchor point calculation,
 * and binding resolution. Used by ArrowTool during drawing and
 * by canvasStore when bound shapes move.
 *
 * @module
 */

import type { VisualExpression, ArrowData } from "../../protocol";
import { BINDABLE_KINDS } from "../connectors/constants";

/**
 * Find the nearest connection point on a shape's edge.
 *
 * Returns the closest anchor point and its world position if the
 * given world point is within `snapDistance` of any edge anchor.
 * Returns null if no anchor is close enough or the expression
 * is not a bindable shape. [CLEAN-CODE]
 */
export function findSnapPoint(
  worldPoint: { x: number; y: number },
  targetExpression: VisualExpression,
  snapDistance: number,
): { point: { x: number; y: number }; anchor: string; ratio: number } | null {
  if (snapDistance <= 0) return null;
  if (!BINDABLE_KINDS.has(targetExpression.kind)) return null;

  const { x, y } = targetExpression.position;
  const { width, height } = targetExpression.size;

  // Check if point is within snap range of the shape's bounding box
  const expandedLeft = x - snapDistance;
  const expandedRight = x + width + snapDistance;
  const expandedTop = y - snapDistance;
  const expandedBottom = y + height + snapDistance;

  if (
    worldPoint.x < expandedLeft ||
    worldPoint.x > expandedRight ||
    worldPoint.y < expandedTop ||
    worldPoint.y > expandedBottom
  ) {
    return null; // Too far from shape
  }

  // Project cursor to nearest point on each edge, pick closest
  const edgePoints: Array<{
    anchor: string;
    point: { x: number; y: number };
    ratio: number;
  }> = [
    {
      anchor: "top",
      point: { x: clamp(worldPoint.x, x, x + width), y },
      ratio: width > 0 ? (clamp(worldPoint.x, x, x + width) - x) / width : 0.5,
    },
    {
      anchor: "bottom",
      point: { x: clamp(worldPoint.x, x, x + width), y: y + height },
      ratio: width > 0 ? (clamp(worldPoint.x, x, x + width) - x) / width : 0.5,
    },
    {
      anchor: "left",
      point: { x, y: clamp(worldPoint.y, y, y + height) },
      ratio:
        height > 0 ? (clamp(worldPoint.y, y, y + height) - y) / height : 0.5,
    },
    {
      anchor: "right",
      point: { x: x + width, y: clamp(worldPoint.y, y, y + height) },
      ratio:
        height > 0 ? (clamp(worldPoint.y, y, y + height) - y) / height : 0.5,
    },
  ];

  let closest: {
    anchor: string;
    point: { x: number; y: number };
    dist: number;
    ratio: number;
  } | null = null;

  for (const { anchor, point, ratio } of edgePoints) {
    const dist = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
    if (dist <= snapDistance && (closest === null || dist < closest.dist)) {
      closest = { anchor, point, dist, ratio };
    }
  }

  if (!closest) return null;
  return { point: closest.point, anchor: closest.anchor, ratio: closest.ratio };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Get the connection point for a specific anchor on a shape.
 *
 * Shape-aware: returns perimeter points for ellipse (parametric angles)
 * and diamond (edge midpoints), matching the geometry from
 * connectionPoints.ts. Avoids endpoint jumping on re-render.
 *
 * For 'center' and 'auto' anchors, returns the bounding box center.
 * [CLEAN-CODE] [SRP]
 */
export function getAnchorPoint(
  expression: VisualExpression,
  anchor: string,
  ratio: number = 0.5,
): { x: number; y: number } {
  const { x, y } = expression.position;
  const { width, height } = expression.size;

  if (anchor === "center" || anchor === "auto") {
    return { x: x + width / 2, y: y + height / 2 };
  }

  // Corner anchors need shape-specific geometry
  const isCorner =
    anchor === "top-left" ||
    anchor === "top-right" ||
    anchor === "bottom-left" ||
    anchor === "bottom-right";

  if (isCorner) {
    return getShapeAwareCornerPoint(
      expression.kind,
      x,
      y,
      width,
      height,
      anchor,
    );
  }

  // Edge anchors — use ratio (0-1) along the edge for precise positioning
  switch (anchor) {
    case "top":
      return { x: x + width * ratio, y };
    case "right":
      return { x: x + width, y: y + height * ratio };
    case "bottom":
      return { x: x + width * ratio, y: y + height };
    case "left":
      return { x, y: y + height * ratio };
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

/**
 * Compute corner anchor points using shape-specific geometry.
 *
 * Matches the geometry from connectionPoints.ts:
 * - Rectangle/sticky-note/stencil: bounding box corners
 * - Ellipse: parametric angles at 45°/135°/225°/315°
 * - Diamond: midpoints of edges between vertices
 * [CLEAN-CODE]
 */
function getShapeAwareCornerPoint(
  kind: string,
  x: number,
  y: number,
  width: number,
  height: number,
  anchor: string,
): { x: number; y: number } {
  if (kind === "ellipse") {
    return getEllipseCornerPoint(x, y, width, height, anchor);
  }

  if (kind === "diamond") {
    return getDiamondCornerPoint(x, y, width, height, anchor);
  }

  // Rectangle, sticky-note, stencil — use bounding box corners
  switch (anchor) {
    case "top-left":
      return { x, y };
    case "top-right":
      return { x: x + width, y };
    case "bottom-left":
      return { x, y: y + height };
    case "bottom-right":
      return { x: x + width, y: y + height };
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

/** Compute ellipse corner anchor at parametric angle on the perimeter. */
function getEllipseCornerPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  anchor: string,
): { x: number; y: number } {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const cos45 = Math.cos(Math.PI / 4);
  const sin45 = Math.sin(Math.PI / 4);

  switch (anchor) {
    case "top-right":
      return { x: cx + rx * cos45, y: cy - ry * sin45 };
    case "top-left":
      return { x: cx - rx * cos45, y: cy - ry * sin45 };
    case "bottom-right":
      return { x: cx + rx * cos45, y: cy + ry * sin45 };
    case "bottom-left":
      return { x: cx - rx * cos45, y: cy + ry * sin45 };
    default:
      return { x: cx, y: cy };
  }
}

/** Compute diamond corner anchor at the midpoint between two vertices. */
function getDiamondCornerPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  anchor: string,
): { x: number; y: number } {
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Diamond vertices
  const top = { x: cx, y };
  const right = { x: x + width, y: cy };
  const bottom = { x: cx, y: y + height };
  const left = { x, y: cy };

  switch (anchor) {
    case "top-right":
      return { x: (top.x + right.x) / 2, y: (top.y + right.y) / 2 };
    case "top-left":
      return { x: (top.x + left.x) / 2, y: (top.y + left.y) / 2 };
    case "bottom-right":
      return { x: (bottom.x + right.x) / 2, y: (bottom.y + right.y) / 2 };
    case "bottom-left":
      return { x: (bottom.x + left.x) / 2, y: (bottom.y + left.y) / 2 };
    default:
      return { x: cx, y: cy };
  }
}

/**
 * Recalculate arrow endpoints based on bindings.
 *
 * If the arrow has start/end bindings, replaces the first/last point
 * with the resolved anchor position on the bound shape. Returns a new
 * points array (does not mutate the original). [CLEAN-CODE] [SRP]
 *
 * Returns an empty array for non-arrow expressions.
 */
export function resolveBindings(
  arrowExpr: VisualExpression,
  expressions: Record<string, VisualExpression>,
): [number, number][] {
  if (arrowExpr.data.kind !== "arrow") return [];

  const arrowData = arrowExpr.data as ArrowData;
  const points: [number, number][] = arrowData.points.map(
    (p) => [p[0], p[1]] as [number, number],
  );

  if (points.length < 2) return points;

  // Get both bound shapes
  const startShape = arrowData.startBinding
    ? expressions[arrowData.startBinding.expressionId]
    : null;
  const endShape = arrowData.endBinding
    ? expressions[arrowData.endBinding.expressionId]
    : null;

  // Self-loop: both bound to same shape — use stored anchors directly
  const isSelfLoop =
    startShape &&
    endShape &&
    arrowData.startBinding!.expressionId === arrowData.endBinding!.expressionId;
  if (isSelfLoop) {
    const startPt = getAnchorPoint(
      startShape,
      arrowData.startBinding!.anchor || "top",
      arrowData.startBinding!.ratio ?? 0.5,
    );
    const endPt = getAnchorPoint(
      endShape,
      arrowData.endBinding!.anchor || "right",
      arrowData.endBinding!.ratio ?? 0.5,
    );
    points[0] = [startPt.x, startPt.y];
    points[points.length - 1] = [endPt.x, endPt.y];
    return points;
  }

  // Resolve start binding — use stored anchor from snap
  if (arrowData.startBinding && startShape) {
    const anchor = arrowData.startBinding.anchor;
    const ratio = arrowData.startBinding.ratio ?? 0.5;
    const pt = getAnchorPoint(startShape, anchor, ratio);
    points[0] = [pt.x, pt.y];
  }

  // Resolve end binding — use stored anchor from snap
  if (arrowData.endBinding && endShape) {
    const anchor = arrowData.endBinding.anchor;
    const ratio = arrowData.endBinding.ratio ?? 0.5;
    const pt = getAnchorPoint(endShape, anchor, ratio);
    points[points.length - 1] = [pt.x, pt.y];
  }

  return points;
}

/**
 * Find all arrows bound to a given expression ID.
 *
 * Scans all expressions and returns IDs of arrows that have
 * a startBinding or endBinding referencing the target ID.
 * [CLEAN-CODE]
 */
export function findBoundArrows(
  targetId: string,
  expressions: Record<string, VisualExpression>,
): string[] {
  const result: string[] = [];
  for (const [id, expr] of Object.entries(expressions)) {
    if (expr.data.kind !== "arrow") continue;
    const data = expr.data as ArrowData;
    if (
      data.startBinding?.expressionId === targetId ||
      data.endBinding?.expressionId === targetId
    ) {
      result.push(id);
    }
  }
  return result;
}

/**
 * Clear bindings that reference a deleted expression.
 *
 * Returns a new ArrowData with the referencing bindings removed,
 * or undefined if no change is needed. [CLEAN-CODE]
 */
export function clearBindingsForDeletedExpression(
  arrowData: ArrowData,
  deletedId: string,
): ArrowData | undefined {
  let changed = false;
  const updated = { ...arrowData };

  if (arrowData.startBinding?.expressionId === deletedId) {
    updated.startBinding = undefined;
    changed = true;
  }
  if (arrowData.endBinding?.expressionId === deletedId) {
    updated.endBinding = undefined;
    changed = true;
  }

  return changed ? updated : undefined;
}
