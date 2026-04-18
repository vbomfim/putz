/**
 * Primitive expression renderer.
 *
 * Renders all 9 primitive expression kinds using Rough.js for shapes
 * and native canvas API for text, freehand, and images.
 *
 * Each frame: iterate expressionOrder → cull → draw in z-order.
 *
 * @module
 */

import type { VisualExpression, ExpressionStyle } from '../../protocol';
import type { RoughCanvas } from 'roughjs/bin/canvas.js';
import type { Drawable } from 'roughjs/bin/core.js';
import getStroke from 'perfect-freehand';
import type { Camera } from '../types/index';
import { mapStyleToRoughOptions, idToSeed } from './styleMapper';
import { isVisible } from './viewportCulling';
import { createDrawableCache } from './drawableCache';
import type { DrawableCache } from './drawableCache';
import { getCompositeRenderer } from './compositeRegistry';
import { STENCIL_CATALOG, svgToDataUri } from './stencils/index';
import { resolveTextConfig } from '../text/textConfig';
import { renderArrowheadFromRegistry } from './arrowheads';
import { renderArrow as renderArrowImpl } from './arrowRenderer';

// ── Constants ────────────────────────────────────────────────

/** Sticky note rotation in radians (2°). */
const STICKY_NOTE_ROTATION = (2 * Math.PI) / 180;

/** Default font family when not specified. */
const DEFAULT_FONT_FAMILY = 'Architects Daughter, cursive';

/** Line height multiplier for text wrapping. */
const LINE_HEIGHT_MULTIPLIER = 1.4;

// ── Image cache ──────────────────────────────────────────────

/** Global image element cache. Maps src URL → loaded HTMLImageElement. */
const imageCache = new Map<string, HTMLImageElement>();

/** Set of image URLs currently being loaded. */
const imageLoading = new Set<string>();

/** Set of image URLs that failed to load. */
const imageFailed = new Set<string>();

/**
 * Get a cached image element, starting async load if needed.
 *
 * Returns the image if loaded, undefined if still loading,
 * or null if the load failed.
 */
function getCachedImage(src: string): HTMLImageElement | undefined | null {
  if (imageFailed.has(src)) return null;

  const cached = imageCache.get(src);
  if (cached) return cached;

  if (!imageLoading.has(src)) {
    imageLoading.add(src);
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      imageLoading.delete(src);
    };
    img.onerror = () => {
      imageFailed.add(src);
      imageLoading.delete(src);
    };
    img.src = src;
  }

  return undefined;
}

// ── Drawable cache (module-level singleton) ──────────────────

const drawableCache: DrawableCache = createDrawableCache();

// ── Public API ───────────────────────────────────────────────

/**
 * Render all visible expressions in z-order. [AC1] [AC12] [AC13]
 *
 * Iterates `expressionOrder` (index 0 = back), skips off-screen
 * expressions via viewport culling, and renders each visible
 * expression using the appropriate primitive renderer.
 */
export function renderExpressions(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  editingId?: string | null,
): void {
  for (const id of expressionOrder) {
    const expr = expressions[id];
    if (!expr) continue;

    // Viewport culling [AC12]
    const bbox = {
      x: expr.position.x,
      y: expr.position.y,
      width: expr.size.width,
      height: expr.size.height,
    };

    if (!isVisible(bbox, camera, viewportWidth, viewportHeight)) continue;

    // Apply opacity [AC11]
    ctx.save();
    ctx.globalAlpha = expr.style.opacity;

    renderPrimitive(ctx, roughCanvas, expr, expressions, editingId, camera);

    ctx.restore();
  }
}

/**
 * Dispatch to the correct renderer by expression kind.
 *
 * Checks primitives first, then composite registry, then placeholder. [AC15]
 */
