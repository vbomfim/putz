/**
 * Manipulation helpers — pure functions for handle detection,
 * resize computation, and cursor mapping.
 *
 * Extracted from useManipulationInteraction for testability.
 * All functions are side-effect free. [CLEAN-CODE]
 *
 * @module
 */

import type { VisualExpression, ArrowData } from '../../protocol';
import type { Camera } from '../types/index';
import { computeOrthogonalRoute, computeSelfLoopPath } from '../connectors/orthogonalRouter';
import { resolveBindings } from './connectorHelpers';

// ── Point-based kind guard ─────────────────────────────────────

/** Expression kinds that use `data.points` for geometry. */
export type PointBasedKind = 'line' | 'arrow' | 'freehand';

/**
 * Check if an expression kind uses point-based geometry.
 *
 * Lines, arrows, and freehand shapes store their geometry in
 * `data.points` rather than using `position`/`size` alone. [CLEAN-CODE]
 */
export function isPointBasedKind(kind: string): kind is PointBasedKind {
  return kind === 'line' || kind === 'arrow' || kind === 'freehand';
}

// ── Handle types ──────────────────────────────────────────────

/** The 8 resize handle positions (4 corners + 4 edge midpoints). */
export type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Result of detecting a handle at a given point. */
export interface HandleHit {
  type: HandleType;
  expressionId: string;
}

/** Result of detecting a point handle (endpoint of a line/arrow/freehand). */
export interface PointHandleHit {
  pointIndex: number;
  expressionId: string;
}

/**
 * Result of detecting a jetty (spacing) handle on a routed arrow.
 *
 * The handle appears at the midpoint of the exit stub and can be
 * dragged along the stub direction to adjust `jettySize`.
 */
export interface JettyHandleHit {
  expressionId: string;
  /** Which end of the arrow this handle is near. */
  end: 'start' | 'end';
  /** World position of the handle. */
  position: { x: number; y: number };
  /** Unit direction vector of the stub (away from shape). */
  direction: { x: number; y: number };
  /**
   * Orientation of the segment where the handle sits.
   *
   * - `'horizontal'` — segment runs left/right → cursor should be `ns-resize`
   * - `'vertical'` — segment runs up/down → cursor should be `ew-resize`
   *
   * [CLEAN-CODE] Explicit orientation avoids inferring it from direction.
   */
  segmentOrientation: 'horizontal' | 'vertical';
  /**
   * Whether dragging this handle adjusts `midpointOffset` (Z-shape)
   * or `jettySize` (self-loop / non-Z-shape).
   *
   * - `true` (default) → drag updates `midpointOffset` ratio
   * - `false` → drag updates `jettySize` distance
   */
  adjustsMidpoint?: boolean;
}

/**
 * Result of detecting a segment midpoint handle on a routed arrow.
 *
 * The handle appears at the midpoint of each internal segment.
 * Horizontal segments drag vertically (ns-resize), vertical segments
 * drag horizontally (ew-resize).
 */
export interface SegmentHandleHit {
  expressionId: string;
  /** Index of the segment in the route's internal segments. */
  segmentIndex: number;
  /** World position of the handle. */
  position: { x: number; y: number };
  /** Orientation of the segment. */
  segmentOrientation: 'horizontal' | 'vertical';
}

/** Result of detecting what the pointer is hovering over. */
export type PointerTarget =
  | { kind: 'handle'; handle: HandleHit }
  | { kind: 'point-handle'; handle: PointHandleHit }
  | { kind: 'jetty-handle'; handle: JettyHandleHit }
  | { kind: 'segment-handle'; handle: SegmentHandleHit }
  | { kind: 'body'; expressionId: string }
  | { kind: 'none' };

/** Tolerance in screen pixels for handle detection. */
const HANDLE_TOLERANCE_PX = 8;

/** Minimum expression size in world units. */
export const MIN_SIZE = 10;

// ── Handle detection ──────────────────────────────────────────

