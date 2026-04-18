/**
 * Arrowhead registry and renderers.
 *
 * Provides Canvas2D rendering for all 22+ ArrowheadType values defined
 * in the protocol schema. Each arrowhead type has a dedicated renderer
 * function registered in a lookup map.
 *
 * Usage:
 *   renderArrowheadFromRegistry(ctx, tipX, tipY, angle, size, type, filled, strokeColor, fillColor);
 *
 * @module
 */

// ArrowheadType values are defined in ../../protocol.
// This module uses string keys for the registry to allow flexible lookups.

// ── Types ────────────────────────────────────────────────────

/**
 * Renderer function for a single arrowhead type.
 *
 * @param ctx        - Canvas 2D rendering context
 * @param tipX       - X position of the arrowhead tip
 * @param tipY       - Y position of the arrowhead tip
 * @param angle      - Direction angle in radians (where the arrow points)
 * @param size       - Arrowhead size in world pixels
 * @param filled     - Whether to fill (true) or stroke-only (false)
 * @param strokeColor - Stroke/border color
 * @param fillColor   - Fill color (used for outline arrowheads' interior)
 */
type ArrowheadRenderer = (
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  filled: boolean,
  strokeColor: string,
  fillColor: string,
) => void;

// ── Constants ────────────────────────────────────────────────

/** Standard half-angle for triangle-based arrowheads (30°). */
const HALF_ANGLE = Math.PI / 6;

/** Thin variant width multiplier (60% of normal). */
const THIN_FACTOR = 0.6;

// ── Registry ─────────────────────────────────────────────────

const ARROWHEAD_REGISTRY = new Map<string, ArrowheadRenderer>();

// ── Helper functions ─────────────────────────────────────────

/** Fill or stroke the current path based on the `filled` flag. */
function fillOrStroke(
  ctx: CanvasRenderingContext2D,
  filled: boolean,
  strokeColor: string,
  fillColor: string,
): void {
  if (filled) {
    ctx.fillStyle = strokeColor;
    ctx.fill();
  } else {
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
}

/**
 * Draw a triangle arrowhead path.
 *
 * @param widthFactor - Multiplier for the half-angle spread (1.0 = normal, 0.6 = thin)
 */
function drawTrianglePath(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  widthFactor: number,
): void {
  const halfAngle = HALF_ANGLE * widthFactor;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle - halfAngle),
    tipY - size * Math.sin(angle - halfAngle),
  );
  ctx.lineTo(
    tipX - size * Math.cos(angle + halfAngle),
    tipY - size * Math.sin(angle + halfAngle),
  );
  ctx.closePath();
}

/**
 * Draw a block (rectangle) arrowhead path.
 *
 * The block is aligned along the arrow direction with the tip
 * at one edge.
 *
 * @param widthFactor - Multiplier for block width (1.0 = normal, 0.6 = thin)
 */
function drawBlockPath(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  widthFactor: number,
): void {
  const halfW = size * 0.4 * widthFactor;
  const perpAngle = angle + Math.PI / 2;
  const backX = tipX - size * Math.cos(angle);
  const backY = tipY - size * Math.sin(angle);
  const dx = halfW * Math.cos(perpAngle);
  const dy = halfW * Math.sin(perpAngle);

  ctx.beginPath();
  ctx.moveTo(tipX + dx, tipY + dy);
  ctx.lineTo(tipX - dx, tipY - dy);
  ctx.lineTo(backX - dx, backY - dy);
  ctx.lineTo(backX + dx, backY + dy);
  ctx.closePath();
}

/**
 * Draw a diamond arrowhead path.
 *
 * @param widthFactor - Multiplier for diamond width (1.0 = normal, 0.6 = thin)
 */
function drawDiamondPath(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  widthFactor: number,
): void {
  const hSize = size * 0.6;
  const halfW = hSize * 0.5 * widthFactor;
  const cx = tipX - hSize * Math.cos(angle);
  const cy = tipY - hSize * Math.sin(angle);
  const perpAngle = angle + Math.PI / 2;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    cx + halfW * Math.cos(perpAngle),
    cy + halfW * Math.sin(perpAngle),
  );
  ctx.lineTo(cx - hSize * Math.cos(angle), cy - hSize * Math.sin(angle));
  ctx.lineTo(
    cx - halfW * Math.cos(perpAngle),
    cy - halfW * Math.sin(perpAngle),
  );
  ctx.closePath();
}

