/**
 * Annotation data types for InfiniCanvas Protocol.
 *
 * Annotations attach supplementary information to other expressions:
 * comments, callouts, highlights, and markers.
 *
 * @module
 */

/** A comment attached to a specific expression. */
export interface CommentData {
  kind: 'comment';
  text: string;
  /** ID of the expression this comment refers to. */
  targetExpressionId: string;
  /** Whether the comment has been resolved. */
  resolved: boolean;
}

/** A callout pointing to a specific expression. */
export interface CalloutData {
  kind: 'callout';
  text: string;
  /** ID of the expression this callout points to. */
  targetExpressionId: string;
  /** Position of the callout relative to its target. */
  position: 'top' | 'right' | 'bottom' | 'left';
}

/** A highlight spanning one or more expressions. */
export interface HighlightData {
  kind: 'highlight';
  /** IDs of the expressions being highlighted. */
  targetExpressionIds: string[];
  /** Highlight color in hex format. */
  color: string;
}

/** A standalone marker / label on the canvas. */
export interface MarkerData {
  kind: 'marker';
  label: string;
  /** Optional icon identifier. */
  icon?: string;
}

/** Union of all annotation data types. */
export type AnnotationData =
  | CommentData
  | CalloutData
  | HighlightData
  | MarkerData;
