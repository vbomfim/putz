/**
 * Arrow renderer — unified rendering pipeline for all arrow types.
 *
 * Extracted from primitiveRenderer.ts for single responsibility.
 * Handles: binding resolution → routing → path drawing → arrowheads → labels.
 *
 * ALL routed arrows render via Canvas2D `renderPathSegments()`.
 * Straight arrows (no routing) still use Rough.js linearPath.
 * Self-loop arrows render with cubic bezier.
 *
 * [CLEAN-CODE] [SRP] — one function, one job: render an arrow.
 * [HEXAGONAL] — decoupled from router implementation via routerRegistry.
 *
 * @module
 */

import type { VisualExpression, ArrowData } from "../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import type { Camera } from "../types/index";
import type { PathSegment } from "../connectors/routerTypes";
import { mapStyleToRoughOptions, idToSeed } from "./styleMapper";
import { resolveBindings } from "../interaction/connectorHelpers";
import { getRouter } from "../connectors/routerRegistry";
import { renderArrowheadFromRegistry } from "./arrowheads";
import { computeSelfLoopPath } from "../connectors/orthogonalRouter";

// ── Constants ────────────────────────────────────────────────

/** Arrowhead size in world pixels. */
const ARROWHEAD_SIZE = 10;

// ── Public API ───────────────────────────────────────────────

/**
 * Render an arrow expression with arrowheads and connector bindings.
 *
 * Unified pipeline:
 * 1. Resolve arrowhead types (backward compat: true → 'triangle')
 * 2. Resolve binding positions → absolute world coordinates
 * 3. Route: dispatch via routerRegistry to get PathSegment[]
 * 4. Render: Canvas2D for routed arrows, Rough.js for straight
 * 5. Arrowheads at both endpoints
 * 6. Label at midpoint
 *
 * [AC5] No drawable cache for routed arrows — always fresh path.
 * [AC6] All routing modes render with correct arrowhead angles.
 */