/**
 * Compute the 8 handle positions for an expression in world coordinates.
 *
 * Order matches selectionRenderer.ts:
 *   [nw, ne, se, sw, n, e, s, w]
 */
export function getHandlePositions(
  expr: VisualExpression,
): Array<{ x: number; y: number; type: HandleType }> {
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  return [
    { x, y, type: 'nw' },
    { x: x + width, y, type: 'ne' },
    { x: x + width, y: y + height, type: 'se' },
    { x, y: y + height, type: 'sw' },
    { x: x + width / 2, y, type: 'n' },
    { x: x + width, y: y + height / 2, type: 'e' },
    { x: x + width / 2, y: y + height, type: 's' },
    { x, y: y + height / 2, type: 'w' },
  ];
}

/**
 * Detect which bbox handle (if any) is at the given world point.
 *
 * Checks all selected non-point-based expressions' handles. Returns the
 * first hit within HANDLE_TOLERANCE_PX screen pixels of the handle center.
 * Point-based shapes (line, arrow, freehand) are skipped — they use
 * point handles instead.
 */
export function detectHandle(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  selectedIds: Set<string>,
  camera: Camera,
): HandleHit | null {
  const tolerance = HANDLE_TOLERANCE_PX / camera.zoom;

  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;

    // Point-based shapes use point handles, not bbox handles
    if (isPointBasedKind(expr.data.kind)) continue;

    const handles = getHandlePositions(expr);
    for (const handle of handles) {
      const dx = worldPoint.x - handle.x;
      const dy = worldPoint.y - handle.y;
      if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
        return { type: handle.type, expressionId: id };
      }
    }
  }

  return null;
}

// ── Point-based handle detection ──────────────────────────────

/**
 * Compute point handle positions for a point-based expression.
 *
 * - Lines and arrows: returns a handle at each point in `data.points`.
 * - Freehand: returns handles at first and last point only (not all points).
 * - Non-point-based expressions: returns empty array.
 *
 * @returns Array of handle positions with their point index.
 */
export function getPointHandlePositions(
  expr: VisualExpression,
): Array<{ x: number; y: number; pointIndex: number }> {
  if (!isPointBasedKind(expr.data.kind)) return [];

  const data = expr.data as { points: [number, number][] | [number, number, number][] };
  const { points } = data;

  if (points.length === 0) return [];

  if (expr.data.kind === 'freehand') {
    // Freehand: first and last point only
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (points.length === 1) {
      return [{ x: first[0], y: first[1], pointIndex: 0 }];
    }
    return [
      { x: first[0], y: first[1], pointIndex: 0 },
      { x: last[0], y: last[1], pointIndex: points.length - 1 },
    ];
  }

  // Lines and arrows: handle at each point
  return points.map((p, i) => ({ x: p[0], y: p[1], pointIndex: i }));
}

/**
 * Detect which point handle (if any) is at the given world point.
 *
 * Only checks point-based expressions (line, arrow, freehand).
 * Returns the first hit within HANDLE_TOLERANCE_PX screen pixels.
 */
export function detectPointHandle(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  selectedIds: Set<string>,
  camera: Camera,
): PointHandleHit | null {
  const tolerance = HANDLE_TOLERANCE_PX / camera.zoom;

  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr || !isPointBasedKind(expr.data.kind)) continue;

    const handles = getPointHandlePositions(expr);
    for (const handle of handles) {
      const dx = worldPoint.x - handle.x;
      const dy = worldPoint.y - handle.y;
      if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
        return { pointIndex: handle.pointIndex, expressionId: id };
      }
    }
  }

  return null;
}

// ── Jetty handle detection ──────────────────────────────────

/** Default stub length when jettySize is not set. */
const DEFAULT_JETTY_SIZE = 20;

/** Routing modes that produce exit stubs where a jetty handle makes sense.
 * 'curved' removed — curved routes have no stubs. [Bug #6]
 * 'elbow' removed — now an alias for orthogonal (already in the set). */
