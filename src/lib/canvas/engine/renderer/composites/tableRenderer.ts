/**
 * Table composite renderer.
 *
 * Renders a clean grid with optional title row, bold header row,
 * data rows with optional cell background colors, and crisp lines.
 *
 * @module
 */

import type { VisualExpression, TableData, TableCell } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

const PADDING = 8;
const ROW_HEIGHT = 28;
const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';
const HEADER_FONT_SIZE = 12;
const CELL_FONT_SIZE = 11;
const CELL_PADDING = 8;
const BORDER_COLOR = '#d0d0d0';
const HEADER_BG = '#f5f5f5';
const TITLE_FONT_SIZE = 13;

// ── Helpers ──────────────────────────────────────────────────

function getCellText(cell: string | TableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}

function getCellBg(cell: string | TableCell): string | undefined {
  return typeof cell === 'object' ? cell.backgroundColor : undefined;
}

// ── Main renderer ────────────────────────────────────────────

export function renderTable(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  _rc: RoughCanvas,
): void {
  const data = expr.data as TableData;
  const { x: originX, y: originY } = expr.position;
  const { width } = expr.size;

  ctx.save();

  if (data.headers.length === 0 && data.rows.length === 0) {
    ctx.restore();
    return;
  }

  const colCount = Math.max(data.headers.length, ...data.rows.map(r => r.length), 1);
  const tableWidth = width - PADDING * 2;
  const colWidth = tableWidth / colCount;
  const tableX = originX + PADDING;
  let currentY = originY + PADDING;

  ctx.lineWidth = 1;
  ctx.strokeStyle = BORDER_COLOR;

  // ── Title row ─────────────────────────────────────────────
  if (data.title) {
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(tableX, currentY, tableWidth, ROW_HEIGHT);
    ctx.strokeRect(tableX, currentY, tableWidth, ROW_HEIGHT);

    ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#333333';
    ctx.fillText(data.title, tableX + tableWidth / 2, currentY + ROW_HEIGHT / 2);
    currentY += ROW_HEIGHT;
  }

  // ── Header row ─────────────────────────────────────────────
  if (data.headers.length > 0) {
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(tableX, currentY, tableWidth, ROW_HEIGHT);

    ctx.font = `bold ${HEADER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#333333';

    for (let ci = 0; ci < data.headers.length; ci++) {
      const cellX = tableX + ci * colWidth;
      ctx.strokeRect(cellX, currentY, colWidth, ROW_HEIGHT);
      ctx.fillStyle = '#333333';
      ctx.fillText(data.headers[ci]!, cellX + CELL_PADDING, currentY + ROW_HEIGHT / 2);
    }
    currentY += ROW_HEIGHT;
  }

  // ── Data rows ──────────────────────────────────────────────
  ctx.font = `${CELL_FONT_SIZE}px ${FONT_FAMILY}`;

  for (const row of data.rows) {
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci]!;
      const cellX = tableX + ci * colWidth;
      const bg = getCellBg(cell);

      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(cellX, currentY, colWidth, ROW_HEIGHT);
      }

      ctx.strokeRect(cellX, currentY, colWidth, ROW_HEIGHT);

      const text = getCellText(cell);
      if (text) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#333333';
        ctx.fillText(text, cellX + CELL_PADDING, currentY + ROW_HEIGHT / 2);
      }
    }
    currentY += ROW_HEIGHT;
  }

  // ── Outer border ───────────────────────────────────────────
  const tableTop = originY + PADDING;
  ctx.strokeRect(tableX, tableTop, tableWidth, currentY - tableTop);

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer('table', renderTable);
