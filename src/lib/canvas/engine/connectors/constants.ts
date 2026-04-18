/**
 * Shared constants for the connector system.
 *
 * Single source of truth for bindable shape kinds.
 * Imported by connectionPoints.ts, connectorHelpers.ts, and ArrowTool.ts.
 *
 * @module
 */

/** Expression kinds that support connection points and snap/binding. */
export const BINDABLE_KINDS = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'sticky-note',
  'stencil',
  'container',
]);
