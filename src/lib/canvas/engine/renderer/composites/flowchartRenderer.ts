/**
 * Flowchart composite renderer.
 *
 * Uses dagre for automatic graph layout, and Rough.js for sketchy
 * node/edge rendering. Supports five node shapes (rect, diamond,
 * ellipse, parallelogram, cylinder) and four directions (TB, LR, BT, RL).
 *
 * Layout is cached per expression ID + data hash to avoid re-running
 * dagre on every frame. Auto-sizes the expression bounding box from
 * the computed dagre graph dimensions.
 *
 * @module
 */

import type { VisualExpression, FlowchartData, FlowNode } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import type { Options } from 'roughjs/bin/core.js';
import dagre from '@dagrejs/dagre';
import { mapStyleToRoughOptions } from '../styleMapper';
import { renderArrowhead } from '../primitiveRenderer';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

/** Default node width for dagre layout. */
const NODE_WIDTH = 140;

/** Default node height for dagre layout. */
const NODE_HEIGHT = 50;

/** Padding around the entire flowchart within the expression bounds. */
const FLOWCHART_PADDING = 30;

/** Space reserved for the title above the node area. */
const TITLE_HEIGHT = 30;

/** Default font size for node labels. */
const DEFAULT_FONT_SIZE = 14;

/** Default font family. */
const DEFAULT_FONT_FAMILY = 'sans-serif';

/** Title font size. */
const TITLE_FONT_SIZE = 16;

/** Arrowhead size for edge endpoints. */
const ARROWHEAD_SIZE = 8;

/** Parallelogram skew offset (pixels). */
const PARALLELOGRAM_SKEW = 15;

/** Cylinder cap height (proportion of node height). */
const CYLINDER_CAP_RATIO = 0.2;

/** Separation between nodes in dagre layout (pixels). */
const NODE_SEP = 50;

/** Separation between ranks in dagre layout (pixels). */
const RANK_SEP = 60;

/** Edge label font size. */
const EDGE_LABEL_FONT_SIZE = 12;

// ── Layout cache ─────────────────────────────────────────────

