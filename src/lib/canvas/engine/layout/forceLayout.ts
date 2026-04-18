/**
 * Force-directed layout — spring/repulsion model.
 *
 * Connected shapes attract (spring force), all shapes repel
 * (charge/Coulomb force). Iterates until stable or max iterations.
 *
 * Custom implementation — no external library needed.
 * Good for undirected relationships and cluster discovery.
 *
 * Pure function — takes shapes and edges, returns position map.
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import type { ForceLayoutOptions } from './types';
import { DEFAULT_FORCE_ITERATIONS } from './types';
import { extractEdges } from './edges';

/** Spring constant — attraction force for connected nodes. */
const SPRING_K = 0.005;

/** Ideal spring length between connected nodes. */
const SPRING_LENGTH = 200;

/** Repulsion constant — charge force between all node pairs. */
const REPULSION_K = 8000;

/** Damping factor — reduces velocity each iteration for convergence. */
const DAMPING = 0.85;

/** Maximum velocity clamp to prevent instability. */
const MAX_VELOCITY = 50;

/** Small epsilon to avoid division by zero. */
const EPSILON = 0.1;

/** Internal node state during simulation. */
interface ForceNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
}

/**
 * Compute force-directed positions for the given shapes.
 *
 * Simulates a physics system where connected shapes attract
 * and all shapes repel. Converges to a stable arrangement.
 *
 * @param shapes - Non-arrow, non-locked shapes to arrange
 * @param arrows - Arrow expressions with binding data for edge extraction
 * @param options - Iteration count configuration
 * @returns Map of expression ID → new { x, y } position
 */
export function computeForceLayout(
  shapes: VisualExpression[],
  arrows: VisualExpression[],
  options: ForceLayoutOptions,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();

  if (shapes.length === 0) return result;

  const iterations = options.iterations ?? DEFAULT_FORCE_ITERATIONS;

  // Initialize nodes from shapes with small jitter to break symmetry
  // When nodes start at identical positions, forces cancel out.
  // A deterministic offset based on index avoids this.
  const nodes: ForceNode[] = shapes.map((shape, index) => ({
    id: shape.id,
    x: shape.position.x + shape.size.width / 2 + index * 0.1,
    y: shape.position.y + shape.size.height / 2 + index * 0.1,
    width: shape.size.width,
    height: shape.size.height,
    vx: 0,
    vy: 0,
  }));

  // Handle zero iterations — return original positions
  if (iterations <= 0) {
    for (const shape of shapes) {
      result.set(shape.id, { x: shape.position.x, y: shape.position.y });
    }
    return result;
  }

  // Extract edges from arrow bindings
  const shapeIds = new Set(shapes.map((s) => s.id));
  const edges = extractEdges(arrows, shapeIds);

  // Build node lookup map for O(1) access in hot loop [Finding #2]
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Run simulation
  for (let iter = 0; iter < iterations; iter++) {
    // Calculate repulsion forces between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i]!;
        const nodeB = nodes[j]!;

        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distSq = dx * dx + dy * dy + EPSILON;
        const dist = Math.sqrt(distSq);

        // Coulomb repulsion: F = k / d²
        const force = REPULSION_K / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        nodeA.vx -= fx;
        nodeA.vy -= fy;
        nodeB.vx += fx;
        nodeB.vy += fy;
      }
    }

    // Calculate spring forces for connected pairs
    for (const edge of edges) {
      const nodeA = nodeMap.get(edge.source);
      const nodeB = nodeMap.get(edge.target);
      if (!nodeA || !nodeB) continue;

      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      const dist = Math.sqrt(dx * dx + dy * dy + EPSILON);

      // Hooke's law: F = k * (d - rest_length)
      const displacement = dist - SPRING_LENGTH;
      const force = SPRING_K * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      nodeA.vx += fx;
      nodeA.vy += fy;
      nodeB.vx -= fx;
      nodeB.vy -= fy;
    }

    // Apply velocities with damping and clamping
    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;

      // Clamp velocity to prevent explosions
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > MAX_VELOCITY) {
        node.vx = (node.vx / speed) * MAX_VELOCITY;
        node.vy = (node.vy / speed) * MAX_VELOCITY;
      }

      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // Build shape lookup map for O(1) access
  const shapeMap = new Map(shapes.map((s) => [s.id, s]));

  // Convert center positions to top-left and round
  for (const node of nodes) {
    const shape = shapeMap.get(node.id);
    if (shape) {
      result.set(node.id, {
        x: Math.round(node.x - shape.size.width / 2),
        y: Math.round(node.y - shape.size.height / 2),
      });
    }
  }

  return result;
}
