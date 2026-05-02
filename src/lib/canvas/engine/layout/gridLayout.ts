/**
 * Grid layout — arrange shapes in a regular grid pattern.
 *
 * Places shapes in rows and columns with configurable spacing.
 * Good for organizing imported stencils and equalizing spacing.
 *
 * Pure function — takes shapes, returns position map.
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";
import type { GridLayoutOptions } from "./types";
import { DEFAULT_SPACING, DEFAULT_GRID_COLUMNS } from "./types";

/**
 * Compute grid positions for the given shapes.
 *
 * Arranges shapes in rows of `columns` items each. Each row's
 * vertical position is offset by the tallest element in the
 * previous row plus vertical spacing. Column widths use the
 * widest element in that column plus horizontal spacing.
 *
 * @param shapes - Non-arrow, non-locked shapes to arrange
 * @param options - Column count and spacing configuration
 * @returns Map of expression ID → new { x, y } position
 */
export function computeGridLayout(
  shapes: VisualExpression[],
  options: GridLayoutOptions,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();

  if (shapes.length === 0) return result;

  const columns = options.columns ?? DEFAULT_GRID_COLUMNS;
  const spacing = options.spacing ?? DEFAULT_SPACING;

  // Compute column widths (max width per column position)
  const columnWidths = computeColumnWidths(shapes, columns);

  // Place shapes row by row
  let currentY = 0;
  let rowMaxHeight = 0;

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]!;
    const col = i % columns;
    const isNewRow = col === 0 && i > 0;

    if (isNewRow) {
      currentY += rowMaxHeight + spacing.vertical;
      rowMaxHeight = 0;
    }

    // Compute x from column widths + spacing
    let x = 0;
    for (let c = 0; c < col; c++) {
      x += (columnWidths[c] ?? 0) + spacing.horizontal;
    }

    result.set(shape.id, { x, y: currentY });

    rowMaxHeight = Math.max(rowMaxHeight, shape.size.height);
  }

  return result;
}

/**
 * Compute the maximum width needed for each column.
 *
 * Looks at all shapes that will land in each column position
 * and returns the maximum width found.
 */
function computeColumnWidths(
  shapes: VisualExpression[],
  columns: number,
): number[] {
  const widths: number[] = new Array(Math.min(columns, shapes.length)).fill(0);

  for (let i = 0; i < shapes.length; i++) {
    const col = i % columns;
    const shape = shapes[i]!;
    widths[col] = Math.max(widths[col] ?? 0, shape.size.width);
  }

  return widths;
}
