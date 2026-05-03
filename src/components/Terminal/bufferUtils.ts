/**
 * Buffer extraction utilities for command block context menu.
 *
 * Pure functions to extract text from xterm.js buffer ranges,
 * used by CommandBlockContextMenu for copy operations.
 *
 * @module bufferUtils
 * @see https://github.com/vbomfim/putz/issues/103
 */

/** Minimal buffer line interface — matches xterm.js IBufferLine. */
export interface BufferLineReader {
  translateToString(trimRight?: boolean): string;
}

/** Callback type for getting a buffer line by row index. */
export type GetBufferLine = (row: number) => BufferLineReader | null;

/**
 * Column-aware buffer range — allows clipping at sub-row granularity.
 *
 * startCol/endCol default to full-line extraction when omitted.
 */
export interface BufferRange {
  /** First row (inclusive). */
  startRow: number;
  /** Starting column on the first row (inclusive, default 0). */
  startCol?: number;
  /** Last row (exclusive — rows [startRow, endRow) are extracted). */
  endRow: number;
  /** Ending column on the last row (exclusive, default full line). */
  endCol?: number;
}

/**
 * Extract text from a column-aware buffer range.
 *
 * - On the first row, text starts at `startCol` (default 0).
 * - On the last row (endRow - 1), text ends at `endCol` (default full line).
 * - If startRow === endRow, returns empty string (exclusive end).
 * - Bounds are defensively clamped to non-negative values.
 *
 * @param getLine - function to get a buffer line by absolute row
 * @param range - the range to extract (endRow is exclusive)
 * @returns extracted text with lines joined by newline, trailing whitespace trimmed
 */
export function extractRangeText(
  getLine: GetBufferLine,
  range: BufferRange,
): string;
/**
 * Extract text from a row-only buffer range [fromRow, toRow) — exclusive end.
 *
 * @deprecated Use the BufferRange overload for column-aware extraction.
 * @param getLine - function to get a buffer line by absolute row
 * @param fromRow - first row (inclusive)
 * @param toRow - last row (exclusive)
 * @returns extracted text with lines joined by newline, trailing whitespace trimmed
 */
export function extractRangeText(
  getLine: GetBufferLine,
  fromRow: number,
  toRow: number,
): string;
export function extractRangeText(
  getLine: GetBufferLine,
  rangeOrFromRow: BufferRange | number,
  toRow?: number,
): string {
  // Normalise overloads into a single BufferRange
  const range: Required<BufferRange> =
    typeof rangeOrFromRow === "number"
      ? {
          startRow: rangeOrFromRow,
          startCol: 0,
          endRow: toRow ?? rangeOrFromRow,
          endCol: Infinity,
        }
      : {
          startRow: rangeOrFromRow.startRow,
          startCol: rangeOrFromRow.startCol ?? 0,
          endRow: rangeOrFromRow.endRow,
          endCol: rangeOrFromRow.endCol ?? Infinity,
        };

  // Defensive bounds clamping
  const startRow = Math.max(0, range.startRow);
  const endRow = Math.max(startRow, range.endRow); // endRow is exclusive
  const startCol = Math.max(0, range.startCol);

  if (startRow >= endRow) return "";

  const lines: string[] = [];
  for (let row = startRow; row < endRow; row++) {
    const line = getLine(row);
    if (!line) continue;
    const fullText = line.translateToString(true);

    if (row === startRow && endRow - startRow === 1) {
      // Single-row range: clip both ends
      const end = range.endCol === Infinity ? undefined : range.endCol;
      lines.push(fullText.slice(startCol, end));
    } else if (row === startRow) {
      // First row of multi-row: clip from startCol
      lines.push(fullText.slice(startCol));
    } else if (row === endRow - 1 && range.endCol !== Infinity) {
      // Last row of multi-row with explicit endCol: clip to endCol
      lines.push(fullText.slice(0, range.endCol));
    } else {
      // Middle rows or last row without endCol: full content
      lines.push(fullText);
    }
  }

  return lines.join("\n").trimEnd();
}