interface CachedLayout {
  /** Hash of the data that produced this layout. */
  dataHash: string;
  /** Positioned nodes from dagre. */
  nodes: Map<string, { x: number; y: number; width: number; height: number; label: string; shape: FlowNode['shape'] }>;
  /** Edge routing points from dagre. */
  edges: Array<{ from: string; to: string; points: Array<{ x: number; y: number }>; label?: string }>;
  /** Computed bounds (min/max). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const layoutCache = new Map<string, CachedLayout>();

/**
 * Clear the layout cache. Useful for testing.
 */
export function clearLayoutCache(): void {
  layoutCache.clear();
}

/**
 * Remove a single entry from the layout cache (e.g. after expression deletion).
 */
export function invalidateLayoutCache(exprId: string): void {
  layoutCache.delete(exprId);
}

// ── Data hashing ─────────────────────────────────────────────

/**
 * Compute a simple hash of the flowchart data for cache invalidation.
 */
function computeDataHash(data: FlowchartData): string {
  return JSON.stringify({
    nodes: data.nodes,
    edges: data.edges,
    direction: data.direction,
  });
}

// ── Dagre layout ─────────────────────────────────────────────

/**
 * Run dagre layout on the flowchart data and return positioned nodes/edges.
 */
function computeLayout(data: FlowchartData): CachedLayout {
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: data.direction,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: FLOWCHART_PADDING,
    marginy: FLOWCHART_PADDING,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const node of data.nodes) {
    g.setNode(node.id, {
      label: node.label,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  // Add edges
  for (const edge of data.edges) {
    g.setEdge(edge.from, edge.to, { label: edge.label });
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const nodes = new Map<string, { x: number; y: number; width: number; height: number; label: string; shape: FlowNode['shape'] }>();
  const nodeShapes = new Map(data.nodes.map(n => [n.id, n.shape]));

  for (const nodeId of g.nodes()) {
    const node = g.node(nodeId);
    if (!node) continue;
    nodes.set(nodeId, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      label: node.label ?? '',
      shape: nodeShapes.get(nodeId) ?? 'rect',
    });
  }

  // Extract edge routing points
  const edges: CachedLayout['edges'] = [];
  for (const edgeObj of g.edges()) {
    const edge = g.edge(edgeObj);
    if (!edge) continue;
    edges.push({
      from: edgeObj.v,
      to: edgeObj.w,
      points: edge.points ?? [],
      label: edge.label,
    });
  }

  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes.values()) {
    const left = n.x - n.width / 2;
    const right = n.x + n.width / 2;
    const top = n.y - n.height / 2;
    const bottom = n.y + n.height / 2;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  // Include edge points in bounds
  for (const e of edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  // If no nodes exist, set zero bounds
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  return {
    dataHash: computeDataHash(data),
    nodes,
    edges,
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Get or compute the layout for a flowchart expression.
 */
function getLayout(exprId: string, data: FlowchartData): CachedLayout {
  const hash = computeDataHash(data);
  const cached = layoutCache.get(exprId);

  if (cached && cached.dataHash === hash) {
    return cached;
  }

  const layout = computeLayout(data);
  layoutCache.set(exprId, layout);
  return layout;
}

// ── Node shape renderers ─────────────────────────────────────

/**
 * Render a rectangular node.
 */
function renderRectNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  options: Options,
): void {
  const drawable = rc.rectangle(x - w / 2, y - h / 2, w, h, options);
  rc.draw(drawable);
  renderNodeLabel(ctx, label, x, y, options);
}

/**
 * Render a diamond-shaped node.
 */
function renderDiamondNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  options: Options,
): void {
  const points: [number, number][] = [
    [x, y - h / 2],     // top
    [x + w / 2, y],     // right
    [x, y + h / 2],     // bottom
    [x - w / 2, y],     // left
  ];
  const drawable = rc.polygon(points, options);
  rc.draw(drawable);
  renderNodeLabel(ctx, label, x, y, options);
}

/**
 * Render an ellipse-shaped node.
 */
function renderEllipseNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  options: Options,
): void {
  const drawable = rc.ellipse(x, y, w, h, options);
  rc.draw(drawable);
  renderNodeLabel(ctx, label, x, y, options);
}

/**
 * Render a parallelogram-shaped node (used for I/O).
 */
function renderParallelogramNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  options: Options,
): void {
  const skew = PARALLELOGRAM_SKEW;
  const points: [number, number][] = [
    [x - w / 2 + skew, y - h / 2],  // top-left (skewed right)
    [x + w / 2 + skew, y - h / 2],  // top-right (skewed right)
    [x + w / 2 - skew, y + h / 2],  // bottom-right (skewed left)
    [x - w / 2 - skew, y + h / 2],  // bottom-left (skewed left)
  ];
  const drawable = rc.polygon(points, options);
  rc.draw(drawable);
  renderNodeLabel(ctx, label, x, y, options);
}

/**
 * Render a cylinder-shaped node (used for databases).
 *
 * Draws an elliptical top cap, two side lines, and a bottom ellipse arc.
 */
function renderCylinderNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  options: Options,
): void {
  const capH = h * CYLINDER_CAP_RATIO;
  const bodyTop = y - h / 2 + capH;
  const bodyBottom = y + h / 2 - capH;

  // Top ellipse (full)
  const topDrawable = rc.ellipse(x, y - h / 2 + capH, w, capH * 2, options);
  rc.draw(topDrawable);

  // Side lines
  const leftLine = rc.line(x - w / 2, bodyTop, x - w / 2, bodyBottom, options);
  rc.draw(leftLine);
  const rightLine = rc.line(x + w / 2, bodyTop, x + w / 2, bodyBottom, options);
  rc.draw(rightLine);

  // Bottom ellipse (only bottom half visible — draw full and let overlap)
  const bottomDrawable = rc.ellipse(x, bodyBottom, w, capH * 2, options);
  rc.draw(bottomDrawable);

  renderNodeLabel(ctx, label, x, y, options);
}

/**
 * Render centered text inside a node.
 */
function renderNodeLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  options: Options,
): void {
  if (!label) return;

  ctx.font = `${DEFAULT_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = (options.stroke as string) ?? '#000000';
  ctx.fillText(label, cx, cy);
}

// ── Edge renderer ────────────────────────────────────────────

/**
 * Render an edge as a Rough.js polyline with an arrowhead at the end.
 */
function renderEdge(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  points: Array<{ x: number; y: number }>,
  label: string | undefined,
  options: Options,
): void {
  if (points.length < 2) return;

  // Draw edge line
  const linePoints: [number, number][] = points.map(p => [p.x, p.y]);
  const drawable = rc.linearPath(linePoints, options);
  rc.draw(drawable);

  // Draw arrowhead at the end
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);

  ctx.fillStyle = (options.stroke as string) ?? '#000000';
  renderArrowhead(ctx, last.x, last.y, angle, ARROWHEAD_SIZE);

  // Draw edge label at midpoint
  if (label) {
    const midIdx = Math.floor(points.length / 2);
    const midPoint = points[midIdx]!;

    ctx.font = `${EDGE_LABEL_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = (options.stroke as string) ?? '#000000';
    ctx.fillText(label, midPoint.x, midPoint.y - 10);
  }
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a flowchart expression. [AC4-AC12]
 *
 * Uses dagre for automatic graph layout and Rough.js for rendering.
 * The expression's position is used as the origin offset.
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The flowchart VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderFlowchart(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as FlowchartData;
  const { x: originX, y: originY } = expr.position;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // Data validated by Zod — nodes.min(1) ensures at least one node. [S6-3]

  // ── Compute / retrieve layout [AC4] ────────────────────────
  const layout = getLayout(expr.id, data);
  const { bounds, nodes, edges } = layout;

  // Compute offset: translate dagre coords so bounds start at expression position
  const graphWidth = bounds.maxX - bounds.minX + FLOWCHART_PADDING * 2;

  // NOTE: We do NOT mutate expr.size here — renderers must be pure. [S5-1]
  // Layout sizes are computed at expression creation time in compositeTools.

  const offsetX = originX - bounds.minX + FLOWCHART_PADDING;
  const offsetY = originY - bounds.minY + FLOWCHART_PADDING + TITLE_HEIGHT;

  // ── Render title [AC9] ─────────────────────────────────────
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = expr.style.strokeColor;
  ctx.fillText(data.title, originX + graphWidth / 2, originY + TITLE_HEIGHT / 2);

  // ── Render edges [AC8] ─────────────────────────────────────
  for (const edge of edges) {
    const translatedPoints = edge.points.map(p => ({
      x: p.x + offsetX,
      y: p.y + offsetY,
    }));
    renderEdge(ctx, rc, translatedPoints, edge.label, roughOptions);
  }

  // ── Render nodes [AC6] ─────────────────────────────────────
  for (const [, node] of nodes) {
    const nx = node.x + offsetX;
    const ny = node.y + offsetY;
    const nw = node.width;
    const nh = node.height;

    switch (node.shape) {
      case 'rect':
        renderRectNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
      case 'diamond':
        renderDiamondNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
      case 'ellipse':
        renderEllipseNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
      case 'parallelogram':
        renderParallelogramNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
      case 'cylinder':
        renderCylinderNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
      default:
        // Fallback to rectangle for unknown shapes
        renderRectNode(ctx, rc, nx, ny, nw, nh, node.label, roughOptions);
        break;
    }
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

/**
 * Register the flowchart renderer on module load. [AC5]
 *
 * This ensures that importing this module is sufficient to make
 * the 'flowchart' kind renderable via the composite registry.
 */
registerCompositeRenderer('flowchart', renderFlowchart);
