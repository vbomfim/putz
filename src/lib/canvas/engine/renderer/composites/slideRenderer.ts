/**
 * Slide composite renderer.
 *
 * Supports three layouts:
 * - title: centered large text
 * - bullets: title + bulleted list
 * - split: title + two columns of bullets
 *
 * @module
 */

import type { VisualExpression, SlideData } from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding inside the slide. */
const PADDING = 24;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Title font size for "title" layout (large centered). */
const TITLE_LARGE_FONT_SIZE = 28;

/** Title font size for "bullets" / "split" layouts. */
const TITLE_FONT_SIZE = 20;

/** Bullet text font size. */
const BULLET_FONT_SIZE = 14;

/** Line height for bullet items. */
const BULLET_LINE_HEIGHT = 28;

/** Bullet character. */
const BULLET_CHAR = "• ";

/** Space between title and content area. */
const TITLE_GAP = 16;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a slide expression. [AC6]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The slide VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderSlide(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as SlideData;
  const { x: originX, y: originY } = expr.position;
  const { width, height } = expr.size;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // ── Slide border ───────────────────────────────────────────
  const borderDrawable = rc.rectangle(
    originX,
    originY,
    width,
    height,
    roughOptions,
  );
  rc.draw(borderDrawable);

  switch (data.layout) {
    case "title":
      renderTitleLayout(ctx, data, originX, originY, width, height);
      break;
    case "bullets":
      renderBulletsLayout(ctx, data, originX, originY, width, height);
      break;
    case "split":
      renderSplitLayout(
        ctx,
        rc,
        data,
        originX,
        originY,
        width,
        height,
        roughOptions,
      );
      break;
    default:
      renderBulletsLayout(ctx, data, originX, originY, width, height);
      break;
  }

  ctx.restore();
}

/**
 * "title" layout — large centered title text.
 */
function renderTitleLayout(
  ctx: CanvasRenderingContext2D,
  data: SlideData,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.font = `bold ${TITLE_LARGE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000000";
  ctx.fillText(data.title, x + w / 2, y + h / 2);
}

/**
 * "bullets" layout — title at top + bulleted list.
 */
function renderBulletsLayout(
  ctx: CanvasRenderingContext2D,
  data: SlideData,
  x: number,
  y: number,
  _w: number,
  _h: number,
): void {
  // Title
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000000";
  ctx.fillText(data.title, x + PADDING, y + PADDING);

  // Bullets
  ctx.font = `${BULLET_FONT_SIZE}px ${FONT_FAMILY}`;
  let bulletY = y + PADDING + TITLE_FONT_SIZE + TITLE_GAP;

  for (const bullet of data.bullets) {
    ctx.fillText(`${BULLET_CHAR}${bullet}`, x + PADDING + 8, bulletY);
    bulletY += BULLET_LINE_HEIGHT;
  }
}

/**
 * "split" layout — title at top + two columns of bullets.
 */
function renderSplitLayout(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  data: SlideData,
  x: number,
  y: number,
  w: number,
  h: number,
  roughOptions: ReturnType<typeof mapStyleToRoughOptions>,
): void {
  // Title
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000000";
  ctx.fillText(data.title, x + w / 2, y + PADDING);

  // Vertical divider
  const midX = x + w / 2;
  const divTop = y + PADDING + TITLE_FONT_SIZE + TITLE_GAP;
  const divLine = rc.line(midX, divTop, midX, y + h - PADDING, roughOptions);
  rc.draw(divLine);

  // Split bullets into left/right halves
  const midIdx = Math.ceil(data.bullets.length / 2);
  const leftBullets = data.bullets.slice(0, midIdx);
  const rightBullets = data.bullets.slice(midIdx);

  ctx.font = `${BULLET_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Left column
  let bulletY = divTop;
  for (const bullet of leftBullets) {
    ctx.fillText(`${BULLET_CHAR}${bullet}`, x + PADDING, bulletY);
    bulletY += BULLET_LINE_HEIGHT;
  }

  // Right column
  bulletY = divTop;
  for (const bullet of rightBullets) {
    ctx.fillText(`${BULLET_CHAR}${bullet}`, midX + PADDING, bulletY);
    bulletY += BULLET_LINE_HEIGHT;
  }
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("slide", renderSlide);
