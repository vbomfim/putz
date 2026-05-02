/**
 * Kanban board composite renderer.
 *
 * Renders columns as vertical sections with title headers and cards
 * as stacked Rough.js rectangles with title text. Column width is
 * computed as expression width / columns.length.
 *
 * @module
 */

import type { VisualExpression, KanbanData } from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding inside the kanban board. */
const PADDING = 16;

/** Height reserved for the board title. */
const TITLE_HEIGHT = 30;

/** Height reserved for each column header. */
const COLUMN_HEADER_HEIGHT = 28;

/** Height of each card rectangle. */
const CARD_HEIGHT = 36;

/** Vertical gap between cards. */
const CARD_GAP = 8;

/** Horizontal gap between columns. */
const COLUMN_GAP = 8;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Title font size. */
const TITLE_FONT_SIZE = 16;

/** Column header font size. */
const HEADER_FONT_SIZE = 13;

/** Card font size. */
const CARD_FONT_SIZE = 12;

/** Card inner padding. */
const CARD_PADDING = 6;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a kanban board expression. [AC1]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The kanban VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderKanban(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as KanbanData;
  const { x: originX, y: originY } = expr.position;
  const { width, height } = expr.size;
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

  // ── Empty board ────────────────────────────────────────────
  if (data.columns.length === 0) {
    ctx.restore();
    return;
  }

  // ── Column layout ──────────────────────────────────────────
  const contentTop = originY + PADDING + TITLE_HEIGHT;
  const totalGap = COLUMN_GAP * (data.columns.length - 1);
  const usableWidth = width - PADDING * 2 - totalGap;
  const colWidth = usableWidth / data.columns.length;

  for (let ci = 0; ci < data.columns.length; ci++) {
    const col = data.columns[ci]!;
    const colX = originX + PADDING + ci * (colWidth + COLUMN_GAP);

    // Column header
    ctx.font = `bold ${HEADER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = expr.style.strokeColor;
    ctx.fillText(
      col.title,
      colX + colWidth / 2,
      contentTop + COLUMN_HEADER_HEIGHT / 2,
    );

    // Column separator line
    if (ci > 0) {
      const sepX = colX - COLUMN_GAP / 2;
      const sepDrawable = rc.line(
        sepX,
        contentTop,
        sepX,
        originY + height - PADDING,
        roughOptions,
      );
      rc.draw(sepDrawable);
    }

    // Cards
    let cardY = contentTop + COLUMN_HEADER_HEIGHT + CARD_GAP;
    for (const card of col.cards) {
      const drawable = rc.rectangle(
        colX,
        cardY,
        colWidth,
        CARD_HEIGHT,
        roughOptions,
      );
      rc.draw(drawable);

      ctx.font = `${CARD_FONT_SIZE}px ${FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = expr.style.strokeColor;
      ctx.fillText(card.title, colX + CARD_PADDING, cardY + CARD_HEIGHT / 2);

      cardY += CARD_HEIGHT + CARD_GAP;
    }
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("kanban", renderKanban);