const JETTY_ROUTING_MODES = new Set([
  'orthogonal',
  'entityRelation',
  'isometric',
  'orthogonalCurved',
]);

/**
 * Resolve the exit direction unit vector for a given anchor.
 *
 * Arrows exit perpendicular to the anchored edge. When no anchor is
 * provided, infer direction from the delta between start and end.
 *
 * [CLEAN-CODE] [SRP]
 */
function resolveExitDirection(
  anchor: string | undefined,
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  switch (anchor) {
    case 'right':
      return { x: 1, y: 0 };
    case 'left':
      return { x: -1, y: 0 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'top':
      return { x: 0, y: -1 };
    case 'top-right':
      return { x: 1, y: 0 };
    case 'bottom-right':
      return { x: 1, y: 0 };
    case 'top-left':
      return { x: -1, y: 0 };
    case 'bottom-left':
      return { x: -1, y: 0 };
    default: {
      // Infer from delta — pick the dominant axis
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        return { x: dx >= 0 ? 1 : -1, y: 0 };
      }
      return { x: 0, y: dy >= 0 ? 1 : -1 };
    }
  }
}

/**
 * Compute the jetty handle position for a routed arrow.
 *
 * For Z-shape routes (same-axis exits, normal flow), the handle sits
 * at the midpoint of the middle segment — the vertical or horizontal
 * bar that connects the exit and entry stubs. Dragging it adjusts
 * `midpointOffset` (0–1 ratio controlling the Z-turn position).
 *
 * For non-Z-shape routes (L-shape, C-shape, etc.), the handle sits
 * at the midpoint of the exit stub for jettySize adjustment.
 *
 * Returns null for non-arrow expressions, straight arrows, or
 * routing modes that don't produce stubs.
 *
 * [CLEAN-CODE] [SRP]
 */
export function getJettyHandlePosition(
  expr: VisualExpression,
): JettyHandleHit | null {
  if (expr.data.kind !== 'arrow') return null;

  const data = expr.data as {
    kind: 'arrow';
    points: [number, number][];
    routing?: string;
    jettySize?: number | 'auto';
    midpointOffset?: number;
    startBinding?: { expressionId: string; anchor: string };
    endBinding?: { expressionId: string; anchor: string };
  };

  if (!data.routing || !JETTY_ROUTING_MODES.has(data.routing)) return null;
  if (data.points.length < 2) return null;

  const startPt = { x: data.points[0]![0], y: data.points[0]![1] };
  const endPt = {
    x: data.points[data.points.length - 1]![0],
    y: data.points[data.points.length - 1]![1],
  };

  const jettySize =
    typeof data.jettySize === 'number' ? data.jettySize : DEFAULT_JETTY_SIZE;

  const startAnchor = data.startBinding?.anchor;
  const endAnchor = data.endBinding?.anchor;
  const exitDir = resolveExitDirection(startAnchor, startPt, endPt);
  const entryDir = resolveExitDirection(endAnchor, endPt, startPt);

  // Check if this is a Z-shape route (same-axis exits, normal flow)
  const exitH = exitDir.x !== 0;
  const entryH = entryDir.x !== 0;

  if (exitH === entryH) {
    // Same axis — check for normal flow (Z-shape)
    const exitStubEnd = exitH
      ? startPt.x + exitDir.x * jettySize
      : startPt.y + exitDir.y * jettySize;
    const entryStubEnd = entryH
      ? endPt.x + entryDir.x * jettySize
      : endPt.y + entryDir.y * jettySize;

    const forward = exitH ? exitDir.x : exitDir.y;
    const diff = exitH
      ? entryStubEnd - exitStubEnd
      : entryStubEnd - exitStubEnd;
    const normalFlow = (forward > 0 && diff > 0) || (forward < 0 && diff < 0);

    if (normalFlow) {
      // Z-shape: handle on the middle segment
      const t = data.midpointOffset ?? 0.5;

      if (exitH) {
        // Horizontal flow → vertical middle segment
        const midX = exitStubEnd + (entryStubEnd - exitStubEnd) * t;
        return {
          expressionId: expr.id,
          end: 'start',
          position: {
            x: midX,
            y: (startPt.y + endPt.y) / 2,
          },
          // Drag direction is horizontal (moves the vertical bar left/right)
          direction: { x: 1, y: 0 },
          // Middle segment runs vertically
          segmentOrientation: 'vertical',
          adjustsMidpoint: true,
        };
      }

      // Vertical flow → horizontal middle segment
      const midY = exitStubEnd + (entryStubEnd - exitStubEnd) * t;
      return {
        expressionId: expr.id,
        end: 'start',
        position: {
          x: (startPt.x + endPt.x) / 2,
          y: midY,
        },
        // Drag direction is vertical (moves the horizontal bar up/down)
        direction: { x: 0, y: 1 },
        // Middle segment runs horizontally
        segmentOrientation: 'horizontal',
        adjustsMidpoint: true,
      };
    }
  }

  // Non-Z-shape (L-shape, C-shape, etc.) → fallback to exit stub midpoint
  // Exit stub orientation: horizontal if exitDir.x != 0, vertical if exitDir.y != 0
  const stubOrientation: 'horizontal' | 'vertical' = exitDir.x !== 0 ? 'horizontal' : 'vertical';
  return {
    expressionId: expr.id,
    end: 'start',
    position: {
      x: startPt.x + exitDir.x * (jettySize / 2),
      y: startPt.y + exitDir.y * (jettySize / 2),
    },
    direction: exitDir,
    segmentOrientation: stubOrientation,
    adjustsMidpoint: false,
  };
}

