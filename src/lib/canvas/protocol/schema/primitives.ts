/**
 * Primitive element data types for InfiniCanvas Protocol.
 *
 * Each type represents the data payload for a single primitive expression kind.
 *
 * @module
 */

/** Data for a rectangle expression. */
export interface RectangleData {
  kind: 'rectangle';
  label?: string;
}

/** Data for an ellipse expression. */
export interface EllipseData {
  kind: 'ellipse';
  label?: string;
}

/** Data for a diamond expression. */
export interface DiamondData {
  kind: 'diamond';
  label?: string;
}

/** Data for a line expression defined by a series of points. */
export interface LineData {
  kind: 'line';
  /** Array of [x, y] coordinate pairs forming the line. */
  points: [number, number][];
}

/** Anchor position on a shape's edge for arrow binding. */
export type ArrowAnchor = 'center' | 'top' | 'right' | 'bottom' | 'left'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'auto';

/** Binding that connects an arrow endpoint to a shape. */
export interface ArrowBinding {
  /** ID of the bound shape expression. */
  expressionId: string;
  /** Which edge of the shape the arrow attaches to. */
  anchor: ArrowAnchor;
  /** Position along the edge (0-1). 0.5 = center. */
  ratio?: number;
  /** Exact X connection point (0-1 ratio, matches draw.io exitX/entryX). */
  portX?: number;
  /** Exact Y connection point (0-1 ratio, matches draw.io exitY/entryY). */
  portY?: number;
}

/**
 * Arrowhead tip style.
 *
 * Covers all draw.io arrowhead types plus legacy InfiniCanvas values.
 * `'triangle'` is kept as an alias for `'classic'` (backward compat).
 */
export type ArrowheadType =
  // Legacy (backward compat)
  | 'triangle'      // alias for 'classic'
  | 'chevron'       // legacy InfiniCanvas
  // Standard
  | 'none'          // no arrowhead
  | 'classic'       // filled triangle (draw.io default)
  | 'classicThin'   // thinner filled triangle
  | 'open'          // outline triangle
  | 'openThin'      // thinner outline triangle
  | 'block'         // filled rectangle/block
  | 'blockThin'     // thinner block
  | 'oval'          // filled circle
  | 'diamond'       // filled diamond
  | 'diamondThin'   // thinner diamond
  | 'circle'        // alias kept for backward compat
  // ER Diagram
  | 'ERone'         // single bar (|)
  | 'ERmany'        // crow's foot (>)
  | 'ERmandOne'     // mandatory one (||)
  | 'ERoneToMany'   // one to many (|>)
  | 'ERzeroToOne'   // zero to one (o|)
  | 'ERzeroToMany'  // zero to many (o>)
  // UML
  | 'openAsync'     // open arrowhead (async message)
  | 'dash'          // dashed end
  | 'cross'         // X mark
  // Other
  | 'box'           // small filled box
  | 'halfCircle'    // half circle
  | 'doubleBlock';  // double block arrows

/** Data for an arrow expression with optional arrowheads. */
export interface ArrowData {
  kind: 'arrow';
  /** Array of [x, y] coordinate pairs forming the arrow path. */
  points: [number, number][];
  /** Arrowhead style at the start ('none' = no arrowhead). */
  startArrowhead?: ArrowheadType | boolean;
  /** Arrowhead style at the end ('none' = no arrowhead). */
  endArrowhead?: ArrowheadType | boolean;
  /** Filled (true) or outline (false) start arrowhead. */
  startFill?: boolean;
  /** Filled (true) or outline (false) end arrowhead. */
  endFill?: boolean;
  /** Binding for the start endpoint to a shape. */
  startBinding?: ArrowBinding;
  /** Binding for the end endpoint to a shape. */
  endBinding?: ArrowBinding;
  /** Optional text label rendered at the arrow midpoint. */
  label?: string;
  /** Routing mode for the connector path. */
  routing?: RoutingMode;
  /** Smooth bezier curves on orthogonal corners (draw.io curved=1). */
  curved?: boolean;
  /** Round corners on orthogonal route segments. */
  rounded?: boolean;
  /** Exit stub length from shape; 'auto' = calculated. */
  jettySize?: number | 'auto';
  /** Z-shape midpoint offset as 0–1 ratio (0.5 = centered, default). */
  midpointOffset?: number;
  /**
   * User-adjusted segment positions for orthogonal routes.
   *
   * Each entry is the absolute X (for vertical segments) or Y (for
   * horizontal segments) of a draggable mid-segment. When present,
   * overrides the auto-computed position for that segment. Indices
   * correspond to the internal segments of the route (excluding the
   * first and last jetty stubs).
   */
  waypoints?: number[];
}

/** Data for a freehand drawing expression. */
export interface FreehandData {
  kind: 'freehand';
  /** Array of [x, y, pressure] tuples capturing the stroke. */
  points: [number, number, number][];
}

/** Data for a text expression. */
export interface TextData {
  kind: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
}

/** Data for a sticky note expression. */
export interface StickyNoteData {
  kind: 'sticky-note';
  text: string;
  /** Background color of the sticky note. */
  color: string;
}

/** Data for an image expression. */
export interface ImageData {
  kind: 'image';
  /** Image source URL or data URI. */
  src: string;
  /** Alternative text description. */
  alt?: string;
}

/** Data for a stencil expression (icon from the stencil catalog). */
export interface StencilData {
  kind: 'stencil';
  /** ID of the stencil entry in the catalog. */
  stencilId: string;
  /** Category grouping for the stencil (e.g. 'network', 'kubernetes'). */
  category: string;
  /** Optional display label rendered below the icon. */
  label?: string;
  /** Where to render the label relative to the stencil icon. */
  labelPosition?: 'below' | 'top-left' | 'top-center' | 'center';
  /** Explicit font size for the label (world units, no auto-scaling). */
  labelFontSize?: number;
}

/**
 * Data for a container expression.
 *
 * Containers are parent shapes that visually contain and manage children.
 * They have a colored header bar with a title and a body area where
 * child expressions can be placed. Useful for swimlanes, grouping, and
 * organizational layouts.
 */
export interface ContainerData {
  kind: 'container';
  /** Display title shown in the header bar. */
  title: string;
  /** Height of the header bar in world pixels. */
  headerHeight: number;
  /** Inner padding between container border and child area. */
  padding: number;
  /** Whether the container body is collapsed (only header visible). */
  collapsed: boolean;
}

/**
 * Routing mode for arrow connectors.
 *
 * - `'straight'` — direct line between points
 * - `'orthogonal'` — right-angle segments
 * - `'curved'` — smooth bezier curve
 * - `'elbow'` — single-bend elbow connector
 * - `'entityRelation'` — ER-style routing with perpendicular exits
 * - `'isometric'` — 30°/60° isometric routing
 * - `'orthogonalCurved'` — orthogonal routing with bezier-smoothed corners
 */
export type RoutingMode =
  | 'straight'
  | 'orthogonal'
  | 'curved'
  | 'elbow'
  | 'entityRelation'
  | 'isometric'
  | 'orthogonalCurved';

/** Union of all primitive expression data types. */
export type PrimitiveData =
  | RectangleData
  | EllipseData
  | DiamondData
  | LineData
  | ArrowData
  | FreehandData
  | TextData
  | StickyNoteData
  | ImageData
  | StencilData
  | ContainerData;
