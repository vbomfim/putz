/**
 * Hit testing — pure geometry functions for point-in-shape detection.
 *
 * Each function takes a world-coordinate point, an expression, and a
 * tolerance in world units. Returns true if the point is inside (or
 * within tolerance of) the expression's geometry.
 *
 * Tolerance is specified in screen pixels at the call site and converted
 * to world units via `tolerance / camera.zoom` before calling these functions.
 *
 * @module
 */

import type { VisualExpression, ArrowData } from "../../protocol";
import type { PathSegment } from "../connectors/routerTypes";
import { getRouter } from "../connectors/routerRegistry";
import { computeSelfLoopPath } from "../connectors/orthogonalRouter";

/** A 2D point in world coordinates. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Hit test a rectangle expression.
 *
 * Checks if the point falls within the expression's bounding box,
 * expanded by `tolerance` on all sides.
 */
export function hitTestRectangle(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
): boolean {
  const { x, y } = expression.position;
  const { width, height } = expression.size;

  return (
    point.x >= x - tolerance &&
    point.x <= x + width + tolerance &&
    point.y >= y - tolerance &&
    point.y <= y + height + tolerance
  );
}

/**
 * Hit test an ellipse expression.
 *
 * Uses the standard ellipse equation with radii expanded by tolerance:
 * `((px - cx) / (rx + tol))² + ((py - cy) / (ry + tol))² ≤ 1`
 */
export function hitTestEllipse(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
): boolean {
  const { x, y } = expression.position;
  const { width, height } = expression.size;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2 + tolerance;
  const ry = height / 2 + tolerance;

  if (rx <= 0 || ry <= 0) return false;

  const dx = point.x - cx;
  const dy = point.y - cy;

  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

/**
 * Hit test a diamond expression.
 *
 * The diamond is a rhombus inscribed in the bounding box with vertices at
 * the midpoints of each edge. Uses the diamond equation:
 * `|px - cx| / halfW + |py - cy| / halfH ≤ 1`
 *
 * Tolerance expands the half-widths.
 */
export function hitTestDiamond(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
): boolean {
  const { x, y } = expression.position;
  const { width, height } = expression.size;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const halfW = width / 2 + tolerance;
  const halfH = height / 2 + tolerance;

  if (halfW <= 0 || halfH <= 0) return false;

  return Math.abs(point.x - cx) / halfW + Math.abs(point.y - cy) / halfH <= 1;
}

/**
 * Compute the minimum distance from a point to a line segment.
 *
 * Uses projection: clamps the parameter t to [0, 1] to stay within
 * the segment, then computes distance to the nearest point.
 */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (zero length) — distance to the point
    return Math.hypot(px - ax, py - ay);
  }

  // Project point onto the line, clamped to segment
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;

  return Math.hypot(px - projX, py - projY);
}

/**
 * Compute the minimum distance from a point to a cubic bezier curve.
 *
 * Approximates the curve by sampling it into `BEZIER_SAMPLES` line
 * segments, then finds the minimum distance to any segment.
 * 20 samples gives sub-pixel accuracy for typical canvas zoom levels.
 */
const BEZIER_SAMPLES = 20;

export function distanceToBezier(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cp1x: number,
  cp1y: number,
  cp2x: number,
  cp2y: number,
  ex: number,
  ey: number,
): number {
  let minDist = Infinity;
  let prevX = sx;
  let prevY = sy;

  for (let i = 1; i <= BEZIER_SAMPLES; i++) {
    const t = i / BEZIER_SAMPLES;
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = u3 * sx + 3 * u2 * t * cp1x + 3 * u * t2 * cp2x + t3 * ex;
    const y = u3 * sy + 3 * u2 * t * cp1y + 3 * u * t2 * cp2y + t3 * ey;

    const d = distanceToSegment(px, py, prevX, prevY, x, y);
    if (d < minDist) minDist = d;

    prevX = x;
    prevY = y;
  }

  return minDist;
}

/**
 * Compute the minimum distance from a point to a quadratic bezier curve.
 *
 * Approximates the curve by sampling it into line segments,
 * then finds the minimum distance to any segment.
 */
const QUADRATIC_SAMPLES = 16;

export function distanceToQuadraticBezier(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cpx: number,
  cpy: number,
  ex: number,
  ey: number,
): number {
  let minDist = Infinity;
  let prevX = sx;
  let prevY = sy;

  for (let i = 1; i <= QUADRATIC_SAMPLES; i++) {
    const t = i / QUADRATIC_SAMPLES;
    const u = 1 - t;

    const x = u * u * sx + 2 * u * t * cpx + t * t * ex;
    const y = u * u * sy + 2 * u * t * cpy + t * t * ey;

    const d = distanceToSegment(px, py, prevX, prevY, x, y);
    if (d < minDist) minDist = d;

    prevX = x;
    prevY = y;
  }

  return minDist;
}