/**
 * Detect whether the pointer is near a jetty handle on a selected arrow.
 *
 * Only checks selected, routed arrows. Returns the first hit within
 * HANDLE_TOLERANCE_PX screen pixels.
 *
 * [CLEAN-CODE] [SRP]
 */
export function detectJettyHandle(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  selectedIds: Set<string>,
  camera: Camera,
): JettyHandleHit | null {
  const tolerance = HANDLE_TOLERANCE_PX / camera.zoom;

  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;

    // Skip jetty handle when segment-midpoint handles are shown (same role,
    // same visual). Keeps hit-testing consistent with rendering.
    if (getSegmentMidpointHandles(expr, expressions).length > 0) continue;

    const handle = getJettyHandlePosition(expr);
    if (!handle) continue;

    const dx = worldPoint.x - handle.position.x;
    const dy = worldPoint.y - handle.position.y;
    if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
      return handle;
    }
  }

  // ── Self-loop handle check (reuses JettyHandleHit) ──
  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;

    const handle = getSelfLoopHandlePosition(expr, expressions);
    if (!handle) continue;

    const dx = worldPoint.x - handle.position.x;
    const dy = worldPoint.y - handle.position.y;
    if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
      return handle;
    }
  }

  return null;
}

// ── Self-loop handle ─────────────────────────────────────────

/** Routing modes that produce orthogonal self-loops with a drag handle. */
const SELF_LOOP_HANDLE_ROUTING = new Set([
  'orthogonal',
  'elbow',
  'orthogonalCurved',
  'entityRelation',
  'isometric',
]);

/**
 * Compute the handle position for a self-loop arrow's outer segment.
 *
 * For orthogonal self-loops (4 points: start → corner1 → corner2 → end),
 * places ONE handle at the midpoint of the outer segment (corner1 → corner2).
 * This is the segment farthest from the shape. Dragging it adjusts `jettySize`.
 *
 * Returns null for:
 * - Non-self-loop arrows
 * - Curved/straight self-loops (no orthogonal path to place handle on)
 * - Missing target shape
 *
 * [CLEAN-CODE] [SRP]
 */
