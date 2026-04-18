/**
 * Table composite renderer.
 *
 * Renders a grid with bold header row, data rows, and Rough.js lines
 * separating cells. Uses equal column widths and 30px row height.
 *
 * @module
 */

import type { VisualExpression, TableData } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import { mapStyleToRoughOptions } from '../styleMapper';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

/** Padding around the table. */
const PADDING = 12;

/** Height of each row. */
const ROW_HEIGHT = 30;

/** Default font family. */
const FONT_FAMILY = 'sans-serif';

/** Header font size. */
const HEADER_FONT_SIZE = 13;

/** Cell font size. */
const CELL_FONT_SIZE = 12;

/** Cell horizontal padding. */
const CELL_PADDING = 8;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a table expression. [AC2]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The table VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderTable(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as TableData;
  const { x: originX, y: originY } = expr.position;
  const { width } = expr.size;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // ── Empty table ────────────────────────────────────────────
  if (data.headers.length === 0 && data.rows.length === 0) {
    ctx.restore();
    return;
  }

  const colCount = Math.max(data.headers.length, ...data.rows.map(r => r.length), 1);
  const tableWidth = width - PADDING * 2;
  const colWidth = tableWidth / colCount;
  const tableX = originX + PADDING;
  let currentY = originY + PADDING;

  // ── Header row ─────────────────────────────────────────────
  if (data.headers.length > 0) {
    // Header background line (bottom of header row)
    const headerBottomY = currentY + ROW_HEIGHT;
    const headerLine = rc.line(tableX, headerBottomY, tableX + tableWidth, headerBottomY, roughOptions);
    rc.draw(headerLine);

    ctx.font = `bold ${HEADER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = expr.style.strokeColor;

    for (let ci = 0; ci < data.headers.length; ci++) {
      const cellX = tableX + ci * colWidth;
      ctx.fillText(data.headers[ci]!, cellX + CELL_PADDING, currentY + ROW_HEIGHT / 2);
    }
    currentY += ROW_HEIGHT;
  }

  // ── Data rows ──────────────────────────────────────────────
  ctx.font = `${CELL_FONT_SIZE}px ${FONT_FAMILY}`;

  for (const row of data.rows) {
    for (let ci = 0; ci < row.length; ci++) {
      const cellX = tableX + ci * colWidth;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = expr.style.strokeColor;
      ctx.fillText(row[ci]!, cellX + CELL_PADDING, currentY + ROW_HEIGHT / 2);
    }

    currentY += ROW_HEIGHT;

    // Row separator line
    const rowLine = rc.line(tableX, currentY, tableX + tableWidth, currentY, roughOptions);
    rc.draw(rowLine);
  }

  // ── Vertical column separators ─────────────────────────────
  const tableTop = originY + PADDING;
  const tableBottom = currentY;

  for (let ci = 1; ci < colCount; ci++) {
    const sepX = tableX + ci * colWidth;
    const colLine = rc.line(sepX, tableTop, sepX, tableBottom, roughOptions);
    rc.draw(colLine);
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer('table', renderTable);
