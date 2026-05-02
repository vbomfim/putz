/**
 * Roadmap composite renderer.
 *
 * Renders phases as sections (horizontal or vertical per orientation)
 * with items as chips, color-coded by status:
 * - planned = gray
 * - in-progress = blue
 * - done = green
 *
 * @module
 */

import type {
  VisualExpression,
  RoadmapData,
  RoadmapItem,
} from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import type { Options } from "roughjs/bin/core.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding around the roadmap. */
const PADDING = 16;

/** Height reserved for the title. */
const TITLE_HEIGHT = 30;

/** Height of a phase name label. */
const PHASE_HEADER_HEIGHT = 24;

/** Item chip height. */
const CHIP_HEIGHT = 26;

/** Gap between items. */
const CHIP_GAP = 6;

/** Item chip horizontal padding. */
const CHIP_PADDING = 8;

/** Gap between phases. */
const PHASE_GAP = 12;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Title font size. */
const TITLE_FONT_SIZE = 16;

/** Phase header font size. */
const PHASE_FONT_SIZE = 13;

/** Chip font size. */
const CHIP_FONT_SIZE = 11;

// ── Status colors ────────────────────────────────────────────

/** Map status to fill color for chips. */
const STATUS_COLORS: Record<RoadmapItem["status"], string> = {
  planned: "#cccccc",
  "in-progress": "#4a90d9",
  done: "#4caf50",
};

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a roadmap expression. [AC4]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The roadmap VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderRoadmap(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as RoadmapData;
  const { x: originX, y: originY } = expr.position;
  const { width } = expr.size;
  const roughOptions = mapStyleToRoughOptions(expr.style);

  ctx.save();

  // ── Title ──────────────────────────────────────────────────
  ctx.font = `bold ${TITLE_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = expr.style.strokeColor;
  ctx.fillText(
    data.title,
    originX + width / 2,
    originY + PADDING + TITLE_HEIGHT / 2,
  );

  // ── Empty roadmap ──────────────────────────────────────────
  if (data.phases.length === 0) {
    ctx.restore();
    return;
  }

  const isHorizontal = data.orientation === "horizontal";

  if (isHorizontal) {
    renderHorizontal(ctx, rc, data, originX, originY, width, roughOptions);
  } else {
    renderVertical(ctx, rc, data, originX, originY, width, roughOptions);
  }

  ctx.restore();
}

/**
 * Render phases as horizontal sections (left to right).
 */
function renderHorizontal(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  data: RoadmapData,
  originX: number,
  originY: number,
  totalWidth: number,
  roughOptions: Options,
): void {
  const contentTop = originY + PADDING + TITLE_HEIGHT;
  const totalGap = PHASE_GAP * (data.phases.length - 1);
  const usableWidth = totalWidth - PADDING * 2 - totalGap;
  const phaseWidth = usableWidth / data.phases.length;

  for (let pi = 0; pi < data.phases.length; pi++) {
    const phase = data.phases[pi]!;
    const phaseX = originX + PADDING + pi * (phaseWidth + PHASE_GAP);

    // Phase header
    ctx.font = `bold ${PHASE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
    ctx.fillText(
      phase.name,
      phaseX + phaseWidth / 2,
      contentTop + PHASE_HEADER_HEIGHT / 2,
    );

    // Items as chips
    let chipY = contentTop + PHASE_HEADER_HEIGHT + CHIP_GAP;
    for (const item of phase.items) {
      renderChip(ctx, rc, item, phaseX, chipY, phaseWidth, roughOptions);
      chipY += CHIP_HEIGHT + CHIP_GAP;
    }
  }
}

/**
 * Render phases as vertical sections (top to bottom).
 */
function renderVertical(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  data: RoadmapData,
  originX: number,
  originY: number,
  totalWidth: number,
  roughOptions: Options,
): void {
  const contentWidth = totalWidth - PADDING * 2;
  let currentY = originY + PADDING + TITLE_HEIGHT;

  for (const phase of data.phases) {
    // Phase header
    ctx.font = `bold ${PHASE_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
    ctx.fillText(
      phase.name,
      originX + PADDING,
      currentY + PHASE_HEADER_HEIGHT / 2,
    );

    currentY += PHASE_HEADER_HEIGHT + CHIP_GAP;

    // Items as chips
    for (const item of phase.items) {
      renderChip(
        ctx,
        rc,
        item,
        originX + PADDING,
        currentY,
        contentWidth,
        roughOptions,
      );
      currentY += CHIP_HEIGHT + CHIP_GAP;
    }

    currentY += PHASE_GAP;
  }
}

/**
 * Render a single item chip with status-based coloring.
 */
function renderChip(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  item: RoadmapItem,
  x: number,
  y: number,
  maxWidth: number,
  roughOptions: Options,
): void {
  const chipColor = STATUS_COLORS[item.status];
  const chipOptions: Options = {
    ...roughOptions,
    fill: chipColor,
    fillStyle: "solid",
  };

  const drawable = rc.rectangle(x, y, maxWidth, CHIP_HEIGHT, chipOptions);
  rc.draw(drawable);

  ctx.font = `${CHIP_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = item.status === "planned" ? "#333333" : "#ffffff";
  ctx.fillText(item.title, x + CHIP_PADDING, y + CHIP_HEIGHT / 2);
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("roadmap", renderRoadmap);