function renderPrimitive(
  ctx: CanvasRenderingContext2D,
  roughCanvas: RoughCanvas,
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
  editingId?: string | null,
  camera?: Camera,
): void {
  const { kind } = expr;
  const isEditing = expr.id === editingId;

  switch (kind) {
    case 'rectangle':
      renderRectangle(ctx, roughCanvas, expr, isEditing);
      break;
    case 'ellipse':
      renderEllipse(ctx, roughCanvas, expr, isEditing);
      break;
    case 'diamond':
      renderDiamond(ctx, roughCanvas, expr, isEditing);
      break;
    case 'line':
      renderLine(ctx, roughCanvas, expr);
      break;
    case 'arrow':
      renderArrow(ctx, roughCanvas, expr, expressions, camera);
      break;
    case 'freehand':
      renderFreehand(ctx, expr);
      break;
    case 'text':
      if (!isEditing) renderText(ctx, expr);
      break;
    case 'sticky-note':
      renderStickyNote(ctx, expr, isEditing);
      break;
    case 'image':
      renderImage(ctx, expr);
      break;
    case 'stencil':
      renderStencil(ctx, expr, isEditing);
      break;
    default: {
      // Check composite renderer registry before falling back
      const compositeRenderer = getCompositeRenderer(kind);
      if (compositeRenderer) {
        compositeRenderer(ctx, expr, roughCanvas);
      } else {
        renderPlaceholder(ctx, expr);
      }
      break;
    }
  }
}

// ── Shape renderers (Rough.js) ───────────────────────────────