export function renderArrow(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
  camera?: Camera,
  computePositionOffset?: (expr: VisualExpression) => { x: number; y: number },
  getOrCreateDrawable?: (
    expr: VisualExpression,
    factory: () => unknown,
  ) => unknown,
): void {
  if (expr.data.kind !== "arrow") return;
  const data = expr.data as ArrowData;
  const startType = resolveArrowheadType(data.startArrowhead);
  const endType = resolveArrowheadType(data.endArrowhead);
  const options = mapStyleToRoughOptions(
    expr.style,
    idToSeed(expr.id),
  ) as unknown as Record<string, unknown>;

  // Arrowhead sizing — must always be larger than the stroke width
  const zoom = camera?.zoom ?? 1;
  const baseArrowSize = 5 + ARROWHEAD_SIZE * (expr.style.strokeWidth / 2);
  const minArrowSize = Math.max(expr.style.strokeWidth * 4, 8 / zoom);
  const arrowSize = Math.max(baseArrowSize, minArrowSize);

  // Resolve fill mode and colors for arrowheads
  const startFilled = data.startFill !== false;
  const endFilled = data.endFill !== false;
  const strokeColor = expr.style.strokeColor;
  const fillColor = expr.style.backgroundColor;

  // Resolve binding positions for connected arrows
  const points = resolveBindings(expr, expressions);
  if (points.length < 2) return;

  // ── Routing via registry ──
  // All routed arrows go through the registry to produce PathSegment[].
  // orthogonal + curved → 'orthogonalCurved' mode in the registry.
  let pathSegments: PathSegment[] | null = null;
  const routingMode =
    data.routing === "orthogonal" && data.curved
      ? ("orthogonalCurved" as const)
      : data.routing;
  const router = getRouter(routingMode);

  if (router && points.length === 2) {
    const startBounds = data.startBinding
      ? expressions[data.startBinding.expressionId]
      : undefined;
    const endBounds = data.endBinding
      ? expressions[data.endBinding.expressionId]
      : undefined;

    pathSegments = router(
      { x: points[0]![0], y: points[0]![1] },
      { x: points[1]![0], y: points[1]![1] },
      data.startBinding?.anchor,
      data.endBinding?.anchor,
      {
        curved: data.curved,
        rounded: data.rounded,
        jettySize:
          typeof data.jettySize === "number" ? data.jettySize : undefined,
        midpointOffset:
          typeof data.midpointOffset === "number"
            ? data.midpointOffset
            : undefined,
        waypoints: data.waypoints,
        startBounds: startBounds
          ? {
              x: startBounds.position.x,
              y: startBounds.position.y,
              width: startBounds.size.width,
              height: startBounds.size.height,
            }
          : undefined,
        endBounds: endBounds
          ? {
              x: endBounds.position.x,
              y: endBounds.position.y,
              width: endBounds.size.width,
              height: endBounds.size.height,
            }
          : undefined,
      },
    );
  }

  // Skip position offset for bound arrows — resolveBindings returns absolute
  // world coordinates, so applying an offset would double-shift the arrow.
  const hasBound = data.startBinding || data.endBinding;
  const offset = hasBound
    ? { x: 0, y: 0 }
    : computePositionOffset
      ? computePositionOffset(expr)
      : { x: 0, y: 0 };

  if (offset.x !== 0 || offset.y !== 0) {
    ctx.save();
    ctx.translate(offset.x, offset.y);
  }

  // ── Self-loop detection: both ends bound to the same shape ──
  const isSelfLoop =
    data.startBinding &&
    data.endBinding &&
    data.startBinding.expressionId === data.endBinding.expressionId;

  if (isSelfLoop) {
    renderSelfLoop(
      ctx,
      points,
      data,
      expr,
      expressions,
      arrowSize,
      startType,
      endType,
      startFilled,
      endFilled,
      strokeColor,
      fillColor,
    );
  } else if (pathSegments && pathSegments.length > 0) {
    // ── Routed arrows: Canvas2D rendering for ALL routed types ──
    // [AC5] No drawable cache — always render the actual computed path.
    renderPathSegments(
      ctx,
      points[0]!,
      points,
      pathSegments,
      arrowSize,
      startType,
      endType,
      startFilled,
      endFilled,
      strokeColor,
      fillColor,
      expr,
    );
  } else {
    // ── Straight arrows: Rough.js linearPath ──
    renderStraightArrow(
      ctx,
      rc,
      expr,
      points,
      arrowSize,
      startType,
      endType,
      startFilled,
      endFilled,
      strokeColor,
      fillColor,
      options,
      getOrCreateDrawable,
    );
  }

  if (offset.x !== 0 || offset.y !== 0) {
    ctx.restore();
  }

  // ── Label at arrow midpoint ──
  if (data.label) {
    renderArrowLabel(ctx, points, data.label, expr);
  }
}

// ── Self-loop rendering ──────────────────────────────────────

/**
 * Render a self-referencing arrow (both ends bound to the same shape).
 *
 * Routing-aware:
 * - Curved/straight/undefined → bezier curve (existing behavior)
 * - Orthogonal/elbow/orthogonalCurved → right-angle loop segments
 *
 * Uses `computeSelfLoopPath` to share path computation with hit testing.
 * [CLEAN-CODE] [SRP]
 */
