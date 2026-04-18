/**
 * Grid snap utility — pure math functions for snapping
 * coordinates to grid intersections.
 *
 * Used by manipulation interactions to align shapes during drag
 * when snap-to-grid is enabled. All functions are pure and
 * side-effect free. [CLEAN-CODE]
 *
 * @module
 */

/**
 * Snap a single value to the nearest grid intersection.
 *
 * Returns the value unchanged if gridSize is zero or negative
 * to avoid division-by-zero errors. [CLEAN-CODE]
 *
 * @param value - The raw coordinate value to snap.
 * @param gridSize - The grid spacing in world units (must be > 0).
 * @returns The nearest grid-aligned value, or the original value if gridSize ≤ 0.
 */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap an (x, y) coordinate pair to the nearest grid intersection.
 *
 * @param x - The raw x coordinate.
 * @param y - The raw y coordinate.
 * @param gridSize - The grid spacing in world units.
 * @returns The grid-aligned position.
 */
export function snapPosition(
  x: number,
  y: number,
  gridSize: number,
): { x: number; y: number } {
  return {
    x: snapToGrid(x, gridSize),
    y: snapToGrid(y, gridSize),
  };
}

/**
 * Compute a snapped move delta for multi-select dragging.
 *
 * Snaps the lead expression's target position to the grid, then
 * derives the adjusted delta so all other expressions preserve
 * their relative offsets. [DRY]
 *
 * @param dx - Raw delta X from drag start.
 * @param dy - Raw delta Y from drag start.
 * @param originalPositions - Original positions of all dragged expressions.
 * @param gridSize - Grid spacing in world units.
 * @returns Snapped delta pair.
 */
export function computeSnappedDelta(
  dx: number,
  dy: number,
  originalPositions: Map<string, { x: number; y: number }>,
  gridSize: number,
): { dx: number; dy: number } {
  const firstEntry = originalPositions.entries().next().value;
  if (!firstEntry) return { dx, dy };

  const [, orig] = firstEntry;
  const snapped = snapPosition(orig.x + dx, orig.y + dy, gridSize);
  return {
    dx: snapped.x - orig.x,
    dy: snapped.y - orig.y,
  };
}
