/**
 * Canvas state store — Zustand with immer middleware.
 *
 * Manages all canvas state: expressions, selection, tools, camera, and
 * the protocol operation log. Mutation actions that affect canvas content
 * (add, update, delete) emit ProtocolOperations for collaboration tracking
 * and push undo snapshots for history navigation.
 * UI-only actions (selection, tool, camera) do NOT emit operations or snapshots.
 *
 * @module
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { createElement } from "react";
import { nanoid } from "nanoid";
import {
  visualExpressionSchema,
  protocolOperationSchema,
  expressionStyleSchema,
  DEFAULT_EXPRESSION_STYLE,
  DEFAULT_LAYER_ID,
} from "../../protocol";
import type {
  VisualExpression,
  ProtocolOperation,
  AuthorInfo,
  CreatePayload,
  UpdatePayload,
  DeletePayload,
  MovePayload,
  TransformPayload,
  StylePayload,
  GroupPayload,
  UngroupPayload,
  ExpressionStyle,
  Layer,
  ContainerData,
} from "../../protocol";
import type {
  CanvasState,
  CanvasActions,
  ToolType,
  Camera,
  CameraWaypoint,
  DefaultArrowStyle,
} from "../types/index";
import { HistoryManager } from "../history/historyManager";
import type { CanvasSnapshot } from "../history/historyManager";
import { getThemeById, applyThemeToExpressions } from "../themes/presets";
import { invalidateLayoutCache as invalidateFlowchartCache } from "../renderer/composites/flowchartRenderer";
import { invalidateLayoutCache as invalidateSequenceCache } from "../renderer/composites/sequenceDiagramRenderer";
import { invalidateLayoutCache as invalidateMindMapCache } from "../renderer/composites/mindMapRenderer";
import { invalidateLayoutCache as invalidateReasoningCache } from "../renderer/composites/reasoningChainRenderer";
import {
  findBoundArrows,
  getAnchorPoint,
  clearBindingsForDeletedExpression,
  findSnapPoint,
} from "../interaction/connectorHelpers";
import type { ArrowData, ArrowAnchor, ArrowBinding } from "../../protocol";
import { computeLayout } from "../layout/computeLayout";
import type { LayoutOptions } from "../layout/types";

// Enable immer support for Set/Map (used by selectedIds: Set<string>)
enableMapSet();

/** System author used for store-generated operations. */
const SYSTEM_AUTHOR: AuthorInfo = {
  type: "agent",
  id: "canvas-engine",
  name: "Canvas Engine",
  provider: "infinicanvas",
};

/** Maximum operations kept in the log before oldest are evicted. */
const MAX_OPERATION_LOG = 10_000;

/** Min/max camera zoom bounds. */
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 100;

/** Fields that cannot be changed via updateExpression. */
const IMMUTABLE_FIELDS = new Set(["id", "kind", "meta"]);

/**
 * Per-instance mutable state — moved inside createCanvasStore() factory.
 * Module-level references to the last-created store for test reset helpers.
 */
let _lastWaypointCounter = 0;
let _lastLayerCounter = 1;

/** Maximum number of layers allowed on a canvas. */
const MAX_LAYERS = 100;

/** Maximum length for a layer name. */
const MAX_LAYER_NAME_LENGTH = 500;

/** Check if an expression is on a locked layer. */
function isOnLockedLayer(state: CanvasState, expr: VisualExpression): boolean {
  const layerId = expr.layerId ?? DEFAULT_LAYER_ID;
  const layer = state.layers.find((l) => l.id === layerId);
  return layer?.locked ?? false;
}

/** Creates a ProtocolOperation with unique ID and current timestamp. */
function createOperation(
  type: ProtocolOperation["type"],
  payload: ProtocolOperation["payload"],
): ProtocolOperation {
  return {
    id: nanoid(),
    type,
    author: SYSTEM_AUTHOR,
    timestamp: Date.now(),
    payload,
  };
}

/** Strip empty string values from a style to prevent gateway schema rejection. */
function sanitizeStyle(style: ExpressionStyle): ExpressionStyle {
  const clean = { ...style };
  for (const [k, v] of Object.entries(clean)) {
    if (v === "") delete (clean as Record<string, unknown>)[k];
  }
  return clean;
}

/** Append an operation to the log, evicting oldest entries if over cap. */
function pushOperation(log: ProtocolOperation[], op: ProtocolOperation): void {
  log.push(op);
  if (log.length > MAX_OPERATION_LOG) {
    log.splice(0, log.length - MAX_OPERATION_LOG);
  }
}

/** Check if two expressions' bounding boxes overlap. */
function rectsOverlap(a: VisualExpression, b: VisualExpression): boolean {
  return (
    a.position.x < b.position.x + b.size.width &&
    a.position.x + a.size.width > b.position.x &&
    a.position.y < b.position.y + b.size.height &&
    a.position.y + a.size.height > b.position.y
  );
}

/** Extract a snapshot from the current canvas state (expressions + z-order). */
function captureSnapshot(state: CanvasState): CanvasSnapshot {
  // Build a plain-object clone of expressions (immer draft → plain)
  const expressions: Record<string, VisualExpression> = {};
  for (const [id, expr] of Object.entries(state.expressions)) {
    expressions[id] = structuredClone(expr as VisualExpression);
  }
  return {
    expressions,
    expressionOrder: [...state.expressionOrder],
  };
}

/** Point-based expression kinds whose data includes a `points` array. */
const POINT_BASED_KINDS = new Set(["line", "arrow", "freehand"]);

/**
 * Translate `data.points` by (dx, dy) for point-based expressions.
 *
 * Point-based shapes (line, arrow, freehand) store their geometry as
 * absolute world coordinates in `data.points`. When moving these shapes,
 * the points must be translated along with `position` to keep the
 * rendered shape in sync with the selection bounding box. [#74]
 *
 * Non-point-based shapes (rectangle, ellipse, etc.) are no-ops.
 * Freehand points are [x, y, pressure] — only x and y are translated.
 */
function translateExpressionPoints(
  expr: VisualExpression,
  dx: number,
  dy: number,
): void {
  if (!POINT_BASED_KINDS.has(expr.kind)) return;

  const data = expr.data as {
    points?: unknown[];
    startBinding?: unknown;
    endBinding?: unknown;
  };
  if (!data.points || data.points.length === 0) return;

  if (expr.kind === "freehand") {
    const points = data.points as [number, number, number][];
    for (const point of points) {
      point[0] += dx;
      point[1] += dy;
    }
  } else {
    const points = data.points as [number, number][];
    for (const point of points) {
      point[0] += dx;
      point[1] += dy;
    }
  }

  // Clear bindings when arrow is moved by body — detach from shapes
  if (expr.kind === "arrow") {
    data.startBinding = undefined;
    data.endBinding = undefined;
  }
}

/**
 * Update all arrows bound to the given expression IDs.
 *
 * After moving or resizing a shape, finds all arrows that reference
 * it via startBinding or endBinding and recalculates the bound
 * endpoint to the current anchor position. [CLEAN-CODE]
 */