function renderSelfLoop(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  data: ArrowData,
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
  arrowSize: number,
  startType: string,
  endType: string,
  startFilled: boolean,
  endFilled: boolean,
  strokeColor: string,
  fillColor: string,
): void {
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const target = expressions[data.startBinding!.expressionId];
  const jetty = typeof data.jettySize === "number" ? data.jettySize : 30;

  const path = computeSelfLoopPath(start, end, data.routing, target, jetty);

  ctx.save();
  ctx.strokeStyle = expr.style.strokeColor;
  ctx.lineWidth = expr.style.strokeWidth;
  ctx.globalAlpha = expr.style.opacity;
  const ss = expr.style.strokeStyle ?? "solid";
  if (ss === "dashed")
    ctx.setLineDash([expr.style.strokeWidth * 4, expr.style.strokeWidth * 3]);
  else if (ss === "dotted")
    ctx.setLineDash([expr.style.strokeWidth, expr.style.strokeWidth * 2]);

  if (path.isCurved) {
    // ── Bezier self-loop (curved/straight/undefined) ──
    const loopSize = target
      ? Math.max(target.size.width, target.size.height) * 0.6
      : 60;

    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;
    const cx = target ? target.position.x + target.size.width / 2 : midX;
    const cy = target ? target.position.y + target.size.height / 2 : midY;

    const dx = midX - cx;
    const dy = midY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const cp1x = start[0] + nx * loopSize;
    const cp1y = start[1] + ny * loopSize;
    const cp2x = end[0] + nx * loopSize;
    const cp2y = end[1] + ny * loopSize;

    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, end[0], end[1]);
    ctx.stroke();
    ctx.restore();

    // Arrowheads for bezier self-loop
    if (endType !== "none") {
      const angle = Math.atan2(end[1] - cp2y, end[0] - cp2x);
      renderArrowheadFromRegistry(
        ctx,
        end[0],
        end[1],
        angle,
        arrowSize,
        endType,
        endFilled,
        strokeColor,
        fillColor,
      );
    }
    if (startType !== "none") {
      const angle = Math.atan2(start[1] - cp1y, start[0] - cp1x);
      renderArrowheadFromRegistry(
        ctx,
        start[0],
        start[1],
        angle,
        arrowSize,
        startType,
        startFilled,
        strokeColor,
        fillColor,
      );
    }
  } else {
    // ── Orthogonal self-loop (right-angle segments) ──
    ctx.beginPath();
    ctx.moveTo(path.points[0]![0], path.points[0]![1]);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i]![0], path.points[i]![1]);
    }
    ctx.stroke();
    ctx.restore();

    // Arrowheads for orthogonal self-loop
    if (endType !== "none" && path.points.length >= 2) {
      const last = path.points[path.points.length - 1]!;
      const prev = path.points[path.points.length - 2]!;
      const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
      renderArrowheadFromRegistry(
        ctx,
        last[0],
        last[1],
        angle,
        arrowSize,
        endType,
        endFilled,
        strokeColor,
        fillColor,
      );
    }
    if (startType !== "none" && path.points.length >= 2) {
      const first = path.points[0]!;
      const second = path.points[1]!;
      const angle = Math.atan2(first[1] - second[1], first[0] - second[0]);
      renderArrowheadFromRegistry(
        ctx,
        first[0],
        first[1],
        angle,
        arrowSize,
        startType,
        startFilled,
        strokeColor,
        fillColor,
      );
    }
  }
}

// ── PathSegment rendering (Canvas2D) ─────────────────────────

/**
 * Render a PathSegment-based route using native Canvas2D.
 *
 * Draws the path using lineTo, bezierCurveTo, and arcTo based on
 * segment types. Handles arrowhead rendering at both endpoints.
 *
 * Used for ALL routed arrows (orthogonal, curved, elbow, ER,
 * isometric, orthogonalCurved).
 *
 * [CLEAN-CODE] [SRP]
 */
