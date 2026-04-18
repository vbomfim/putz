/**
 * Orthogonal connector routing — draw.io-style clean rebuild.
 *
 * Algorithm:
 * 1. Determine exit/entry directions from quadrant analysis
 * 2. Look up route pattern from direction combination
 * 3. Generate waypoints with jetty stubs
 * 4. Apply user waypoint overrides (if any)
 * 5. Eliminate collinear points
 *
 * The router outputs [x, y][] waypoints. Corner smoothing (quadratic
 * Bézier) is handled by the routerRegistry adapter.
 *
 * Exported for testing: pickExitEntry, eliminateCollinear.
 *
 * [CLEAN-CODE] [SRP] — each function does one thing.
 * @module
 */

// ── Types ────────────────────────────────────────────────────

/** Cardinal exit/entry direction. */
export type Direction = 'top' | 'right' | 'bottom' | 'left';

/** Bounding rectangle for shape-avoidance. */
type Rect = { x: number; y: number; width: number; height: number };

/** 2D point as a tuple. */
type Point = [number, number];

/** Unit direction vector for each cardinal direction. */
const DIR_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  top:    { dx:  0, dy: -1 },
  right:  { dx:  1, dy:  0 },
  bottom: { dx:  0, dy:  1 },
  left:   { dx: -1, dy:  0 },
};

// ── Constants ────────────────────────────────────────────────

/** Default exit/entry stub length in world units. */
const DEFAULT_JETTY = 20;

/**
 * Epsilon for shape-edge comparisons.
 * Segments exactly on a shape edge (within 1px) are treated as crossing.
 */
const EDGE_EPSILON = 1;

// ══════════════════════════════════════════════════════════════
// 1. Public entry point
// ══════════════════════════════════════════════════════════════

/**
 * Compute an orthogonal route between two points.
 *
 * Returns [x, y] waypoints forming only horizontal/vertical segments.
 * All collinear points are eliminated from the output.
 *
 * @param start       Connection point on shape A edge
 * @param end         Connection point on shape B edge
 * @param startAnchor Anchor: top | bottom | left | right | corners
 * @param endAnchor   Anchor for the target shape
 * @param startBounds Bounding rect of shape A
 * @param endBounds   Bounding rect of shape B
 * @param jettySize   Exit/entry stub length (default: 20)
 * @param midpointOffset Z-shape midpoint ratio 0–1 (0.5 = centered)
 * @param waypoints   User-adjusted segment positions (absolute X or Y)
 */
export function computeOrthogonalRoute(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  startBounds?: Rect,
  endBounds?: Rect,
  jettySize?: number,
  midpointOffset?: number,
  waypoints?: number[],
): Point[] {
  // Coincident points — degenerate case
  if (start.x === end.x && start.y === end.y) {
    return [[start.x, start.y], [end.x, end.y]];
  }

  const padding = typeof jettySize === 'number' ? jettySize : DEFAULT_JETTY;

  // Step 1: Pick exit/entry directions
  const { exit, entry } = pickExitEntry(
    start, end, startAnchor, endAnchor, startBounds, endBounds,
  );

  // Step 2: Generate exit/entry stubs
  const exitVec = DIR_VECTORS[exit];
  const entryVec = DIR_VECTORS[entry];

  const exitStub: Point = [
    start.x + exitVec.dx * padding,
    start.y + exitVec.dy * padding,
  ];
  const entryStub: Point = [
    end.x + entryVec.dx * padding,
    end.y + entryVec.dy * padding,
  ];

  // Step 3: Connect stubs with pattern-based segments
  const middle = connectByPattern(
    exitStub, entryStub,
    exit, entry,
    startBounds, endBounds,
    padding,
    midpointOffset,
    waypoints,
  );

  // Step 4: Assemble full path
  const raw: Point[] = [
    [start.x, start.y],
    exitStub,
    ...middle,
    entryStub,
    [end.x, end.y],
  ];

  // Step 5: Eliminate collinear points
  return eliminateCollinear(raw);
}

// ══════════════════════════════════════════════════════════════
// 2. Quadrant-based direction analysis
// ══════════════════════════════════════════════════════════════

/**
 * Pick exit and entry directions based on quadrant analysis.
 *
 * Uses shape bounds centers when available, falls back to connection
 * points. Explicit anchors override the analysis.
 *
 * Exported for testing.
 */
