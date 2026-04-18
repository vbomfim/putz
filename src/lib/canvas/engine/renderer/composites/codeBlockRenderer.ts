/**
 * Code block composite renderer.
 *
 * Renders code with a dark background (#1e1e1e), language label in
 * the top-right corner, and white monospace text. No syntax
 * highlighting is applied.
 *
 * @module
 */

import type { VisualExpression, CodeBlockData } from '../../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import { registerCompositeRenderer } from '../compositeRegistry';

// ── Constants ────────────────────────────────────────────────

/** Dark background color. */
const BG_COLOR = '#1e1e1e';

/** Code text color. */
const TEXT_COLOR = '#d4d4d4';

/** Language label color. */
const LABEL_COLOR = '#888888';

/** Padding inside the code block. */
const PADDING = 16;

/** Line height for code text. */
const LINE_HEIGHT = 20;

/** Font size for code. */
const CODE_FONT_SIZE = 13;

/** Font size for language label. */
const LABEL_FONT_SIZE = 11;

/** Font family for monospace code. */
const CODE_FONT_FAMILY = 'monospace';

/** Corner radius for the background. */
const CORNER_RADIUS = 6;

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a code block expression. [AC5]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The code block VisualExpression.
 * @param rc - The Rough.js canvas (unused — code block uses native rendering).
 */
export function renderCodeBlock(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  _rc: RoughCanvas,
): void {
  const data = expr.data as CodeBlockData;
  const { x: originX, y: originY } = expr.position;
  const { width, height } = expr.size;

  ctx.save();

  // ── Dark background ────────────────────────────────────────
  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(originX, originY, width, height, CORNER_RADIUS);
  } else {
    ctx.rect(originX, originY, width, height);
  }
  ctx.fill();

  // Clipping is handled by fillRect for the background
  ctx.fillRect(originX, originY, width, height);

  // ── Language label (top-right) ─────────────────────────────
  if (data.language) {
    ctx.font = `${LABEL_FONT_SIZE}px ${CODE_FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(data.language, originX + width - PADDING, originY + PADDING / 2);
  }

  // ── Code text ──────────────────────────────────────────────
  if (!data.code) {
    ctx.restore();
    return;
  }

  const lines = data.code.split('\n');
  ctx.font = `${CODE_FONT_SIZE}px ${CODE_FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT_COLOR;

  const codeTop = originY + PADDING + (data.language ? LINE_HEIGHT : 0);
  const maxLines = Math.floor((height - PADDING * 2) / LINE_HEIGHT);

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    ctx.fillText(lines[i]!, originX + PADDING, codeTop + i * LINE_HEIGHT);
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer('code-block', renderCodeBlock);