function updateBoundArrows(state: CanvasState, movedIds: Set<string>): void {
  // Collect all arrows that need updating
  const processedArrows = new Set<string>();

  for (const targetId of movedIds) {
    const target = state.expressions[targetId];
    if (!target) continue;

    const arrowIds = findBoundArrows(targetId, state.expressions);
    for (const arrowId of arrowIds) {
      if (processedArrows.has(arrowId)) continue;
      processedArrows.add(arrowId);

      const arrow = state.expressions[arrowId];
      if (!arrow || arrow.data.kind !== "arrow") continue;

      const data = arrow.data as ArrowData;
      const points = data.points;
      if (points.length < 2) continue;

      // Resolve both bound shapes
      const startTarget = data.startBinding
        ? state.expressions[data.startBinding.expressionId]
        : null;
      const endTarget = data.endBinding
        ? state.expressions[data.endBinding.expressionId]
        : null;

      // Self-loop: use stored anchors (user chose the snap points)
      const isSelfLoop =
        data.startBinding &&
        data.endBinding &&
        data.startBinding.expressionId === data.endBinding.expressionId;
      if (isSelfLoop && startTarget) {
        const sp = getAnchorPoint(
          startTarget,
          data.startBinding!.anchor || "top",
          data.startBinding!.ratio ?? 0.5,
        );
        const ep = getAnchorPoint(
          startTarget,
          data.endBinding!.anchor || "right",
          data.endBinding!.ratio ?? 0.5,
        );
        points[0] = [sp.x, sp.y];
        points[points.length - 1] = [ep.x, ep.y];

        // Bbox includes bezier control points
        const loopSize =
          Math.max(startTarget.size.width, startTarget.size.height) * 0.6;
        const midX = (sp.x + ep.x) / 2,
          midY = (sp.y + ep.y) / 2;
        const cx = startTarget.position.x + startTarget.size.width / 2;
        const cy = startTarget.position.y + startTarget.size.height / 2;
        const dist = Math.hypot(midX - cx, midY - cy) || 1;
        const cpX = midX + ((midX - cx) / dist) * loopSize;
        const cpY = midY + ((midY - cy) / dist) * loopSize;
        arrow.position = {
          x: Math.min(sp.x, ep.x, cpX),
          y: Math.min(sp.y, ep.y, cpY),
        };
        arrow.size = {
          width: Math.max(Math.max(sp.x, ep.x, cpX) - arrow.position.x, 1),
          height: Math.max(Math.max(sp.y, ep.y, cpY) - arrow.position.y, 1),
        };
        continue;
      }

      // Use shape centers as reference points for smart routing
      const startRef = startTarget
        ? {
            x: startTarget.position.x + startTarget.size.width / 2,
            y: startTarget.position.y + startTarget.size.height / 2,
          }
        : { x: points[0]![0], y: points[0]![1] };
      const endRef = endTarget
        ? {
            x: endTarget.position.x + endTarget.size.width / 2,
            y: endTarget.position.y + endTarget.size.height / 2,
          }
        : {
            x: points[points.length - 1]![0],
            y: points[points.length - 1]![1],
          };

      // Smart anchor BOTH ends — only switch edge when needed, keep ratio stable
      if (data.startBinding && startTarget) {
        const best = findBestAnchor(
          startTarget,
          endRef,
          data.startBinding.anchor,
          data.startBinding.ratio,
        );
        data.startBinding.anchor = best.anchor as ArrowAnchor;
        data.startBinding.ratio = best.ratio;
        points[0] = [best.point.x, best.point.y];
      }

      if (data.endBinding && endTarget) {
        const best = findBestAnchor(
          endTarget,
          startRef,
          data.endBinding.anchor,
          data.endBinding.ratio,
        );
        data.endBinding.anchor = best.anchor as ArrowAnchor;
        data.endBinding.ratio = best.ratio;
        points[points.length - 1] = [best.point.x, best.point.y];
      }

      // Update bounding box
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [px, py] of points) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }

      arrow.position = { x: minX, y: minY };
      arrow.size = {
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
      };
    }
  }
}

/**
 * Find the best edge facing toward a target point.
 * Only changes the edge (anchor) when the arrow would cross the shape.
 * Preserves the original ratio — only resets to 0.5 when switching edges.
 */
function findBestAnchor(
  expr: VisualExpression,
  toward: { x: number; y: number },
  currentAnchor?: string,
  currentRatio?: number,
): { anchor: string; point: { x: number; y: number }; ratio: number } {
  const { x, y } = expr.position;
  const { width, height } = expr.size;
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Direction from shape center to the target point
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  // Pick the edge that faces the target — use the dominant axis
  let anchor: string;
  if (Math.abs(dx) > Math.abs(dy)) {
    anchor = dx > 0 ? "right" : "left";
  } else {
    anchor = dy > 0 ? "bottom" : "top";
  }

  // Keep existing ratio if the edge didn't change
  let ratio: number;
  if (anchor === currentAnchor && currentRatio !== undefined) {
    ratio = currentRatio;
  } else {
    ratio = 0.5; // Reset to center when switching edges
  }

  const point = getAnchorPoint(expr, anchor, ratio);
  return { anchor, point, ratio };
}

/** Store API type for external consumption (includes immer-enhanced setState). */
type StateType = CanvasState & CanvasActions;
export type CanvasStoreApi = Omit<StoreApi<StateType>, "setState"> & {
  setState: StoreApi<StateType>["setState"] &
    ((fn: (draft: StateType) => void) => void);
};

/**
 * Factory: creates a new independent canvas store instance.
 * Each instance gets its own historyManager, waypointCounter, and layerCounter.
 */