/**
 * Draw a perpendicular bar at the given position.
 *
 * Used for ER diagram markers (|).
 */
function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  const perpAngle = angle + Math.PI / 2;
  const halfH = size * 0.5;
  ctx.moveTo(
    x + halfH * Math.cos(perpAngle),
    y + halfH * Math.sin(perpAngle),
  );
  ctx.lineTo(
    x - halfH * Math.cos(perpAngle),
    y - halfH * Math.sin(perpAngle),
  );
}

/**
 * Draw crow's foot (three diverging lines) from a point.
 *
 * Used for ER diagram "many" markers (>).
 */
function drawCrowsFoot(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
): void {
  const backX = tipX - size * Math.cos(angle);
  const backY = tipY - size * Math.sin(angle);
  const perpAngle = angle + Math.PI / 2;
  const spread = size * 0.5;

  // Center line
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX, backY);

  // Upper fork
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    backX + spread * Math.cos(perpAngle),
    backY + spread * Math.sin(perpAngle),
  );

  // Lower fork
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    backX - spread * Math.cos(perpAngle),
    backY - spread * Math.sin(perpAngle),
  );
}

/**
 * Draw a small circle at the given position.
 *
 * Used for ER diagram "zero" markers (o).
 */
function drawERCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fillColor: string,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.stroke();
}

// ── Arrowhead Renderers ──────────────────────────────────────

// --- none ---
const renderNone: ArrowheadRenderer = () => {
  // Intentionally empty — no arrowhead.
};

// --- classic (filled triangle) ---
const renderClassic: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawTrianglePath(ctx, tipX, tipY, angle, size, 1.0);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- classicThin ---
const renderClassicThin: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawTrianglePath(ctx, tipX, tipY, angle, size, THIN_FACTOR);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- open (outline-only triangle, always stroked) ---
const renderOpen: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  const halfAngle = HALF_ANGLE;
  ctx.beginPath();
  ctx.moveTo(
    tipX - size * Math.cos(angle - halfAngle),
    tipY - size * Math.sin(angle - halfAngle),
  );
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle + halfAngle),
    tipY - size * Math.sin(angle + halfAngle),
  );
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  ctx.stroke();
};

// --- openThin ---
const renderOpenThin: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  const halfAngle = HALF_ANGLE * THIN_FACTOR;
  ctx.beginPath();
  ctx.moveTo(
    tipX - size * Math.cos(angle - halfAngle),
    tipY - size * Math.sin(angle - halfAngle),
  );
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle + halfAngle),
    tipY - size * Math.sin(angle + halfAngle),
  );
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  ctx.stroke();
};

// --- block (filled rectangle) ---
const renderBlock: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawBlockPath(ctx, tipX, tipY, angle, size, 1.0);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- blockThin ---
const renderBlockThin: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawBlockPath(ctx, tipX, tipY, angle, size, THIN_FACTOR);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- oval (filled circle) ---
const renderOval: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  const r = size * 0.35;
  const cx = tipX - r * Math.cos(angle);
  const cy = tipY - r * Math.sin(angle);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- diamond (filled diamond) ---
const renderDiamond: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawDiamondPath(ctx, tipX, tipY, angle, size, 1.0);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- diamondThin ---
const renderDiamondThin: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  drawDiamondPath(ctx, tipX, tipY, angle, size, THIN_FACTOR);
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// --- ERone (single bar |) ---
const renderERone: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  drawBar(ctx, tipX, tipY, angle, size);
  ctx.stroke();
};

// --- ERmany (crow's foot >) ---
const renderERmany: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  drawCrowsFoot(ctx, tipX, tipY, angle, size);
  ctx.stroke();
};

// --- ERmandOne (double bar ||) ---
const renderERmandOne: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  // First bar at tip
  drawBar(ctx, tipX, tipY, angle, size);
  // Second bar offset backward
  const offset = size * 0.25;
  drawBar(
    ctx,
    tipX - offset * Math.cos(angle),
    tipY - offset * Math.sin(angle),
    angle,
    size,
  );
  ctx.stroke();
};

