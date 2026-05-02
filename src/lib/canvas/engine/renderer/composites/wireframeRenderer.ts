/**
 * Wireframe composite renderer.
 *
 * Renders UI components as labeled Rough.js rectangles at specified
 * x, y, w, h positions within expression bounds. Component type is
 * shown as "[button]", "[input]", etc.
 *
 * @module
 */

import type { VisualExpression, WireframeData } from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding around the wireframe. */
const PADDING = 12;

/** Height reserved for the title. */
const TITLE_HEIGHT = 28;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Title font size. */
const TITLE_FONT_SIZE = 16;

/** Component label font size. */
const LABEL_FONT_SIZE = 11;

/** Component type badge font size. */
const TYPE_FONT_SIZE = 10;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a wireframe expression. [AC3]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The wireframe VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderWireframe(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as WireframeData;
  const { x: originX, y: originY } = expr.position;
  const { width } = expr.size;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // ── Title ──────────────────────────────────────────────────
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = expr.style.strokeColor;
  ctx.fillText(
    data.title,
    originX + width / 2,
    originY + PADDING + TITLE_HEIGHT / 2,
  );

  // ── Empty wireframe ────────────────────────────────────────
  if (data.components.length === 0) {
    ctx.restore();
    return;
  }

  // ── Render components ──────────────────────────────────────
  const contentOffsetX = originX + PADDING;
  const contentOffsetY = originY + PADDING + TITLE_HEIGHT;

  for (const comp of data.components) {
    const cx = contentOffsetX + comp.x;
    const cy = contentOffsetY + comp.y;

    // Component rectangle
    const drawable = rc.rectangle(
      cx,
      cy,
      comp.width,
      comp.height,
      roughOptions,
    );
    rc.draw(drawable);

    // Type badge (top-left inside rectangle)
    const typeLabel = `[${comp.type}]`;
    ctx.font = `${TYPE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#888888";
    ctx.fillText(typeLabel, cx + 4, cy + 3);

    // Component label (centered)
    ctx.font = `${LABEL_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = expr.style.strokeColor;
    ctx.fillText(comp.label, cx + comp.width / 2, cy + comp.height / 2);
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("wireframe", renderWireframe);
