/**
 * Sequence diagram composite renderer.
 *
 * Renders UML-style sequence diagrams with participants as labeled
 * rectangles at the top, dashed vertical lifelines, and horizontal
 * message arrows between lifelines. Supports three arrow types:
 * sync (solid + filled head), async (solid + open head), and
 * reply (dashed + open head).
 *
 * Layout is cached per expression ID + data hash to avoid
 * re-computing on every frame.
 *
 * @module
 */

import type { VisualExpression, SequenceDiagramData } from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { renderArrowhead } from "../primitiveRenderer";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Participant box width. */
const PARTICIPANT_WIDTH = 100;

/** Participant box height. */
const PARTICIPANT_HEIGHT = 36;

/** Horizontal spacing between participant centers. */
const PARTICIPANT_SPACING = 160;

/** Vertical distance from top to participant box top edge. */
const TITLE_HEIGHT = 30;

/** Vertical offset from participant bottom to first message. */
const HEADER_HEIGHT = TITLE_HEIGHT + PARTICIPANT_HEIGHT + 20;

/** Vertical spacing between message arrows. */
const MESSAGE_SPACING = 40;

/** Arrowhead size (pixels). */
const ARROWHEAD_SIZE = 8;

/** Dashed line pattern for lifelines. */
const LIFELINE_DASH = [6, 4];

/** Dashed line pattern for reply arrows. */
const REPLY_DASH = [8, 4];

/** Padding around the entire diagram. */
const DIAGRAM_PADDING = 20;

/** Font sizes. */
const TITLE_FONT_SIZE = 16;
const PARTICIPANT_FONT_SIZE = 13;
const MESSAGE_FONT_SIZE = 12;

/** Default font family. */
const DEFAULT_FONT_FAMILY = "sans-serif";

// ── Layout types ─────────────────────────────────────────────

interface ParticipantLayout {
  id: string;
  name: string;
  x: number;
  y: number;
}

interface LifelineLayout {
  x: number;
  topY: number;
  bottomY: number;
}

interface ArrowLayout {
  fromX: number;
  toX: number;
  y: number;
  label: string;
  type: "sync" | "async" | "reply";
}

interface SequenceLayout {
  participants: ParticipantLayout[];
  lifelines: LifelineLayout[];
  arrows: ArrowLayout[];
  totalWidth: number;
  totalHeight: number;
  dataHash: string;
}

// ── Layout cache ─────────────────────────────────────────────

const layoutCache = new Map<string, SequenceLayout>();

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

function computeDataHash(data: SequenceDiagramData): string {
  return JSON.stringify({
    participants: data.participants,
    messages: data.messages,
    title: data.title,
  });
}

// ── Layout computation ───────────────────────────────────────

/**
 * Compute the layout for a sequence diagram.
 *
 * Places participants evenly spaced horizontally, computes lifeline
 * positions, and assigns vertical positions to message arrows.
 */
export function computeSequenceLayout(
  data: SequenceDiagramData,
): SequenceLayout {
  const participantCount = data.participants.length;

  // Build participant position map
  const participants: ParticipantLayout[] = data.participants.map((p, i) => ({
    id: p.id,
    name: p.name,
    x: DIAGRAM_PADDING + PARTICIPANT_WIDTH / 2 + i * PARTICIPANT_SPACING,
    y: TITLE_HEIGHT,
  }));

  const participantXMap = new Map(participants.map((p) => [p.id, p.x]));

  // Compute lifeline start/end
  const messageCount = data.messages.length;
  const bottomY =
    HEADER_HEIGHT + messageCount * MESSAGE_SPACING + DIAGRAM_PADDING;

  const lifelines: LifelineLayout[] = participants.map((p) => ({
    x: p.x,
    topY: p.y + PARTICIPANT_HEIGHT,
    bottomY,
  }));

  // Compute arrow positions
  const arrows: ArrowLayout[] = data.messages.map((msg, i) => ({
    fromX: participantXMap.get(msg.from) ?? 0,
    toX: participantXMap.get(msg.to) ?? 0,
    y: HEADER_HEIGHT + (i + 0.5) * MESSAGE_SPACING,
    label: msg.label,
    type: msg.type,
  }));

  // Compute total dimensions
  const totalWidth =
    participantCount > 0
      ? DIAGRAM_PADDING * 2 +
        (participantCount - 1) * PARTICIPANT_SPACING +
        PARTICIPANT_WIDTH
      : 200;
  const totalHeight = bottomY + DIAGRAM_PADDING;

  return {
    participants,
    lifelines,
    arrows,
    totalWidth,
    totalHeight,
    dataHash: computeDataHash(data),
  };
}

// ── Cached layout retrieval ──────────────────────────────────

