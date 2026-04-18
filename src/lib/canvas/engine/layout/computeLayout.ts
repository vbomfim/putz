/**
 * Layout computation dispatcher.
 *
 * Entry point for all layout algorithms. Filters expressions
 * (removes arrows, locked shapes) and delegates to the appropriate
 * algorithm based on `options.algorithm`.
 *
 * Pure function — no side effects.
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import type { LayoutOptions } from './types';
import { computeTreeLayout } from './treeLayout';
import { computeForceLayout } from './forceLayout';
import { computeGridLayout } from './gridLayout';

/** Expression kinds that are connectors (edges), not nodes. */
const CONNECTOR_KINDS = new Set(['arrow', 'line']);

/**
 * Compute new positions for canvas expressions using the specified algorithm.
 *
 * Filters out locked expressions and connector kinds (arrows/lines) before
 * passing to the algorithm. Arrows are used as edge data for tree and force
 * layouts.
 *
 * @param expressions - All expressions to consider
 * @param options - Algorithm selection and configuration
 * @returns Map of expression ID → new { x, y } position
 */
export function computeLayout(
  expressions: VisualExpression[],
  options: LayoutOptions,
): Map<string, { x: number; y: number }> {
  // Separate shapes from arrows
  const shapes = expressions.filter(
    (expr) => !CONNECTOR_KINDS.has(expr.kind) && !expr.meta.locked,
  );
  const arrows = expressions.filter((expr) => expr.kind === 'arrow');

  if (shapes.length === 0) {
    return new Map();
  }

  switch (options.algorithm) {
    case 'tree':
      return computeTreeLayout(shapes, arrows, {
        direction: options.direction,
        spacing: options.spacing,
      });

    case 'force':
      return computeForceLayout(shapes, arrows, {
        iterations: options.iterations,
        spacing: options.spacing,
      });

    case 'grid':
      return computeGridLayout(shapes, {
        columns: options.columns,
        spacing: options.spacing,
      });

    default: {
      // Exhaustive check — TypeScript will flag if a case is missed
      void (options.algorithm satisfies never);
      return new Map();
    }
  }
}
