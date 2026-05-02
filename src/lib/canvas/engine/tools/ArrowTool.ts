/**
 * Arrow drawing tool with connector binding support.
 *
 * Creates arrows with endArrowhead: true. When drawing starts or ends
 * near a shape edge, the arrow binds to that shape so it follows on move.
 * Minimum distance: 5px. Auto-switches to Select after creation.
 *
 * @module
 */

import { nanoid } from "nanoid";
import type { VisualExpression, ArrowBinding, ArrowData } from "../../protocol";
import type { ToolHandler, DrawPreview } from "./BaseTool";
import type { CanvasStoreApi } from "../store/canvasStore";
import { findSnapPoint } from "../interaction/connectorHelpers";
import {
  getConnectionPoints,
  findNearestConnectionPoint,
  type ShapeConnectionPoint,
} from "../connectors/connectionPoints";

/** Minimum arrow length in world units. */
const MIN_ARROW_LENGTH = 5;

/** Snap distance in world units for connector binding. */
const SNAP_DISTANCE = 15;

/** Human author for locally-drawn expressions. */
const LOCAL_AUTHOR = {
  type: "human" as const,
  id: "local-user",
  name: "You",
};

/** Tool handler for drawing arrows on the canvas. */
export class ArrowTool implements ToolHandler {
  private readonly store: CanvasStoreApi;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;
  private startBinding: ArrowBinding | undefined = undefined;
  private currentSnapPoint: { x: number; y: number } | undefined = undefined;
  private currentSnapTargetId: string | undefined = undefined;
  private currentConnectionPoints: ShapeConnectionPoint[] | undefined =
    undefined;

  constructor(store: CanvasStoreApi) {
    this.store = store;
  }

  onPointerDown(worldX: number, worldY: number, _event: PointerEvent): void {
    this.isDrawing = true;
    this.startX = worldX;
    this.startY = worldY;
    this.endX = worldX;
    this.endY = worldY;

    // Check for start binding
    const snap = this.findNearestSnap(worldX, worldY);
    if (snap) {
      this.startBinding = {
        expressionId: snap.targetId,
        anchor: snap.anchor as ArrowBinding["anchor"],
        ratio: snap.ratio,
      };
      this.startX = snap.point.x;
      this.startY = snap.point.y;
    } else {
      this.startBinding = undefined;
    }
  }

  onPointerMove(worldX: number, worldY: number, _event: PointerEvent): void {
    // Check for snap — show indicator even before drawing starts
    const snap = this.findNearestSnap(worldX, worldY);
    if (snap) {
      this.currentSnapPoint = snap.point;
      this.currentSnapTargetId = snap.targetId;
      this.currentConnectionPoints = snap.connectionPoints;
    } else {
      this.currentSnapPoint = undefined;
      this.currentSnapTargetId = undefined;
      this.currentConnectionPoints = undefined;
    }

    if (!this.isDrawing) return;

    this.endX = worldX;
    this.endY = worldY;

    // Snap endpoint during drawing
    if (snap) {
      this.endX = snap.point.x;
      this.endY = snap.point.y;
    }
  }

  onPointerUp(worldX: number, worldY: number, _event: PointerEvent): void {
    if (!this.isDrawing) return;

    this.endX = worldX;
    this.endY = worldY;
    this.isDrawing = false;

    // Check for end binding
    let endBinding: ArrowBinding | undefined;
    const snap = this.findNearestSnap(worldX, worldY);
    if (snap) {
      endBinding = {
        expressionId: snap.targetId,
        anchor: snap.anchor as ArrowBinding["anchor"],
        ratio: snap.ratio,
      };
      this.endX = snap.point.x;
      this.endY = snap.point.y;
    }

    const length = Math.hypot(this.endX - this.startX, this.endY - this.startY);
    if (length < MIN_ARROW_LENGTH) {
      this.reset();
      return;
    }

    const points: [number, number][] = [
      [this.startX, this.startY],
      [this.endX, this.endY],
    ];

    const { position, size } = computeBoundingBox(points);
    const now = Date.now();
    const id = nanoid();

    const expression: VisualExpression = {
      id,
      kind: "arrow",
      position,
      size,
      angle: 0,
      style: (() => {
        const s = this.store.getState();
        return { ...s.lastUsedStyle };
      })(),
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data: (() => {
        const { defaultArrowStyle } = this.store.getState();
        const d: ArrowData = {
          kind: "arrow",
          points,
          startArrowhead: defaultArrowStyle.startArrowhead,
          endArrowhead: defaultArrowStyle.endArrowhead,
        };
        if (
          defaultArrowStyle.routing &&
          defaultArrowStyle.routing !== "straight"
        ) {
          d.routing = defaultArrowStyle.routing;
        }
        if (this.startBinding) d.startBinding = this.startBinding;
        if (endBinding) d.endBinding = endBinding;
        return d;
      })(),
    };

    const store = this.store.getState();
    store.addExpression(expression);
    store.setSelectedIds(new Set([id]));

    this.reset();
  }