function renderPathSegments(
  ctx: CanvasRenderingContext2D,
  startPoint: [number, number],
  _originalPoints: [number, number][],
  segments: PathSegment[],
  arrowSize: number,
  startType: string,
  endType: string,
  startFilled: boolean,
  endFilled: boolean,
  strokeColor: string,
  fillColor: string,
  expr: VisualExpression,
): void {
  ctx.save();
  ctx.strokeStyle = expr.style.strokeColor;
  ctx.lineWidth = expr.style.strokeWidth;
  ctx.globalAlpha = expr.style.opacity;
  const style = expr.style as unknown as Record<string, unknown>;
  const ss = (style.strokeStyle as string | undefined) ?? "solid";
  if (ss === "dashed")
    ctx.setLineDash([expr.style.strokeWidth * 4, expr.style.strokeWidth * 3]);
  else if (ss === "dotted")
    ctx.setLineDash([expr.style.strokeWidth, expr.style.strokeWidth * 2]);

  ctx.beginPath();
  ctx.moveTo(startPoint[0], startPoint[1]);

  for (const seg of segments) {
    switch (seg.type) {
      case "line":
        ctx.lineTo(seg.x, seg.y);
        break;
      case "bezier":
        ctx.bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, seg.x, seg.y);
        break;
      case "quadratic":
        ctx.quadraticCurveTo(seg.cpx, seg.cpy, seg.x, seg.y);
        break;
      case "arc": {
        ctx.arcTo(seg.x, seg.y, seg.x, seg.y, seg.rx);
        ctx.lineTo(seg.x, seg.y);
        break;
      }
    }
  }

  ctx.stroke();
  ctx.restore();

  // ── Arrowhead angles from path segments ──
  const lastSeg = segments[segments.length - 1]!;
  const endX = lastSeg.x;
  const endY = lastSeg.y;

  if (endType !== "none") {
    const { prevX, prevY } = computeEndPrevPoint(lastSeg, segments, startPoint);
    const angle = Math.atan2(endY - prevY, endX - prevX);
    renderArrowheadFromRegistry(
      ctx,
      endX,
      endY,
      angle,
      arrowSize,
      endType,
      endFilled,
      strokeColor,
      fillColor,
    );
  }

  if (startType !== "none") {
    const firstSeg = segments[0]!;
    const { nextX, nextY } = computeStartNextPoint(firstSeg);
    const angle = Math.atan2(startPoint[1] - nextY, startPoint[0] - nextX);
    renderArrowheadFromRegistry(
      ctx,
      startPoint[0],
      startPoint[1],
      angle,
      arrowSize,
      startType,
      startFilled,
      strokeColor,
      fillColor,
    );
  }
}

/**
 * Compute the "previous point" for end arrowhead angle.
 * Uses bezier/quadratic control point or the preceding segment endpoint.
 */
function computeEndPrevPoint(
  lastSeg: PathSegment,
  segments: PathSegment[],
  startPoint: [number, number],
): { prevX: number; prevY: number } {
  if (lastSeg.type === "bezier") {
    return { prevX: lastSeg.cp2x, prevY: lastSeg.cp2y };
  }
  if (lastSeg.type === "quadratic") {
    return { prevX: lastSeg.cpx, prevY: lastSeg.cpy };
  }
  if (segments.length >= 2) {
    const prevSeg = segments[segments.length - 2]!;
    return { prevX: prevSeg.x, prevY: prevSeg.y };
  }
  return { prevX: startPoint[0], prevY: startPoint[1] };
}

/**
 * Compute the "next point" for start arrowhead angle.
 * Uses bezier/quadratic control point or the first segment endpoint.
 */
function computeStartNextPoint(firstSeg: PathSegment): {
  nextX: number;
  nextY: number;
} {
  if (firstSeg.type === "bezier") {
    return { nextX: firstSeg.cp1x, nextY: firstSeg.cp1y };
  }
  if (firstSeg.type === "quadratic") {
    return { nextX: firstSeg.cpx, nextY: firstSeg.cpy };
  }
  return { nextX: firstSeg.x, nextY: firstSeg.y };
}

// ── Straight arrow rendering (Rough.js) ──────────────────────

/**
 * Render a straight (non-routed) arrow using Rough.js linearPath.
 *
 * Applies line shortening at arrowhead endpoints so the stroke
 * doesn't overlap the arrowhead tip.
 */