export function getSelfLoopHandlePosition(
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
): JettyHandleHit | null {
  if (expr.data.kind !== 'arrow') return null;

  const data = expr.data as ArrowData;

  // Must be a self-loop (both ends bound to the same shape)
  if (!data.startBinding || !data.endBinding) return null;
  if (data.startBinding.expressionId !== data.endBinding.expressionId) return null;

  // Only orthogonal-family routing produces a right-angle loop
  if (!data.routing || !SELF_LOOP_HANDLE_ROUTING.has(data.routing)) return null;
  if (data.points.length < 2) return null;

  const target = expressions[data.startBinding.expressionId];
  if (!target) return null;

  const start = data.points[0]!;
  const end = data.points[data.points.length - 1]!;
  const jetty = typeof data.jettySize === 'number' ? data.jettySize : 30;

  const path = computeSelfLoopPath(start, end, data.routing, target, jetty);
  if (path.isCurved || path.points.length < 4) return null;

  // Outer segment is points[1] → points[2] (the segment farthest from shape)
  const corner1 = path.points[1]!;
  const corner2 = path.points[2]!;
  const midX = (corner1[0] + corner2[0]) / 2;
  const midY = (corner1[1] + corner2[1]) / 2;

  // Determine segment orientation and outward direction
  const isHoriz = Math.abs(corner1[1] - corner2[1]) < 0.01;
  const shapeCx = target.position.x + target.size.width / 2;
  const shapeCy = target.position.y + target.size.height / 2;

  let direction: { x: number; y: number };
  if (isHoriz) {
    // Horizontal outer segment → drag vertically (away from shape)
    direction = midY < shapeCy ? { x: 0, y: -1 } : { x: 0, y: 1 };
  } else {
    // Vertical outer segment → drag horizontally (away from shape)
    direction = midX < shapeCx ? { x: -1, y: 0 } : { x: 1, y: 0 };
  }

  return {
    expressionId: expr.id,
    end: 'start',
    position: { x: midX, y: midY },
    direction,
    segmentOrientation: isHoriz ? 'horizontal' : 'vertical',
    adjustsMidpoint: false,
  };
}

// ── Segment midpoint handles ─────────────────────────────────

/** Routing modes that produce orthogonal segments with draggable midpoints. */
const SEGMENT_HANDLE_ROUTING_MODES = new Set([
  'orthogonal',
  'orthogonalCurved',
]);

/**
 * Compute segment midpoint handle positions for a routed arrow.
 *
 * For each internal segment of the orthogonal route (excluding the
 * first and last segments which are jetty stubs), computes a handle
 * at the segment midpoint.
 *
 * @param expr - The arrow expression
 * @param expressions - All expressions (for resolving bindings and bounds)
 * @returns Array of segment handle descriptors
 *
 * [CLEAN-CODE] [SRP]
 */