/** Draw a shape with native canvas API (perfect geometry, no roughness). */
function drawCleanShape(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  kind: 'rectangle' | 'ellipse' | 'diamond',
): void {
  const { x, y } = expr.position;
  const { width, height } = expr.size;
  const style = expr.style;
  const noFill = style.fillStyle === 'none' || style.backgroundColor === 'transparent';
  const dash = style.strokeStyle === 'dashed' ? [style.strokeWidth * 4, style.strokeWidth * 3]
    : style.strokeStyle === 'dotted' ? [style.strokeWidth, style.strokeWidth * 2] : [];

  ctx.save();
  ctx.strokeStyle = style.strokeColor;
  // Native canvas draws single-pixel lines — scale up to match Rough.js visual weight
  ctx.lineWidth = Math.max(style.strokeWidth * 1.5, 1.5);
  ctx.setLineDash(dash);

  ctx.beginPath();
  if (kind === 'rectangle') {
    ctx.rect(x, y, width, height);
  } else if (kind === 'ellipse') {
    ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height / 2);
    ctx.lineTo(x + width / 2, y + height);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
  }

  if (!noFill) {
    ctx.fillStyle = style.backgroundColor;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

/** Render rectangle. [AC2] */
function renderRectangle(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  skipLabel = false,
): void {
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  if ((expr.style.roughness ?? 0) < 0.1) {
    drawCleanShape(ctx, expr, 'rectangle');
  } else {
    const options = mapStyleToRoughOptions(expr.style, idToSeed(expr.id));
    const drawable = getOrCreateDrawable(expr, () =>
      rc.generator.rectangle(0, 0, width, height, options),
    );
    ctx.save();
    ctx.translate(x, y);
    rc.draw(drawable);
    ctx.restore();
  }

  // Center label if present (skip when editing in-place)
  if (!skipLabel && expr.data.kind === 'rectangle' && expr.data.label) {
    renderLabel(ctx, expr.data.label, x, y, width, height, expr.style);
  }
}

/** Render ellipse. [AC3] */
function renderEllipse(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  skipLabel = false,
): void {
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  if ((expr.style.roughness ?? 0) < 0.1) {
    drawCleanShape(ctx, expr, 'ellipse');
  } else {
    const options = mapStyleToRoughOptions(expr.style, idToSeed(expr.id));
    const drawable = getOrCreateDrawable(expr, () =>
      rc.generator.ellipse(width / 2, height / 2, width, height, options),
    );
    ctx.save();
    ctx.translate(x, y);
    rc.draw(drawable);
    ctx.restore();
  }

  if (!skipLabel && expr.data.kind === 'ellipse' && expr.data.label) {
    renderLabel(ctx, expr.data.label, x, y, width, height, expr.style);
  }
}

/** Render diamond. [AC4] */
function renderDiamond(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  skipLabel = false,
): void {
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  if ((expr.style.roughness ?? 0) < 0.1) {
    drawCleanShape(ctx, expr, 'diamond');
  } else {
    const options = mapStyleToRoughOptions(expr.style, idToSeed(expr.id));
    const points: [number, number][] = [
      [width / 2, 0],
      [width, height / 2],
      [width / 2, height],
      [0, height / 2],
    ];
    const drawable = getOrCreateDrawable(expr, () =>
      rc.generator.polygon(points, options),
    );
    ctx.save();
    ctx.translate(x, y);
    rc.draw(drawable);
    ctx.restore();
  }

  if (!skipLabel && expr.data.kind === 'diamond' && expr.data.label) {
    renderLabel(ctx, expr.data.label, x, y, width, height, expr.style);
  }
}

/** Render line. [AC5] */
function renderLine(
  _ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
): void {
  if (expr.data.kind !== 'line') return;
  const { points } = expr.data;
  const options = mapStyleToRoughOptions(expr.style, idToSeed(expr.id));
  const offset = computePositionOffset(expr);

  if (offset.x !== 0 || offset.y !== 0) {
    _ctx.save();
    _ctx.translate(offset.x, offset.y);
  }

  const drawable = getOrCreateDrawable(expr, () =>
    rc.generator.linearPath(points, options),
  );

  rc.draw(drawable);

  if (offset.x !== 0 || offset.y !== 0) {
    _ctx.restore();
  }
}

/** Render arrow with arrowheads and connector bindings. [AC6]
 * Delegates to the extracted arrowRenderer module for unified
 * Canvas2D rendering of all routed arrows.
 */
function renderArrow(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  expr: VisualExpression,
  expressions: Record<string, VisualExpression>,
  camera?: Camera,
): void {
  renderArrowImpl(ctx, rc, expr, expressions, camera,
    computePositionOffset,
    getOrCreateDrawable as (expr: VisualExpression, factory: () => unknown) => unknown);
}

// ── Non-Rough.js renderers ───────────────────────────────────

/** Render freehand stroke using perfect-freehand. [AC7] */
function renderFreehand(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
): void {
  if (expr.data.kind !== 'freehand') return;
  const { points } = expr.data;

  const outlinePoints = getStroke(points, {
    size: expr.style.strokeWidth * 4,
    smoothing: 0.5,
    thinning: 0.5,
    simulatePressure: false,
  });

  if (outlinePoints.length === 0) return;

  const offset = computePositionOffset(expr);

  if (offset.x !== 0 || offset.y !== 0) {
    ctx.save();
    ctx.translate(offset.x, offset.y);
  }

  const path = new Path2D();
  const [first, ...rest] = outlinePoints;
  path.moveTo(first![0], first![1]);
  for (const [px, py] of rest) {
    path.lineTo(px, py);
  }
  path.closePath();

  ctx.fillStyle = expr.style.strokeColor;
  ctx.fill(path);

  if (offset.x !== 0 || offset.y !== 0) {
    ctx.restore();
  }
}

/** Render text with word-wrap using unified text config. [AC8] */
function renderText(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
): void {
  if (expr.data.kind !== 'text') return;
  const config = resolveTextConfig(expr);
  if (!config) return;

  ctx.font = `${config.fontSize}px ${config.fontFamily}`;
  ctx.textAlign = (expr.data as { textAlign: string }).textAlign as CanvasTextAlign;
  ctx.textBaseline = 'top';
  ctx.fillStyle = config.color;

  const lineHeight = config.fontSize * LINE_HEIGHT_MULTIPLIER;
  const lines = wrapText(ctx, config.text, config.worldWidth);

  let textX = config.worldX;
  const textAlign = (expr.data as { textAlign: string }).textAlign;
  if (textAlign === 'center') textX = config.worldX + config.worldWidth / 2;
  else if (textAlign === 'right') textX = config.worldX + config.worldWidth;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, textX, config.worldY + i * lineHeight);
  }
}

/** Render sticky note with background, rotation, and text. [AC9] */
function renderStickyNote(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  skipText = false,
): void {
  if (expr.data.kind !== 'sticky-note') return;
  const { color } = expr.data;
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  ctx.save();

  // Apply slight rotation at center
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.translate(cx, cy);
  ctx.rotate(STICKY_NOTE_ROTATION);
  ctx.translate(-cx, -cy);

  // Draw colored background
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);

  // Draw text with padding (skip when editing in-place)
  if (!skipText) {
    const config = resolveTextConfig(expr);
    if (config) {
      ctx.font = `${config.fontSize}px ${config.fontFamily}`;
      ctx.textAlign = config.textAlign;
      ctx.textBaseline = 'top';
      ctx.fillStyle = config.color;

      const lineHeight = config.fontSize * LINE_HEIGHT_MULTIPLIER;
      const lines = wrapText(ctx, config.text, config.worldWidth);

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(
          lines[i]!,
          config.worldX,
          config.worldY + i * lineHeight,
        );
      }
    }
  }

  ctx.restore();
}

