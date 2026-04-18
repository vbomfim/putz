/**
 * Draw preview renderer.
 *
 * Renders transient dashed outlines during active tool drag.
 * These shapes are NOT committed to the store — they're rendered
 * directly each frame from the tool handler's preview state.
 *
 * @module
 */

import type { DrawPreview } from '../tools/BaseTool';
import type { ShapeConnectionPoint } from '../connectors/connectionPoints';

/** Dashed stroke color for draw previews. */
const PREVIEW_STROKE_COLOR = '#4A90D9';

/** Dash pattern for draw previews. */
const PREVIEW_DASH_PATTERN = [6, 4];

/** Stroke width for draw previews. */
const PREVIEW_STROKE_WIDTH = 1.5;

/** Preview fill color (very light blue). */
const PREVIEW_FILL_COLOR = 'rgba(74, 144, 217, 0.08)';

/** Connection point circle radius in screen pixels. */
const CONNECTION_POINT_RADIUS = 6;

/** Connection point idle fill color (light blue). */
const CONNECTION_POINT_FILL = 'rgba(74, 144, 217, 0.3)';

/** Connection point border color. */
const CONNECTION_POINT_STROKE = '#4A90D9';

/**
 * Render a draw preview on the canvas context.
 *
 * Called within the render loop after expressions are drawn,
 * while the camera transform is still active (world coordinates).
 */
export function renderDrawPreview(
  ctx: CanvasRenderingContext2D,
  preview: DrawPreview,
  zoom: number = 1,
): void {
  ctx.save();

  ctx.strokeStyle = PREVIEW_STROKE_COLOR;
  ctx.fillStyle = PREVIEW_FILL_COLOR;
  ctx.lineWidth = PREVIEW_STROKE_WIDTH;
  ctx.setLineDash(PREVIEW_DASH_PATTERN);

  switch (preview.kind) {
    case 'rectangle':
      renderRectanglePreview(ctx, preview);
      break;
    case 'ellipse':
      renderEllipsePreview(ctx, preview);
      break;
    case 'diamond':
      renderDiamondPreview(ctx, preview);
      break;
    case 'line':
      renderLinePreview(ctx, preview);
      break;
    case 'arrow':
      renderArrowPreview(ctx, preview);
      break;
    case 'freehand':
      renderFreehandPreview(ctx, preview);
      break;
    case 'sticky-note':
      renderStickyNotePreview(ctx, preview);
      break;
  }

  ctx.restore();

  // ── Snap indicator: blue circle at snap point ──
  if (preview.snapPoint) {
    const r = 10 / zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(preview.snapPoint.x, preview.snapPoint.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#4A90D9';
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  // ── Connection points: show all points on the hovered shape ──
  if (preview.connectionPoints && preview.connectionPoints.length > 0) {
    renderConnectionPoints(ctx, preview.connectionPoints, preview.snapPoint, zoom);
  }
}

/** Render rectangle preview as dashed outline with light fill. */
function renderRectanglePreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  ctx.fillRect(p.x, p.y, p.width, p.height);
  ctx.strokeRect(p.x, p.y, p.width, p.height);
}

/** Render ellipse preview as dashed outline with light fill. */
function renderEllipsePreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const rx = p.width / 2;
  const ry = p.height / 2;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Render diamond preview as dashed outline with light fill. */
function renderDiamondPreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;

  ctx.beginPath();
  ctx.moveTo(cx, p.y);
  ctx.lineTo(p.x + p.width, cy);
  ctx.lineTo(cx, p.y + p.height);
  ctx.lineTo(p.x, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Render line preview as dashed line. */
function renderLinePreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  if (!p.points || p.points.length < 2) return;

  ctx.beginPath();
  const [first, ...rest] = p.points;
  ctx.moveTo(first![0], first![1]);
  for (const [px, py] of rest) {
    ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** Render arrow preview as dashed line with arrowhead. */
function renderArrowPreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  if (!p.points || p.points.length < 2) return;

  ctx.beginPath();
  const [first, ...rest] = p.points;
  ctx.moveTo(first![0], first![1]);
  for (const [px, py] of rest) {
    ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Draw arrowhead at the end
  const last = p.points[p.points.length - 1]!;
  const prev = p.points[p.points.length - 2]!;
  const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const size = 10;
  const halfAngle = Math.PI / 6;

  ctx.setLineDash([]);
  ctx.fillStyle = PREVIEW_STROKE_COLOR;
  ctx.beginPath();
  ctx.moveTo(last[0], last[1]);
  ctx.lineTo(
    last[0] - size * Math.cos(angle - halfAngle),
    last[1] - size * Math.sin(angle - halfAngle),
  );
  ctx.lineTo(
    last[0] - size * Math.cos(angle + halfAngle),
    last[1] - size * Math.sin(angle + halfAngle),
  );
  ctx.closePath();
  ctx.fill();
}

/** Render freehand preview as dashed polyline. */
function renderFreehandPreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  if (!p.points || p.points.length < 2) return;

  ctx.setLineDash([]);
  ctx.strokeStyle = PREVIEW_STROKE_COLOR;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  const [first, ...rest] = p.points;
  ctx.moveTo(first![0], first![1]);
  for (const [px, py] of rest) {
    ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** Render sticky note preview as a warm-tinted rectangle. */
function renderStickyNotePreview(ctx: CanvasRenderingContext2D, p: DrawPreview): void {
  ctx.fillStyle = 'rgba(255, 224, 130, 0.3)';
  ctx.fillRect(p.x, p.y, p.width, p.height);
  ctx.strokeStyle = '#FFB300';
  ctx.strokeRect(p.x, p.y, p.width, p.height);
}

/**
 * Render connection point circles on a shape.
 *
 * Shows small circles at each connection point. The currently snapped
 * point is excluded (rendered separately as the larger snap indicator).
 * [CLEAN-CODE]
 */
function renderConnectionPoints(
  ctx: CanvasRenderingContext2D,
  points: ShapeConnectionPoint[],
  snapPoint: { x: number; y: number } | undefined,
  zoom: number,
): void {
  const r = CONNECTION_POINT_RADIUS / zoom;
  const strokeWidth = 1.5 / zoom;

  ctx.save();
  ctx.setLineDash([]);

  for (const pt of points) {
    // Skip the snapped point — it has its own larger indicator
    if (snapPoint && Math.abs(pt.x - snapPoint.x) < 0.5 && Math.abs(pt.y - snapPoint.y) < 0.5) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = CONNECTION_POINT_FILL;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.strokeStyle = CONNECTION_POINT_STROKE;
    ctx.lineWidth = strokeWidth;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
  }

  ctx.restore();
}
