/**
 * Router registry — maps RoutingMode to router functions.
 *
 * Central dispatch for all routing algorithms. The renderer calls
 * `getRouter(mode)` to get the appropriate routing function, then
 * invokes it to get PathSegments.
 *
 * Returns `null` for 'straight' and undefined modes (the renderer
 * uses default point-to-point rendering for these).
 *
 * `elbow` is an alias for orthogonal (L-shape with no stubs).
 * `orthogonalCurved` wraps orthogonal with bezier-smoothed corners
 * (inlined from the deleted orthogonalEnhancements.ts).
 *
 * [CLEAN-CODE] [SRP] — single responsibility: router dispatch.
 * [SOLID/OCP] — adding a new router only requires adding an entry here.
 *
 * @module
 */

import type { RoutingMode } from '../../protocol';
import type { PathSegment, RouterFunction, RouterOptions } from './routerTypes';
import { computeCurvedRoute } from './curvedRouter';
import { computeEntityRelationRoute } from './entityRelationRouter';
import { computeIsometricRoute } from './isometricRouter';
import { computeOrthogonalRoute } from './orthogonalRouter';

// ── Orthogonal adapter ──────────────────────────────────────

/**
 * Adapter that converts the orthogonal router's [x,y][] output
 * to PathSegment[].
 */
function orthogonalAdapter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  options?: RouterOptions,
): PathSegment[] {
  const points = computeOrthogonalRoute(
    start,
    end,
    startAnchor,
    endAnchor,
    options?.startBounds,
    options?.endBounds,
    options?.jettySize,
    options?.midpointOffset,
    options?.waypoints,
  );

  // Convert [x,y][] to PathSegment[] — skip the first point (moveTo)
  return points.slice(1).map(([x, y]) => ({ type: 'line' as const, x, y }));
}

// ── Elbow adapter (backward compat alias) ────────────────────

/**
 * Elbow adapter — delegates to orthogonal router with jettySize=0.
 *
 * Produces an L-shape (no exit/entry stubs). Backward compatible:
 * existing arrows with routing='elbow' render the same way.
 */
function elbowAdapter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  options?: RouterOptions,
): PathSegment[] {
  return orthogonalAdapter(start, end, startAnchor, endAnchor, {
    ...options,
    jettySize: 0,
  });
}

// ── Orthogonal Curved adapter (corner smoothing) ─────────────

/** Corner blend ratio for bezier curves (how far before/after corner). */
const CORNER_OFFSET_RATIO = 0.3;

/** Max corner blend distance in world pixels. */
const MAX_CORNER_OFFSET = 20;

/** Default corner radius for quadratic Bézier rounded corners. */
const DEFAULT_CORNER_RADIUS = 12;

/**
 * Check if three consecutive points form a corner (direction change).
 *
 * In orthogonal routing, a corner is where a horizontal segment
 * meets a vertical segment (or vice versa).
 */
function isCorner(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const dx1 = b[0] - a[0];
  const dy1 = b[1] - a[1];
  const dx2 = c[0] - b[0];
  const dy2 = c[1] - b[1];

  const seg1Horiz = Math.abs(dy1) < 0.01 && Math.abs(dx1) > 0.01;
  const seg1Vert = Math.abs(dx1) < 0.01 && Math.abs(dy1) > 0.01;
  const seg2Horiz = Math.abs(dy2) < 0.01 && Math.abs(dx2) > 0.01;
  const seg2Vert = Math.abs(dx2) < 0.01 && Math.abs(dy2) > 0.01;

  return (seg1Horiz && seg2Vert) || (seg1Vert && seg2Horiz);
}

/**
 * Convert orthogonal waypoints to PathSegments with bezier-smoothed corners.
 *
 * For each corner point, replaces it with a line to a pre-corner offset
 * and a bezier curve through the corner.
 */
