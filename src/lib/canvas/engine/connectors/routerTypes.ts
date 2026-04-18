/**
 * Shared types for the routing engine system.
 *
 * Defines PathSegment (output of all routers) and RouterFunction
 * (common router signature). These types decouple individual router
 * implementations from the renderer.
 *
 * @module
 */

/**
 * A single segment in a routed path.
 *
 * - `line` — straight segment to (x, y), rendered with `lineTo()`
 * - `bezier` — cubic bezier curve, rendered with `bezierCurveTo()`
 * - `quadratic` — quadratic bezier curve, rendered with `quadraticCurveTo()`
 * - `arc` — arc corner, rendered with `arcTo()`
 */
export type PathSegment =
  | { type: 'line'; x: number; y: number }
  | {
      type: 'bezier';
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  | { type: 'quadratic'; cpx: number; cpy: number; x: number; y: number }
  | { type: 'arc'; rx: number; ry: number; x: number; y: number };

/** Options passed to router functions. */
export interface RouterOptions {
  /** Smooth bezier curves at orthogonal corners. */
  curved?: boolean;
  /** Small arc radius at orthogonal corners. */
  rounded?: boolean;
  /** Exit stub length from shape (default: 20). */
  jettySize?: number;
  /** Z-shape midpoint offset as 0–1 ratio (0.5 = centered, default). */
  midpointOffset?: number;
  /** Bounds of the source shape. */
  startBounds?: { x: number; y: number; width: number; height: number };
  /** Bounds of the target shape. */
  endBounds?: { x: number; y: number; width: number; height: number };
  /**
   * User-adjusted segment positions for orthogonal routes.
   *
   * Each entry is the absolute position of a draggable mid-segment.
   * When present, overrides the auto-computed position.
   */
  waypoints?: number[];
}

/**
 * Function signature for all routing algorithms.
 *
 * Takes start/end points, optional anchors, and options.
 * Returns an array of PathSegments describing the path from start to end.
 * The first segment's start is implicitly the `start` parameter (moveTo).
 */
export type RouterFunction = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  startAnchor?: string,
  endAnchor?: string,
  options?: RouterOptions,
) => PathSegment[];
