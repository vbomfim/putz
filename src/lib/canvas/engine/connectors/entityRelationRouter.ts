/**
 * Entity Relation (ER) routing algorithm for arrow connectors.
 *
 * Mimics draw.io's ER connector style:
 * - Short perpendicular stub out of the source shape
 * - Smooth S-curve (cubic bezier) connecting the stubs
 * - Short perpendicular stub into the target shape
 *
 * The stubs are perpendicular to the connection point's edge,
 * creating the characteristic "exit straight, curve, enter straight" look.
 *
 * [CLEAN-CODE] [SRP] — single responsibility: ER path computation.
 *
 * @module
 */

import type { PathSegment } from "./routerTypes";

/** Default stub length for ER connectors. */
const DEFAULT_STUB_LENGTH = 20;

/**
 * Compute an entity-relation style route between two points.
 *
 * Returns PathSegments: stub line → bezier S-curve → stub line.
 * For coincident points, returns a degenerate segment.
 */
export function computeEntityRelationRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  options?: { jettySize?: number },
): PathSegment[] {
  // Same point — degenerate
  if (start.x === end.x && start.y === end.y) {
    return [{ type: "line", x: end.x, y: end.y }];
  }

  const stubLen = options?.jettySize ?? DEFAULT_STUB_LENGTH;

  // Compute exit direction for start and end
  const startDir = resolveDirection(startAnchor, start, end);
  const endDir = resolveDirection(endAnchor, end, start);

  // Stub endpoints
  const stubStart = {
    x: start.x + startDir.x * stubLen,
    y: start.y + startDir.y * stubLen,
  };
  const stubEnd = {
    x: end.x + endDir.x * stubLen,
    y: end.y + endDir.y * stubLen,
  };

  // S-curve control points: extend stubs further to create smooth bezier
  const dist = Math.hypot(stubEnd.x - stubStart.x, stubEnd.y - stubStart.y);
  const curveOffset = Math.max(dist / 3, stubLen);

  const cp1x = stubStart.x + startDir.x * curveOffset;
  const cp1y = stubStart.y + startDir.y * curveOffset;
  const cp2x = stubEnd.x + endDir.x * curveOffset;
  const cp2y = stubEnd.y + endDir.y * curveOffset;

  return [
    // Start stub (perpendicular exit)
    { type: "line", x: stubStart.x, y: stubStart.y },
    // S-curve bezier from stub end to stub start of target
    {
      type: "bezier",
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      x: stubEnd.x,
      y: stubEnd.y,
    },
    // End stub (perpendicular entry)
    { type: "line", x: end.x, y: end.y },
  ];
}

/**
 * Resolve the exit direction vector for an anchor.
 *
 * Returns a unit vector pointing away from the shape edge.
 * Falls back to inferring direction from relative positions.
 */
function resolveDirection(
  anchor: string | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  if (anchor) {
    switch (anchor) {
      case "right":
        return { x: 1, y: 0 };
      case "left":
        return { x: -1, y: 0 };
      case "top":
        return { x: 0, y: -1 };
      case "bottom":
        return { x: 0, y: 1 };
      case "top-right":
        return normalize(1, -1);
      case "top-left":
        return normalize(-1, -1);
      case "bottom-right":
        return normalize(1, 1);
      case "bottom-left":
        return normalize(-1, 1);
    }
  }

  // Infer: exit toward the target on the dominant axis
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? 1 : -1, y: 0 };
  }
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

/** Normalize a vector to unit length. */
function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}
