/**
 * Mind map composite renderer.
 *
 * Renders a radial/tree mind map with a central topic as a bold
 * rounded rectangle and branches extending outward to the right.
 * Uses curved Rough.js-style lines (via native canvas quadratic curves)
 * for connections. Supports up to 5 levels of depth; deeper nodes
 * are collapsed with a "…" truncation indicator.
 *
 * Layout is cached per expression ID + data hash to avoid
 * re-computing on every frame.
 *
 * @module
 */

import type { VisualExpression, MindMapData, MindMapBranch } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import { mapStyleToRoughOptions } from '../styleMapper';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

/** Central topic box width. */
const CENTER_WIDTH = 160;

/** Central topic box height. */
const CENTER_HEIGHT = 44;

/** Branch node box width. */
const NODE_WIDTH = 120;

/** Branch node box height. */
const NODE_HEIGHT = 30;

/** Horizontal distance between depth levels. */
const LEVEL_SPACING = 180;

/** Minimum vertical spacing between sibling nodes. */
const SIBLING_SPACING = 50;

/** Maximum tree depth before truncation. */
const MAX_DEPTH = 5;

/** Font sizes. */
const CENTER_FONT_SIZE = 16;
const NODE_FONT_SIZE = 13;
const TRUNCATION_FONT_SIZE = 12;

/** Default font family. */
const DEFAULT_FONT_FAMILY = 'sans-serif';

/** Padding around the diagram. */
const DIAGRAM_PADDING = 30;

// ── Layout types ─────────────────────────────────────────────

interface MindMapNodeLayout {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  truncated: boolean;
}