/** Render image (async load + cache). [AC10] */
function renderImage(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
): void {
  if (expr.data.kind !== 'image') return;
  const { src } = expr.data;
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  const img = getCachedImage(src);

  if (img) {
    // Image loaded — draw it
    ctx.drawImage(img, x, y, width, height);
  } else {
    // Image loading or failed — draw placeholder
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#666666';
    ctx.font = `${Math.min(width, height) * 0.3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠', x + width / 2, y + height / 2);
  }
}

/** Render stencil icon from catalog with optional label. */
function renderStencil(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  skipLabel = false,
): void {
  if (expr.data.kind !== 'stencil') return;
  const { stencilId, label } = expr.data;
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  const entry = STENCIL_CATALOG.get(stencilId);

  if (!entry) {
    // Unknown stencil — render labeled placeholder box
    renderPlaceholder(ctx, expr);
    return;
  }

  // Apply expression style colors to the SVG
  const strokeColor = expr.style.strokeColor ?? '#1e1e1e';
  const bgColor = expr.style.backgroundColor ?? 'transparent';
  const fillStyle = expr.style.fillStyle ?? 'hachure';
  const opacity = expr.style.opacity ?? 1;
  
  // Replace currentColor with the expression's stroke color
  const styledSvg = entry.svgContent.replace(/currentColor/g, strokeColor);

  // Draw background fill behind the icon (clipped to bounding box)
  const isTransparent = bgColor === 'transparent' || bgColor === 'none' || bgColor === '#00000000';
  if (fillStyle !== 'none' && !isTransparent) {
    ctx.save();
    ctx.globalAlpha = opacity;

    // Clip all fill rendering to the stencil bounding box
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.clip();

    if (fillStyle === 'solid') {
      ctx.fillStyle = bgColor;
      ctx.fill();
    } else {
      // hachure / cross-hatch — diagonal lines only, no background fill (matches Rough.js)
      const roughness = expr.style.roughness ?? 0;

      ctx.globalAlpha = opacity * 0.6;
      ctx.strokeStyle = bgColor;
      ctx.lineWidth = 1.5;

      // Seeded pseudo-random for stable wobble across frames
      let seed = 0;
      for (let c = 0; c < expr.id.length; c++) seed = ((seed << 5) - seed + expr.id.charCodeAt(c)) | 0;
      const seededRandom = () => {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed & 0x7fffffff) / 2147483647;
      };

      // Hachure at -41° (matching Rough.js default) with roughness wobble
      const angle = -41 * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const step = Math.max(4, 8 - roughness * 2);
      const diagonal = Math.hypot(width, height);

      // Helper: draw a wobbly line segment
      const wobblyLine = (x1: number, y1: number, x2: number, y2: number) => {
        if (roughness < 0.3) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          return;
        }
        const len = Math.hypot(x2 - x1, y2 - y1);
        const segments = Math.max(2, Math.ceil(len / 15));
        ctx.moveTo(x1 + (seededRandom() - 0.5) * roughness, y1 + (seededRandom() - 0.5) * roughness);
        for (let s = 1; s <= segments; s++) {
          const t = s / segments;
          const jx = (seededRandom() - 0.5) * roughness * 1.5;
          const jy = (seededRandom() - 0.5) * roughness * 1.5;
          ctx.lineTo(x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy);
        }
      };

      ctx.beginPath();
      const cx = x + width / 2;
      const cy = y + height / 2;
      for (let d = -diagonal; d < diagonal; d += step) {
        // Line perpendicular to hachure angle at offset d
        const px = cx + cos * 0 + sin * d;
        const py = cy + sin * 0 - cos * d;
        // Extend line in both directions
        const x1 = px - cos * diagonal;
        const y1 = py - sin * diagonal;
        const x2 = px + cos * diagonal;
        const y2 = py + sin * diagonal;
        wobblyLine(x1, y1, x2, y2);
      }
      ctx.stroke();

      if (fillStyle === 'cross-hatch') {
        const angle2 = 41 * Math.PI / 180;
        const cos2 = Math.cos(angle2);
        const sin2 = Math.sin(angle2);
        ctx.beginPath();
        for (let d = -diagonal; d < diagonal; d += step) {
          const px = cx + sin2 * d;
          const py = cy - cos2 * d;
          const x1 = px - cos2 * diagonal;
          const y1 = py - sin2 * diagonal;
          const x2 = px + cos2 * diagonal;
          const y2 = py + sin2 * diagonal;
          wobblyLine(x1, y1, x2, y2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  const dataUri = svgToDataUri(styledSvg);
  const img = getCachedImage(dataUri);

  if (img) {
    ctx.save();
    ctx.globalAlpha = opacity;
    // Scale stencil SVG to fill the expression bounds
    ctx.drawImage(img, x, y, width, height);
    ctx.restore();
  } else {
    // Loading placeholder
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#666666';
    ctx.font = `${Math.min(width, height) * 0.3}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⏳', x + width / 2, y + height / 2);
  }

  // Draw label below the icon if present (skip when editing in-place)
  if (!skipLabel && label) {
    const config = resolveTextConfig(expr);
    if (config) {
      ctx.font = `${config.fontSize}px ${config.fontFamily}`;
      ctx.textAlign = config.textAlign;
      ctx.textBaseline = 'top';
      ctx.fillStyle = config.color;
      ctx.fillText(label, expr.position.x + expr.size.width / 2, config.worldY);
    }
  }
}