export function pickExitEntry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  startBounds?: Rect,
  endBounds?: Rect,
): { exit: Direction; entry: Direction } {
  // Use shape centers for better quadrant analysis when bounds available
  const srcCx = startBounds ? startBounds.x + startBounds.width / 2 : start.x;
  const srcCy = startBounds ? startBounds.y + startBounds.height / 2 : start.y;
  const tgtCx = endBounds ? endBounds.x + endBounds.width / 2 : end.x;
  const tgtCy = endBounds ? endBounds.y + endBounds.height / 2 : end.y;

  const dx = tgtCx - srcCx;
  const dy = tgtCy - srcCy;

  // Exit direction
  const exit: Direction = startAnchor
    ? anchorToDirection(startAnchor, start, end)
    : inferDirection(dx, dy, 'exit');

  // Entry direction — opposite facing (toward source)
  const entry: Direction = endAnchor
    ? anchorToDirection(endAnchor, end, start)
    : inferDirection(dx, dy, 'entry');

  return { exit, entry };
}

/**
 * Infer a direction from delta for either exit or entry.
 *
 * Exit: face toward target (same sign as delta).
 * Entry: face toward source (opposite sign).
 */
function inferDirection(
  dx: number,
  dy: number,
  role: 'exit' | 'entry',
): Direction {
  if (role === 'exit') {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'bottom' : 'top';
  }
  // Entry: face opposite (toward source)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'left' : 'right';
  }
  return dy >= 0 ? 'top' : 'bottom';
}

/**
 * Map anchor name → cardinal direction.
 *
 * Cardinal anchors map directly. Corner anchors use the dominant axis
 * between from/to to pick horizontal or vertical exit.
 */