interface MindMapConnection {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface MindMapLayout {
  center: { x: number; y: number };
  nodes: MindMapNodeLayout[];
  connections: MindMapConnection[];
  totalWidth: number;
  totalHeight: number;
  dataHash: string;
}

// ── Layout cache ─────────────────────────────────────────────

const layoutCache = new Map<string, MindMapLayout>();

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

function computeDataHash(data: MindMapData): string {
  return JSON.stringify({
    centralTopic: data.centralTopic,
    branches: data.branches,
  });
}

// ── Subtree size computation ─────────────────────────────────

/**
 * Count the total number of leaf nodes (or leaf-equivalent slots)
 * in a branch subtree, respecting the max depth.
 */
function countLeaves(branch: MindMapBranch, currentDepth: number): number {
  if (currentDepth >= MAX_DEPTH || branch.children.length === 0) {
    return 1;
  }
  let total = 0;
  for (const child of branch.children) {
    total += countLeaves(child, currentDepth + 1);
  }
  return total;
}

// ── Layout computation ───────────────────────────────────────

/**
 * Recursively lay out a branch and its children.
 *
 * @param branch - The branch to lay out.
 * @param depth - Current depth (1 = first-level branch).
 * @param centerX - The x position of the center node's right edge.
 * @param slotTop - The top of the vertical slot allocated to this subtree.
 * @param slotHeight - The height of the vertical slot.
 * @param nodes - Array to append nodes to.
 * @param connections - Array to append connections to.
 * @param parentX - X center of the parent node.
 * @param parentY - Y center of the parent node.
 */
function layoutBranch(
  branch: MindMapBranch,
  depth: number,
  centerX: number,
  slotTop: number,
  slotHeight: number,
  nodes: MindMapNodeLayout[],
  connections: MindMapConnection[],
  parentX: number,
  parentY: number,
): void {
  const nodeX = centerX + depth * LEVEL_SPACING;
  const nodeY = slotTop + slotHeight / 2;
  const w = NODE_WIDTH;
  const h = NODE_HEIGHT;

  const isTruncated = depth >= MAX_DEPTH && branch.children.length > 0;

  nodes.push({
    id: branch.id,
    label: branch.label,
    x: nodeX,
    y: nodeY,
    width: w,
    height: h,
    depth,
    truncated: isTruncated,
  });

  // Connection from parent to this node
  connections.push({
    fromX: parentX + (depth === 1 ? CENTER_WIDTH / 2 : NODE_WIDTH / 2),
    fromY: parentY,
    toX: nodeX - w / 2,
    toY: nodeY,
  });

  // If truncated, stop recursion (renderer draws "…" after the node)
  if (isTruncated) {
    return;
  }

  // Lay out children
  if (branch.children.length === 0) return;

  const totalLeaves = branch.children.reduce(
    (sum, child) => sum + countLeaves(child, depth + 1),
    0,
  );

  let currentTop = slotTop;

  for (const child of branch.children) {
    const childLeaves = countLeaves(child, depth + 1);
    const childSlotHeight = (childLeaves / totalLeaves) * slotHeight;

    layoutBranch(
      child,
      depth + 1,
      centerX,
      currentTop,
      childSlotHeight,
      nodes,
      connections,
      nodeX,
      nodeY,
    );

    currentTop += childSlotHeight;
  }
}

/**
 * Compute the full mind map layout.
 *
 * Places the central topic at center-left and lays out branches
 * extending to the right with proportional vertical spacing.
 */
export function computeMindMapLayout(data: MindMapData): MindMapLayout {
  const nodes: MindMapNodeLayout[] = [];
  const connections: MindMapConnection[] = [];

  // Count total leaves for vertical space allocation
  const totalLeaves = data.branches.length > 0
    ? data.branches.reduce((sum, b) => sum + countLeaves(b, 1), 0)
    : 1;

  const totalSlotHeight = totalLeaves * SIBLING_SPACING;

  // Central topic position (left-center of the diagram)
  const centerX = DIAGRAM_PADDING;
  const centerY = DIAGRAM_PADDING + totalSlotHeight / 2;

  // Add central topic as the root node (depth 0)
  nodes.push({
    id: '__center__',
    label: data.centralTopic,
    x: centerX + CENTER_WIDTH / 2,
    y: centerY,
    width: CENTER_WIDTH,
    height: CENTER_HEIGHT,
    depth: 0,
    truncated: false,
  });

  // Lay out branches
  let currentTop = DIAGRAM_PADDING;

  for (const branch of data.branches) {
    const branchLeaves = countLeaves(branch, 1);
    const branchSlotHeight = (branchLeaves / totalLeaves) * totalSlotHeight;

    layoutBranch(
      branch,
      1,
      centerX,
      currentTop,
      branchSlotHeight,
      nodes,
      connections,
      centerX + CENTER_WIDTH / 2,
      centerY,
    );

    currentTop += branchSlotHeight;
  }

  // Compute total dimensions
  const maxX = nodes.reduce((max, n) => Math.max(max, n.x + n.width / 2), 0);
  const maxY = nodes.reduce((max, n) => Math.max(max, n.y + n.height / 2), 0);

  return {
    center: { x: centerX + CENTER_WIDTH / 2, y: centerY },
    nodes,
    connections,
    totalWidth: maxX + DIAGRAM_PADDING,
    totalHeight: maxY + DIAGRAM_PADDING,
    dataHash: computeDataHash(data),
  };
}

// ── Cached layout retrieval ──────────────────────────────────

function getLayout(exprId: string, data: MindMapData): MindMapLayout {
  const hash = computeDataHash(data);
  const cached = layoutCache.get(exprId);

  if (cached && cached.dataHash === hash) {
    return cached;
  }

  const layout = computeMindMapLayout(data);
  layoutCache.set(exprId, layout);
  return layout;
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a mind map expression.
 *
 * Central topic is a bold rounded rectangle at center-left.
 * First-level branches extend to the right with curved lines.
 * Nested children extend further with proportional vertical spacing.
 * Depth is capped at 5 levels; deeper nodes show "…".
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The mind map VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderMindMap(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as MindMapData;
  const { x: originX, y: originY } = expr.position;
  const roughOptions = mapStyleToRoughOptions(expr.style);
  const strokeColor = expr.style.strokeColor;

  ctx.save();

  // ── Compute / retrieve layout ──────────────────────────────
  const layout = getLayout(expr.id, data);

  // ── Render connections (curved lines) ──────────────────────
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = expr.style.strokeWidth;

  for (const conn of layout.connections) {
    const fx = originX + conn.fromX;
    const fy = originY + conn.fromY;
    const tx = originX + conn.toX;
    const ty = originY + conn.toY;
    const cpX = fx + (tx - fx) * 0.5;

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(cpX, ty, tx, ty);
    ctx.stroke();
  }

  // ── Render nodes ───────────────────────────────────────────
  for (const node of layout.nodes) {
    const nx = originX + node.x - node.width / 2;
    const ny = originY + node.y - node.height / 2;

    if (node.depth === 0) {
      // Central topic: bold rounded rectangle
      const drawable = rc.rectangle(nx, ny, node.width, node.height, roughOptions);
      rc.draw(drawable);

      ctx.font = `bold ${CENTER_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = strokeColor;
      ctx.fillText(node.label, originX + node.x, originY + node.y);
    } else {
      // Branch node
      const drawable = rc.rectangle(nx, ny, node.width, node.height, roughOptions);
      rc.draw(drawable);

      ctx.font = `${NODE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = strokeColor;
      ctx.fillText(node.label, originX + node.x, originY + node.y);

      // Truncation indicator: draw "…" to the right of truncated nodes
      if (node.truncated) {
        ctx.font = `${TRUNCATION_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = strokeColor;
        ctx.fillText('…', originX + node.x + node.width / 2 + 8, originY + node.y);
      }
    }
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

/**
 * Register the mind map renderer on module load.
 */
registerCompositeRenderer('mind-map', renderMindMap);
