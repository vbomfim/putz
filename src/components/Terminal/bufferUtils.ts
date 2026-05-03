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
 * Extract text from a buffer range [fromRow, toRow) — exclusive end.
 *
 * @param getLine - function to get a buffer line by absolute row
 * @param fromRow - first row (inclusive)
 * @param toRow - last row (exclusive)
 * @returns extracted text with lines joined by newline, trailing whitespace trimmed
 */
export function extractRangeText(
  getLine: GetBufferLine,
  fromRow: number,
  toRow: number,
): string {
  const lines: string[] = [];
  for (let row = fromRow; row < toRow; row++) {
    const line = getLine(row);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n").trimEnd();
}
