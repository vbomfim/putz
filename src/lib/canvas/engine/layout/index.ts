/**
 * Layout module — automatic diagram arrangement algorithms.
 *
 * Re-exports the public API for layout computation.
 *
 * @module
 */

export { computeLayout } from "./computeLayout";
export { computeTreeLayout } from "./treeLayout";
export { computeForceLayout } from "./forceLayout";
export { computeGridLayout } from "./gridLayout";
export { extractEdges } from "./edges";
export type {
  LayoutAlgorithm,
  LayoutDirection,
  LayoutSpacing,
  LayoutOptions,
  TreeLayoutOptions,
  ForceLayoutOptions,
  GridLayoutOptions,
  LayoutEdge,
} from "./types";
export {
  DEFAULT_SPACING,
  DEFAULT_FORCE_ITERATIONS,
  DEFAULT_GRID_COLUMNS,
} from "./types";