export function getSegmentMidpointHandles(
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
): SegmentHandleHit[] {
  if (expr.data.kind !== 'arrow') return [];

  const data = expr.data as ArrowData;
  if (!data.routing || !SEGMENT_HANDLE_ROUTING_MODES.has(data.routing)) return [];
  if (data.points.length < 2) return [];

  // Self-loops use computeSelfLoopPath, not computeOrthogonalRoute —
  // skip segment handles (the self-loop gets ONE handle via getSelfLoopHandlePosition)
  if (data.startBinding && data.endBinding &&
      data.startBinding.expressionId === data.endBinding.expressionId) {
    return [];
  }

  // Resolve binding positions to get absolute world coordinates
  const points = resolveBindings(expr, expressions);
  if (points.length < 2) return [];

  const startPt = { x: points[0]![0], y: points[0]![1] };
  const endPt = { x: points[points.length - 1]![0], y: points[points.length - 1]![1] };

  // Resolve shape bounds for the router
  const startBoundExpr = data.startBinding
    ? expressions[data.startBinding.expressionId]
    : undefined;
  const endBoundExpr = data.endBinding
    ? expressions[data.endBinding.expressionId]
    : undefined;

  // Compute the actual route waypoints
  const routeWaypoints = computeOrthogonalRoute(
    startPt,
    endPt,
    data.startBinding?.anchor,
    data.endBinding?.anchor,
    startBoundExpr ? {
      x: startBoundExpr.position.x,
      y: startBoundExpr.position.y,
      width: startBoundExpr.size.width,
      height: startBoundExpr.size.height,
    } : undefined,
    endBoundExpr ? {
      x: endBoundExpr.position.x,
      y: endBoundExpr.position.y,
      width: endBoundExpr.size.width,
      height: endBoundExpr.size.height,
    } : undefined,
    typeof data.jettySize === 'number' ? data.jettySize : undefined,
    typeof data.midpointOffset === 'number' ? data.midpointOffset : undefined,
    data.waypoints,
  );

  if (routeWaypoints.length < 4) return []; // Need at least start, stub, stub, end

  const handles: SegmentHandleHit[] = [];

  // Emit a handle on every internal segment (i.e. every segment between the
  // exit stub and the entry stub), up to 2 handles. The router supports two
  // waypoints for L-shape routes:
  //   waypoints[0] → first perpendicular-to-exit middle segment
  //   waypoints[1] → second middle segment (perpendicular to the first)
  // For Z-shape routes, only one waypoint is meaningful and only one handle
  // is produced.
  let slot = 0;
  for (let i = 1; i < routeWaypoints.length - 2; i++) {
    const [x1, y1] = routeWaypoints[i]!;
    const [x2, y2] = routeWaypoints[i + 1]!;

    const isHoriz = Math.abs(y1 - y2) < 0.01 && Math.abs(x1 - x2) >= 0.01;
    const isVert = Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) >= 0.01;
    const orientation: 'horizontal' | 'vertical' | null = isHoriz
      ? 'horizontal'
      : isVert
        ? 'vertical'
        : null;
    if (!orientation) continue;

    handles.push({
      expressionId: expr.id,
      segmentIndex: slot,
      position: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      segmentOrientation: orientation,
    });
    slot += 1;
    if (slot >= 2) break;
  }

  return handles;
}

/**
 * Detect whether the pointer is near a segment midpoint handle.
 *
 * Only checks selected, routed arrows. Returns the first hit within
 * HANDLE_TOLERANCE_PX screen pixels.
 *
 * [CLEAN-CODE] [SRP]
 */
export function detectSegmentHandle(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  selectedIds: Set<string>,
  camera: Camera,
): SegmentHandleHit | null {
  const tolerance = HANDLE_TOLERANCE_PX / camera.zoom;

  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;

    const handles = getSegmentMidpointHandles(expr, expressions);
    for (const handle of handles) {
      const dx = worldPoint.x - handle.position.x;
      const dy = worldPoint.y - handle.position.y;
      if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
        return handle;
      }
    }
  }

  return null;
}

/**
 * Detect what the pointer is targeting: a handle, a shape body, or nothing.
 *
 * Priority: point handles → jetty handles → bbox handles → body.
 * Point-based shapes (line, arrow, freehand) use point handles instead
 * of the 8 bounding-box handles.
 */