// ── Placeholder renderer ─────────────────────────────────────

/** Corner radius for placeholder rounded rectangle (px). */
const PLACEHOLDER_CORNER_RADIUS = 8;

/** Placeholder background color. */
const PLACEHOLDER_BG_COLOR = '#e8e8e8';

/** Placeholder border color. */
const PLACEHOLDER_BORDER_COLOR = '#999999';

/** Placeholder text color. */
const PLACEHOLDER_TEXT_COLOR = '#666666';

/**
 * Render a placeholder for unknown/unimplemented expression kinds. [AC3]
 *
 * Draws a gray rounded rectangle with the kind name centered inside,
 * providing a visible indicator that a renderer for this kind is needed.
 */
function renderPlaceholder(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
): void {
  const { x, y } = expr.position;
  const { width, height } = expr.size;
  const r = Math.min(PLACEHOLDER_CORNER_RADIUS, width / 2, height / 2);

  ctx.save();

  // Draw rounded rectangle background
  ctx.fillStyle = PLACEHOLDER_BG_COLOR;
  ctx.strokeStyle = PLACEHOLDER_BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Draw kind name centered
  ctx.fillStyle = PLACEHOLDER_TEXT_COLOR;
  ctx.font = `14px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(expr.kind, x + width / 2, y + height / 2);

  ctx.restore();
}

// ── Helpers (exported for testing) ───────────────────────────

/**
 * Render a centered label inside a bounding box.
 *
 * Sets font, textAlign='center', textBaseline='middle', and draws
 * the text at the center of the given rectangle.
 */
export function renderLabel(
  ctx: CanvasRenderingContext2D,
  label: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  style: ExpressionStyle,
): void {
  if (!label) return;

  const fontFamily = style.fontFamily ?? DEFAULT_FONT_FAMILY;

  // Use explicit fontSize if user has set one, otherwise auto-scale to shape
  let fontSize: number;
  if (style.fontSize) {
    fontSize = style.fontSize;
  } else {
    const autoSize = height * 0.2;
    fontSize = Math.max(8, Math.min(autoSize, 72));
  }

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.strokeColor;

  // Word-wrap if text is wider than the shape
  const maxWidth = width * 0.85;
  const measured = ctx.measureText(label);
  if (measured.width <= maxWidth) {
    ctx.fillText(label, x + width / 2, y + height / 2);
  } else {
    // Word wrap with newline support
    const allLines: string[] = [];
    const paragraphs = label.split('\n');
    for (const para of paragraphs) {
      if (!para) { allLines.push(''); continue; }
      const words = para.split(' ');
      let currentLine = '';
      for (const word of words) {
        const test = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && currentLine) {
          allLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = test;
        }
      }
      if (currentLine) allLines.push(currentLine);
    }
    const lines = allLines;

    const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const totalHeight = lines.length * lineHeight;
    const startY = y + height / 2 - totalHeight / 2 + lineHeight / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, x + width / 2, startY + i * lineHeight);
    }
  }
}

/**
 * Draw an arrowhead at the given point.
 *
 * @deprecated Use `renderArrowheadFromRegistry` from `./arrowheads.js` for
 * full ArrowheadType support. This export is kept for backward compatibility.
 *
 * The arrowhead points in the direction of `angle` (radians).
 */
export function renderArrowhead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  type: string = 'triangle',
): void {
  // Delegate to the registry-based renderer.
  // fillStyle is assumed to be set by the caller (backward compat behavior).
  const strokeColor = ctx.fillStyle as string;
  renderArrowheadFromRegistry(ctx, tipX, tipY, angle, size, type, true, strokeColor, '#ffffff');
}

/**
 * Word-wrap text to fit within a maximum width.
 *
 * Splits on word boundaries. Words wider than maxWidth are kept
 * on their own line (not broken mid-word).
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [];

  const result: string[] = [];

  // Split on explicit newlines first
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      result.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

// ── Position offset for point-based shapes ───────────────────

/** Point-based expression kinds whose rendering uses data.points. */
const POINT_BASED_KINDS = new Set(['line', 'arrow', 'freehand']);

/**
 * Compute the rendering offset for point-based expressions.
 *
 * During a transient drag, only `expr.position` is updated while
 * `data.points` remain at their original absolute world coordinates.
 * This function returns the delta between the current `position` and
 * the bounding-box minimum of `data.points`, so the renderer can
 * apply a `ctx.translate(offset)` to keep the shape visually in sync
 * with the selection bounding box.
 *
 * For non-point-based shapes (rectangle, ellipse, etc.) this always
 * returns `{ x: 0, y: 0 }` because they render directly from
 * `expr.position`. [CLEAN-CODE]
 */
export function computePositionOffset(
  expr: VisualExpression,
): { x: number; y: number } {
  if (!POINT_BASED_KINDS.has(expr.kind)) {
    return { x: 0, y: 0 };
  }

  const data = expr.data as { points?: unknown[] };
  if (!data.points || data.points.length === 0) {
    return { x: 0, y: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;

  for (const pt of data.points) {
    const point = pt as number[];
    const px = point[0];
    const py = point[1];
    if (px !== undefined && px < minX) minX = px;
    if (py !== undefined && py < minY) minY = py;
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    return { x: 0, y: 0 };
  }

  return {
    x: expr.position.x - minX,
    y: expr.position.y - minY,
  };
}

// ── Drawable cache helper ────────────────────────────────────

/**
 * Get a cached drawable or create a new one. [AC14]
 *
 * Uses the module-level drawable cache keyed by expression ID + render hash
 * (style, position, size, and data).
 */
function getOrCreateDrawable(
  expr: VisualExpression,
  create: () => Drawable,
): Drawable {
  // Shapes: cache ignores position and data. Size is included so resize
  // gets the correct geometry. Deterministic seed ensures identical
  // roughness pattern on regeneration — no visual flicker.
  const isShape = expr.kind === 'rectangle' || expr.kind === 'ellipse' || expr.kind === 'diamond';
  const cacheData = isShape ? undefined : expr.data;
  const cachePosition = isShape ? { x: 0, y: 0 } : expr.position;
  const ctx = { style: expr.style, position: cachePosition, size: expr.size, data: cacheData };
  const cached = drawableCache.get(expr.id, ctx);
  if (cached) return cached;

  const drawable = create();
  drawableCache.set(expr.id, ctx, drawable);
  return drawable;
}

/**
 * Clear the drawable cache. Useful when resetting renderer state.
 */
export function clearDrawableCache(): void {
  drawableCache.clear();
}

/**
 * Clear the image cache. Useful for testing.
 */
export function clearImageCache(): void {
  imageCache.clear();
  imageLoading.clear();
  imageFailed.clear();
}
