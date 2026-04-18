/**
 * VisualExpression — the core type of the InfiniCanvas Protocol.
 *
 * Every element on the canvas is a VisualExpression, carrying its identity,
 * position, style, metadata, and kind-specific data payload.
 *
 * @module
 */

import type { AuthorInfo, ExpressionStyle } from './metadata';
import type { PrimitiveData } from './primitives';
import type { CompositeData } from './composites';
import type { AnnotationData } from './annotations';

/** Discriminated union of all expression data payloads. */
export type ExpressionData = PrimitiveData | CompositeData | AnnotationData;

/** All valid expression kind strings, derived from ExpressionData. */
export type ExpressionKind = ExpressionData['kind'];

/** Default layer ID — the guaranteed fallback layer every canvas starts with. */
export const DEFAULT_LAYER_ID = 'default';

/** A canvas layer for organizing expressions with visibility and lock controls. */
export interface Layer {
  /** Unique identifier for this layer. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Whether expressions on this layer are rendered. */
  visible: boolean;
  /** Whether expressions on this layer are locked from editing. */
  locked: boolean;
  /** Z-order position (lower = further back, rendered first). */
  order: number;
}

/** A visual expression on the InfiniCanvas. */
export interface VisualExpression {
  /** Unique identifier for this expression. */
  id: string;
  /** The kind of expression — discriminant for the `data` field. */
  kind: ExpressionKind;
  /** Position on the canvas (top-left corner). */
  position: { x: number; y: number };
  /** Dimensions of the expression bounding box. */
  size: { width: number; height: number };
  /** Rotation angle in degrees. */
  angle: number;
  /** Visual styling. */
  style: ExpressionStyle;
  /** Expression metadata. */
  meta: {
    /** Who created this expression. */
    author: AuthorInfo;
    /** Unix timestamp (ms) when the expression was created. */
    createdAt: number;
    /** Unix timestamp (ms) when the expression was last updated. */
    updatedAt: number;
    /** ID of the operation that produced this expression. */
    sourceOperation?: string;
    /** Freeform tags for categorization. */
    tags: string[];
    /** Whether this expression is locked from editing. */
    locked: boolean;
  };
  /** ID of the parent expression (for grouping/nesting). */
  parentId?: string;
  /** IDs of child expressions. */
  children?: string[];
  /** ID of the layer this expression belongs to (default: 'default'). */
  layerId?: string;
  /** Kind-specific data payload (discriminated by `kind`). */
  data: ExpressionData;
}