export function detectPointerTarget(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  selectedIds: Set<string>,
  camera: Camera,
): PointerTarget {
  // Check point handles first (for line/arrow/freehand)
  const pointHandle = detectPointHandle(worldPoint, expressions, selectedIds, camera);
  if (pointHandle) {
    return { kind: 'point-handle', handle: pointHandle };
  }

  // Check jetty handles (for routed arrows with exit stubs)
  const jettyHandle = detectJettyHandle(worldPoint, expressions, selectedIds, camera);
  if (jettyHandle) {
    return { kind: 'jetty-handle', handle: jettyHandle };
  }

  // Check segment midpoint handles (for routed arrows)
  const segHandle = detectSegmentHandle(worldPoint, expressions, selectedIds, camera);
  if (segHandle) {
    return { kind: 'segment-handle', handle: segHandle };
  }

  // Check bbox handles (only for non-point-based shapes)
  const handle = detectHandle(worldPoint, expressions, selectedIds, camera);
  if (handle) {
    return { kind: 'handle', handle };
  }

  // Check shape bodies (only selected shapes can be moved)
  for (const id of selectedIds) {
    const expr = expressions[id];
    if (!expr) continue;

    const { x, y } = expr.position;
    const { width, height } = expr.size;

    if (
      worldPoint.x >= x &&
      worldPoint.x <= x + width &&
      worldPoint.y >= y &&
      worldPoint.y <= y + height
    ) {
      return { kind: 'body', expressionId: id };
    }
  }

  return { kind: 'none' };
}

// ── Cursor mapping ────────────────────────────────────────────

/** Map a handle type to its CSS cursor value. */
const HANDLE_CURSORS: Record<HandleType, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Get the appropriate CSS cursor for a pointer target. */
export function getCursorForTarget(target: PointerTarget): string {
  switch (target.kind) {
    case 'handle':
      return HANDLE_CURSORS[target.handle.type];
    case 'point-handle':
      return 'crosshair';
    case 'jetty-handle': {
      // Cursor is perpendicular to the segment: horizontal segment → ns-resize,
      // vertical segment → ew-resize
      const { segmentOrientation } = target.handle;
      return segmentOrientation === 'horizontal' ? 'ns-resize' : 'ew-resize';
    }
    case 'segment-handle': {
      // Same cursor logic as jetty-handle: perpendicular to segment
      const { segmentOrientation: so } = target.handle;
      return so === 'horizontal' ? 'ns-resize' : 'ew-resize';
    }
    case 'body':
      return 'move';
    case 'none':
      return 'default';
  }
}

// ── Resize computation ────────────────────────────────────────

interface ResizeInput {
  handleType: HandleType;
  deltaX: number;
  deltaY: number;
  originalPosition: { x: number; y: number };
  originalSize: { width: number; height: number };
  shiftKey: boolean;
  ctrlKey: boolean;
}