// --- ERoneToMany (bar + crow's foot |>) ---
const renderERoneToMany: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  // Crow's foot at tip
  drawCrowsFoot(ctx, tipX, tipY, angle, size);
  // Bar behind crow's foot
  const barOffset = size * 1.1;
  drawBar(
    ctx,
    tipX - barOffset * Math.cos(angle),
    tipY - barOffset * Math.sin(angle),
    angle,
    size,
  );
  ctx.stroke();
};

// --- ERzeroToOne (circle + bar o|) ---
const renderERzeroToOne: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, fillColor) => {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);

  // Bar at tip
  ctx.beginPath();
  drawBar(ctx, tipX, tipY, angle, size);
  ctx.stroke();

  // Circle behind bar
  const circleOffset = size * 0.5;
  const r = size * 0.2;
  drawERCircle(
    ctx,
    tipX - circleOffset * Math.cos(angle),
    tipY - circleOffset * Math.sin(angle),
    r,
    fillColor,
  );
};

// --- ERzeroToMany (circle + crow's foot o>) ---
const renderERzeroToMany: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, fillColor) => {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);

  // Crow's foot at tip
  ctx.beginPath();
  drawCrowsFoot(ctx, tipX, tipY, angle, size);
  ctx.stroke();

  // Circle behind crow's foot
  const circleOffset = size * 1.2;
  const r = size * 0.2;
  drawERCircle(
    ctx,
    tipX - circleOffset * Math.cos(angle),
    tipY - circleOffset * Math.sin(angle),
    r,
    fillColor,
  );
};

// --- openAsync / chevron (open > stroke only) ---
const renderOpenAsync: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  ctx.moveTo(
    tipX - size * Math.cos(angle - HALF_ANGLE),
    tipY - size * Math.sin(angle - HALF_ANGLE),
  );
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle + HALF_ANGLE),
    tipY - size * Math.sin(angle + HALF_ANGLE),
  );
  ctx.stroke();
};

// --- dash (short perpendicular line) ---
const renderDash: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);
  drawBar(ctx, tipX, tipY, angle, size * 0.7);
  ctx.stroke();
};

// --- cross (X mark) ---
const renderCross: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, _filled, strokeColor, _fillColor) => {
  const halfSize = size * 0.35;
  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(ctx.lineWidth, 1.5);

  // Forward-slash stroke of the X
  ctx.moveTo(
    tipX + halfSize * Math.cos(angle + Math.PI / 4),
    tipY + halfSize * Math.sin(angle + Math.PI / 4),
  );
  ctx.lineTo(
    tipX - halfSize * Math.cos(angle + Math.PI / 4),
    tipY - halfSize * Math.sin(angle + Math.PI / 4),
  );

  // Back-slash stroke of the X
  ctx.moveTo(
    tipX + halfSize * Math.cos(angle - Math.PI / 4),
    tipY + halfSize * Math.sin(angle - Math.PI / 4),
  );
  ctx.lineTo(
    tipX - halfSize * Math.cos(angle - Math.PI / 4),
    tipY - halfSize * Math.sin(angle - Math.PI / 4),
  );

  ctx.stroke();
};

// --- halfCircle ---
const renderHalfCircle: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, _fillColor) => {
  const r = size * 0.4;
  ctx.beginPath();
  // Semicircle: arc from angle-PI/2 to angle+PI/2 (the back half)
  ctx.arc(tipX, tipY, r, angle + Math.PI / 2, angle - Math.PI / 2);
  if (filled) {
    ctx.fillStyle = strokeColor;
    ctx.fill();
  } else {
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
  }
};

// --- doubleBlock (two stacked block arrows) ---
const renderDoubleBlock: ArrowheadRenderer = (ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor) => {
  // First block at tip
  drawBlockPath(ctx, tipX, tipY, angle, size * 0.7, 1.0);
  fillOrStroke(ctx, filled, strokeColor, fillColor);

  // Second block offset backward
  const offset = size * 0.75;
  drawBlockPath(
    ctx,
    tipX - offset * Math.cos(angle),
    tipY - offset * Math.sin(angle),
    angle,
    size * 0.7,
    1.0,
  );
  fillOrStroke(ctx, filled, strokeColor, fillColor);
};

