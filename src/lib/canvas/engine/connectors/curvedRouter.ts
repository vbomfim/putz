/**
 * Curved routing algorithm for arrow connectors.
 *
 * Produces a smooth cubic bezier curve from start to end.
 * Uses control points calculated from the distance and direction
 * between endpoints to create a natural-looking curve.
 *
 * [CLEAN-CODE] [SRP] — single responsibility: curved path computation.
 *
 * @module
 */

import type { PathSegment } from './routerTypes';

/**
 * Compute a smooth curved route between two points.
 *
 * Returns an array of bezier PathSegments. For a simple two-point
 * connection, produces a single cubic bezier with control points
 * offset along the direction between start and end.
 *
 * For coincident points, returns a degenerate line segment.
 */
export function computeCurvedRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
): PathSegment[] {
  // Same point — degenerate segment
  if (start.x === end.x && start.y === end.y) {
    return [{ type: 'line', x: end.x, y: end.y }];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  // Control point offset: 1/3 of the distance, biased by anchor direction
  const offset = dist / 3;

  const startDir = anchorToVector(startAnchor, dx, dy);
  const endDir = anchorToVector(endAnchor, -dx, -dy);

  const cp1x = start.x + startDir.x * offset;
  const cp1y = start.y + startDir.y * offset;
  const cp2x = end.x + endDir.x * offset;
  const cp2y = end.y + endDir.y * offset;

  return [
    {
      type: 'bezier',
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      x: end.x,
      y: end.y,
    },
  ];
}

/**
 * Convert an anchor name to a unit direction vector.
 *
 * When no anchor is provided, infers direction from the
 * delta between start and end.
 */
function anchorToVector(
  anchor: string | undefined,
  defaultDx: number,
  defaultDy: number,
): { x: number; y: number } {
  if (anchor) {
    switch (anchor) {
      case 'right': return { x: 1, y: 0 };
      case 'left': return { x: -1, y: 0 };
      case 'top': return { x: 0, y: -1 };
      case 'bottom': return { x: 0, y: 1 };
      case 'top-right': return normalize(1, -1);
      case 'top-left': return normalize(-1, -1);
      case 'bottom-right': return normalize(1, 1);
      case 'bottom-left': return normalize(-1, 1);
    }
  }

  // Default: direction from start toward end
  const dist = Math.hypot(defaultDx, defaultDy);
  if (dist === 0) return { x: 1, y: 0 };
  return { x: defaultDx / dist, y: defaultDy / dist };
}

/** Normalize a vector to unit length. */
function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}
