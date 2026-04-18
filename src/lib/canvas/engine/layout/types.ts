/**
 * Layout algorithm type definitions.
 *
 * Pure data types for configuring and executing layout computations.
 * No side effects — these are consumed by algorithm functions and
 * the store action / MCP tool.
 *
 * @module
 */

/** Supported layout algorithm identifiers. */
export type LayoutAlgorithm = 'tree' | 'force' | 'grid';

/** Direction for hierarchical (tree) layouts. */
export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

/** Spacing configuration for layout algorithms. */
export interface LayoutSpacing {
  horizontal: number;
  vertical: number;
}

/** Configuration options for layout computation. */
export interface LayoutOptions {
  /** Which algorithm to use. */
  algorithm: LayoutAlgorithm;
  /** Layout direction — used by tree algorithm. */
  direction?: LayoutDirection;
  /** Spacing between arranged elements. */
  spacing?: LayoutSpacing;
  /** Number of simulation iterations — used by force algorithm. */
  iterations?: number;
  /** Number of columns — used by grid algorithm. */
  columns?: number;
}

/** Options specific to tree layout. */
export interface TreeLayoutOptions {
  direction?: LayoutDirection;
  spacing?: LayoutSpacing;
}

/** Options specific to force-directed layout. */
export interface ForceLayoutOptions {
  iterations?: number;
  spacing?: LayoutSpacing;
}

/** Options specific to grid layout. */
export interface GridLayoutOptions {
  columns?: number;
  spacing?: LayoutSpacing;
}

/** A directed edge between two node IDs, extracted from arrow bindings. */
export interface LayoutEdge {
  source: string;
  target: string;
}

/** Default spacing values used when no spacing is provided. */
export const DEFAULT_SPACING: LayoutSpacing = {
  horizontal: 50,
  vertical: 80,
};

/** Default number of force layout iterations. */
export const DEFAULT_FORCE_ITERATIONS = 100;

/** Default number of grid columns. */
export const DEFAULT_GRID_COLUMNS = 4;