interface ResizeResult {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Compute new position and size after a resize drag.
 *
 * Corner handles resize both dimensions; edge handles resize one dimension.
 * Shift key constrains aspect ratio on corner handles.
 * Minimum size is enforced at MIN_SIZE × MIN_SIZE world units. [AC5]
 */
export function computeResize(input: ResizeInput): ResizeResult {
  const { handleType, deltaX, deltaY, originalPosition, originalSize, shiftKey, ctrlKey } = input;

  let newX = originalPosition.x;
  let newY = originalPosition.y;
  let newWidth = originalSize.width;
  let newHeight = originalSize.height;

  switch (handleType) {
    // ── Corner handles: resize both dimensions ──
    case 'se':
      newWidth = originalSize.width + deltaX;
      newHeight = originalSize.height + deltaY;
      break;
    case 'nw':
      newWidth = originalSize.width - deltaX;
      newHeight = originalSize.height - deltaY;
      newX = originalPosition.x + deltaX;
      newY = originalPosition.y + deltaY;
      break;
    case 'ne':
      newWidth = originalSize.width + deltaX;
      newHeight = originalSize.height - deltaY;
      newY = originalPosition.y + deltaY;
      break;
    case 'sw':
      newWidth = originalSize.width - deltaX;
      newHeight = originalSize.height + deltaY;
      newX = originalPosition.x + deltaX;
      break;

    // ── Edge handles: resize one dimension only ──
    case 'e':
      newWidth = originalSize.width + deltaX;
      break;
    case 'w':
      newWidth = originalSize.width - deltaX;
      newX = originalPosition.x + deltaX;
      break;
    case 's':
      newHeight = originalSize.height + deltaY;
      break;
    case 'n':
      newHeight = originalSize.height - deltaY;
      newY = originalPosition.y + deltaY;
      break;
  }

  // ── Shift: constrain aspect ratio on corner handles ──
  if (shiftKey && isCornerHandle(handleType)) {
    const aspectRatio = originalSize.width / originalSize.height;

    if (newWidth / aspectRatio > newHeight) {
      // Width is the dominant change; adjust height
      newHeight = newWidth / aspectRatio;
    } else {
      // Height is the dominant change; adjust width
      newWidth = newHeight * aspectRatio;
    }

    // Re-adjust position for handles that move the origin
    if (handleType === 'nw') {
      newX = originalPosition.x + originalSize.width - newWidth;
      newY = originalPosition.y + originalSize.height - newHeight;
    } else if (handleType === 'ne') {
      newY = originalPosition.y + originalSize.height - newHeight;
    } else if (handleType === 'sw') {
      newX = originalPosition.x + originalSize.width - newWidth;
    }
    // 'se' doesn't move the origin
  }

  // ── Ctrl/Cmd: force 1:1 aspect ratio (square/circle) on corner handles ──
  if (ctrlKey && isCornerHandle(handleType)) {
    const maxDim = Math.max(newWidth, newHeight);
    newWidth = maxDim;
    newHeight = maxDim;

    // Re-adjust position for handles that move the origin
    if (handleType === 'nw') {
      newX = originalPosition.x + originalSize.width - newWidth;
      newY = originalPosition.y + originalSize.height - newHeight;
    } else if (handleType === 'ne') {
      newY = originalPosition.y + originalSize.height - newHeight;
    } else if (handleType === 'sw') {
      newX = originalPosition.x + originalSize.width - newWidth;
    }
  }

  // ── Enforce minimum size [AC5] ──
  if (newWidth < MIN_SIZE) {
    // Adjust position back if this handle moves the origin
    if (handleType === 'nw' || handleType === 'sw' || handleType === 'w') {
      newX = originalPosition.x + originalSize.width - MIN_SIZE;
    }
    newWidth = MIN_SIZE;
  }
  if (newHeight < MIN_SIZE) {
    if (handleType === 'nw' || handleType === 'ne' || handleType === 'n') {
      newY = originalPosition.y + originalSize.height - MIN_SIZE;
    }
    newHeight = MIN_SIZE;
  }

  return {
    position: { x: newX, y: newY },
    size: { width: newWidth, height: newHeight },
  };
}

/** Check if a handle is a corner handle (resizes both dimensions). */
function isCornerHandle(type: HandleType): boolean {
  return type === 'nw' || type === 'ne' || type === 'se' || type === 'sw';
}

// ── Point drag computation ────────────────────────────────────

interface PointDragInput {
  /** Index of the point being dragged. */
  pointIndex: number;
  /** Original points array (not mutated). */
  originalPoints: [number, number][];
  /** New world position for the dragged point. */
  newPointPosition: { x: number; y: number };
}

interface PointDragResult {
  /** Updated points array with the dragged point moved. */
  points: [number, number][];
  /** Recalculated bounding-box position (top-left). */
  position: { x: number; y: number };
  /** Recalculated bounding-box size. Zero dimensions are clamped to 1. */
  size: { width: number; height: number };
}

/**
 * Compute the result of dragging a single point in a point-based shape.
 *
 * Updates the specific point, then recalculates the bounding box
 * (position and size) from all points. Does not mutate the original
 * points array. [CLEAN-CODE]
 */
export function computePointDrag(input: PointDragInput): PointDragResult {
  const { pointIndex, originalPoints, newPointPosition } = input;

  // Clone points and update the dragged point
  const points: [number, number][] = originalPoints.map(
    (p) => [p[0], p[1]] as [number, number],
  );
  points[pointIndex] = [newPointPosition.x, newPointPosition.y];

  // Recalculate bounding box from all points
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    points,
    position: { x: minX, y: minY },
    size: {
      width: maxX - minX || 1,
      height: maxY - minY || 1,
    },
  };
}