function smoothCornersWithBezier(points: [number, number][]): PathSegment[] {
  if (points.length <= 1) {
    return points.length === 1
      ? [{ type: 'line', x: points[0]![0], y: points[0]![1] }]
      : [];
  }
  if (points.length === 2) {
    return [{ type: 'line', x: points[1]![0], y: points[1]![1] }];
  }

  const segments: PathSegment[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = i < points.length - 1 ? points[i + 1] : undefined;

    if (next && isCorner(prev, curr, next)) {
      const segLen1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
      const segLen2 = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
      const offset = Math.min(
        segLen1 * CORNER_OFFSET_RATIO,
        segLen2 * CORNER_OFFSET_RATIO,
        MAX_CORNER_OFFSET,
      );

      const beforeX = curr[0] + (prev[0] - curr[0]) * (offset / segLen1);
      const beforeY = curr[1] + (prev[1] - curr[1]) * (offset / segLen1);
      const afterX = curr[0] + (next[0] - curr[0]) * (offset / segLen2);
      const afterY = curr[1] + (next[1] - curr[1]) * (offset / segLen2);

      segments.push({ type: 'line', x: beforeX, y: beforeY });
      segments.push({
        type: 'bezier',
        cp1x: curr[0], cp1y: curr[1],
        cp2x: curr[0], cp2y: curr[1],
        x: afterX, y: afterY,
      });
    } else if (i === points.length - 1) {
      segments.push({ type: 'line', x: curr[0], y: curr[1] });
    } else if (!next || !isCorner(prev, curr, next)) {
      segments.push({ type: 'line', x: curr[0], y: curr[1] });
    }
  }

  return segments;
}

/**
 * Convert orthogonal waypoints to PathSegments with quadratic Bézier
 * rounded corners (Excalidraw-style).
 *
 * At each 90° turn, replaces the corner with a smooth quadratic curve.
 * Uses `quadraticCurveTo` with the corner point as the control point.
 */
function smoothCornersWithQuadratic(points: [number, number][]): PathSegment[] {
  if (points.length <= 1) {
    return points.length === 1
      ? [{ type: 'line', x: points[0]![0], y: points[0]![1] }]
      : [];
  }
  if (points.length === 2) {
    return [{ type: 'line', x: points[1]![0], y: points[1]![1] }];
  }

  const segments: PathSegment[] = [];
  const radius = DEFAULT_CORNER_RADIUS;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = i < points.length - 1 ? points[i + 1] : undefined;

    if (next && isCorner(prev, curr, next)) {
      const segLen1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
      const segLen2 = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
      const r = Math.min(radius, segLen1 / 2, segLen2 / 2);

      const beforeX = curr[0] + (prev[0] - curr[0]) * (r / segLen1);
      const beforeY = curr[1] + (prev[1] - curr[1]) * (r / segLen1);
      const afterX = curr[0] + (next[0] - curr[0]) * (r / segLen2);
      const afterY = curr[1] + (next[1] - curr[1]) * (r / segLen2);

      // Line to just before the corner
      segments.push({ type: 'line', x: beforeX, y: beforeY });
      // Quadratic curve through the corner point to just after
      segments.push({
        type: 'quadratic',
        cpx: curr[0], cpy: curr[1],
        x: afterX, y: afterY,
      });
    } else if (i === points.length - 1) {
      segments.push({ type: 'line', x: curr[0], y: curr[1] });
    } else if (!next || !isCorner(prev, curr, next)) {
      segments.push({ type: 'line', x: curr[0], y: curr[1] });
    }
  }

  return segments;
}

/**
 * Orthogonal with smoothed or rounded corners.
 *
 * Delegates to the base orthogonal router, then post-processes corners.
 * - `options.rounded` → quadratic Bézier rounding (Excalidraw-style)
 * - `options.curved` → cubic Bézier smoothing (draw.io-style)
 * - Neither → arc rounding (legacy fallback)
 */
function orthogonalCurvedAdapter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  options?: RouterOptions,
): PathSegment[] {
  const basePoints = computeOrthogonalRoute(
    start, end, startAnchor, endAnchor,
    options?.startBounds, options?.endBounds,
    options?.jettySize, options?.midpointOffset,
    options?.waypoints,
  );

  if (options?.rounded) {
    return smoothCornersWithQuadratic(basePoints);
  }
  return smoothCornersWithBezier(basePoints);
}

// ── Router dispatch table ────────────────────────────────────

/** Router dispatch table. */
const ROUTER_MAP: Record<string, RouterFunction> = {
  orthogonal: orthogonalAdapter,
  curved: computeCurvedRoute,
  elbow: elbowAdapter,
  entityRelation: computeEntityRelationRoute,
  isometric: computeIsometricRoute,
  orthogonalCurved: orthogonalCurvedAdapter,
};

/**
 * Get the router function for a routing mode.
 *
 * Returns `null` for 'straight' and undefined modes — the renderer
 * should use default straight-line rendering for these.
 */
export function getRouter(mode: RoutingMode | undefined): RouterFunction | null {
  if (!mode || mode === 'straight') return null;
  return ROUTER_MAP[mode] ?? null;
}

// Re-export types for convenience
export type { PathSegment, RouterFunction, RouterOptions };