function getLayout(exprId: string, data: SequenceDiagramData): SequenceLayout {
  const hash = computeDataHash(data);
  const cached = layoutCache.get(exprId);

  if (cached && cached.dataHash === hash) {
    return cached;
  }

  const layout = computeSequenceLayout(data);
  layoutCache.set(exprId, layout);
  return layout;
}

// ── Arrow renderers ──────────────────────────────────────────

/**
 * Render a sync arrow: solid line + filled arrowhead.
 */
function renderSyncArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  toX: number,
  y: number,
  strokeColor: string,
): void {
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX, y);
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash([]);
  ctx.stroke();

  // Filled arrowhead
  const angle = toX > fromX ? 0 : Math.PI;
  ctx.fillStyle = strokeColor;
  renderArrowhead(ctx, toX, y, angle, ARROWHEAD_SIZE);
}

/**
 * Render an async arrow: solid line + open arrowhead (stroke only).
 */
function renderAsyncArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  toX: number,
  y: number,
  strokeColor: string,
): void {
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX, y);
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash([]);
  ctx.stroke();

  // Open arrowhead (two lines, not filled)
  const direction = toX > fromX ? -1 : 1;
  const headLen = ARROWHEAD_SIZE;

  ctx.beginPath();
  ctx.moveTo(toX + direction * headLen, y - headLen / 2);
  ctx.lineTo(toX, y);
  ctx.lineTo(toX + direction * headLen, y + headLen / 2);
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}

/**
 * Render a reply arrow: dashed line + open arrowhead.
 */
function renderReplyArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  toX: number,
  y: number,
  strokeColor: string,
): void {
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX, y);
  ctx.strokeStyle = strokeColor;
  ctx.setLineDash(REPLY_DASH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Open arrowhead
  const direction = toX > fromX ? -1 : 1;
  const headLen = ARROWHEAD_SIZE;

  ctx.beginPath();
  ctx.moveTo(toX + direction * headLen, y - headLen / 2);
  ctx.lineTo(toX, y);
  ctx.lineTo(toX + direction * headLen, y + headLen / 2);
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a sequence diagram expression.
 *
 * Participants are labeled rectangles at top, evenly spaced.
 * Dashed vertical lifelines extend down. Horizontal arrows
 * between lifelines represent messages.
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The sequence diagram VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderSequenceDiagram(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as SequenceDiagramData;
  const { x: originX, y: originY } = expr.position;
  const roughOptions = mapStyleToRoughOptions(expr.style);
  const strokeColor = expr.style.strokeColor;

  ctx.save();

  // Data validated by Zod — participants.min(2) ensures at least two participants. [S6-3]

  // ── Compute / retrieve layout ──────────────────────────────
  const layout = getLayout(expr.id, data);

  // ── Render title ───────────────────────────────────────────
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = strokeColor;
  ctx.fillText(
    data.title,
    originX + layout.totalWidth / 2,
    originY + TITLE_HEIGHT / 2,
  );

  // ── Render participant boxes ───────────────────────────────
  ctx.font = `${PARTICIPANT_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const p of layout.participants) {
    const px = originX + p.x - PARTICIPANT_WIDTH / 2;
    const py = originY + p.y;

    const drawable = rc.rectangle(
      px,
      py,
      PARTICIPANT_WIDTH,
      PARTICIPANT_HEIGHT,
      roughOptions,
    );
    rc.draw(drawable);

    ctx.fillStyle = strokeColor;
    ctx.fillText(p.name, originX + p.x, originY + p.y + PARTICIPANT_HEIGHT / 2);
  }

  // ── Render lifelines (dashed vertical lines) ───────────────
  for (const ll of layout.lifelines) {
    const lx = originX + ll.x;
    const ltop = originY + ll.topY;
    const lbot = originY + ll.bottomY;

    ctx.beginPath();
    ctx.moveTo(lx, ltop);
    ctx.lineTo(lx, lbot);
    ctx.strokeStyle = strokeColor;
    ctx.setLineDash(LIFELINE_DASH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Render message arrows ─────────────────────────────────
  ctx.font = `${MESSAGE_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`;

  for (const arrow of layout.arrows) {
    const ax = originX + arrow.fromX;
    const bx = originX + arrow.toX;
    const ay = originY + arrow.y;

    switch (arrow.type) {
      case "sync":
        renderSyncArrow(ctx, ax, bx, ay, strokeColor);
        break;
      case "async":
        renderAsyncArrow(ctx, ax, bx, ay, strokeColor);
        break;
      case "reply":
        renderReplyArrow(ctx, ax, bx, ay, strokeColor);
        break;
    }

    // Render label above the arrow
    const midX = (ax + bx) / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = strokeColor;
    ctx.fillText(arrow.label, midX, ay - 4);
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

/**
 * Register the sequence diagram renderer on module load.
 */
registerCompositeRenderer("sequence-diagram", renderSequenceDiagram);
