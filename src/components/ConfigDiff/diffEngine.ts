/**
 * Line-by-line diff engine using the LCS (Longest Common Subsequence) algorithm.
 *
 * Compares two text configurations line-by-line and produces a unified diff
 * with additions, deletions, and unchanged lines. Designed for network
 * configuration comparison (router/switch running-config diffs).
 *
 * @module diffEngine
 */

/** Type of change for a diff line. */
export type DiffType = "add" | "delete" | "equal";

/** A single line in the diff output. */
export interface DiffLine {
  /** The type of change. */
  type: DiffType;
  /** The text content of the line. */
  content: string;
  /** Line number in the old (left) text, or null for additions. */
  oldLineNumber: number | null;
  /** Line number in the new (right) text, or null for deletions. */
  newLineNumber: number | null;
}

/**
 * Computes a line-by-line diff between two texts using LCS.
 *
 * @param oldText - The original/left configuration text.
 * @param newText - The modified/right configuration text.
 * @returns Array of DiffLine entries representing the diff.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  if (oldText === "" && newText === "") return [];

  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");

  const lcsTable = buildLcsTable(oldLines, newLines);
  return backtrackDiff(lcsTable, oldLines, newLines);
}

/**
 * Builds the LCS (Longest Common Subsequence) dynamic programming table.
 *
 * @param oldLines - Lines from the original text.
 * @param newLines - Lines from the modified text.
 * @returns 2D table where table[i][j] = LCS length of oldLines[0..i] and newLines[0..j].
 */
function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Backtracks through the LCS table to produce the diff output.
 *
 * Walks from table[m][n] back to table[0][0], emitting equal, delete,
 * or add entries based on the LCS path.
 *
 * @param table - The LCS DP table.
 * @param oldLines - Lines from the original text.
 * @param newLines - Lines from the modified text.
 * @returns Ordered array of DiffLine entries.
 */
function backtrackDiff(
  table: number[][],
  oldLines: string[],
  newLines: string[],
): DiffLine[] {
  const result: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({
        type: "equal",
        content: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.push({
        type: "add",
        content: newLines[j - 1],
        oldLineNumber: null,
        newLineNumber: j,
      });
      j--;
    } else {
      result.push({
        type: "delete",
        content: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: null,
      });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Exports a diff result as a human-readable text string.
 *
 * Format:
 * - Lines prefixed with `+` for additions
 * - Lines prefixed with `-` for deletions
 * - Lines prefixed with ` ` (two spaces) for unchanged
 *
 * @param diff - The diff lines to format.
 * @returns Formatted diff text.
 */
export function exportDiffAsText(diff: DiffLine[]): string {
  if (diff.length === 0) return "";

  return diff
    .map((line) => {
      switch (line.type) {
        case "add":
          return `+ ${line.content}`;
        case "delete":
          return `- ${line.content}`;
        case "equal":
          return `  ${line.content}`;
      }
    })
    .join("\n");
}
