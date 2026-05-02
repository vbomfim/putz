/**
 * Line drawing tool.
 *
 * Creates an arrow expression with no arrowheads (a plain line).
 * User can add arrowheads later via the style panel.
 * Supports snap-to-shape binding like the arrow tool.
 *
 * @module
 */

import { nanoid } from "nanoid";
import type {
  VisualExpression,
  ArrowBinding,
  ArrowAnchor,
} from "../../protocol";
import type { ToolHandler, DrawPreview } from "./BaseTool";
import type { CanvasStoreApi } from "../store/canvasStore";
import { findSnapPoint } from "../interaction/connectorHelpers";

/** Minimum line length in world units. */
const MIN_LINE_LENGTH = 5;

/** Snap distance for connector binding (world units). */
const SNAP_DISTANCE = 15;

/** Human author for locally-drawn expressions. */
const LOCAL_AUTHOR = {
  type: "human" as const,
  id: "local-user",
  name: "You",
};

/** Tool handler for drawing straight lines (arrows with no tips). */
export class LineTool implements ToolHandler {
  private readonly store: CanvasStoreApi;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;

  constructor(store: CanvasStoreApi) {
    this.store = store;
  }

  onPointerDown(worldX: number, worldY: number, _event: PointerEvent): void {
    this.isDrawing = true;
    this.startX = worldX;
    this.startY = worldY;
    this.endX = worldX;
    this.endY = worldY;
  }

  onPointerMove(worldX: number, worldY: number, _event: PointerEvent): void {
    if (!this.isDrawing) return;
    this.endX = worldX;
    this.endY = worldY;
  }

  onPointerUp(worldX: number, worldY: number, _event: PointerEvent): void {
    if (!this.isDrawing) return;

    this.endX = worldX;
    this.endY = worldY;
    this.isDrawing = false;

    const length = Math.hypot(this.endX - this.startX, this.endY - this.startY);
    if (length < MIN_LINE_LENGTH) {
      this.reset();
      return;
    }

    const points: [number, number][] = [
      [this.startX, this.startY],
      [this.endX, this.endY],
    ];

    // Snap endpoints to nearby shapes
    const state = this.store.getState();
    let startBinding: ArrowBinding | undefined;
    let endBinding: ArrowBinding | undefined;
    // Scale snap distance so it stays ~15 screen pixels at any zoom
    const snapDist = Math.max(SNAP_DISTANCE, SNAP_DISTANCE / state.camera.zoom);

    for (const [id, target] of Object.entries(state.expressions)) {
      if (!startBinding) {
        const snap = findSnapPoint(
          { x: this.startX, y: this.startY },
          target,
          snapDist,
        );
        if (snap) {
          startBinding = {
            expressionId: id,
            anchor: snap.anchor as ArrowAnchor,
          };
          points[0] = [snap.point.x, snap.point.y];
        }
      }
      if (!endBinding) {
        const snap = findSnapPoint(
          { x: this.endX, y: this.endY },
          target,
          snapDist,
        );
        if (snap) {
          endBinding = { expressionId: id, anchor: snap.anchor as ArrowAnchor };
          points[points.length - 1] = [snap.point.x, snap.point.y];
        }
      }
    }

    const { position, size } = computeBoundingBox(points);
    const now = Date.now();
    const id = nanoid();

    const expression: VisualExpression = {
      id,
      kind: "arrow",
      position,
      size,
      angle: 0,
      style: { ...state.lastUsedStyle },
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data: {
        kind: "arrow",
        points,
        startArrowhead: "none",
        endArrowhead: "none",
        startBinding,
        endBinding,
      },
    };

    state.addExpression(expression);
    state.setSelectedIds(new Set([id]));

    this.reset();
  }

  onCancel(): void {
    this.isDrawing = false;
    this.reset();
  }

  getPreview(): DrawPreview | null {
    if (!this.isDrawing) return null;
    if (this.endX === this.startX && this.endY === this.startY) return null;

    const points: [number, number][] = [
      [this.startX, this.startY],
      [this.endX, this.endY],
    ];
    const { position, size } = computeBoundingBox(points);

    return {
      kind: "line",
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      points,
    };
  }

  private reset(): void {
    this.startX = 0;
    this.startY = 0;
    this.endX = 0;
    this.endY = 0;
  }
}

/** Compute axis-aligned bounding box from a set of points. */
function computeBoundingBox(points: [number, number][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  return {
    position: { x: minX, y: minY },
    size: { width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) },
  };
}