function renderStraightArrow(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  points: [number, number][],
  arrowSize: number,
  startType: string,
  endType: string,
  startFilled: boolean,
  endFilled: boolean,
  strokeColor: string,
  fillColor: string,
  options: Record<string, unknown>,
  getOrCreateDrawable?: (
    expr: VisualExpression,
    factory: () => unknown,
  ) => unknown,
): void {
  // Shorten line at ends where arrowheads exist
  const drawPoints: [number, number][] = points.map((p) => [p[0], p[1]]);
  if (endType !== "none" && drawPoints.length >= 2) {
    const last = drawPoints[drawPoints.length - 1]!;
    const prev = drawPoints[drawPoints.length - 2]!;
    const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    const shorten = arrowSize * 0.8;
    drawPoints[drawPoints.length - 1] = [
      last[0] - shorten * Math.cos(angle),
      last[1] - shorten * Math.sin(angle),
    ];
  }
  if (startType !== "none" && drawPoints.length >= 2) {
    const first = drawPoints[0]!;
    const second = drawPoints[1]!;
    const angle = Math.atan2(first[1] - second[1], first[0] - second[0]);
    const shorten = arrowSize * 0.8;
    drawPoints[0] = [
      first[0] - shorten * Math.cos(angle),
      first[1] - shorten * Math.sin(angle),
    ];
  }

  // Straight arrows use drawable cache for Rough.js rendering
  const drawable = getOrCreateDrawable
    ? getOrCreateDrawable(expr, () =>
        rc.generator.linearPath(drawPoints, options),
      )
    : rc.generator.linearPath(drawPoints, options);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rc.draw(drawable as any);

  // Arrowheads
  if (endType !== "none" && points.length >= 2) {
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    renderArrowheadFromRegistry(
      ctx,
      last[0],
      last[1],
      angle,
      arrowSize,
      endType,
      endFilled,
      strokeColor,
      fillColor,
    );
  }
  if (startType !== "none" && points.length >= 2) {
    const first = points[0]!;
    const second = points[1]!;
    const angle = Math.atan2(first[1] - second[1], first[0] - second[0]);
    renderArrowheadFromRegistry(
      ctx,
      first[0],
      first[1],
      angle,
      arrowSize,
      startType,
      startFilled,
      strokeColor,
      fillColor,
    );
  }
}

// ── Label rendering ──────────────────────────────────────────

/**
 * Render a label at the arrow midpoint with a white background.
 */
function renderArrowLabel(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  label: string,
  expr: VisualExpression,
): void {
  const midIdx = Math.floor(points.length / 2);
  const p1 = points[midIdx - 1] ?? points[0]!;
  const p2 = points[midIdx] ?? points[points.length - 1]!;
  const midX = (p1[0] + p2[0]) / 2;
  const midY = (p1[1] + p2[1]) / 2;

  ctx.save();
  const fontSize = expr.style.fontSize ?? 12;
  ctx.font = `${fontSize}px ${expr.style.fontFamily ?? "sans-serif"}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  const lines = label.split("\n");
  const lineHeight = fontSize * 1.2;
  const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const totalHeight = lines.length * lineHeight;
  const pad = 4;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    midX - maxLineWidth / 2 - pad,
    midY - totalHeight - pad,
    maxLineWidth + pad * 2,
    totalHeight + pad,
  );

  ctx.fillStyle = expr.style.strokeColor;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i]!,
      midX,
      midY - totalHeight + (i + 1) * lineHeight - 4,
    );
  }
  ctx.restore();
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Resolve arrowhead type from ArrowData value.
 *
 * Backward compat: true → 'triangle', false/undefined → 'none'.
 */
function resolveArrowheadType(value: string | boolean | undefined): string {
  if (value === true) return "triangle";
  if (value === false || value === undefined) return "none";
  return value;
}