function anchorToDirection(
  anchor: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Direction {
  switch (anchor) {
    case 'top':    return 'top';
    case 'bottom': return 'bottom';
    case 'left':   return 'left';
    case 'right':  return 'right';

    // Corner anchors: pick axis based on which component is dominant
    case 'top-right':
      return Math.abs(to.y - from.y) > Math.abs(to.x - from.x) ? 'top' : 'right';
    case 'top-left':
      return Math.abs(to.y - from.y) > Math.abs(to.x - from.x) ? 'top' : 'left';
    case 'bottom-right':
      return Math.abs(to.y - from.y) > Math.abs(to.x - from.x) ? 'bottom' : 'right';
    case 'bottom-left':
      return Math.abs(to.y - from.y) > Math.abs(to.x - from.x) ? 'bottom' : 'left';

    default: {
      // Unknown anchor: infer from delta
      const ddx = to.x - from.x;
      const ddy = to.y - from.y;
      if (Math.abs(ddx) >= Math.abs(ddy)) {
        return ddx >= 0 ? 'right' : 'left';
      }
      return ddy >= 0 ? 'bottom' : 'top';
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 3. Pattern-based stub connection
// ══════════════════════════════════════════════════════════════

/**
 * Connect two stub endpoints using pattern lookup.
 *
 * Categorizes the exit→entry combination into one of three patterns:
 * - **Opposite** (right→left, top→bottom): Z-shape
 * - **Same** (right→right, top→top): U-shape detour
 * - **Perpendicular** (right→top, bottom→left): L-shape
 *
 * Returns intermediate waypoints (between exit stub and entry stub).
 */
function connectByPattern(
  exitStub: Point,
  entryStub: Point,
  exit: Direction,
  entry: Direction,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
  midpointOffset?: number,
  waypoints?: number[],
): Point[] {
  // Check if stubs are already aligned (no turn needed)
  if (exitStub[0] === entryStub[0] || exitStub[1] === entryStub[1]) {
    return [];
  }

  const exitH = isHorizontal(exit);
  const entryH = isHorizontal(entry);

  // ── Perpendicular: L-shape ──
  if (exitH !== entryH) {
    return buildLShape(exitStub, entryStub, exit, entry, sBounds, eBounds, padding, waypoints);
  }

  // ── Same axis ──
  if (exit === entry) {
    // Same direction → U-shape
    return buildUShape(exitStub, entryStub, exit, sBounds, eBounds, padding, waypoints);
  }

  // Opposite direction → Z-shape
  return buildZShape(exitStub, entryStub, exit, sBounds, eBounds, padding, midpointOffset, waypoints);
}

// ── Z-shape (opposite directions) ────────────────────────────

/**
 * Build a Z-shape connecting opposite-facing stubs.
 *
 * For horizontal flow (right→left):
 *   exitStub → [midX, exitStub.y] → [midX, entryStub.y] → entryStub
 *
 * For vertical flow (bottom→top):
 *   exitStub → [exitStub.x, midY] → [entryStub.x, midY] → entryStub
 */
function buildZShape(
  exitStub: Point,
  entryStub: Point,
  exit: Direction,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
  midpointOffset?: number,
  waypoints?: number[],
): Point[] {
  const t = midpointOffset ?? 0.5;

  if (isHorizontal(exit)) {
    // Horizontal flow: vertical mid-segment
    let midX = waypoints?.[0] ?? (exitStub[0] + (entryStub[0] - exitStub[0]) * t);

    // Push midX out of any blocking shape
    midX = avoidShapesOnAxis(midX, 'x', exitStub[1], entryStub[1], sBounds, eBounds, padding);

    return [[midX, exitStub[1]], [midX, entryStub[1]]];
  }

  // Vertical flow: horizontal mid-segment
  let midY = waypoints?.[0] ?? (exitStub[1] + (entryStub[1] - exitStub[1]) * t);

  // Push midY out of any blocking shape
  midY = avoidShapesOnAxis(midY, 'y', exitStub[0], entryStub[0], sBounds, eBounds, padding);

  return [[exitStub[0], midY], [entryStub[0], midY]];
}

// ── U-shape (same direction) ─────────────────────────────────

/**
 * Build a U-shape for same-direction stubs.
 *
 * Both stubs exit the same way, so we need to detour around the shapes.
 * The detour coordinate is placed past the outermost shape edge + padding.
 */
function buildUShape(
  exitStub: Point,
  entryStub: Point,
  exit: Direction,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
  waypoints?: number[],
): Point[] {
  if (isHorizontal(exit)) {
    // Horizontal exit → need a vertical clearance line → connect horizontally
    const clearX = waypoints?.[0] ?? computeUClearance(exit, 'x', sBounds, eBounds, padding, exitStub, entryStub);
    return [[clearX, exitStub[1]], [clearX, entryStub[1]]];
  }

  // Vertical exit → need a horizontal clearance line
  const clearY = waypoints?.[0] ?? computeUClearance(exit, 'y', sBounds, eBounds, padding, exitStub, entryStub);
  return [[exitStub[0], clearY], [entryStub[0], clearY]];
}

/**
 * Compute the clearance coordinate for a U-shape detour.
 *
 * Goes past the outermost shape edge in the exit direction.
 */
function computeUClearance(
  exit: Direction,
  axis: 'x' | 'y',
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
  exitStub: Point,
  entryStub: Point,
): number {
  const rects = [sBounds, eBounds].filter(Boolean) as Rect[];

  if (rects.length === 0) {
    // No shapes: go padding past the stubs
    const stubCoord = axis === 'x'
      ? Math.max(exitStub[0], entryStub[0])
      : Math.max(exitStub[1], entryStub[1]);
    return exit === 'right' || exit === 'bottom'
      ? stubCoord + padding
      : stubCoord - padding;
  }

  if (axis === 'x') {
    if (exit === 'right') {
      return Math.max(...rects.map(r => r.x + r.width)) + padding;
    }
    return Math.min(...rects.map(r => r.x)) - padding;
  }

  // axis === 'y'
  if (exit === 'bottom') {
    return Math.max(...rects.map(r => r.y + r.height)) + padding;
  }
  return Math.min(...rects.map(r => r.y)) - padding;
}

// ── L-shape (perpendicular) ──────────────────────────────────

/**
 * Build an L-shape for perpendicular stubs.
 *
 * Natural corner: continue in exit direction, turn to entry.
 * If the natural corner crosses a shape, try the alt corner.
 * If both are blocked, fall back to a C-shape detour.
 */
function buildLShape(
  exitStub: Point,
  entryStub: Point,
  exit: Direction,
  _entry: Direction,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
  waypoints?: number[],
): Point[] {
  const exitH = isHorizontal(exit);

  // Natural corner: intersection of exit line and entry line
  const natural: Point = exitH
    ? [entryStub[0], exitStub[1]]
    : [exitStub[0], entryStub[1]];

  // Alt corner (Z-like path: 2 perpendicular middle segments share one turn point)
  const alt: Point = exitH
    ? [exitStub[0], entryStub[1]]
    : [entryStub[0], exitStub[1]];

  // ── Two-waypoint form (Z-like with independent middles) ──
  // waypoints[0] controls the first perpendicular-to-exit middle segment,
  // waypoints[1] controls the second perpendicular-to-first middle segment.
  if (waypoints && waypoints.length >= 2) {
    if (exitH) {
      // Horizontal exit → first middle is vertical (X), second is horizontal (Y)
      const vx = waypoints[0]!;
      const hy = waypoints[1]!;
      return [[vx, exitStub[1]], [vx, hy], [entryStub[0], hy]];
    }
    // Vertical exit → first middle is horizontal (Y), second is vertical (X)
    const hy = waypoints[0]!;
    const vx = waypoints[1]!;
    return [[exitStub[0], hy], [vx, hy], [vx, entryStub[1]]];
  }

  // ── Single-waypoint form: override corner position only ──
  if (waypoints && waypoints.length > 0) {
    if (exitH) {
      return [[waypoints[0]!, exitStub[1]], [waypoints[0]!, entryStub[1]]];
    }
    return [[exitStub[0], waypoints[0]!], [entryStub[0], waypoints[0]!]];
  }

  if (!segmentCrossesRect(exitStub, natural, sBounds) &&
      !segmentCrossesRect(exitStub, natural, eBounds) &&
      !segmentCrossesRect(natural, entryStub, sBounds) &&
      !segmentCrossesRect(natural, entryStub, eBounds)) {
    return [natural];
  }

  if (!segmentCrossesRect(exitStub, alt, sBounds) &&
      !segmentCrossesRect(exitStub, alt, eBounds) &&
      !segmentCrossesRect(alt, entryStub, sBounds) &&
      !segmentCrossesRect(alt, entryStub, eBounds)) {
    return [alt];
  }

  // Both corners blocked → C-shape detour
  const useX = !exitH;
  const cl = computeCShapeClearance(useX, sBounds, eBounds, exitStub, entryStub, padding);
  return exitH
    ? [[exitStub[0], cl], [entryStub[0], cl]]
    : [[cl, exitStub[1]], [cl, entryStub[1]]];
}

// ══════════════════════════════════════════════════════════════
// 4. Collinear elimination
// ══════════════════════════════════════════════════════════════

/**
 * Remove collinear points from an orthogonal route.
 *
 * A point is collinear if the previous and next points share the same
 * X (all vertical) or same Y (all horizontal). Removing it doesn't
 * change the visual path.
 *
 * Exported for testing.
 */
export function eliminateCollinear(points: Point[]): Point[] {
  if (points.length <= 2) return [...points];

  const result: Point[] = [points[0]!];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const sameX = prev[0] === curr[0] && curr[0] === next[0];
    const sameY = prev[1] === curr[1] && curr[1] === next[1];

    if (!sameX && !sameY) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]!);
  return result;
}

// ══════════════════════════════════════════════════════════════
// 5. Self-loop path computation
// ══════════════════════════════════════════════════════════════

/**
 * Compute the path for a self-referencing arrow (both ends on the same shape).
 *
 * For curved/straight/undefined routing, returns the original start→end pair
 * (renderer draws a bezier curve). For orthogonal/elbow/orthogonalCurved,
 * computes a right-angle loop that extends outward from the shape.
 *
 * Shared between the arrow renderer and hit testing to ensure the rendered
 * path matches the hit-test path exactly.
 *
 * @param start   Connection point on shape edge (start)
 * @param end     Connection point on shape edge (end)
 * @param routing Arrow routing mode
 * @param target  Shape that the self-loop is bound to (position + size)
 * @param jettySize How far the loop extends outward from the shape
 *
 * [CLEAN-CODE] [SRP] — one function computes the path; callers decide how to use it.
 */
export function computeSelfLoopPath(
  start: [number, number],
  end: [number, number],
  routing: string | undefined,
  target: { position: { x: number; y: number }; size: { width: number; height: number } } | undefined,
  jettySize: number,
): { points: [number, number][]; isCurved: boolean } {
  // For curved/straight/undefined: renderer draws bezier
  if (!routing || routing === 'straight' || routing === 'curved') {
    return { points: [start, end], isCurved: true };
  }

  // For orthogonal/elbow/orthogonalCurved: compute right-angle loop
  if (!target) {
    return { points: [start, end], isCurved: true }; // fallback
  }

  const shapeCx = target.position.x + target.size.width / 2;
  const shapeCy = target.position.y + target.size.height / 2;
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;

  // Direction outward from shape center
  const dx = midX - shapeCx;
  const dy = midY - shapeCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Start and end are on left or right side — loop outward horizontally
    const outX = dx >= 0
      ? Math.max(start[0], end[0]) + jettySize
      : Math.min(start[0], end[0]) - jettySize;
    return {
      points: [start, [outX, start[1]], [outX, end[1]], end],
      isCurved: false,
    };
  } else {
    // Start and end are on top or bottom — loop outward vertically
    const outY = dy >= 0
      ? Math.max(start[1], end[1]) + jettySize
      : Math.min(start[1], end[1]) - jettySize;
    return {
      points: [start, [start[0], outY], [end[0], outY], end],
      isCurved: false,
    };
  }
}

// ══════════════════════════════════════════════════════════════
// 6. Geometry helpers
// ══════════════════════════════════════════════════════════════

/** Check if a direction is horizontal (left or right). */
function isHorizontal(dir: Direction): boolean {
  return dir === 'left' || dir === 'right';
}

/**
 * Push a mid-segment coordinate out of blocking shapes.
 *
 * For a vertical mid-segment at X = midVal, check if it would cross
 * through either shape's bounds (considering the Y range of the segment).
 * If it does, push it to the nearest clear edge + padding.
 */
function avoidShapesOnAxis(
  midVal: number,
  axis: 'x' | 'y',
  crossStart: number,
  crossEnd: number,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  padding: number,
): number {
  const lo = Math.min(crossStart, crossEnd);
  const hi = Math.max(crossStart, crossEnd);

  for (const b of [sBounds, eBounds]) {
    if (!b) continue;

    if (axis === 'x') {
      // Check if vertical segment at midVal crosses shape
      if (midVal > b.x && midVal < b.x + b.width &&
          hi > b.y && lo < b.y + b.height) {
        const r = b.x + b.width + padding;
        const l = b.x - padding;
        midVal = Math.abs(r - midVal) <= Math.abs(l - midVal) ? r : l;
      }
    } else {
      // Check if horizontal segment at midVal crosses shape
      if (midVal > b.y && midVal < b.y + b.height &&
          hi > b.x && lo < b.x + b.width) {
        const d = b.y + b.height + padding;
        const u = b.y - padding;
        midVal = Math.abs(d - midVal) <= Math.abs(u - midVal) ? d : u;
      }
    }
  }

  return midVal;
}

/**
 * Check whether an orthogonal segment crosses through a rect.
 *
 * Uses epsilon tolerance — segments within EDGE_EPSILON of shape edges
 * are treated as crossing.
 */
function segmentCrossesRect(
  p1: Point,
  p2: Point,
  rect?: Rect,
): boolean {
  if (!rect) return false;
  const [x1, y1] = p1;
  const [x2, y2] = p2;

  if (y1 === y2) {
    // Horizontal segment
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    return y1 > rect.y - EDGE_EPSILON &&
           y1 < rect.y + rect.height + EDGE_EPSILON &&
           maxX > rect.x - EDGE_EPSILON &&
           minX < rect.x + rect.width + EDGE_EPSILON;
  }

  if (x1 === x2) {
    // Vertical segment
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return x1 > rect.x - EDGE_EPSILON &&
           x1 < rect.x + rect.width + EDGE_EPSILON &&
           maxY > rect.y - EDGE_EPSILON &&
           minY < rect.y + rect.height + EDGE_EPSILON;
  }

  return false;
}

/**
 * Compute a clearance coordinate outside both shapes for C-shape detours.
 *
 * Returns an x (if isXAxis) or y that clears all shape extents + padding.
 */
function computeCShapeClearance(
  isXAxis: boolean,
  sBounds: Rect | undefined,
  eBounds: Rect | undefined,
  exit: Point,
  entry: Point,
  padding: number,
): number {
  const all = [sBounds, eBounds].filter(Boolean) as Rect[];

  if (all.length === 0) {
    return isXAxis
      ? (exit[0] + entry[0]) / 2
      : (exit[1] + entry[1]) / 2;
  }

  if (isXAxis) {
    const lo = Math.min(...all.map(b => b.x)) - padding;
    const hi = Math.max(...all.map(b => b.x + b.width)) + padding;
    const avg = (exit[0] + entry[0]) / 2;
    return Math.abs(avg - lo) < Math.abs(avg - hi) ? lo : hi;
  }

  const lo = Math.min(...all.map(b => b.y)) - padding;
  const hi = Math.max(...all.map(b => b.y + b.height)) + padding;
  const avg = (exit[1] + entry[1]) / 2;
  return Math.abs(avg - lo) < Math.abs(avg - hi) ? lo : hi;
}
