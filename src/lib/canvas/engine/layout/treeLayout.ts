/**
 * Tree (hierarchical) layout using dagre.
 *
 * Arranges shapes in a layered tree based on arrow bindings.
 * Finds root nodes (no incoming arrows) and positions children
 * below/right of parents depending on direction.
 *
 * Pure function — takes expressions and arrows, returns position map.
 *
 * @module
 */

import dagre from '@dagrejs/dagre';
import type { VisualExpression } from '../../protocol';
import type { TreeLayoutOptions } from './types';
import { DEFAULT_SPACING } from './types';
import { extractEdges } from './edges';

/**
 * Compute hierarchical tree positions for the given shapes.
 *
 * Uses the dagre library for layered graph layout. Arrow bindings
 * define directed edges between shapes. Disconnected nodes are
 * included as isolated nodes in the graph.
 *
 * @param shapes - Non-arrow, non-locked shapes to arrange
 * @param arrows - Arrow expressions with binding data for edge extraction
 * @param options - Direction and spacing configuration
 * @returns Map of expression ID → new { x, y } position
 */
export function computeTreeLayout(
  shapes: VisualExpression[],
  arrows: VisualExpression[],
  options: TreeLayoutOptions,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();

  if (shapes.length === 0) return result;

  const spacing = options.spacing ?? DEFAULT_SPACING;
  const direction = options.direction ?? 'TB';

  // Build dagre graph
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    nodesep: spacing.horizontal,
    ranksep: spacing.vertical,
    marginx: 20,
    marginy: 20,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  // Track valid shape IDs for edge validation
  const shapeIds = new Set(shapes.map((s) => s.id));

  // Add nodes with their dimensions
  for (const shape of shapes) {
    graph.setNode(shape.id, {
      width: shape.size.width,
      height: shape.size.height,
    });
  }

  // Extract edges from arrow bindings
  const edges = extractEdges(arrows, shapeIds);
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  // Run dagre layout
  dagre.layout(graph);

  // Extract computed positions
  // Dagre returns center positions; convert to top-left
  for (const shape of shapes) {
    const node = graph.node(shape.id);
    if (node) {
      result.set(shape.id, {
        x: Math.round(node.x - shape.size.width / 2),
        y: Math.round(node.y - shape.size.height / 2),
      });
    }
  }

  return result;
}