  onCancel(): void {
    this.isDrawing = false;
    this.reset();
  }

  getPreview(): DrawPreview | null {
    // Show snap indicator even when not drawing (hover preview)
    if (!this.isDrawing) {
      if (this.currentSnapPoint) {
        return {
          kind: "arrow",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          points: [],
          snapPoint: this.currentSnapPoint,
          snapTargetId: this.currentSnapTargetId,
          connectionPoints: this.currentConnectionPoints,
        };
      }
      return null;
    }
    if (this.endX === this.startX && this.endY === this.startY) return null;

    const points: [number, number][] = [
      [this.startX, this.startY],
      [this.endX, this.endY],
    ];
    const { position, size } = computeBoundingBox(points);

    return {
      kind: "arrow",
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      points,
      snapPoint: this.currentSnapPoint,
      snapTargetId: this.currentSnapTargetId,
      connectionPoints: this.currentConnectionPoints,
    };
  }

  private reset(): void {
    this.startX = 0;
    this.startY = 0;
    this.endX = 0;
    this.endY = 0;
    this.startBinding = undefined;
    this.currentSnapPoint = undefined;
    this.currentSnapTargetId = undefined;
    this.currentConnectionPoints = undefined;
  }

  /**
   * Find the nearest snap target among all canvas expressions.
   *
   * Iterates all expressions and returns the closest snap point
   * within SNAP_DISTANCE, or null if none found. Also includes
   * all connection points on the target shape for hover UI.
   * [SRP]
   */
  private findNearestSnap(
    worldX: number,
    worldY: number,
  ): {
    point: { x: number; y: number };
    anchor: string;
    targetId: string;
    ratio: number;
    connectionPoints: ShapeConnectionPoint[];
  } | null {
    const { expressions, camera } = this.store.getState();
    // Scale snap distance: at zoom > 1, shrink so snapping feels precise;
    // at zoom ≤ 1, keep at constant ~15 screen pixels. [Bug #5]
    const snapDist = SNAP_DISTANCE / Math.max(camera.zoom, 1);
    let best: {
      point: { x: number; y: number };
      anchor: string;
      targetId: string;
      dist: number;
      ratio: number;
      connectionPoints: ShapeConnectionPoint[];
    } | null = null;

    for (const [id, expr] of Object.entries(expressions)) {
      // Try new connection point system first (includes corners)
      const cpSnap = findNearestConnectionPoint(worldX, worldY, expr, snapDist);
      if (cpSnap) {
        const dist = Math.hypot(worldX - cpSnap.x, worldY - cpSnap.y);
        if (!best || dist < best.dist) {
          best = {
            point: { x: cpSnap.x, y: cpSnap.y },
            anchor: cpSnap.position,
            targetId: id,
            dist,
            ratio: 0.5,
            connectionPoints: getConnectionPoints(expr),
          };
        }
        continue;
      }

      // Fall back to legacy edge snap (for edge midpoint ratios)
      const snap = findSnapPoint({ x: worldX, y: worldY }, expr, snapDist);
      if (snap) {
        const dist = Math.hypot(worldX - snap.point.x, worldY - snap.point.y);
        if (!best || dist < best.dist) {
          best = {
            point: snap.point,
            anchor: snap.anchor,
            targetId: id,
            dist,
            ratio: snap.ratio,
            connectionPoints: getConnectionPoints(expr),
          };
        }
      }
    }

    return best
      ? {
          point: best.point,
          anchor: best.anchor,
          targetId: best.targetId,
          ratio: best.ratio,
          connectionPoints: best.connectionPoints,
        }
      : null;
  }
}

/** Compute axis-aligned bounding box from a set of points.
 * Ensures minimum size of 1 to satisfy Zod positive() constraint. */
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
    size: {
      width: Math.max(maxX - minX, 1),
      height: Math.max(maxY - minY, 1),
    },
  };
}