// ── Register all arrowhead types ─────────────────────────────

// Standard
ARROWHEAD_REGISTRY.set('none', renderNone);
ARROWHEAD_REGISTRY.set('classic', renderClassic);
ARROWHEAD_REGISTRY.set('triangle', renderClassic);         // alias
ARROWHEAD_REGISTRY.set('classicThin', renderClassicThin);
ARROWHEAD_REGISTRY.set('open', renderOpen);
ARROWHEAD_REGISTRY.set('openThin', renderOpenThin);
ARROWHEAD_REGISTRY.set('block', renderBlock);
ARROWHEAD_REGISTRY.set('blockThin', renderBlockThin);
ARROWHEAD_REGISTRY.set('oval', renderOval);
ARROWHEAD_REGISTRY.set('circle', renderOval);               // alias
ARROWHEAD_REGISTRY.set('diamond', renderDiamond);
ARROWHEAD_REGISTRY.set('diamondThin', renderDiamondThin);
ARROWHEAD_REGISTRY.set('box', renderBlock);                  // alias

// ER Diagram
ARROWHEAD_REGISTRY.set('ERone', renderERone);
ARROWHEAD_REGISTRY.set('ERmany', renderERmany);
ARROWHEAD_REGISTRY.set('ERmandOne', renderERmandOne);
ARROWHEAD_REGISTRY.set('ERoneToMany', renderERoneToMany);
ARROWHEAD_REGISTRY.set('ERzeroToOne', renderERzeroToOne);
ARROWHEAD_REGISTRY.set('ERzeroToMany', renderERzeroToMany);

// UML
ARROWHEAD_REGISTRY.set('openAsync', renderOpenAsync);
ARROWHEAD_REGISTRY.set('chevron', renderOpenAsync);         // alias
ARROWHEAD_REGISTRY.set('dash', renderDash);
ARROWHEAD_REGISTRY.set('cross', renderCross);

// Other
ARROWHEAD_REGISTRY.set('halfCircle', renderHalfCircle);
ARROWHEAD_REGISTRY.set('doubleBlock', renderDoubleBlock);

// ── Public API ───────────────────────────────────────────────

/** All registered arrowhead type keys (for test completeness checks). */
export const ALL_ARROWHEAD_TYPES: readonly string[] = [...ARROWHEAD_REGISTRY.keys()];

/**
 * Look up the renderer for a given arrowhead type.
 *
 * Returns undefined if no renderer is registered (unknown type).
 */
export function getArrowheadRenderer(type: string): ArrowheadRenderer | undefined {
  return ARROWHEAD_REGISTRY.get(type);
}

/**
 * Render an arrowhead at the given position using the registry.
 *
 * Falls back to 'classic' for unknown types. Wraps ctx.save/restore
 * to isolate style changes.
 *
 * @param ctx         - Canvas 2D rendering context
 * @param tipX        - X position of the arrowhead tip
 * @param tipY        - Y position of the arrowhead tip
 * @param angle       - Direction angle in radians
 * @param size        - Arrowhead size in world pixels
 * @param type        - ArrowheadType string
 * @param filled      - Fill (true) or outline (false)
 * @param strokeColor - Stroke color
 * @param fillColor   - Fill color for outline arrowheads
 */
export function renderArrowheadFromRegistry(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  angle: number,
  size: number,
  type: string,
  filled: boolean,
  strokeColor: string,
  fillColor: string,
): void {
  if (type === 'none') return;

  const renderer = ARROWHEAD_REGISTRY.get(type);
  if (!renderer) {
    console.warn(`[arrowheads] Unknown arrowhead type "${type}", falling back to "classic"`);
  }
  const resolvedRenderer = renderer ?? ARROWHEAD_REGISTRY.get('classic')!;
  ctx.save();
  resolvedRenderer(ctx, tipX, tipY, angle, size, filled, strokeColor, fillColor);
  ctx.restore();
}