export function createCanvasStore(): CanvasStoreApi {
  const historyManager = new HistoryManager();
  let waypointCounter = 0;
  let layerCounter = 1;

  const store = createStore<CanvasState & CanvasActions>()(
    immer((set, get) => ({
      // ── Initial state ────────────────────────────────────────
      expressions: {},
      expressionOrder: [],
      selectedIds: new Set<string>(),
      activeTool: "select" as ToolType,
      camera: { x: 0, y: 0, zoom: 1 },
      operationLog: [],
      canUndo: false,
      canRedo: false,
      lastUsedStyle: { ...DEFAULT_EXPRESSION_STYLE },
      waypoints: [] as CameraWaypoint[],
      presentationIndex: -1,
      waypointPanelOpen: false,

      // ── Grid & snap state (UI-only, no operations or snapshots) ──
      gridVisible: true,
      gridType: "dot" as const,
      gridSize: 20,
      snapEnabled: true,

      // ── Page/paper boundary state (UI-only, no operations or snapshots) ──
      pageVisible: true,
      pageSize: { width: 1122, height: 794 },

      // ── Layer state (UI-only, no operations or snapshots) ──
      layers: [
        {
          id: DEFAULT_LAYER_ID,
          name: "Layer 1",
          visible: true,
          locked: false,
          order: 0,
        },
      ] as Layer[],
      activeLayerId: DEFAULT_LAYER_ID,

      // ── Default arrow style (UI-only, applied to new arrows) ──
      defaultArrowStyle: {
        routing: "straight",
        startArrowhead: "none",
        endArrowhead: "classic",
      } as DefaultArrowStyle,

      // ── Content mutations (emit ProtocolOperations + push snapshots) ──

      addExpression: (expression: VisualExpression) => {
        const result = visualExpressionSchema.safeParse(expression);
        if (!result.success) {
          console.warn(
            `[canvasStore] Invalid expression rejected:`,
            result.error.issues,
          );
          return;
        }

        // Check for duplicate before snapshotting [AC8]
        const currentState = get();
        if (currentState.expressions[expression.id]) {
          return;
        }

        // Push snapshot BEFORE mutation [AC8]
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          // Assign layerId from activeLayerId if not already set [#109]
          const layeredExpr = expression.layerId
            ? expression
            : { ...expression, layerId: state.activeLayerId };
          state.expressions[layeredExpr.id] = layeredExpr;
          state.expressionOrder.push(layeredExpr.id);

          const operation = createOperation("create", {
            type: "create",
            expressionId: expression.id,
            kind: expression.kind,
            position: expression.position,
            size: expression.size,
            data: expression.data,
            style: sanitizeStyle(expression.style),
            angle: expression.angle,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      updateExpression: (id: string, partial: Partial<VisualExpression>) => {
        const currentState = get();
        const existing = currentState.expressions[id];
        if (!existing) {
          console.warn(
            `[canvasStore] Cannot update non-existent expression: ${id}`,
          );
          return;
        }

        // S5-3: Skip locked expressions
        if (existing.meta.locked) return;

        // #109: Skip expressions on locked layers
        if (isOnLockedLayer(currentState, existing)) return;

        // Push snapshot BEFORE mutation [AC8]
        historyManager.pushSnapshot(captureSnapshot(currentState));

        let reverted = false;

        set((state) => {
          const expr = state.expressions[id];
          if (!expr) return;

          // Strip immutable fields to protect invariants
          const safeUpdates: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(partial)) {
            if (!IMMUTABLE_FIELDS.has(key)) {
              safeUpdates[key] = value;
            }
          }

          // Snapshot original values for rollback
          const originals: Record<string, unknown> = {};
          for (const key of Object.keys(safeUpdates)) {
            originals[key] = (expr as Record<string, unknown>)[key];
          }

          // Apply safe updates
          Object.assign(expr, safeUpdates);

          // Post-merge validation — revert if result is invalid
          const merged = visualExpressionSchema.safeParse(expr);
          if (!merged.success) {
            // Rollback draft to original values
            Object.assign(expr, originals);
            console.warn(
              `[canvasStore] Update would produce invalid expression, reverting:`,
              merged.error.issues,
            );
            reverted = true;
            return;
          }

          // Build changes payload with only the fields that actually changed
          const changes: Record<string, unknown> = {};
          if (safeUpdates.position) changes.position = safeUpdates.position;
          if (safeUpdates.size) changes.size = safeUpdates.size;
          if (safeUpdates.angle !== undefined)
            changes.angle = safeUpdates.angle;
          if (safeUpdates.style)
            changes.style = sanitizeStyle(safeUpdates.style as ExpressionStyle);
          if (safeUpdates.data) changes.data = safeUpdates.data;

          const operation = createOperation("update", {
            type: "update",
            expressionId: id,
            changes,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });

        // If the update was reverted (validation failed), undo the snapshot push
        if (reverted) {
          historyManager.undo(captureSnapshot(get()));
          set((state) => {
            state.canUndo = historyManager.canUndo();
            state.canRedo = historyManager.canRedo();
          });
        }
      },

      deleteExpressions: (ids: string[]) => {
        if (ids.length === 0) {
          return;
        }

        const currentState = get();

        // Filter to only IDs that actually exist and are not locked [S5-3] [#109]
        const existingIds = ids.filter((id) => {
          const expr = currentState.expressions[id];
          return (
            expr && !expr.meta.locked && !isOnLockedLayer(currentState, expr)
          );
        });
        if (existingIds.length === 0) {
          return;
        }

        // Push snapshot BEFORE mutation [AC8]
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          const idSet = new Set(existingIds);

          // Clear bindings in surviving arrows that reference deleted shapes [CLEAN-CODE]
          for (const deletedId of existingIds) {
            for (const [arrowId, expr] of Object.entries(state.expressions)) {
              if (idSet.has(arrowId)) continue; // skip if this arrow is also being deleted
              if (expr.data.kind !== "arrow") continue;
              const updated = clearBindingsForDeletedExpression(
                expr.data as ArrowData,
                deletedId,
              );
              if (updated) {
                expr.data = updated;
              }
            }
          }

          // #112: Unparent children of deleted containers
          for (const deletedId of existingIds) {
            for (const [childId, childExpr] of Object.entries(
              state.expressions,
            )) {
              if (idSet.has(childId)) continue; // skip if child is also being deleted
              if (childExpr.parentId === deletedId) {
                delete childExpr.parentId;
              }
            }
          }

          for (const id of existingIds) {
            delete state.expressions[id];
            state.selectedIds.delete(id);
          }

          state.expressionOrder = state.expressionOrder.filter(
            (orderId) => !idSet.has(orderId),
          );

          const operation = createOperation("delete", {
            type: "delete",
            expressionIds: [...existingIds],
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });

        // Evict deleted expressions from composite renderer layout caches [S6-4]
        for (const id of existingIds) {
          invalidateFlowchartCache(id);
          invalidateSequenceCache(id);
          invalidateMindMapCache(id);
          invalidateReasoningCache(id);
        }
      },

      // ── Undo/Redo actions ────────────────────────────────────

      undo: () => {
        const currentState = get();
        const snapshot = historyManager.undo(captureSnapshot(currentState));
        if (!snapshot) return;

        set((state) => {
          // Restore expressions and z-order from snapshot
          state.expressions = snapshot.expressions;
          state.expressionOrder = snapshot.expressionOrder;
          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      redo: () => {
        const currentState = get();
        const snapshot = historyManager.redo(captureSnapshot(currentState));
        if (!snapshot) return;

        set((state) => {
          // Restore expressions and z-order from snapshot
          state.expressions = snapshot.expressions;
          state.expressionOrder = snapshot.expressionOrder;
          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      clearHistory: () => {
        historyManager.clear();
        set((state) => {
          state.canUndo = false;
          state.canRedo = false;
        });
      },

      // ── UI-only state (NO ProtocolOperations, NO snapshots) ──

      setSelectedIds: (ids: Set<string>) => {
        set((state) => {
          state.selectedIds = new Set(ids);
        });
      },

      setActiveTool: (tool: ToolType) => {
        set((state) => {
          state.activeTool = tool;
        });
      },

      setCamera: (camera: Camera) => {
        if (
          !Number.isFinite(camera.x) ||
          !Number.isFinite(camera.y) ||
          !Number.isFinite(camera.zoom)
        ) {
          console.warn(
            "[canvasStore] Invalid camera values (NaN/Infinity) rejected",
          );
          return;
        }
        set((state) => {
          state.camera = {
            x: camera.x,
            y: camera.y,
            zoom: Math.max(MIN_ZOOM, Math.min(camera.zoom, MAX_ZOOM)),
          };
        });
      },

      // ── Remote operations (NO operationLog append) ────────────

      applyRemoteOperation: (op: ProtocolOperation) => {
        // Validate incoming remote operation against schema [R5]
        const opResult = protocolOperationSchema.safeParse(op);
        if (!opResult.success) {
          console.warn(
            "[canvasStore] Invalid remote operation rejected:",
            opResult.error.issues,
          );
          return;
        }

        set((state) => {
          switch (op.payload.type) {
            case "create": {
              const p = op.payload as CreatePayload;
              const expr: VisualExpression = {
                id: p.expressionId,
                kind: p.kind,
                position: p.position,
                size: p.size,
                angle: p.angle ?? 0,
                style: p.style ?? { ...DEFAULT_EXPRESSION_STYLE },
                meta: {
                  author: op.author,
                  createdAt: op.timestamp,
                  updatedAt: op.timestamp,
                  tags: [],
                  locked: false,
                },
                data: p.data,
              };
              // Validate reconstructed expression [R5]
              const exprResult = visualExpressionSchema.safeParse(expr);
              if (!exprResult.success) {
                console.warn(
                  "[canvasStore] Invalid expression from remote create rejected:",
                  exprResult.error.issues,
                );
                break;
              }
              state.expressions[p.expressionId] = expr;
              state.expressionOrder.push(p.expressionId);
              break;
            }

            case "update": {
              const p = op.payload as UpdatePayload;
              const existing = state.expressions[p.expressionId];
              if (!existing) break;
              if (p.changes.position) existing.position = p.changes.position;
              if (p.changes.size) existing.size = p.changes.size;
              if (p.changes.angle !== undefined)
                existing.angle = p.changes.angle;
              if (p.changes.style) {
                Object.assign(existing.style, p.changes.style);
              }
              if (p.changes.data) existing.data = p.changes.data;
              break;
            }

            case "delete": {
              const p = op.payload as DeletePayload;
              const idSet = new Set(p.expressionIds);
              for (const id of p.expressionIds) {
                delete state.expressions[id];
                state.selectedIds.delete(id);
              }
              state.expressionOrder = state.expressionOrder.filter(
                (id) => !idSet.has(id),
              );
              break;
            }

            case "move": {
              const p = op.payload as MovePayload;
              const existing = state.expressions[p.expressionId];
              if (existing) {
                existing.position = p.to;
              }
              break;
            }

            case "transform": {
              const p = op.payload as TransformPayload;
              const existing = state.expressions[p.expressionId];
              if (existing) {
                if (p.angle !== undefined) existing.angle = p.angle;
                if (p.size) existing.size = p.size;
              }
              break;
            }

            case "style": {
              const p = op.payload as StylePayload;
              for (const id of p.expressionIds) {
                const existing = state.expressions[id];
                if (existing) {
                  existing.style = {
                    ...existing.style,
                    ...p.style,
                  } as ExpressionStyle;
                }
              }
              break;
            }

            case "group": {
              const p = op.payload as GroupPayload;
              for (const id of p.expressionIds) {
                const existing = state.expressions[id];
                if (existing) {
                  existing.parentId = p.groupId;
                }
              }
              break;
            }

            case "ungroup": {
              const p = op.payload as UngroupPayload;
              for (const [, existing] of Object.entries(state.expressions)) {
                if (existing.parentId === p.groupId) {
                  delete existing.parentId;
                }
              }
              break;
            }

            default:
              // Unsupported operation types are silently ignored
              break;
          }
        });
      },

      replaceState: (
        expressions: VisualExpression[],
        expressionOrder: string[],
      ) => {
        set((state) => {
          const exprMap: Record<string, VisualExpression> = {};
          const validIds = new Set<string>();

          for (const expr of expressions) {
            const result = visualExpressionSchema.safeParse(expr);
            if (!result.success) {
              console.warn(
                `[canvasStore] replaceState: invalid expression rejected (id=${expr?.id}):`,
                result.error.issues,
              );
              continue;
            }
            // Use Zod-stripped output to prevent prototype pollution [S7-1]
            const validated = result.data as VisualExpression;
            exprMap[validated.id] = validated;
            validIds.add(validated.id);
          }

          state.expressions = exprMap;
          // Filter expressionOrder to only include validated IDs
          state.expressionOrder = expressionOrder.filter((id) =>
            validIds.has(id),
          );
          state.operationLog = [];
          state.selectedIds = new Set<string>();

          // Clear undo/redo history on full state replacement
          historyManager.clear();
          state.canUndo = false;
          state.canRedo = false;
        });
      },

      // ── Shape manipulation mutations ─────────────────────────

      /**
       * Apply a validated style partial to multiple expressions. [S7-5]
       *
       * Validates the incoming style with `expressionStyleSchema.partial()`.
       * Rejects invalid styles with a console.warn and returns without mutating.
       * Emits a `style` ProtocolOperation and pushes an undo snapshot.
       */
      styleExpressions: (ids: string[], style: Partial<ExpressionStyle>) => {
        if (ids.length === 0) return;

        // Validate style partial before applying [S7-5]
        const styleResult = expressionStyleSchema.partial().safeParse(style);
        if (!styleResult.success) {
          console.warn(
            "[canvasStore] styleExpressions: invalid style rejected:",
            styleResult.error.issues,
          );
          return;
        }
        const validatedStyle = styleResult.data as Partial<ExpressionStyle>;

        const currentState = get();

        // Filter to only IDs that exist and are not locked (expression or layer)
        const validIds = ids.filter((id) => {
          const expr = currentState.expressions[id];
          return (
            expr && !expr.meta.locked && !isOnLockedLayer(currentState, expr)
          );
        });
        if (validIds.length === 0) return;

        // Push snapshot BEFORE mutation
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          for (const id of validIds) {
            const expr = state.expressions[id];
            if (expr) {
              expr.style = {
                ...expr.style,
                ...validatedStyle,
              } as ExpressionStyle;

              // For text expressions, also update data.fontSize/fontFamily (they store font in data)
              if (expr.kind === "text") {
                const data = expr.data as Record<string, unknown>;
                if (validatedStyle.fontSize !== undefined) {
                  data.fontSize = validatedStyle.fontSize;
                }
                if (validatedStyle.fontFamily !== undefined) {
                  data.fontFamily = validatedStyle.fontFamily;
                }
              }
            }
          }

          const operation = createOperation("style", {
            type: "style",
            expressionIds: [...validIds],
            style: validatedStyle,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      moveExpressions: (
        moves: Array<{
          id: string;
          from: { x: number; y: number };
          to: { x: number; y: number };
        }>,
      ) => {
        if (moves.length === 0) return;

        const currentState = get();

        // #109: Filter out moves for expressions on locked layers
        const allowedMoves = moves.filter((m) => {
          const expr = currentState.expressions[m.id];
          return expr && !isOnLockedLayer(currentState, expr);
        });
        if (allowedMoves.length === 0) return;

        // Build a snapshot reflecting pre-drag positions (expressions may
        // already be at 'to' positions from transient drag updates).
        const snapshot = captureSnapshot(currentState);
        for (const move of allowedMoves) {
          const expr = snapshot.expressions[move.id];
          if (expr) {
            expr.position = { ...move.from };
            // Note: data.points in snapshot are already at original positions
            // because transient drag only updates position, not points. [#74]
          }
        }
        historyManager.pushSnapshot(snapshot);

        set((state) => {
          const movedIds = new Set(allowedMoves.map((m) => m.id));

          // #112: Cascade container moves to children.
          // Collect child moves for containers being moved, excluding
          // children already in the explicit move list.
          const childMoves: Array<{ id: string; dx: number; dy: number }> = [];
          for (const move of allowedMoves) {
            const expr = state.expressions[move.id];
            if (!expr || expr.kind !== "container") continue;
            const dx = move.to.x - move.from.x;
            const dy = move.to.y - move.from.y;
            for (const [childId, childExpr] of Object.entries(
              state.expressions,
            )) {
              if (childExpr.parentId === move.id && !movedIds.has(childId)) {
                childMoves.push({ id: childId, dx, dy });
                movedIds.add(childId);
              }
            }
          }

          for (const move of allowedMoves) {
            const expr = state.expressions[move.id];
            if (expr) {
              expr.position = { ...move.to };
              // Translate data.points for point-based shapes [#74]
              // Skip bound arrows whose shapes are also being moved —
              // their endpoints will be recalculated by updateBoundArrows.
              const dx = move.to.x - move.from.x;
              const dy = move.to.y - move.from.y;
              if (expr.kind === "arrow" && expr.data.kind === "arrow") {
                const data = expr.data as {
                  startBinding?: { expressionId: string };
                  endBinding?: { expressionId: string };
                };
                const startBound =
                  data.startBinding &&
                  movedIds.has(data.startBinding.expressionId);
                const endBound =
                  data.endBinding && movedIds.has(data.endBinding.expressionId);
                if (!startBound && !endBound) {
                  // Arrow not bound to any moved shape — translate + detach normally
                  translateExpressionPoints(expr, dx, dy);
                }
                // Bound arrow: skip translate, let updateBoundArrows handle it
              } else {
                translateExpressionPoints(expr, dx, dy);
              }
            }
          }

          // #112: Apply cascaded child moves
          for (const cm of childMoves) {
            const child = state.expressions[cm.id];
            if (child) {
              child.position = {
                x: child.position.x + cm.dx,
                y: child.position.y + cm.dy,
              };
              translateExpressionPoints(child, cm.dx, cm.dy);
            }
          }

          // Update arrows bound to the moved shapes
          updateBoundArrows(state, movedIds);

          // Re-snap moved arrows to nearby shapes
          for (const move of allowedMoves) {
            const expr = state.expressions[move.id];
            if (!expr || expr.kind !== "arrow") continue;

            const data = expr.data as {
              points: [number, number][];
              startBinding?: ArrowBinding;
              endBinding?: ArrowBinding;
              kind: string;
            };
            if (data.points.length < 2) continue;

            const RESNAP_DIST = 15;
            const startPt = data.points[0]!;
            const endPt = data.points[data.points.length - 1]!;

            // Check start point for snap
            for (const [id, target] of Object.entries(state.expressions)) {
              if (id === move.id) continue;
              const snap = findSnapPoint(
                { x: startPt[0], y: startPt[1] },
                target,
                RESNAP_DIST,
              );
              if (snap) {
                data.startBinding = {
                  expressionId: id,
                  anchor: snap.anchor as ArrowAnchor,
                  ratio: snap.ratio,
                };
                data.points[0] = [snap.point.x, snap.point.y];
                break;
              }
            }

            // Check end point for snap
            for (const [id, target] of Object.entries(state.expressions)) {
              if (id === move.id) continue;
              const snap = findSnapPoint(
                { x: endPt[0], y: endPt[1] },
                target,
                RESNAP_DIST,
              );
              if (snap) {
                data.endBinding = {
                  expressionId: id,
                  anchor: snap.anchor as ArrowAnchor,
                  ratio: snap.ratio,
                };
                data.points[data.points.length - 1] = [
                  snap.point.x,
                  snap.point.y,
                ];
                break;
              }
            }
          }

          for (const move of allowedMoves) {
            const operation = createOperation("move", {
              type: "move",
              expressionId: move.id,
              from: move.from,
              to: move.to,
            });
            pushOperation(state.operationLog, operation);
          }

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      transformExpression: (
        id: string,
        original: {
          position: { x: number; y: number };
          size: { width: number; height: number };
        },
        final: {
          position: { x: number; y: number };
          size: { width: number; height: number };
        },
      ) => {
        const currentState = get();
        const target = currentState.expressions[id];
        if (!target) return;
        if (isOnLockedLayer(currentState, target)) return;

        // Build a snapshot reflecting pre-resize state.
        const snapshot = captureSnapshot(currentState);
        const snapshotExpr = snapshot.expressions[id];
        if (snapshotExpr) {
          snapshotExpr.position = { ...original.position };
          snapshotExpr.size = { ...original.size };
        }
        historyManager.pushSnapshot(snapshot);

        set((state) => {
          const expr = state.expressions[id];
          if (!expr) return;

          expr.position = { ...final.position };
          expr.size = { ...final.size };

          // Update arrows bound to the resized shape [CLEAN-CODE]
          updateBoundArrows(state, new Set([id]));

          const operation = createOperation("transform", {
            type: "transform",
            expressionId: id,
            size: final.size,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      setLastUsedStyle: (style: Partial<ExpressionStyle>) => {
        set((state) => {
          // Strip empty strings to avoid tainting lastUsedStyle with invalid values
          const clean: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(style)) {
            if (v !== "") clean[k] = v;
          }
          state.lastUsedStyle = {
            ...state.lastUsedStyle,
            ...clean,
          } as ExpressionStyle;
        });
      },

      // ── Group/Ungroup actions (#71) ─────────────────────────────

      groupExpressions: (ids: string[]): string => {
        const currentState = get();

        // Filter to only IDs that actually exist and are not on a locked layer
        const validIds = ids.filter((id) => {
          const expr = currentState.expressions[id];
          return expr && !isOnLockedLayer(currentState, expr);
        });
        if (validIds.length < 2) return "";

        // Push snapshot BEFORE mutation for undo support
        historyManager.pushSnapshot(captureSnapshot(currentState));

        const groupId = nanoid();

        set((state) => {
          for (const id of validIds) {
            const expr = state.expressions[id];
            if (expr) {
              expr.parentId = groupId;
            }
          }

          const operation = createOperation("group", {
            type: "group",
            expressionIds: [...validIds],
            groupId,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });

        return groupId;
      },

      ungroupExpressions: (groupId: string) => {
        const currentState = get();

        // Find all expressions with this parentId, excluding those on locked layers
        const memberIds = Object.keys(currentState.expressions).filter((id) => {
          const expr = currentState.expressions[id];
          return (
            expr?.parentId === groupId && !isOnLockedLayer(currentState, expr)
          );
        });
        if (memberIds.length === 0) return;

        // Push snapshot BEFORE mutation for undo support
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          for (const id of memberIds) {
            const expr = state.expressions[id];
            if (expr) {
              delete expr.parentId;
            }
          }

          const operation = createOperation("ungroup", {
            type: "ungroup",
            groupId,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      getGroupMembers: (groupId: string): string[] => {
        const { expressions } = get();
        return Object.keys(expressions).filter(
          (id) => expressions[id]?.parentId === groupId,
        );
      },

      expandSelectionToGroups: (ids: Set<string>): Set<string> => {
        const { expressions } = get();
        const expanded = new Set(ids);

        for (const id of ids) {
          const parentId = expressions[id]?.parentId;
          if (!parentId) continue;

          // Add all siblings in the same group
          for (const [otherId, otherExpr] of Object.entries(expressions)) {
            if (otherExpr.parentId === parentId) {
              expanded.add(otherId);
            }
          }
        }

        return expanded;
      },

      duplicateGrouped: (ids: Set<string>): string[] => {
        const currentState = get();
        const { expressions } = currentState;
        const OFFSET = 20;

        // Map old groupId → new groupId for preserving group structure
        const groupMapping = new Map<string, string>();
        const newIds: string[] = [];

        for (const id of ids) {
          const expr = expressions[id];
          if (!expr) continue;

          const newId = nanoid();
          const duplicate = structuredClone(expr) as VisualExpression;
          duplicate.id = newId;
          duplicate.position = {
            x: expr.position.x + OFFSET,
            y: expr.position.y + OFFSET,
          };
          duplicate.meta = {
            ...duplicate.meta,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Preserve group structure with new groupId
          if (expr.parentId) {
            if (!groupMapping.has(expr.parentId)) {
              groupMapping.set(expr.parentId, nanoid());
            }
            duplicate.parentId = groupMapping.get(expr.parentId);
          }

          get().addExpression(duplicate);
          newIds.push(newId);
        }

        return newIds;
      },

      bringToFront: (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => {
          const rest = state.expressionOrder.filter((id) => !idSet.has(id));
          const moved = state.expressionOrder.filter((id) => idSet.has(id));
          state.expressionOrder = [...rest, ...moved];
        });
      },

      sendToBack: (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => {
          const rest = state.expressionOrder.filter((id) => !idSet.has(id));
          const moved = state.expressionOrder.filter((id) => idSet.has(id));
          state.expressionOrder = [...moved, ...rest];
        });
      },

      bringForward: (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => {
          const order = [...state.expressionOrder];
          // For each target, find the next overlapping non-target and jump past it
          for (let i = order.length - 2; i >= 0; i--) {
            if (!idSet.has(order[i]!)) continue;
            const expr = state.expressions[order[i]!];
            if (!expr) continue;
            // Find next non-target that overlaps
            for (let j = i + 1; j < order.length; j++) {
              if (idSet.has(order[j]!)) continue;
              const other = state.expressions[order[j]!];
              if (other && rectsOverlap(expr, other)) {
                // Move target to just after this overlapping object
                const [moved] = order.splice(i, 1);
                order.splice(j, 0, moved!);
                break;
              }
            }
          }
          state.expressionOrder = order;
        });
      },

      sendBackward: (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => {
          const order = [...state.expressionOrder];
          // For each target, find the previous overlapping non-target and jump before it
          for (let i = 1; i < order.length; i++) {
            if (!idSet.has(order[i]!)) continue;
            const expr = state.expressions[order[i]!];
            if (!expr) continue;
            // Find previous non-target that overlaps
            for (let j = i - 1; j >= 0; j--) {
              if (idSet.has(order[j]!)) continue;
              const other = state.expressions[order[j]!];
              if (other && rectsOverlap(expr, other)) {
                // Move target to just before this overlapping object
                const [moved] = order.splice(i, 1);
                order.splice(j, 0, moved!);
                break;
              }
            }
          }
          state.expressionOrder = order;
        });
      },

      // ── Presentation mode (UI-only — NO operations, NO snapshots) ──

      addWaypoint: (waypoint?: CameraWaypoint) => {
        const { camera } = get();
        waypointCounter += 1;
        const defaultLabel = `View ${waypointCounter}`;
        const wp: CameraWaypoint = waypoint
          ? { ...waypoint, label: waypoint.label ?? defaultLabel }
          : {
              x: camera.x,
              y: camera.y,
              zoom: camera.zoom,
              label: defaultLabel,
            };
        set((state) => {
          state.waypoints.push(wp);
        });
      },

      updateWaypoint: (index: number, partial: Partial<CameraWaypoint>) => {
        const { waypoints } = get();
        if (index < 0 || index >= waypoints.length) return;
        set((state) => {
          const wp = state.waypoints[index]!;
          if (partial.x !== undefined) wp.x = partial.x;
          if (partial.y !== undefined) wp.y = partial.y;
          if (partial.zoom !== undefined) wp.zoom = partial.zoom;
          if (partial.label !== undefined) wp.label = partial.label;
        });
      },

      removeWaypoint: (index: number) => {
        const { waypoints } = get();
        if (index < 0 || index >= waypoints.length) return;
        set((state) => {
          state.waypoints.splice(index, 1);
          // Reset presentation index if the active waypoint was removed
          if (state.presentationIndex >= state.waypoints.length) {
            state.presentationIndex = -1;
          } else if (state.presentationIndex === index) {
            state.presentationIndex = -1;
          }
        });
      },

      reorderWaypoints: (fromIndex: number, toIndex: number) => {
        const { waypoints } = get();
        if (fromIndex < 0 || fromIndex >= waypoints.length) return;
        if (toIndex < 0 || toIndex >= waypoints.length) return;
        if (fromIndex === toIndex) return;
        set((state) => {
          const [moved] = state.waypoints.splice(fromIndex, 1);
          state.waypoints.splice(toIndex, 0, moved!);
          // Adjust presentation index to follow the active waypoint
          if (state.presentationIndex === fromIndex) {
            state.presentationIndex = toIndex;
          } else if (
            fromIndex < state.presentationIndex &&
            toIndex >= state.presentationIndex
          ) {
            state.presentationIndex -= 1;
          } else if (
            fromIndex > state.presentationIndex &&
            toIndex <= state.presentationIndex
          ) {
            state.presentationIndex += 1;
          }
        });
      },

      clearWaypoints: () => {
        waypointCounter = 0;
        set((state) => {
          state.waypoints = [];
          state.presentationIndex = -1;
        });
      },

      goToWaypoint: (index: number) => {
        const { waypoints } = get();
        if (index < 0 || index >= waypoints.length) return;
        const wp = waypoints[index]!;
        set((state) => {
          state.presentationIndex = index;
          state.camera = {
            x: wp.x,
            y: wp.y,
            zoom: Math.max(MIN_ZOOM, Math.min(wp.zoom, MAX_ZOOM)),
          };
        });
      },

      nextWaypoint: () => {
        const { waypoints, presentationIndex } = get();
        if (waypoints.length === 0) return;
        const nextIndex =
          presentationIndex < 0
            ? 0
            : (presentationIndex + 1) % waypoints.length;
        const wp = waypoints[nextIndex]!;
        set((state) => {
          state.presentationIndex = nextIndex;
          state.camera = {
            x: wp.x,
            y: wp.y,
            zoom: Math.max(MIN_ZOOM, Math.min(wp.zoom, MAX_ZOOM)),
          };
        });
      },

      prevWaypoint: () => {
        const { waypoints, presentationIndex } = get();
        if (waypoints.length === 0) return;
        const prevIndex =
          presentationIndex < 0
            ? waypoints.length - 1
            : (presentationIndex - 1 + waypoints.length) % waypoints.length;
        const wp = waypoints[prevIndex]!;
        set((state) => {
          state.presentationIndex = prevIndex;
          state.camera = {
            x: wp.x,
            y: wp.y,
            zoom: Math.max(MIN_ZOOM, Math.min(wp.zoom, MAX_ZOOM)),
          };
        });
      },

      exitPresentation: () => {
        set((state) => {
          state.presentationIndex = -1;
        });
      },

      setWaypointPanelOpen: (open: boolean) => {
        set((state) => {
          state.waypointPanelOpen = open;
        });
      },

      // ── Grid & snap actions (UI-only, no operations or snapshots) ──

      toggleGrid: () => {
        set((state) => {
          state.gridVisible = !state.gridVisible;
        });
      },

      setGridType: (type: "dot" | "line") => {
        set((state) => {
          state.gridType = type;
        });
      },

      setGridSize: (size: number) => {
        if (size <= 0 || !Number.isFinite(size)) return;
        set((state) => {
          state.gridSize = Math.max(5, Math.min(size, 200));
        });
      },

      toggleSnapEnabled: () => {
        set((state) => {
          state.snapEnabled = !state.snapEnabled;
        });
      },

      // ── Page/paper boundary actions (UI-only, no operations or snapshots) ──

      togglePage: () => {
        set((state) => {
          state.pageVisible = !state.pageVisible;
        });
      },

      setPageSize: (size: { width: number; height: number }) => {
        if (
          !Number.isFinite(size.width) ||
          size.width <= 0 ||
          !Number.isFinite(size.height) ||
          size.height <= 0
        )
          return;
        set((state) => {
          state.pageSize = { width: size.width, height: size.height };
        });
      },

      // ── Layer actions (UI-only — NO operations, NO snapshots) ─────

      addLayer: (name?: string): string => {
        const { layers } = get();
        // Enforce layer cap [CLEAN-CODE]
        if (layers.length >= MAX_LAYERS) return "";

        layerCounter += 1;
        const id = nanoid();
        const maxOrder = layers.reduce((max, l) => Math.max(max, l.order), -1);
        const rawName = name ?? `Layer ${layerCounter}`;
        const layerName = rawName.slice(0, MAX_LAYER_NAME_LENGTH);

        set((state) => {
          state.layers.push({
            id,
            name: layerName,
            visible: true,
            locked: false,
            order: maxOrder + 1,
          });
        });

        return id;
      },

      removeLayer: (layerId: string) => {
        // Cannot remove the default layer
        if (layerId === DEFAULT_LAYER_ID) return;

        const { layers } = get();
        if (!layers.find((l) => l.id === layerId)) return;

        set((state) => {
          // Move all expressions from the deleted layer to the default layer
          for (const expr of Object.values(state.expressions)) {
            if (expr.layerId === layerId) {
              expr.layerId = DEFAULT_LAYER_ID;
            }
          }

          // Remove the layer
          state.layers = state.layers.filter((l) => l.id !== layerId);

          // Reset active layer if it was removed
          if (state.activeLayerId === layerId) {
            state.activeLayerId = DEFAULT_LAYER_ID;
          }
        });
      },

      renameLayer: (layerId: string, name: string) => {
        const truncated = name.slice(0, MAX_LAYER_NAME_LENGTH);
        set((state) => {
          const layer = state.layers.find((l) => l.id === layerId);
          if (layer) {
            layer.name = truncated;
          }
        });
      },

      toggleLayerVisibility: (layerId: string) => {
        set((state) => {
          const layer = state.layers.find((l) => l.id === layerId);
          if (layer) {
            layer.visible = !layer.visible;
          }
        });
      },

      toggleLayerLock: (layerId: string) => {
        set((state) => {
          const layer = state.layers.find((l) => l.id === layerId);
          if (layer) {
            layer.locked = !layer.locked;
          }
        });
      },

      setActiveLayer: (layerId: string) => {
        const { layers } = get();
        if (!layers.find((l) => l.id === layerId)) return;
        set((state) => {
          state.activeLayerId = layerId;
        });
      },

      reorderLayers: (layerIds: string[]) => {
        const { layers } = get();
        // Validate: all provided IDs must match existing layers
        const existingIds = new Set(layers.map((l) => l.id));
        const allValid = layerIds.every((id) => existingIds.has(id));
        if (!allValid || layerIds.length !== layers.length) return;

        set((state) => {
          // Reorder layers and reassign order values
          const layerMap = new Map(state.layers.map((l) => [l.id, l]));
          state.layers = layerIds.map((id, index) => {
            const layer = layerMap.get(id)!;
            layer.order = index;
            return layer;
          });
        });
      },

      moveToLayer: (expressionIds: string[], layerId: string) => {
        const { layers } = get();

        // Validate target layer exists
        if (!layers.find((l) => l.id === layerId)) return;

        set((state) => {
          for (const id of expressionIds) {
            const expr = state.expressions[id];
            if (!expr) continue;
            // Skip locked expressions
            if (expr.meta.locked) continue;
            expr.layerId = layerId;
          }
        });
      },

      // ── Container actions (#112) ──────────────────────────────

      createContainer: (
        title: string,
        position: { x: number; y: number },
        size: { width: number; height: number },
      ): string => {
        const currentState = get();
        const containerId = nanoid();
        const now = Date.now();

        const containerData: ContainerData = {
          kind: "container",
          title,
          headerHeight: 40,
          padding: 20,
          collapsed: false,
        };

        const expression: VisualExpression = {
          id: containerId,
          kind: "container",
          position: { ...position },
          size: { ...size },
          angle: 0,
          style: { ...DEFAULT_EXPRESSION_STYLE },
          meta: {
            author: SYSTEM_AUTHOR,
            createdAt: now,
            updatedAt: now,
            tags: [],
            locked: false,
          },
          data: containerData,
        };

        // Validate before adding
        const result = visualExpressionSchema.safeParse(expression);
        if (!result.success) {
          console.warn(
            "[canvasStore] Invalid container expression rejected:",
            result.error.issues,
          );
          return "";
        }

        // Push snapshot for undo
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          const layeredExpr = expression.layerId
            ? expression
            : { ...expression, layerId: state.activeLayerId };
          state.expressions[layeredExpr.id] = layeredExpr;
          state.expressionOrder.push(layeredExpr.id);

          const operation = createOperation("create", {
            type: "create",
            expressionId: containerId,
            kind: "container",
            position: expression.position,
            size: expression.size,
            data: expression.data,
            style: expression.style,
            angle: 0,
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });

        return containerId;
      },

      toggleContainerCollapse: (id: string) => {
        const currentState = get();
        const expr = currentState.expressions[id];
        if (!expr || expr.kind !== "container") return;

        // Push snapshot for undo
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          const container = state.expressions[id];
          if (!container || container.data.kind !== "container") return;

          const data = container.data as ContainerData;
          data.collapsed = !data.collapsed;
          container.meta.updatedAt = Date.now();

          const operation = createOperation("update", {
            type: "update",
            expressionId: id,
            changes: { data: { ...data } },
          });
          pushOperation(state.operationLog, operation);

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });
      },

      autoParentOnDrop: (expressionId: string) => {
        const currentState = get();
        const expr = currentState.expressions[expressionId];
        if (!expr) return;

        // Find all containers that fully contain this expression
        const containers: VisualExpression[] = [];
        for (const [id, candidate] of Object.entries(
          currentState.expressions,
        )) {
          if (id === expressionId) continue;
          if (candidate.kind !== "container") continue;

          // #112 Fix #2: Skip collapsed containers — user can't see the parenting
          const candidateData = candidate.data as ContainerData;
          if (candidateData.collapsed) continue;

          // Check if the expression is inside the container body bounds
          const cX = candidate.position.x;
          const cY = candidate.position.y;
          const cW = candidate.size.width;
          const cH = candidate.size.height;

          if (
            expr.position.x >= cX &&
            expr.position.y >= cY &&
            expr.position.x + expr.size.width <= cX + cW &&
            expr.position.y + expr.size.height <= cY + cH
          ) {
            containers.push(candidate);
          }
        }

        if (containers.length === 0) return;

        // Pick the smallest container (innermost nesting)
        const smallest = containers.reduce((best, c) => {
          const bestArea = best.size.width * best.size.height;
          const cArea = c.size.width * c.size.height;
          return cArea < bestArea ? c : best;
        });

        // Already parented to this container — no-op
        if (expr.parentId === smallest.id) return;

        // #112 Fix #4: Prevent circular parenting (A → B → A cycle)
        let ancestor: string | undefined = smallest.parentId;
        while (ancestor) {
          if (ancestor === expressionId) return; // cycle detected
          ancestor = currentState.expressions[ancestor]?.parentId;
        }

        // #112 Fix #1: Push undo snapshot and emit protocol operation
        historyManager.pushSnapshot(captureSnapshot(currentState));

        set((state) => {
          const target = state.expressions[expressionId];
          if (target) {
            target.parentId = smallest.id;

            const changes: Record<string, unknown> = { parentId: smallest.id };
            const operation = createOperation("update", {
              type: "update",
              expressionId,
              changes,
            });
            pushOperation(state.operationLog, operation);

            state.canUndo = historyManager.canUndo();
            state.canRedo = historyManager.canRedo();
          }
        });
      },

      autoUnparentOnDrag: (expressionId: string) => {
        const currentState = get();
        const expr = currentState.expressions[expressionId];
        if (!expr || !expr.parentId) return;

        const parent = currentState.expressions[expr.parentId];
        if (!parent) {
          // Parent no longer exists — clear the reference
          historyManager.pushSnapshot(captureSnapshot(currentState));

          set((state) => {
            const target = state.expressions[expressionId];
            if (target) {
              delete target.parentId;

              const changes: Record<string, unknown> = { parentId: undefined };
              const operation = createOperation("update", {
                type: "update",
                expressionId,
                changes,
              });
              pushOperation(state.operationLog, operation);

              state.canUndo = historyManager.canUndo();
              state.canRedo = historyManager.canRedo();
            }
          });
          return;
        }

        // Check if the expression is still inside the parent container bounds
        const pX = parent.position.x;
        const pY = parent.position.y;
        const pW = parent.size.width;
        const pH = parent.size.height;

        const isInside =
          expr.position.x >= pX &&
          expr.position.y >= pY &&
          expr.position.x + expr.size.width <= pX + pW &&
          expr.position.y + expr.size.height <= pY + pH;

        if (!isInside) {
          // #112 Fix #1: Push undo snapshot and emit protocol operation
          historyManager.pushSnapshot(captureSnapshot(currentState));

          set((state) => {
            const target = state.expressions[expressionId];
            if (target) {
              delete target.parentId;

              const changes: Record<string, unknown> = { parentId: undefined };
              const operation = createOperation("update", {
                type: "update",
                expressionId,
                changes,
              });
              pushOperation(state.operationLog, operation);

              state.canUndo = historyManager.canUndo();
              state.canRedo = historyManager.canRedo();
            }
          });
        }
      },

      applyLayout: (options: LayoutOptions, scope: "all" | "selected") => {
        const currentState = get();
        const { expressions, selectedIds, layers } = currentState;

        // Determine which expressions to layout
        const visibleLayerIds = new Set(
          layers.filter((l) => l.visible).map((l) => l.id),
        );
        const lockedLayerIds = new Set(
          layers.filter((l) => l.locked).map((l) => l.id),
        );

        const candidates = Object.values(expressions).filter((expr) => {
          // Scope filter
          if (scope === "selected" && !selectedIds.has(expr.id)) return false;
          // Skip locked expressions
          if (expr.meta.locked) return false;
          // Skip expressions on locked layers
          const layerId = expr.layerId ?? DEFAULT_LAYER_ID;
          if (lockedLayerIds.has(layerId)) return false;
          // Skip expressions on hidden layers
          if (!visibleLayerIds.has(layerId)) return false;
          return true;
        });

        if (candidates.length === 0) return 0;

        // Compute new positions using the layout algorithm
        const positionMap = computeLayout(candidates, options);

        if (positionMap.size === 0) return 0;

        // Build moves array (only for positions that actually changed)
        const moves: Array<{
          id: string;
          from: { x: number; y: number };
          to: { x: number; y: number };
        }> = [];
        for (const [id, newPos] of positionMap) {
          const expr = expressions[id];
          if (!expr) continue;
          if (expr.position.x === newPos.x && expr.position.y === newPos.y)
            continue;
          moves.push({
            id,
            from: { x: expr.position.x, y: expr.position.y },
            to: newPos,
          });
        }

        if (moves.length === 0) return 0;

        // Push undo snapshot before applying changes
        const snapshot = captureSnapshot(currentState);
        historyManager.pushSnapshot(snapshot);

        set((state) => {
          const movedIds = new Set(moves.map((m) => m.id));

          for (const move of moves) {
            const expr = state.expressions[move.id];
            if (!expr) continue;

            const dx = move.to.x - move.from.x;
            const dy = move.to.y - move.from.y;
            expr.position = { ...move.to };
            translateExpressionPoints(expr, dx, dy);
          }

          // Update arrows bound to moved shapes
          updateBoundArrows(state, movedIds);

          // Emit move operations for collaboration
          for (const move of moves) {
            const operation = createOperation("move", {
              type: "move",
              expressionId: move.id,
              from: move.from,
              to: move.to,
            } satisfies MovePayload);
            pushOperation(state.operationLog, operation);
          }

          state.canUndo = historyManager.canUndo();
          state.canRedo = historyManager.canRedo();
        });

        return moves.length;
      },

      // ── Arrow data mutation (emit ProtocolOperation + push snapshot) ──

      updateArrowData: (expressionId: string, updates: Partial<ArrowData>) => {
        const currentState = get();
        const existing = currentState.expressions[expressionId];
        if (!existing) return;

        // Only operate on arrow expressions
        if (existing.kind !== "arrow") return;

        // S5-3: Skip locked expressions
        if (existing.meta.locked) return;

        // Delegate to updateExpression — it handles snapshot + validation + operation
        const mergedData = { ...existing.data, ...updates } as ArrowData;
        get().updateExpression(expressionId, { data: mergedData });

        // Update defaultArrowStyle to remember choices for the next arrow
        set((state) => {
          if (updates.routing !== undefined) {
            state.defaultArrowStyle.routing =
              updates.routing as DefaultArrowStyle["routing"];
          }
          if (
            updates.startArrowhead !== undefined &&
            typeof updates.startArrowhead === "string"
          ) {
            state.defaultArrowStyle.startArrowhead = updates.startArrowhead;
          }
          if (
            updates.endArrowhead !== undefined &&
            typeof updates.endArrowhead === "string"
          ) {
            state.defaultArrowStyle.endArrowhead = updates.endArrowhead;
          }
        });
      },

      setDefaultArrowStyle: (style: Partial<DefaultArrowStyle>) => {
        set((state) => {
          Object.assign(state.defaultArrowStyle, style);
        });
      },

      applyTheme: (themeId: string, scope: "all" | "selected") => {
        const theme = getThemeById(themeId);
        if (!theme) return;

        const currentState = get();
        const targetIds =
          scope === "selected"
            ? [...currentState.selectedIds]
            : currentState.expressionOrder;

        const targetExprs = targetIds
          .map((id) => currentState.expressions[id])
          .filter(Boolean) as VisualExpression[];

        if (targetExprs.length === 0) return;

        const themed = applyThemeToExpressions(targetExprs, theme);
        for (const expr of themed) {
          get().styleExpressions([expr.id], expr.style);
        }
      },
    })),
  );

  // Track counters for test helpers
  _lastWaypointCounter = waypointCounter;
  _lastLayerCounter = layerCounter;

  return store as unknown as CanvasStoreApi;
}

// ── React context + hooks ────────────────────────────────────

export const CanvasStoreContext = createContext<CanvasStoreApi | null>(null);

export function CanvasStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<CanvasStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createCanvasStore();
  }
  return createElement(
    CanvasStoreContext.Provider,
    { value: storeRef.current },
    children,
  );
}

export function useCanvasStore<T>(
  selector: (state: CanvasState & CanvasActions) => T,
): T {
  const store = useContext(CanvasStoreContext);
  if (!store)
    throw new Error("useCanvasStore must be used within a CanvasStoreProvider");
  return useStore(store, selector);
}

export function useCanvasStoreApi(): CanvasStoreApi {
  const store = useContext(CanvasStoreContext);
  if (!store)
    throw new Error(
      "useCanvasStoreApi must be used within a CanvasStoreProvider",
    );
  return store;
}

/**
 * Reset waypoint counter. Exported for test cleanup only.
 * @internal
 */
export function _resetWaypointCounter(): void {
  void _lastWaypointCounter;
  _lastWaypointCounter = 0;
}

/**
 * Reset layer counter. Exported for test cleanup only.
 * @internal
 */
export function _resetLayerCounter(): void {
  void _lastLayerCounter;
  _lastLayerCounter = 1;
}
