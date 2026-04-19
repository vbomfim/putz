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

const SWATCH_SIZE = 18;

// ── Helpers ──────────────────────────────────────────────────

function getCellText(cell: string | TableCell): string {
  return typeof cell === 'string' ? cell : cell.text;
}

function getCellBg(cell: string | TableCell): string | undefined {
  return typeof cell === 'object' ? cell.backgroundColor : undefined;
}

function getCellBorder(cell: string | TableCell): string | undefined {
  return typeof cell === 'object' ? cell.borderColor : undefined;
}

/** True if this cell is a color swatch (has color, no meaningful text). */
function isSwatch(cell: string | TableCell): boolean {
  if (typeof cell === 'string') return false;
  return !!(cell.borderColor || cell.backgroundColor) && !cell.text.trim();
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
  const tableX = originX + PADDING;
  let currentY = originY + PADDING;

  // Detect swatch-only columns (all cells are color swatches)
  const SWATCH_COL_WIDTH = SWATCH_SIZE + 16;
  const colWidths: number[] = [];
  let swatchColCount = 0;
  for (let ci = 0; ci < colCount; ci++) {
    const allSwatch = data.rows.length > 0 && data.rows.every((row) => {
      const cell = row[ci];
      return cell !== undefined && isSwatch(cell);
    });
    if (allSwatch) {
      colWidths.push(SWATCH_COL_WIDTH);
      swatchColCount++;
    } else {
      colWidths.push(0); // placeholder — will distribute remaining space
    }
  }
  const remainingWidth = tableWidth - swatchColCount * SWATCH_COL_WIDTH;
  const normalColCount = colCount - swatchColCount;
  const normalColWidth = normalColCount > 0 ? remainingWidth / normalColCount : tableWidth / colCount;
  for (let ci = 0; ci < colCount; ci++) {
    if (colWidths[ci] === 0) colWidths[ci] = normalColWidth;
  }

  /** Get X offset for column ci. */
  const colX = (ci: number): number => {
    let x = tableX;
    for (let i = 0; i < ci; i++) x += colWidths[i]!;
    return x;
  };

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

  // ── Header row (skip auto-generated "Col N" headers) ────────
  const isAutoHeaders = data.headers.every((h, i) => h === `Col ${i + 1}`);
  if (data.headers.length > 0 && !isAutoHeaders) {
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(tableX, currentY, tableWidth, ROW_HEIGHT);

    ctx.font = `bold ${HEADER_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#333333';

    for (let ci = 0; ci < data.headers.length; ci++) {
      const cellX = colX(ci);
      ctx.strokeRect(cellX, currentY, colWidths[ci]!, ROW_HEIGHT);
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
      const cellX = colX(ci);
      const bg = getCellBg(cell);
      const border = getCellBorder(cell);

      if (isSwatch(cell)) {
        // Render a small colored square centered in the cell
        const sx = cellX + (colWidths[ci]! - SWATCH_SIZE) / 2;
        const sy = currentY + (ROW_HEIGHT - SWATCH_SIZE) / 2;
        ctx.fillStyle = bg || '#ffffff';
        ctx.fillRect(sx, sy, SWATCH_SIZE, SWATCH_SIZE);
        if (border) {
          ctx.save();
          ctx.strokeStyle = border;
          ctx.lineWidth = 2;
          ctx.strokeRect(sx, sy, SWATCH_SIZE, SWATCH_SIZE);
          ctx.restore();
          ctx.strokeStyle = BORDER_COLOR;
          ctx.lineWidth = 1;
        }
      } else if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(cellX, currentY, colWidths[ci]!, ROW_HEIGHT);
      }

      ctx.strokeRect(cellX, currentY, colWidths[ci]!, ROW_HEIGHT);

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