/**
 * Compute the minimum distance from a point to a path described by
 * PathSegment[].
 *
 * Walks the segment array, tracking the current position. Delegates
 * to `distanceToSegment` for line/arc segments and `distanceToBezier`
 * for bezier segments.
 *
 * Returns `Infinity` if the segments array is empty.
 */
export function distanceToPathSegments(
  px: number,
  py: number,
  startX: number,
  startY: number,
  segments: PathSegment[],
): number {
  if (segments.length === 0) return Infinity;

  let minDist = Infinity;
  let curX = startX;
  let curY = startY;

  for (const seg of segments) {
    let d: number;

    if (seg.type === "bezier") {
      d = distanceToBezier(
        px,
        py,
        curX,
        curY,
        seg.cp1x,
        seg.cp1y,
        seg.cp2x,
        seg.cp2y,
        seg.x,
        seg.y,
      );
    } else if (seg.type === "quadratic") {
      d = distanceToQuadraticBezier(
        px,
        py,
        curX,
        curY,
        seg.cpx,
        seg.cpy,
        seg.x,
        seg.y,
      );
    } else {
      // 'line' and 'arc' — treat as straight segment to endpoint
      d = distanceToSegment(px, py, curX, curY, seg.x, seg.y);
    }

    if (d < minDist) minDist = d;
    curX = seg.x;
    curY = seg.y;
  }

  return minDist;
}

/**
 * Hit test a line expression.
 *
 * Checks if the perpendicular distance from the point to any segment
 * in the line's point array is less than tolerance.
 */
