/**
 * Reasoning chain composite renderer.
 *
 * Renders a vertical chain of reasoning steps: a question box at top,
 * numbered step cards stacked vertically with downward arrows, and
 * a final answer box at the bottom with a thicker border, green tint,
 * and "✓" prefix.
 *
 * Layout is cached per expression ID + data hash to avoid
 * re-computing on every frame.
 *
 * @module
 */

import type { VisualExpression, ReasoningChainData } from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import type { Options } from "roughjs/bin/core.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { renderArrowhead } from "../primitiveRenderer";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Horizontal padding inside the expression bounds. */
const HORIZONTAL_PADDING = 20;

/** Vertical padding at top and bottom. */
const VERTICAL_PADDING = 20;

/** Height of the question box. */
const QUESTION_HEIGHT = 50;

/** Height of each step card. */
const STEP_CARD_HEIGHT = 80;

/** Vertical gap between cards (includes arrow space). */
const CARD_GAP = 36;

/** Height of the final answer box. */
const ANSWER_HEIGHT = 50;

/** Arrowhead size for downward arrows. */
const ARROWHEAD_SIZE = 8;

/** Font sizes. */
const TITLE_FONT_SIZE = 14;
const STEP_TITLE_FONT_SIZE = 13;
const CONTENT_FONT_SIZE = 12;
const ANSWER_FONT_SIZE = 14;

/** Default font family. */
const DEFAULT_FONT_FAMILY = "sans-serif";

/** Green tint for the final answer box. */
const ANSWER_FILL_COLOR = "#e8f5e9";

/** Stroke width multiplier for the answer box (thicker). */
const ANSWER_STROKE_MULTIPLIER = 2;

// ── Layout types ─────────────────────────────────────────────

interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StepCardLayout extends CardLayout {
  stepNumber: number;
  title: string;
  content: string;
}

interface ReasoningLayout {
  questionCard: CardLayout & { text: string };
  stepCards: StepCardLayout[];
  answerCard: CardLayout & { text: string };
  cardWidth: number;
  totalHeight: number;
  dataHash: string;
  /** Expression width used to compute this layout — part of cache key. */
  exprWidth: number;
}

// ── Layout cache ─────────────────────────────────────────────

const layoutCache = new Map<string, ReasoningLayout>();

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

function computeDataHash(data: ReasoningChainData): string {
  return JSON.stringify({
    question: data.question,
    steps: data.steps,
    finalAnswer: data.finalAnswer,
  });
}

// ── Layout computation ───────────────────────────────────────

/**
 * Compute the layout for a reasoning chain.
 *
 * @param data - The reasoning chain data.
 * @param exprWidth - The expression width (for computing card width).
 * @returns The computed layout.
 */
export function computeReasoningLayout(
  data: ReasoningChainData,
  exprWidth: number,
): ReasoningLayout {
  const cardWidth = exprWidth - HORIZONTAL_PADDING * 2;
  let currentY = VERTICAL_PADDING;

  // Question card
  const questionCard = {
    x: HORIZONTAL_PADDING,
    y: currentY,
    width: cardWidth,
    height: QUESTION_HEIGHT,
    text: data.question,
  };
  currentY += QUESTION_HEIGHT + CARD_GAP;

  // Step cards
  const stepCards: StepCardLayout[] = data.steps.map((step, i) => {
    const card: StepCardLayout = {
      x: HORIZONTAL_PADDING,
      y: currentY,
      width: cardWidth,
      height: STEP_CARD_HEIGHT,
      stepNumber: i + 1,
      title: step.title,
      content: step.content,
    };
    currentY += STEP_CARD_HEIGHT + CARD_GAP;
    return card;
  });

  // Final answer card
  const answerCard = {
    x: HORIZONTAL_PADDING,
    y: currentY,
    width: cardWidth,
    height: ANSWER_HEIGHT,
    text: data.finalAnswer,
  };
  currentY += ANSWER_HEIGHT + VERTICAL_PADDING;

  return {
    questionCard,
    stepCards,
    answerCard,
    cardWidth,
    totalHeight: currentY,
    dataHash: computeDataHash(data),
    exprWidth,
  };
}

// ── Cached layout retrieval ──────────────────────────────────

function getLayout(
  exprId: string,
  data: ReasoningChainData,
  exprWidth: number,
): ReasoningLayout {
  const hash = computeDataHash(data);
  const cached = layoutCache.get(exprId);

  if (cached && cached.dataHash === hash && cached.exprWidth === exprWidth) {
    return cached;
  }

  const layout = computeReasoningLayout(data, exprWidth);
  layoutCache.set(exprId, layout);
  return layout;
}

