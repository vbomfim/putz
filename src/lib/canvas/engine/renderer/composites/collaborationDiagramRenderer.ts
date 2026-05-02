/**
 * Collaboration diagram composite renderer.
 *
 * Renders objects as labeled rounded rectangles arranged in a circle.
 * Links are drawn as lines between objects with labels at midpoint.
 * Bidirectional links have arrowheads on both ends; unidirectional
 * links have an arrowhead only at the target end.
 *
 * @module
 */

import type {
  VisualExpression,
  CollaborationDiagramData,
  CollabObject,
} from "../../../protocol";
import type { RoughCanvas } from "roughjs/bin/canvas.js";
import { mapStyleToRoughOptions } from "../styleMapper";
import { renderArrowhead } from "../primitiveRenderer";
import { registerCompositeRenderer } from "../compositeRegistry";

// ── Constants ────────────────────────────────────────────────

/** Padding around the diagram. */
const PADDING = 20;

/** Height reserved for the title. */
const TITLE_HEIGHT = 28;

/** Object rectangle width. */
const OBJECT_WIDTH = 100;

/** Object rectangle height. */
const OBJECT_HEIGHT = 40;

/** Default font family. */
const FONT_FAMILY = "sans-serif";

/** Title font size. */
const TITLE_FONT_SIZE = 16;

/** Object label font size. */
const OBJECT_FONT_SIZE = 12;

/** Link label font size. */
const LINK_LABEL_FONT_SIZE = 11;

/** Arrowhead size. */
const ARROWHEAD_SIZE = 8;

// ── Layout helpers ───────────────────────────────────────────

interface PositionedObject {
  id: string;
  name: string;
  cx: number;
  cy: number;
}

/**
 * Arrange objects in a circular layout within the given bounds.
 */
function layoutObjects(
  objects: CollabObject[],
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): PositionedObject[] {
  if (objects.length === 0) return [];
  if (objects.length === 1) {
    return [
      { id: objects[0]!.id, name: objects[0]!.name, cx: centerX, cy: centerY },
    ];
  }

  return objects.map((obj, i) => {
    const angle = (2 * Math.PI * i) / objects.length - Math.PI / 2;
    return {
      id: obj.id,
      name: obj.name,
      cx: centerX + radiusX * Math.cos(angle),
      cy: centerY + radiusY * Math.sin(angle),
    };
  });
}

// ── Main renderer ────────────────────────────────────────────

/**
 * Render a collaboration diagram expression. [AC7]
 *
 * @param ctx - The 2D canvas context.
 * @param expr - The collaboration diagram VisualExpression.
 * @param rc - The Rough.js canvas for sketchy rendering.
 */
export function renderCollaborationDiagram(
  ctx: CanvasRenderingContext2D,
  expr: VisualExpression,
  rc: RoughCanvas,
): void {
  const data = expr.data as CollaborationDiagramData;
  const { x: originX, y: originY } = expr.position;
  const { width, height } = expr.size;
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

  // ── Empty diagram ──────────────────────────────────────────
  if (data.objects.length === 0) {
    ctx.restore();
    return;
  }

  // ── Layout objects in circular arrangement ─────────────────
  const contentTop = originY + PADDING + TITLE_HEIGHT;
  const contentHeight = height - PADDING * 2 - TITLE_HEIGHT;
  const centerX = originX + width / 2;
  const centerY = contentTop + contentHeight / 2;
  const radiusX = (width - PADDING * 2 - OBJECT_WIDTH) / 2;
  const radiusY = (contentHeight - OBJECT_HEIGHT) / 2;

  const positioned = layoutObjects(
    data.objects,
    centerX,
    centerY,
    radiusX,
    radiusY,
  );
  const posMap = new Map(positioned.map((p) => [p.id, p]));

  // ── Render links ───────────────────────────────────────────
  for (const link of data.links) {
    const fromObj = posMap.get(link.from);
    const toObj = posMap.get(link.to);
    if (!fromObj || !toObj) continue;

    // Draw line
    const lineDrawable = rc.line(
      fromObj.cx,
      fromObj.cy,
      toObj.cx,
      toObj.cy,
      roughOptions,
    );
    rc.draw(lineDrawable);

    // Arrowhead at target
    const angle = Math.atan2(toObj.cy - fromObj.cy, toObj.cx - fromObj.cx);
    ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
    renderArrowhead(ctx, toObj.cx, toObj.cy, angle, ARROWHEAD_SIZE);

    // Bidirectional: arrowhead at source too
    if (link.direction === "bidirectional") {
      const reverseAngle = angle + Math.PI;
      renderArrowhead(
        ctx,
        fromObj.cx,
        fromObj.cy,
        reverseAngle,
        ARROWHEAD_SIZE,
      );
    }

    // Link label at midpoint
    const midX = (fromObj.cx + toObj.cx) / 2;
    const midY = (fromObj.cy + toObj.cy) / 2;
    ctx.font = `${LINK_LABEL_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
    ctx.fillText(link.label, midX, midY - 4);
  }

  // ── Render objects (on top of links) ───────────────────────
  for (const obj of positioned) {
    const rx = obj.cx - OBJECT_WIDTH / 2;
    const ry = obj.cy - OBJECT_HEIGHT / 2;

    const drawable = rc.rectangle(
      rx,
      ry,
      OBJECT_WIDTH,
      OBJECT_HEIGHT,
      roughOptions,
    );
    rc.draw(drawable);

    ctx.font = `${OBJECT_FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = (roughOptions.stroke as string) ?? "#000000";
    ctx.fillText(obj.name, obj.cx, obj.cy);
  }

  ctx.restore();
}

// ── Self-registration ────────────────────────────────────────

registerCompositeRenderer("collaboration-diagram", renderCollaborationDiagram);
