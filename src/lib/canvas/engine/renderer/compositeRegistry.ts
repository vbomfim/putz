/**
 * Composite renderer registry.
 *
 * Provides a central registry for composite renderers. Each composite
 * expression kind (e.g. 'flowchart', 'sequence-diagram') can register
 * a renderer function that receives the canvas context, expression,
 * and Rough.js canvas for drawing.
 *
 * The registry is checked by the render loop before falling back
 * to the placeholder renderer for unknown kinds.
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";

// ── Types ────────────────────────────────────────────────────

/**
 * A composite renderer draws a composite expression onto the canvas.
 *
 * Receives the 2D context (for text/native drawing), the full
 * expression (for data, position, style), and the Rough.js canvas
 * (for sketchy shape rendering).
 */
export type CompositeRenderer = (
  ctx: CanvasRenderingContext2D,
  expression: VisualExpression,
  rc: RoughCanvas,
) => void;

// ── Registry ─────────────────────────────────────────────────

/** Internal map of kind → renderer. */
const compositeRenderers: Record<string, CompositeRenderer> = {};

/**
 * Register a composite renderer for a given expression kind.
 *
 * If a renderer is already registered for the kind, it is replaced.
 *
 * @param kind - The expression kind string (e.g. 'flowchart').
 * @param renderer - The renderer function to handle this kind.
 */
export function registerCompositeRenderer(
  kind: string,
  renderer: CompositeRenderer,
): void {
  compositeRenderers[kind] = renderer;
}

/**
 * Get the composite renderer for a given expression kind.
 *
 * @param kind - The expression kind to look up.
 * @returns The registered renderer, or null if none is registered.
 */
export function getCompositeRenderer(kind: string): CompositeRenderer | null {
  return compositeRenderers[kind] ?? null;
}

/**
 * Remove all registered composite renderers.
 *
 * Useful for testing and hot-reload scenarios.
 */
export function clearCompositeRenderers(): void {
  for (const key of Object.keys(compositeRenderers)) {
    delete compositeRenderers[key];
  }
}
