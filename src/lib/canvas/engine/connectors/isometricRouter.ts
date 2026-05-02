/**
 * Isometric routing algorithm for arrow connectors.
 *
 * Produces paths that follow isometric grid angles:
 * 0° (horizontal), 30°, 150°, and 90° (vertical).
 *
 * The route decomposes movement into two legs:
 * one along a 30° or 150° axis, one along 0° or 90°.
 *
 * [CLEAN-CODE] [SRP] — single responsibility: isometric path computation.
 *
 * @module
 */

import type { PathSegment } from "./routerTypes";

/** Tangent of 30° — rise/run for isometric diagonal. */
const TAN_30 = Math.tan(Math.PI / 6); // ≈ 0.577

/**
 * Compute an isometric route between two points.
 *
 * Routes along isometric axes: the path travels diagonally
 * at 30° or 150° and then vertically (or vice versa) to
 * reach the target.
 *
 * Returns line PathSegments only (no curves).
 * For coincident points, returns a degenerate segment.
 */
export function computeIsometricRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  _startAnchor?: string,
  _endAnchor?: string,
): PathSegment[] {
  // Same point — degenerate
  if (start.x === end.x && start.y === end.y) {
    return [{ type: "line", x: end.x, y: end.y }];
  }

  // Pure vertical — travel at 90°
  if (start.x === end.x) {
    return [{ type: "line", x: end.x, y: end.y }];
  }

  // Pure horizontal — travel at 0°
  if (start.y === end.y) {
    return [{ type: "line", x: end.x, y: end.y }];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Strategy: first leg is an isometric diagonal (30° or 150°),
  // second leg is vertical (90°) to reach the exact target.
  //
  // For a 30° line going right: dy/dx = tan(30°) ≈ 0.577
  // For a 150° line going left: dy/dx = -tan(30°)

  // How much vertical movement the diagonal covers
  const diagonalDy = Math.abs(dx) * TAN_30;

  if (Math.abs(dy) <= diagonalDy) {
    // The vertical delta is small enough to cover entirely with diagonal.
    // Travel diagonal to cover all dy, then horizontal for remaining dx.
    const diagDx = (Math.abs(dy) / TAN_30) * Math.sign(dx);
    const diagEndX = start.x + diagDx;
    const diagEndY = start.y + dy; // covers all dy

    const segments: PathSegment[] = [];

    // Diagonal leg (30° or 150°)
    if (diagDx !== 0 || dy !== 0) {
      segments.push({ type: "line", x: diagEndX, y: diagEndY });
    }

    // Horizontal leg to reach end.x
    if (Math.abs(diagEndX - end.x) > 0.01) {
      segments.push({ type: "line", x: end.x, y: end.y });
    }

    return segments.length > 0
      ? segments
      : [{ type: "line", x: end.x, y: end.y }];
  }

  // The vertical delta is larger than what the diagonal covers.
  // First: travel diagonal along full dx, then vertical for remaining dy.
  const diagEndX = end.x;
  const diagEndY = start.y + Math.sign(dy) * diagonalDy;

  const segments: PathSegment[] = [];

  // Diagonal leg covers all dx
  segments.push({ type: "line", x: diagEndX, y: diagEndY });

  // Vertical leg covers remaining dy
  if (Math.abs(diagEndY - end.y) > 0.01) {
    segments.push({ type: "line", x: end.x, y: end.y });
  }

  return segments;
}
