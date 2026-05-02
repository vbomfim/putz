/**
 * Unified text configuration for rendering and editing.
 *
 * `resolveTextConfig()` is the single source of truth for all text
 * properties — font size, family, color, alignment, and position — for
 * every editable expression kind. Both the canvas renderer and the
 * inline editor use this function so the editing textarea matches the
 * rendered text exactly.
 *
 * [CLEAN-CODE] Single Responsibility — one place for text config logic.
 * [DRY] Eliminates duplicated font calculations across renderer + editor.
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";

// ── Constants (mirrored from primitiveRenderer.ts) ───────────
// These MUST stay in sync with the renderer. They are intentionally
// duplicated here rather than imported to avoid a circular dependency
// and to keep this module self-contained.

/** Default font size when not specified (text, sticky-note). */
const DEFAULT_FONT_SIZE = 16;

/** Default font family when not specified. */
const DEFAULT_FONT_FAMILY = "Architects Daughter, cursive";

/** Padding inside sticky notes for text (px). */
const STICKY_NOTE_PADDING = 12;

/** Font size for stencil labels at base 44px icon (px). */
const STENCIL_LABEL_FONT_SIZE = 10;

/** Gap between stencil icon bottom and label text (px). */
const STENCIL_LABEL_GAP = 4;

// ── Public types ─────────────────────────────────────────────

/**
 * Complete text configuration for rendering or editing an expression's text.
 *
 * All measurements are in world units (not screen-scaled).
 */