export function hitTestLine(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
): boolean {
  if (expression.data.kind !== "line") return false;
  const { points } = expression.data;

  if (points.length < 2) return false;

  const effectiveTolerance = Math.max(tolerance, 8);

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    if (
      distanceToSegment(point.x, point.y, ax, ay, bx, by) <= effectiveTolerance
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Hit test an arrow expression.
 *
 * For routed arrows (orthogonal, curved, elbow, etc.), computes the
 * actual rendered path via the router and tests against those segments.
 * For straight arrows or arrows with <2 points, falls back to testing
 * against the stored point array.
 *
 * When `expressions` is provided, shape bounds are passed to the router
 * so the hit-test path matches the rendered path exactly. [AC4]
 */
export function hitTestArrow(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
  expressions?: Record<string, VisualExpression>,
): boolean {
  if (expression.data.kind !== "arrow") return false;
  const data = expression.data as ArrowData;
  const { points } = data;

  if (points.length < 2) return false;

  // Use wider tolerance for thin lines (minimum 8 world px for easier clicking)
  const effectiveTolerance = Math.max(tolerance, 8);

  // ── Self-loop detection: both ends bound to the same shape ──
  // Must be checked BEFORE the router — self-loops use computeSelfLoopPath
  // instead of the general-purpose router for path computation.
  const isSelfLoop =
    data.startBinding &&
    data.endBinding &&
    data.startBinding.expressionId === data.endBinding.expressionId;

  if (isSelfLoop) {
    const target = expressions?.[data.startBinding!.expressionId];
    const jetty = typeof data.jettySize === "number" ? data.jettySize : 30;
    const path = computeSelfLoopPath(
      points[0]!,
      points[points.length - 1]!,
      data.routing,
      target,
      jetty,
    );

    if (path.isCurved) {
      // For bezier self-loops: test against the straight line start→end
      // (approximate — matches existing fallback behavior)
      return (
        distanceToSegment(
          point.x,
          point.y,
          points[0]![0],
          points[0]![1],
          points[points.length - 1]![0],
          points[points.length - 1]![1],
        ) <= effectiveTolerance
      );
    }

    // For orthogonal self-loops: test against each segment in the path
    for (let i = 0; i < path.points.length - 1; i++) {
      if (
        distanceToSegment(
          point.x,
          point.y,
          path.points[i]![0],
          path.points[i]![1],
          path.points[i + 1]![0],
          path.points[i + 1]![1],
        ) <= effectiveTolerance
      ) {
        return true;
      }
    }
    return false;
  }

  // Try routing-aware hit testing for non-straight arrows
  const routingMode =
    data.routing === "orthogonal" && data.curved
      ? ("orthogonalCurved" as const)
      : data.routing;
  const router = getRouter(routingMode);

  if (router && points.length === 2) {
    const start = { x: points[0]![0], y: points[0]![1] };
    const end = { x: points[1]![0], y: points[1]![1] };

    // Resolve shape bounds for routed path computation (bug #3 fix).
    // Without bounds, the hit-test path may differ from the rendered path.
    const startBoundExpr =
      expressions && data.startBinding
        ? expressions[data.startBinding.expressionId]
        : undefined;
    const endBoundExpr =
      expressions && data.endBinding
        ? expressions[data.endBinding.expressionId]
        : undefined;

    const pathSegments = router(
      start,
      end,
      data.startBinding?.anchor,
      data.endBinding?.anchor,
      {
        jettySize:
          typeof data.jettySize === "number" ? data.jettySize : undefined,
        midpointOffset:
          typeof data.midpointOffset === "number"
            ? data.midpointOffset
            : undefined,
        waypoints: data.waypoints,
        startBounds: startBoundExpr
          ? {
              x: startBoundExpr.position.x,
              y: startBoundExpr.position.y,
              width: startBoundExpr.size.width,
              height: startBoundExpr.size.height,
            }
          : undefined,
        endBounds: endBoundExpr
          ? {
              x: endBoundExpr.position.x,
              y: endBoundExpr.position.y,
              width: endBoundExpr.size.width,
              height: endBoundExpr.size.height,
            }
          : undefined,
      },
    );

    if (pathSegments.length > 0) {
      const dist = distanceToPathSegments(
        point.x,
        point.y,
        start.x,
        start.y,
        pathSegments,
      );
      return dist <= effectiveTolerance;
    }
  }

  // Fallback: test against stored point segments (straight arrows)
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    if (
      distanceToSegment(point.x, point.y, ax, ay, bx, by) <= effectiveTolerance
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Hit test a freehand expression.
 *
 * Checks distance to any segment formed by consecutive points.
 * Freehand points are [x, y, pressure] — pressure is ignored for hit testing.
 */
export function hitTestFreehand(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
): boolean {
  if (expression.data.kind !== "freehand") return false;
  const { points } = expression.data;

  if (points.length < 2) return false;

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    if (distanceToSegment(point.x, point.y, ax, ay, bx, by) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Hit test using bounding-box only (no tolerance margin).
 *
 * Shared helper used by text, sticky-note, image, and as the default
 * fallback for composite expression kinds.
 */
export function hitTestBoundingBox(
  point: WorldPoint,
  expression: VisualExpression,
): boolean {
  const { x, y } = expression.position;
  const { width, height } = expression.size;

  return (
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height
  );
}

/**
 * Hit test a text expression.
 *
 * Bounding box only — no tolerance margin.
 */
export function hitTestText(
  point: WorldPoint,
  expression: VisualExpression,
): boolean {
  return hitTestBoundingBox(point, expression);
}

/**
 * Hit test a sticky-note expression.
 *
 * Bounding box only — no tolerance margin.
 */
export function hitTestStickyNote(
  point: WorldPoint,
  expression: VisualExpression,
): boolean {
  return hitTestBoundingBox(point, expression);
}

/**
 * Hit test an image expression.
 *
 * Bounding box only — no tolerance margin.
 */
export function hitTestImage(
  point: WorldPoint,
  expression: VisualExpression,
): boolean {
  return hitTestBoundingBox(point, expression);
}

/**
 * Hit test a stencil expression.
 *
 * Bounding box only — no tolerance margin.
 */
export function hitTestStencil(
  point: WorldPoint,
  expression: VisualExpression,
): boolean {
  return hitTestBoundingBox(point, expression);
}

/**
 * Dispatch hit test by expression kind.
 *
 * Routes to the correct shape-specific hit test function based on
 * the expression's `kind` field. Returns false for unknown kinds.
 *
 * @param expressions - Optional expressions map for arrow hit testing.
 *   When provided, shape bounds are passed to the router for accurate
 *   path matching. [AC4]
 */
export function hitTestExpression(
  point: WorldPoint,
  expression: VisualExpression,
  tolerance: number,
  expressions?: Record<string, VisualExpression>,
): boolean {
  switch (expression.kind) {
    case "rectangle":
      return hitTestRectangle(point, expression, tolerance);
    case "ellipse":
      return hitTestEllipse(point, expression, tolerance);
    case "diamond":
      return hitTestDiamond(point, expression, tolerance);
    case "line":
      return hitTestLine(point, expression, tolerance);
    case "arrow":
      return hitTestArrow(point, expression, tolerance, expressions);
    case "freehand":
      return hitTestFreehand(point, expression, tolerance);
    case "text":
      return hitTestText(point, expression);
    case "sticky-note":
      return hitTestStickyNote(point, expression);
    case "image":
      return hitTestImage(point, expression);
    case "stencil":
      return hitTestStencil(point, expression);
    default:
      // Composite and unknown kinds: fall back to bounding-box hit test
      return hitTestBoundingBox(point, expression);
  }
}
