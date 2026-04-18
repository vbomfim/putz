/**
 * Metadata types for InfiniCanvas Protocol (ICP).
 *
 * Defines author identity and visual styling for expressions.
 *
 * @module
 */

/** Identifies who authored an expression — either a human or an AI agent. */
export type AuthorInfo =
  | { type: 'human'; id: string; name: string }
  | { type: 'agent'; id: string; name: string; provider: string };

/** Visual styling applied to an expression on the canvas. */
export interface ExpressionStyle {
  /** Stroke color in hex format (e.g. '#000000') */
  strokeColor: string;
  /** Background color in hex format, or 'transparent' */
  backgroundColor: string;
  /** Fill rendering style */
  fillStyle: 'solid' | 'hachure' | 'cross-hatch' | 'none';
  /** Stroke line style */
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  /** Stroke width in pixels (1–10) */
  strokeWidth: number;
  /** Roughness factor: 0 = smooth, 1+ = sketchy hand-drawn look */
  roughness: number;
  /** Opacity: 0 = fully transparent, 1 = fully opaque */
  opacity: number;
  /** Font size in pixels (optional, for text-containing expressions) */
  fontSize?: number;
  /** Font family name (optional) */
  fontFamily?: string;
}

/**
 * Canonical default style for new expressions.
 *
 * Every place that needs a fallback style must import this constant
 * instead of defining its own hardcoded values.
 */
export const DEFAULT_EXPRESSION_STYLE: ExpressionStyle = {
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'hachure',
  strokeStyle: 'solid',
  strokeWidth: 2,
  roughness: 0,
  opacity: 1,
  fontFamily: 'Architects Daughter, cursive',
};