export interface TextConfig {
  /** The text content to edit/display. */
  text: string;
  /** Data field name where text is stored ('text' or 'label'). */
  field: "text" | "label";
  /** World-space X position of the text area. */
  worldX: number;
  /** World-space Y position of the text area. */
  worldY: number;
  /** World-space width of the text area. */
  worldWidth: number;
  /** World-space height of the text area. */
  worldHeight: number;
  /** Font size in world units (not screen-scaled). */
  fontSize: number;
  /** Font family string. */
  fontFamily: string;
  /** Text color (CSS color string). */
  color: string;
  /** Horizontal text alignment. */
  textAlign: "left" | "center";
  /** Vertical text alignment: top for text/sticky, middle for shape labels. */
  verticalAlign: "top" | "middle";
  /** Whether empty text should delete the expression. */
  deleteOnEmpty: boolean;
  /** Background for the textarea (e.g., sticky note color). */
  background: string;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve the complete text configuration for an expression.
 *
 * Returns `null` for expression kinds that don't support text editing
 * (line, arrow, freehand, image).
 *
 * The returned config uses the exact same font size, family, color,
 * and position calculations as the renderer, ensuring the editing
 * textarea is visually identical to the rendered text.
 */
export function resolveTextConfig(
  expression: VisualExpression,
): TextConfig | null {
  const { kind } = expression;

  switch (kind) {
    case "text":
      return resolveTextKind(expression);
    case "sticky-note":
      return resolveStickyNoteKind(expression);
    case "rectangle":
    case "ellipse":
    case "diamond":
      return resolveShapeLabelKind(expression);
    case "stencil":
      return resolveStencilKind(expression);
    default:
      return null;
  }
}

// ── Per-kind resolvers (private) ─────────────────────────────

/**
 * Resolve config for text expressions.
 *
 * Uses data.fontSize, data.fontFamily, data.textAlign directly.
 * Color from style.strokeColor. Positioned at expression origin.
 */
function resolveTextKind(expr: VisualExpression): TextConfig {
  const data = expr.data as {
    text: string;
    fontSize: number;
    fontFamily: string;
    textAlign: "left" | "center" | "right";
  };

  // Inset text so it doesn't overlap resize handles
  const pad = 6;

  return {
    text: data.text,
    field: "text",
    worldX: expr.position.x + pad,
    worldY: expr.position.y + pad,
    worldWidth: expr.size.width - pad * 2,
    worldHeight: expr.size.height - pad * 2,
    fontSize: data.fontSize,
    fontFamily: data.fontFamily,
    color: expr.style.strokeColor,
    textAlign:
      data.textAlign === "right"
        ? "left"
        : (data.textAlign as "left" | "center"),
    verticalAlign: "top",
    deleteOnEmpty: true,
    background: "white",
  };
}

/**
 * Resolve config for sticky-note expressions.
 *
 * Text is inset by STICKY_NOTE_PADDING on all sides.
 * Color is always black. Background is the note's color.
 * Font from style overrides or defaults (16px Architects Daughter).
 */
function resolveStickyNoteKind(expr: VisualExpression): TextConfig {
  const data = expr.data as { text: string; color: string };
  const fontSize = expr.style.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = expr.style.fontFamily ?? DEFAULT_FONT_FAMILY;

  return {
    text: data.text,
    field: "text",
    worldX: expr.position.x + STICKY_NOTE_PADDING,
    worldY: expr.position.y + STICKY_NOTE_PADDING,
    worldWidth: expr.size.width - STICKY_NOTE_PADDING * 2,
    worldHeight: expr.size.height - STICKY_NOTE_PADDING * 2,
    fontSize,
    fontFamily,
    color: "#000000",
    textAlign: "left",
    verticalAlign: "top",
    deleteOnEmpty: true,
    background: data.color,
  };
}

/**
 * Resolve config for shape labels (rectangle, ellipse, diamond).
 *
 * Font auto-scales to 20% of height, clamped 8–72px.
 * style.fontSize overrides auto-scale if set.
 * Center-aligned both horizontally and vertically.
 */
function resolveShapeLabelKind(expr: VisualExpression): TextConfig {
  const data = expr.data as { label?: string };
  const fontFamily = expr.style.fontFamily ?? DEFAULT_FONT_FAMILY;

  let fontSize: number;
  if (expr.style.fontSize) {
    fontSize = expr.style.fontSize;
  } else {
    const autoSize = expr.size.height * 0.2;
    fontSize = Math.max(8, Math.min(autoSize, 72));
  }

  return {
    text: data.label ?? "",
    field: "label",
    worldX: expr.position.x,
    worldY: expr.position.y,
    worldWidth: expr.size.width,
    worldHeight: expr.size.height,
    fontSize,
    fontFamily,
    color: expr.style.strokeColor,
    textAlign: "center",
    verticalAlign: "middle",
    deleteOnEmpty: false,
    background: "transparent",
  };
}

/**
 * Resolve config for stencil labels.
 *
 * Label position is controlled by `data.labelPosition`:
 *   - 'below' (default): below the icon with a small gap
 *   - 'top-left': inside the stencil, top-left corner
 *   - 'top-center': inside the stencil, top-center
 *   - 'center': centered inside the stencil
 *
 * If `data.labelFontSize` is set, it is used directly (no scaling).
 * Otherwise the auto-scale formula (proportional to icon size) applies.
 */
function resolveStencilKind(expr: VisualExpression): TextConfig {
  const data = expr.data as {
    label?: string;
    labelPosition?: string;
    labelFontSize?: number;
  };
  const fontFamily = expr.style.fontFamily ?? DEFAULT_FONT_FAMILY;
  const position = data.labelPosition ?? "below";

  // Font size: explicit labelFontSize bypasses auto-scaling.
  let fontSize: number;
  if (data.labelFontSize != null) {
    fontSize = data.labelFontSize;
  } else {
    const scaleFactor = Math.min(expr.size.width, expr.size.height) / 44;
    const baseSize = expr.style.fontSize ?? STENCIL_LABEL_FONT_SIZE;
    fontSize = Math.round(baseSize * scaleFactor);
  }

  // Defaults for the 'below' position (original behaviour).
  const scaleFactor = Math.min(expr.size.width, expr.size.height) / 44;
  const gap = Math.round(STENCIL_LABEL_GAP * scaleFactor);

  let worldX = expr.position.x;
  let worldY = expr.position.y + expr.size.height + gap;
  let worldWidth = expr.size.width;
  let worldHeight = fontSize * 1.4;
  let textAlign: "left" | "center" = "center";
  let verticalAlign: "top" | "middle" = "top";

  if (position === "top-left") {
    worldX = expr.position.x + 8;
    worldY = expr.position.y + 8;
    worldWidth = expr.size.width - 16;
    worldHeight = fontSize * 1.4;
    textAlign = "left";
    verticalAlign = "top";
  } else if (position === "top-center") {
    worldX = expr.position.x;
    worldY = expr.position.y + 8;
    worldWidth = expr.size.width;
    worldHeight = fontSize * 1.4;
    textAlign = "center";
    verticalAlign = "top";
  } else if (position === "center") {
    worldX = expr.position.x;
    worldY = expr.position.y;
    worldWidth = expr.size.width;
    worldHeight = expr.size.height;
    textAlign = "center";
    verticalAlign = "middle";
  }

  return {
    text: data.label ?? "",
    field: "label",
    worldX,
    worldY,
    worldWidth,
    worldHeight,
    fontSize,
    fontFamily,
    color: expr.style.strokeColor,
    textAlign,
    verticalAlign,
    deleteOnEmpty: false,
    background: "transparent",
  };
}
