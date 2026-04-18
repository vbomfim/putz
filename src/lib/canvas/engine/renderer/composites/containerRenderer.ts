/**
 * Container expression renderer.
 *
 * Renders a container shape with a colored header bar (title area)
 * and a lighter body area for child expressions. Supports collapse
 * mode where only the header is visible.
 *
 * Container children are rendered by the main render loop (they are
 * separate VisualExpressions); this renderer only draws the container
 * frame itself.
 *
 * @module
 */

import type { VisualExpression, ContainerData } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import { mapStyleToRoughOptions, idToSeed } from '../styleMapper';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

/** Default font family for the container title. */
const FONT_FAMILY = 'sans-serif';

/** Title font size in the header bar. */
const TITLE_FONT_SIZE = 14;

/** Left padding for the title text within the header. */
const TITLE_PADDING_LEFT = 12;

/** Size of the collapse/expand chevron icon. */
const CHEVRON_SIZE = 8;

/** Right padding for the chevron from the header edge. */
const CHEVRON_PADDING_RIGHT = 12;

/** Opacity for the body fill (lighter than header). */
const BODY_FILL_OPACITY = 0.08;

/** Minimum visible height for collapsed containers (header only). */
const MIN_COLLAPSED_HEIGHT = 20;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a container expression. [#112]
 *
 * Draws a rectangle with a colored header bar containing the title
 * and a collapse chevron. When expanded, draws a lighter body area.
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The container VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderContainer(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as ContainerData;
  const { x, y } = expr.position;
  const { width } = expr.size;
  const headerHeight = Math.max(data.headerHeight, MIN_COLLAPSED_HEIGHT);
  const roughOptions = mapStyleToRoughOptions(expr.style, idToSeed(expr.id));
  const strokeColor = expr.style.strokeColor;
  const isCollapsed = data.collapsed;

  // Effective height: full height when expanded, header-only when collapsed
  const effectiveHeight = isCollapsed ? headerHeight : expr.size.height;

  ctx.save();

  // ── Outer border (full container) ─────────────────────────
  rc.draw(rc.rectangle(x, y, width, effectiveHeight, roughOptions));

  // ── Header bar background ─────────────────────────────────
  const headerFill = expr.style.backgroundColor !== 'transparent'
    ? expr.style.backgroundColor
    : strokeColor;

  ctx.fillStyle = headerFill;
  ctx.globalAlpha = (expr.style.opacity ?? 1) * 0.25;
  ctx.fillRect(x, y, width, headerHeight);
  ctx.globalAlpha = expr.style.opacity ?? 1;

  // ── Header separator line ─────────────────────────────────
  if (!isCollapsed) {
    rc.draw(rc.line(x, y + headerHeight, x + width, y + headerHeight, roughOptions));
  }

  // ── Title text ────────────────────────────────────────────
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = strokeColor;
  const maxTitleWidth = width - TITLE_PADDING_LEFT - CHEVRON_SIZE - CHEVRON_PADDING_RIGHT * 2;
  const titleText = truncateText(ctx, data.title, maxTitleWidth);
  ctx.fillText(titleText, x + TITLE_PADDING_LEFT, y + headerHeight / 2);

  // ── Collapse/expand chevron ───────────────────────────────
  drawChevron(ctx, x + width - CHEVRON_PADDING_RIGHT - CHEVRON_SIZE, y + headerHeight / 2, CHEVRON_SIZE, isCollapsed, strokeColor);

  // ── Body area (expanded only) ─────────────────────────────
  if (!isCollapsed) {
    const bodyTop = y + headerHeight;
    const bodyHeight = effectiveHeight - headerHeight;
    if (bodyHeight > 0) {
      ctx.fillStyle = headerFill;
      ctx.globalAlpha = BODY_FILL_OPACITY;
      ctx.fillRect(x, bodyTop, width, bodyHeight);
      ctx.globalAlpha = expr.style.opacity ?? 1;
    }
  }

  ctx.restore();
}

// ── Helper functions ─────────────────────────────────────────

/**
 * Draw a chevron (▸ or ▾) icon for collapse/expand toggle.
 *
 * @param ctx - Canvas 2D context.
 * @param cx - Center X of the chevron area.
 * @param cy - Center Y of the chevron.
 * @param size - Half-size of the chevron.
 * @param collapsed - Whether to draw a right-pointing (▸) or down-pointing (▾) chevron.
 * @param color - Stroke/fill color.
 */
function drawChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  collapsed: boolean,
  color: string,
): void {
  const half = size / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();

  if (collapsed) {
    // Right-pointing triangle ▸
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
  } else {
    // Down-pointing triangle ▾
    ctx.moveTo(cx - half, cy - half / 2);
    ctx.lineTo(cx + half, cy - half / 2);
    ctx.lineTo(cx, cy + half / 2);
  }

  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Truncate text to fit within a maximum width, appending "…" if needed.
 *
 * @param ctx - Canvas 2D context (for text measurement).
 * @param text - The text to truncate.
 * @param maxWidth - Maximum width in pixels.
 * @returns The truncated text string.
 */
function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return '';
  const measured = ctx.measureText(text);
  if (measured.width <= maxWidth) return text;

  // Binary search for the longest fitting prefix
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const truncated = text.slice(0, mid) + '…';
    if (ctx.measureText(truncated).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo === 0 ? '…' : text.slice(0, lo) + '…';
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer('container', renderContainer);
