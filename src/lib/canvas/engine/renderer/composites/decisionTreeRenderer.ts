/**
 * Decision tree composite renderer.
 *
 * Renders a root question at the top with options branching downward.
 * Supports a maximum of 4 levels of recursive depth. Outcomes are
 * displayed as leaf text nodes.
 *
 * @module
 */

import type {
  VisualExpression,
  DecisionTreeData,
  DecisionOption,
} from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import type { Options } from "roughjs/bin/core.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding around the decision tree. */
const PADDING = 20;

/** Maximum recursive depth for rendering. */
const MAX_DEPTH = 4;

/** Height of the root question box. */
const QUESTION_HEIGHT = 40;

/** Width of option nodes. */
const OPTION_WIDTH = 120;

/** Height of option nodes. */
const OPTION_HEIGHT = 32;

/** Vertical gap between levels. */
const LEVEL_GAP = 50;

/** Horizontal gap between sibling options. */
const SIBLING_GAP = 16;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Question font size. */
const QUESTION_FONT_SIZE = 14;

/** Option label font size. */
const OPTION_FONT_SIZE = 12;

/** Outcome text font size. */
const OUTCOME_FONT_SIZE = 10;

/** Outcome text vertical offset below option. */
const OUTCOME_OFFSET = 14;

// ── Layout computation ───────────────────────────────────────

interface LayoutNode {
  label: string;
  outcome?: string;
  children: LayoutNode[];
  x: number;
  y: number;
  width: number;
}

/**
 * Compute the total width needed for a subtree.
 */
function computeSubtreeWidth(option: DecisionOption, depth: number): number {
  if (depth >= MAX_DEPTH || option.children.length === 0) {
    return OPTION_WIDTH;
  }

  const childrenWidth = option.children.reduce(
    (sum, child) => sum + computeSubtreeWidth(child, depth + 1),
    0,
  );
  const gaps = Math.max(0, option.children.length - 1) * SIBLING_GAP;

  return Math.max(OPTION_WIDTH, childrenWidth + gaps);
}

/**
 * Layout a subtree recursively, assigning x/y positions.
 */
function layoutSubtree(
  option: DecisionOption,
  centerX: number,
  topY: number,
  depth: number,
): LayoutNode {
  const node: LayoutNode = {
    label: option.label,
    outcome: option.outcome,
    children: [],
    x: centerX,
    y: topY,
    width: OPTION_WIDTH,
  };

  if (depth >= MAX_DEPTH || option.children.length === 0) {
    return node;
  }

  const childY = topY + OPTION_HEIGHT + LEVEL_GAP;
  const totalWidth = computeSubtreeWidth(option, depth);
  let currentX = centerX - totalWidth / 2;

  for (const child of option.children) {
    const childWidth = computeSubtreeWidth(child, depth + 1);
    const childCenterX = currentX + childWidth / 2;
    const childNode = layoutSubtree(child, childCenterX, childY, depth + 1);
    node.children.push(childNode);
    currentX += childWidth + SIBLING_GAP;
  }

  return node;
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a decision tree expression. [AC8]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The decision tree VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderDecisionTree(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as DecisionTreeData;
  const { x: originX, y: originY } = expr.position;
  const { width } = expr.size;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // ── Root question ──────────────────────────────────────────
  const questionCenterX = originX + width / 2;
  const questionY = originY + PADDING;

  ctx.font = `bold ${QUESTION_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = expr.style.strokeColor;
  ctx.fillText(data.question, questionCenterX, questionY + QUESTION_HEIGHT / 2);

  // ── Empty tree ─────────────────────────────────────────────
  if (data.options.length === 0) {
    ctx.restore();
    return;
  }

  // ── Layout options ─────────────────────────────────────────
  const optionsTopY = questionY + QUESTION_HEIGHT + LEVEL_GAP;

  // Compute total width of all top-level options
  const totalWidth =
    data.options.reduce((sum, opt) => sum + computeSubtreeWidth(opt, 1), 0) +
    Math.max(0, data.options.length - 1) * SIBLING_GAP;

  let currentX = questionCenterX - totalWidth / 2;
  const layoutNodes: LayoutNode[] = [];

  for (const option of data.options) {
    const optWidth = computeSubtreeWidth(option, 1);
    const optCenterX = currentX + optWidth / 2;
    layoutNodes.push(layoutSubtree(option, optCenterX, optionsTopY, 1));
    currentX += optWidth + SIBLING_GAP;
  }

  // ── Render tree ────────────────────────────────────────────
  for (const node of layoutNodes) {
    // Draw connector from question to top-level option
    drawConnector(
      ctx,
      rc,
      questionCenterX,
      questionY + QUESTION_HEIGHT,
      node.x,
      node.y,
      roughOptions,
    );
    renderNode(ctx, rc, node, roughOptions);
  }

  ctx.restore();
}

/**
 * Render a single option node and its children recursively.
 */
function renderNode(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  node: LayoutNode,
  roughOptions: Options,
): void {
  // Draw option box
  const rx = node.x - OPTION_WIDTH / 2;
  const drawable = rc.rectangle(
    rx,
    node.y,
    OPTION_WIDTH,
    OPTION_HEIGHT,
    roughOptions,
  );
  rc.draw(drawable);

  // Option label
  ctx.font = `${OPTION_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
  ctx.fillText(node.label, node.x, node.y + OPTION_HEIGHT / 2);

  // Outcome text below leaf nodes
  if (node.outcome && node.children.length === 0) {
    ctx.font = `italic ${OUTCOME_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#666666";
    ctx.fillText(
      node.outcome,
      node.x,
      node.y + OPTION_HEIGHT + OUTCOME_OFFSET / 2,
    );
  }

  // Render children
  for (const child of node.children) {
    drawConnector(
      ctx,
      rc,
      node.x,
      node.y + OPTION_HEIGHT,
      child.x,
      child.y,
      roughOptions,
    );
    renderNode(ctx, rc, child, roughOptions);
  }
}

/**
 * Draw a vertical connector line between parent bottom and child top.
 */
function drawConnector(
  _ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  roughOptions: Options,
): void {
  const lineDrawable = rc.line(fromX, fromY, toX, toY, roughOptions);
  rc.draw(lineDrawable);
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("decision-tree", renderDecisionTree);
