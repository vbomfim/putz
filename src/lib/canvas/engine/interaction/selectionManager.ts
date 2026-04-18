/**
 * Selection manager — query functions for finding expressions.
 *
 * Pure functions with no side effects. Used by the selection interaction
 * hook to determine which expressions are under the cursor or inside
 * a marquee rectangle.
 *
 * @module
 */

import type { VisualExpression, Layer } from '../../protocol';
import { DEFAULT_LAYER_ID } from '../../protocol';
import { hitTestExpression } from './hitTest';
import type { WorldPoint } from './hitTest';

/** Axis-aligned bounding box in world coordinates. */
export interface Marquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Check if an expression is on a hidden or locked layer.
 *
 * @param expr - The expression to check
 * @param layers - All layers on the canvas
 * @returns true if the expression should be excluded from selection
 */
function isExcludedByLayer(expr: VisualExpression, layers?: Layer[]): boolean {
  if (!layers || layers.length === 0) return false;
  const layerId = expr.layerId ?? DEFAULT_LAYER_ID;
  const layer = layers.find((l) => l.id === layerId);
  if (!layer) return false;
  return !layer.visible || layer.locked;
}

/**
 * Find the topmost expression at a world-coordinate point.
 *
 * Iterates `expressionOrder` back-to-front (z-order priority) and
 * returns the ID of the first expression that passes hit testing.
 * Returns null if no expression is hit.
 *
 * @param worldPoint - Point in world coordinates
 * @param expressions - All expressions keyed by ID
 * @param expressionOrder - Z-order array (index 0 = back, last = front)
 * @param tolerance - Hit tolerance in world units
 * @param layers - Optional layer list for visibility/lock filtering [#109]
 */
export function findExpressionAtPoint(
  worldPoint: WorldPoint,
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
  tolerance: number,
  layers?: Layer[],
): string | null {
  // Iterate back-to-front: last element is topmost
  for (let i = expressionOrder.length - 1; i >= 0; i--) {
    const id = expressionOrder[i]!;
    const expr = expressions[id];
    if (!expr) continue;

    // Skip expressions on hidden or locked layers [#109]
    if (isExcludedByLayer(expr, layers)) continue;

    if (hitTestExpression(worldPoint, expr, tolerance, expressions)) {
      return id;
    }
  }

  return null;
}

/**
 * Find all expressions whose bounding boxes intersect a marquee rectangle.
 *
 * Uses AABB intersection. Handles inverted marquees (negative width/height)
 * by normalizing before comparison.
 *
 * @param marquee - Selection rectangle in world coordinates
 * @param expressions - All expressions keyed by ID
 * @param layers - Optional layer list for visibility/lock filtering [#109]
 * @returns Array of expression IDs that intersect the marquee
 */
export function findExpressionsInMarquee(
  marquee: Marquee,
  expressions: Record<string, VisualExpression>,
  layers?: Layer[],
): string[] {
  // Normalize marquee (handle negative width/height from reverse drag)
  const mx = marquee.width >= 0 ? marquee.x : marquee.x + marquee.width;
  const my = marquee.height >= 0 ? marquee.y : marquee.y + marquee.height;
  const mw = Math.abs(marquee.width);
  const mh = Math.abs(marquee.height);

  const mRight = mx + mw;
  const mBottom = my + mh;

  const result: string[] = [];

  for (const [id, expr] of Object.entries(expressions)) {
    // Skip expressions on hidden or locked layers [#109]
    if (isExcludedByLayer(expr, layers)) continue;

    const { x, y } = expr.position;
    const { width, height } = expr.size;

    const exprRight = x + width;
    const exprBottom = y + height;

    // Containment test — marquee must fully encompass the expression
    const contained =
      x >= mx &&
      y >= my &&
      exprRight <= mRight &&
      exprBottom <= mBottom;

    if (contained) {
      result.push(id);
    }
  }

  return result;
}