// ── Arrow renderer ───────────────────────────────────────────

/**
 * Render a downward arrow between two cards.
 */
function renderDownArrow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  topY: number,
  bottomY: number,
  strokeColor: string,
): void {
  ctx.beginPath();
  ctx.moveTo(centerX, topY);
  ctx.lineTo(centerX, bottomY);
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash([]);
  ctx.stroke();

  // Filled downward arrowhead (angle = π/2 = pointing down)
  ctx.fillStyle = strokeColor;
  renderArrowhead(ctx, centerX, bottomY, Math.PI / 2, ARROWHEAD_SIZE);
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a reasoning chain expression.
 *
 * Question box at top, numbered step cards vertically stacked
 * with downward arrows, and a final answer box at the bottom
 * with thicker border and green tint.
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The reasoning chain VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderReasoningChain(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as ReasoningChainData;
  const { x: originX, y: originY } = expr.position;
  const roughOptions = mapStyleToRoughOptions(expr.style);
  const strokeColor = expr.style.strokeColor;
  const exprWidth = expr.size.width;

  ctx.save();

  // ── Compute / retrieve layout ──────────────────────────────
  const layout = getLayout(expr.id, data, exprWidth);

  // ── Render question box ────────────────────────────────────
  const qc = layout.questionCard;
  const qDrawable = rc.rectangle(
    originX + qc.x,
    originY + qc.y,
    qc.width,
    qc.height,
    roughOptions,
  );
  rc.draw(qDrawable);

  ctx.font = `bold ${TITLE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = strokeColor;
  ctx.fillText(
    qc.text,
    originX + qc.x + qc.width / 2,
    originY + qc.y + qc.height / 2,
  );

  // ── Render arrow from question to first step (or answer) ───
  const arrowCenterX = originX + qc.x + qc.width / 2;

  if (layout.stepCards.length > 0) {
    const firstStep = layout.stepCards[0]!;
    renderDownArrow(
      ctx,
      arrowCenterX,
      originY + qc.y + qc.height,
      originY + firstStep.y,
      strokeColor,
    );
  } else if (data.finalAnswer) {
    renderDownArrow(
      ctx,
      arrowCenterX,
      originY + qc.y + qc.height,
      originY + layout.answerCard.y,
      strokeColor,
    );
  }

  // ── Render step cards ──────────────────────────────────────
  for (let i = 0; i < layout.stepCards.length; i++) {
    const sc = layout.stepCards[i]!;

    // Step card rectangle
    const stepDrawable = rc.rectangle(
      originX + sc.x,
      originY + sc.y,
      sc.width,
      sc.height,
      roughOptions,
    );
    rc.draw(stepDrawable);

    // Step title: "Step N: title"
    ctx.font = `bold ${STEP_TITLE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = strokeColor;
    ctx.fillText(
      `Step ${sc.stepNumber}: ${sc.title}`,
      originX + sc.x + 10,
      originY + sc.y + 10,
    );

    // Step content
    ctx.font = `${CONTENT_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
    ctx.fillText(sc.content, originX + sc.x + 10, originY + sc.y + 32);

    // Downward arrow to next card
    const nextCard = layout.stepCards[i + 1] ?? layout.answerCard;
    if (nextCard && (i < layout.stepCards.length - 1 || data.finalAnswer)) {
      renderDownArrow(
        ctx,
        arrowCenterX,
        originY + sc.y + sc.height,
        originY + nextCard.y,
        strokeColor,
      );
    }
  }

  // ── Render final answer box ────────────────────────────────
  if (data.finalAnswer) {
    const ac = layout.answerCard;
    const answerOptions: Options = {
      ...roughOptions,
      strokeWidth: (roughOptions.strokeWidth ?? 2) * ANSWER_STROKE_MULTIPLIER,
      fill: ANSWER_FILL_COLOR,
    };

    const answerDrawable = rc.rectangle(
      originX + ac.x,
      originY + ac.y,
      ac.width,
      ac.height,
      answerOptions,
    );
    rc.draw(answerDrawable);

    ctx.font = `bold ${ANSWER_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = strokeColor;
    ctx.fillText(
      `✓ ${ac.text}`,
      originX + ac.x + ac.width / 2,
      originY + ac.y + ac.height / 2,
    );
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

/**
 * Register the reasoning chain renderer on module load.
 */
registerCompositeRenderer("reasoning-chain", renderReasoningChain);
