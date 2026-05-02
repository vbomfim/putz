/**
 * Manipulation interaction hook — move and resize.
 *
 * Integrates with canvas pointer events when the Select tool is active:
 * - **Move** (AC1, AC2): Drag selected shape body → move all selected
 *   shapes maintaining relative positions. Emit `move` ProtocolOperation
 *   on pointerup.
 * - **Resize corner** (AC3): Drag corner handle → free resize.
 *   Shift = constrain aspect ratio. Emit `transform` operation.
 * - **Resize edge** (AC4): Drag edge midpoint → one-dimension resize.
 * - **Resize minimum** (AC5): Cannot resize below 10×10 world units.
 * - **Locked guard** (AC8): Locked shapes are no-ops for move/resize.
 * - **Move preview** (AC9): Real-time drag via transient state; commit on
 *   pointerup only.
 * - **Cursor feedback** (AC10): `move` on body, resize arrows on handles.
 *
 * Keyboard shortcuts (delete, duplicate) are handled centrally by
 * useKeyboardShortcuts.
 *
 * @module
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type {
  VisualExpression,
  ArrowBinding,
  ArrowData,
  ArrowAnchor,
} from "../../protocol";
import { useCanvasStoreApi } from "../store/canvasStore";
import { screenToWorld } from "../camera";
import {
  findSnapPoint,
  findBoundArrows,
  getAnchorPoint,
} from "../interaction/connectorHelpers";
import {
  detectPointerTarget,
  computeResize,
  computePointDrag,
  getCursorForTarget,
  isPointBasedKind,
  getSegmentMidpointHandles,
} from "../interaction/manipulationHelpers";
import type {
  HandleHit,
  PointHandleHit,
  JettyHandleHit,
  SegmentHandleHit,
} from "../interaction/manipulationHelpers";
import { computeSnappedDelta } from "../utils/snapToGrid";

export interface ManipulationInteraction {
  /** Current cursor style based on pointer target. */
  cursor: string;
}

/** Drag mode for the current manipulation. */
type DragMode =
  | { kind: "none" }
  | {
      kind: "move";
      /** Original positions of all selected expressions before drag started. */
      originalPositions: Map<string, { x: number; y: number }>;
      /** World position where drag started. */
      startWorld: { x: number; y: number };
    }
  | {
      kind: "resize";
      /** Handle being dragged. */
      handle: HandleHit;
      /** Original expression bounds before resize. */
      originalPosition: { x: number; y: number };
      originalSize: { width: number; height: number };
      /** World position where drag started. */
      startWorld: { x: number; y: number };
    }
  | {
      kind: "point-drag";
      /** Point handle being dragged. */
      handle: PointHandleHit;
      /** Original points array before drag started. */
      originalPoints: [number, number][];
      /** Original expression bounds before drag. */
      originalPosition: { x: number; y: number };
      originalSize: { width: number; height: number };
      /** World position where drag started. */
      startWorld: { x: number; y: number };
    }
  | {
      kind: "jetty-drag";
      /** Jetty handle being dragged. */
      handle: JettyHandleHit;
      /** Original midpointOffset before drag started. */
      originalMidpointOffset: number;
      /** Original jettySize for range computation. */
      originalJettySize: number;
      /** Whether this is a Z-shape drag (midpointOffset) vs exit-stub drag. */
      isZShape: boolean;
      /** World position where drag started. */
      startWorld: { x: number; y: number };
    }
  | {
      kind: "segment-drag";
      /** Segment handle being dragged. */
      handle: SegmentHandleHit;
      /** Original waypoints array before drag started. */
      originalWaypoints: number[];
      /** World position where drag started. */
      startWorld: { x: number; y: number };
    };

/**
 * Hook for shape manipulation interactions on the canvas.
 *
 * Attaches pointer and keyboard event handlers.
 * Only active when the current tool is 'select'.
 */
export function useManipulationInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): ManipulationInteraction {
  const storeApi = useCanvasStoreApi();
  const [cursor, setCursor] = useState("default");
  const dragModeRef = useRef<DragMode>({ kind: "none" });

  // ── Pointer handlers ───────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const state = storeApi.getState();
      if (state.activeTool !== "select") return;
      if (e.button !== 0) return;

      const { camera, expressions, selectedIds } = state;
      const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);

      // Detect target: handle or body of a selected expression
      const target = detectPointerTarget(
        worldPoint,
        expressions,
        selectedIds,
        camera,
      );

      if (target.kind === "point-handle") {
        const expr = expressions[target.handle.expressionId];
        if (!expr || expr.meta.locked) return; // AC8: locked guard

        // Extract points from the expression data
        const data = expr.data as {
          points: [number, number][] | [number, number, number][];
        };
        const originalPoints: [number, number][] = data.points.map(
          (p) => [p[0], p[1]] as [number, number],
        );

        dragModeRef.current = {
          kind: "point-drag",
          handle: target.handle,
          originalPoints,
          originalPosition: { ...expr.position },
          originalSize: { ...expr.size },
          startWorld: worldPoint,
        };

        // Track arrow endpoint drag state for renderer
        if (expr.data.kind === "arrow") {
          isDraggingArrowEndpoint = true;
          currentDragSnapPoint = null;
        }
      } else if (target.kind === "jetty-handle") {
        const expr = expressions[target.handle.expressionId];
        if (!expr || expr.meta.locked) return; // AC8: locked guard

        const data = expr.data as ArrowData;
        const originalJettySize =
          typeof data.jettySize === "number" ? data.jettySize : 20;
        const originalMidpointOffset =
          typeof (data as ArrowData & { midpointOffset?: number })
            .midpointOffset === "number"
            ? (data as ArrowData & { midpointOffset?: number }).midpointOffset!
            : 0.5;

        // Z-shape handle always has a direction — use it for drag computation
        const isZShape = target.handle.adjustsMidpoint !== false;

        dragModeRef.current = {
          kind: "jetty-drag",
          handle: target.handle,
          originalMidpointOffset,
          originalJettySize,
          isZShape,
          startWorld: worldPoint,
        };
      } else if (target.kind === "segment-handle") {
        const expr = expressions[target.handle.expressionId];
        if (!expr || expr.meta.locked) return;

        const data = expr.data as ArrowData;
        // Seed waypoints from current handle positions so dragging slot 1 before
        // slot 0 doesn't clobber slot 0 with a default 0.
        const currentHandles = getSegmentMidpointHandles(expr, expressions);
        const seeded: number[] = data.waypoints ? [...data.waypoints] : [];
        for (const h of currentHandles) {
          if (seeded[h.segmentIndex] === undefined) {
            seeded[h.segmentIndex] =
              h.segmentOrientation === "horizontal"
                ? h.position.y
                : h.position.x;
          }
        }

        dragModeRef.current = {
          kind: "segment-drag",
          handle: target.handle,
          originalWaypoints: seeded,
          startWorld: worldPoint,
        };
      } else if (target.kind === "handle") {
        const expr = expressions[target.handle.expressionId];
        if (!expr || expr.meta.locked) return; // AC8: locked guard

        dragModeRef.current = {
          kind: "resize",
          handle: target.handle,
          originalPosition: { ...expr.position },
          originalSize: { ...expr.size },
          startWorld: worldPoint,
        };
      } else if (target.kind === "body") {
        // Expand selection to include all group members
        const expandedIds = storeApi
          .getState()
          .expandSelectionToGroups(selectedIds);

        // Check if ALL expanded expressions are locked
        const allLocked = Array.from(expandedIds).every(
          (id) => expressions[id]?.meta.locked,
        );
        if (allLocked) return; // AC8: locked guard

        // Capture original positions of all expanded (unlocked) expressions
        const originalPositions = new Map<string, { x: number; y: number }>();
        for (const id of expandedIds) {
          const expr = expressions[id];
          if (expr && !expr.meta.locked) {
            originalPositions.set(id, { ...expr.position });
          }
        }

        dragModeRef.current = {
          kind: "move",
          originalPositions,
          startWorld: worldPoint,
        };
      }
    },
    [storeApi],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const state = storeApi.getState();
      if (state.activeTool !== "select") return;

      const { camera, expressions, selectedIds } = state;
      const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);
      const drag = dragModeRef.current;

      if (drag.kind === "move") {
        // ── Transient move preview (AC9) ────────────────────
        let dx = worldPoint.x - drag.startWorld.x;
        let dy = worldPoint.y - drag.startWorld.y;

        // Snap delta to grid when snap-to-grid is enabled
        if (state.snapEnabled) {
          ({ dx, dy } = computeSnappedDelta(
            dx,
            dy,
            drag.originalPositions,
            state.gridSize,
          ));
        }

        storeApi.setState((draft) => {
          const movedIds = new Set<string>();
          for (const [id, orig] of drag.originalPositions) {
            const expr = draft.expressions[id];
            if (expr) {
              expr.position = { x: orig.x + dx, y: orig.y + dy };
              movedIds.add(id);
            }
          }

          // Update bound arrows in real-time during drag
          const processedArrows = new Set<string>();
          for (const targetId of movedIds) {
            const target = draft.expressions[targetId];
            if (!target) continue;

            const arrowIds = findBoundArrows(targetId, draft.expressions);
            for (const arrowId of arrowIds) {
              if (processedArrows.has(arrowId)) continue;
              processedArrows.add(arrowId);
              const arrow = draft.expressions[arrowId];
              if (!arrow || arrow.data.kind !== "arrow") continue;

              const data = arrow.data as ArrowData;
              const points = data.points as [number, number][];
              if (points.length < 2) continue;

              // Resolve both bound shape references for smart routing
              const startTarget = data.startBinding
                ? draft.expressions[data.startBinding.expressionId]
                : null;
              const endTarget = data.endBinding
                ? draft.expressions[data.endBinding.expressionId]
                : null;

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

              // Self-loop: preserve stored anchors
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
              } else {
                if (data.startBinding && startTarget) {
                  const best = findBestAnchorForDrag(
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
                  const best = findBestAnchorForDrag(
                    endTarget,
                    startRef,
                    data.endBinding.anchor,
                    data.endBinding.ratio,
                  );
                  data.endBinding.anchor = best.anchor as ArrowAnchor;
                  data.endBinding.ratio = best.ratio;
                  points[points.length - 1] = [best.point.x, best.point.y];
                }
              }

              // Recalc bounding box
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
                width: Math.max(1, maxX - minX),
                height: Math.max(1, maxY - minY),
              };
            }
          }
        });
      } else if (drag.kind === "resize") {
        // ── Transient resize preview ────────────────────────
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        const resized = computeResize({
          handleType: drag.handle.type,
          deltaX: dx,
          deltaY: dy,
          originalPosition: drag.originalPosition,
          originalSize: drag.originalSize,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey || e.metaKey,
        });

        storeApi.setState((draft) => {
          const expr = draft.expressions[drag.handle.expressionId];
          if (expr) {
            expr.position = resized.position;
            expr.size = resized.size;
          }
        });
      } else if (drag.kind === "point-drag") {
        // ── Transient point-drag preview ────────────────────

        // Check for snap during arrow endpoint drag
        let snapTarget = worldPoint;
        if (isDraggingArrowEndpoint) {
          const snap = findSnapPointForDrag(
            worldPoint,
            storeApi.getState().expressions,
            drag.handle.expressionId,
          );
          if (snap) {
            snapTarget = snap.point;
            currentDragSnapPoint = snap.point;
          } else {
            currentDragSnapPoint = null;
          }
        }

        const result = computePointDrag({
          pointIndex: drag.handle.pointIndex,
          originalPoints: drag.originalPoints,
          newPointPosition: snapTarget,
        });

        storeApi.setState((draft) => {
          const expr = draft.expressions[drag.handle.expressionId];
          if (expr && isPointBasedKind(expr.data.kind)) {
            const data = expr.data as {
              points: [number, number][] | [number, number, number][];
              startBinding?: unknown;
              endBinding?: unknown;
            };
            if (expr.data.kind === "freehand") {
              const freehandPoints = data.points as [number, number, number][];
              const pressure =
                freehandPoints[drag.handle.pointIndex]?.[2] ?? 0.5;
              (data.points as [number, number, number][])[
                drag.handle.pointIndex
              ] = [snapTarget.x, snapTarget.y, pressure];
            } else {
              (data.points as [number, number][])[drag.handle.pointIndex] = [
                snapTarget.x,
                snapTarget.y,
              ];
            }

            // Clear binding immediately so arrow detaches visually during drag
            if (expr.data.kind === "arrow") {
              const isStart = drag.handle.pointIndex === 0;
              const isEnd =
                drag.handle.pointIndex === drag.originalPoints.length - 1;
              if (isStart) data.startBinding = undefined;
              if (isEnd) data.endBinding = undefined;
            }

            expr.position = result.position;
            expr.size = result.size;
          }
        });
      } else if (drag.kind === "jetty-drag") {
        // ── Transient midpointOffset drag preview ─────────────
        // Compute new midpointOffset based on drag along handle direction
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        if (drag.isZShape) {
          // Z-shape: update midpointOffset ratio
          const arrowExpr = expressions[drag.handle.expressionId];
          if (arrowExpr && arrowExpr.data.kind === "arrow") {
            const arrowData = arrowExpr.data as ArrowData;
            const pts = arrowData.points;
            const startPt = pts[0]!;
            const endPt = pts[pts.length - 1]!;
            const jettySize = drag.originalJettySize;

            // Compute range based on direction
            const dirX = drag.handle.direction.x;
            const dirY = drag.handle.direction.y;
            let rangeStart: number;
            let rangeEnd: number;
            let currentPos: number;

            if (Math.abs(dirX) >= Math.abs(dirY)) {
              // Horizontal drag: moving the vertical Z-bar
              rangeStart = startPt[0] + jettySize;
              rangeEnd = endPt[0] - jettySize;
              currentPos = drag.handle.position.x + dx;
            } else {
              // Vertical drag: moving the horizontal Z-bar
              rangeStart = startPt[1] + jettySize;
              rangeEnd = endPt[1] - jettySize;
              currentPos = drag.handle.position.y + dy;
            }

            const range = rangeEnd - rangeStart;
            const newOffset =
              range !== 0
                ? Math.max(
                    0.05,
                    Math.min(0.95, (currentPos - rangeStart) / range),
                  )
                : 0.5;

            storeApi.setState((draft) => {
              const expr = draft.expressions[drag.handle.expressionId];
              if (expr && expr.data.kind === "arrow") {
                (
                  expr.data as ArrowData & { midpointOffset?: number }
                ).midpointOffset = Math.round(newOffset * 100) / 100;
              }
            });
          }
        } else {
          // Non-Z-shape: fallback to jettySize drag
          const dotProduct =
            dx * drag.handle.direction.x + dy * drag.handle.direction.y;
          const newJettySize = Math.max(0, drag.originalJettySize + dotProduct);

          storeApi.setState((draft) => {
            const expr = draft.expressions[drag.handle.expressionId];
            if (expr && expr.data.kind === "arrow") {
              (expr.data as ArrowData).jettySize = Math.round(newJettySize);
            }
          });
        }
      } else if (drag.kind === "segment-drag") {
        // ── Transient segment waypoint drag preview ─────────
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        // Determine drag delta based on segment orientation
        const delta =
          drag.handle.segmentOrientation === "horizontal"
            ? dy // Horizontal segment → drag moves Y
            : dx; // Vertical segment → drag moves X

        // Compute the new waypoint position
        const basePosition =
          drag.handle.segmentOrientation === "horizontal"
            ? drag.handle.position.y
            : drag.handle.position.x;
        const newPosition = Math.round(basePosition + delta);

        // Build updated waypoints array
        const newWaypoints = [...drag.originalWaypoints];
        while (newWaypoints.length <= drag.handle.segmentIndex) {
          newWaypoints.push(0); // Pad if needed
        }
        newWaypoints[drag.handle.segmentIndex] = newPosition;

        storeApi.setState((draft) => {
          const expr = draft.expressions[drag.handle.expressionId];
          if (expr && expr.data.kind === "arrow") {
            (expr.data as ArrowData & { waypoints?: number[] }).waypoints =
              newWaypoints;
          }
        });
      } else {
        // ── Hover cursor feedback (AC10) ────────────────────
        const target = detectPointerTarget(
          worldPoint,
          expressions,
          selectedIds,
          camera,
        );
        setCursor(getCursorForTarget(target));
      }
    },
    [storeApi],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragModeRef.current;
      if (drag.kind === "none") return;

      const state = storeApi.getState();
      const { camera } = state;
      const worldPoint = screenToWorld(e.offsetX, e.offsetY, camera);

      if (drag.kind === "move") {
        let dx = worldPoint.x - drag.startWorld.x;
        let dy = worldPoint.y - drag.startWorld.y;

        // Snap delta to grid when snap-to-grid is enabled
        if (state.snapEnabled) {
          ({ dx, dy } = computeSnappedDelta(
            dx,
            dy,
            drag.originalPositions,
            state.gridSize,
          ));
        }

        // Only commit if there was actual movement
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          const moves = Array.from(drag.originalPositions).map(
            ([id, from]) => ({
              id,
              from,
              to: { x: from.x + dx, y: from.y + dy },
            }),
          );

          state.moveExpressions(moves);

          // TODO (#112): Wire autoParentOnDrop / autoUnparentOnDrag here.
          // After moveExpressions completes, call state.autoParentOnDrop(id) and
          // state.autoUnparentOnDrag(id) for each moved non-container expression
          // to enable automatic container child management. Deferred to a follow-up
          // PR — interaction hook changes need E2E testing (useManipulationInteraction).
        }
      } else if (drag.kind === "resize") {
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          const resized = computeResize({
            handleType: drag.handle.type,
            deltaX: dx,
            deltaY: dy,
            originalPosition: drag.originalPosition,
            originalSize: drag.originalSize,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey || e.metaKey,
          });

          state.transformExpression(
            drag.handle.expressionId,
            { position: drag.originalPosition, size: drag.originalSize },
            { position: resized.position, size: resized.size },
          );
        }
      } else if (drag.kind === "point-drag") {
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          // Check for snap when dragging arrow endpoints
          let snapTarget = worldPoint;
          let newBinding: ArrowBinding | undefined;
          const expr = state.expressions[drag.handle.expressionId];

          if (
            expr &&
            (expr.data.kind === "arrow" || expr.data.kind === "line")
          ) {
            const snap = findSnapPointForDrag(
              worldPoint,
              state.expressions,
              drag.handle.expressionId,
            );
            if (snap) {
              snapTarget = snap.point;
              newBinding = {
                expressionId: snap.targetId,
                anchor: snap.anchor as ArrowBinding["anchor"],
                ratio: snap.ratio,
              };
              currentDragSnapPoint = snap.point;
            } else {
              currentDragSnapPoint = null;
            }
          }

          const result = computePointDrag({
            pointIndex: drag.handle.pointIndex,
            originalPoints: drag.originalPoints,
            newPointPosition: snapTarget,
          });

          if (expr) {
            let updatedData: Record<string, unknown>;

            if (expr.data.kind === "freehand") {
              const freehandData = expr.data as {
                kind: "freehand";
                points: [number, number, number][];
              };
              const newPoints: [number, number, number][] =
                freehandData.points.map(
                  (p) => [p[0], p[1], p[2]] as [number, number, number],
                );
              const pressure = newPoints[drag.handle.pointIndex]?.[2] ?? 0.5;
              newPoints[drag.handle.pointIndex] = [
                snapTarget.x,
                snapTarget.y,
                pressure,
              ];
              updatedData = { ...expr.data, points: newPoints };
            } else {
              updatedData = { ...expr.data, points: result.points };
            }

            // Update bindings for arrow endpoints
            if (expr.data.kind === "arrow") {
              const isStart = drag.handle.pointIndex === 0;
              const isEnd =
                drag.handle.pointIndex === drag.originalPoints.length - 1;
              if (isStart) {
                (updatedData as Record<string, unknown>).startBinding =
                  newBinding ?? undefined;
              }
              if (isEnd) {
                (updatedData as Record<string, unknown>).endBinding =
                  newBinding ?? undefined;
              }
            }

            state.updateExpression(drag.handle.expressionId, {
              data: updatedData as unknown as VisualExpression["data"],
              position: result.position,
              size: result.size,
            });
          }
        }
      } else if (drag.kind === "jetty-drag") {
        // ── Commit midpointOffset or jettySize change ──────────
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        if (drag.isZShape) {
          // Commit midpointOffset
          const expr = state.expressions[drag.handle.expressionId];
          if (expr && expr.data.kind === "arrow") {
            const arrowData = expr.data as ArrowData;
            const pts = arrowData.points;
            const startPt = pts[0]!;
            const endPt = pts[pts.length - 1]!;
            const jettySize = drag.originalJettySize;

            const dirX = drag.handle.direction.x;
            const dirY = drag.handle.direction.y;
            let rangeStart: number;
            let rangeEnd: number;
            let currentPos: number;

            if (Math.abs(dirX) >= Math.abs(dirY)) {
              rangeStart = startPt[0] + jettySize;
              rangeEnd = endPt[0] - jettySize;
              currentPos = drag.handle.position.x + dx;
            } else {
              rangeStart = startPt[1] + jettySize;
              rangeEnd = endPt[1] - jettySize;
              currentPos = drag.handle.position.y + dy;
            }

            const range = rangeEnd - rangeStart;
            const newOffset =
              range !== 0
                ? Math.max(
                    0.05,
                    Math.min(0.95, (currentPos - rangeStart) / range),
                  )
                : 0.5;
            const rounded = Math.round(newOffset * 100) / 100;

            if (rounded !== drag.originalMidpointOffset) {
              state.updateExpression(drag.handle.expressionId, {
                data: {
                  ...expr.data,
                  midpointOffset: rounded,
                } as unknown as VisualExpression["data"],
              });
            }
          }
        } else {
          // Commit jettySize
          const dotProduct =
            dx * drag.handle.direction.x + dy * drag.handle.direction.y;
          const newJettySize = Math.round(
            Math.max(0, drag.originalJettySize + dotProduct),
          );

          if (newJettySize !== drag.originalJettySize) {
            const expr = state.expressions[drag.handle.expressionId];
            if (expr && expr.data.kind === "arrow") {
              state.updateExpression(drag.handle.expressionId, {
                data: {
                  ...expr.data,
                  jettySize: newJettySize,
                } as unknown as VisualExpression["data"],
              });
            }
          }
        }
      } else if (drag.kind === "segment-drag") {
        // ── Commit segment waypoint change ──────────────────
        const dx = worldPoint.x - drag.startWorld.x;
        const dy = worldPoint.y - drag.startWorld.y;

        const delta = drag.handle.segmentOrientation === "horizontal" ? dy : dx;
        const basePosition =
          drag.handle.segmentOrientation === "horizontal"
            ? drag.handle.position.y
            : drag.handle.position.x;
        const newPosition = Math.round(basePosition + delta);

        const newWaypoints = [...drag.originalWaypoints];
        while (newWaypoints.length <= drag.handle.segmentIndex) {
          newWaypoints.push(0);
        }
        newWaypoints[drag.handle.segmentIndex] = newPosition;

        const expr = state.expressions[drag.handle.expressionId];
        if (expr && expr.data.kind === "arrow") {
          state.updateExpression(drag.handle.expressionId, {
            data: {
              ...expr.data,
              waypoints: newWaypoints,
            } as unknown as VisualExpression["data"],
          });
        }
      }

      dragModeRef.current = { kind: "none" };
      isDraggingArrowEndpoint = false;
      currentDragSnapPoint = null;
    },
    [storeApi],
  );

  // ── Effect: attach/detach event listeners ──────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
    };
  }, [canvasRef, handlePointerDown, handlePointerMove, handlePointerUp]);

  return { cursor };
}

const DRAG_SNAP_DISTANCE = 15;

/** Find snap point during endpoint drag, excluding the arrow itself. */
function findSnapPointForDrag(
  worldPoint: { x: number; y: number },
  expressions: Record<string, VisualExpression>,
  excludeId: string,
): {
  point: { x: number; y: number };
  anchor: string;
  targetId: string;
  ratio: number;
} | null {
  let best: {
    point: { x: number; y: number };
    anchor: string;
    targetId: string;
    dist: number;
    ratio: number;
  } | null = null;

  for (const [id, expr] of Object.entries(expressions)) {
    if (id === excludeId) continue;
    const snap = findSnapPoint(worldPoint, expr, DRAG_SNAP_DISTANCE);
    if (snap) {
      const dist = Math.hypot(
        worldPoint.x - snap.point.x,
        worldPoint.y - snap.point.y,
      );
      if (!best || dist < best.dist) {
        best = {
          point: snap.point,
          anchor: snap.anchor,
          targetId: id,
          dist,
          ratio: snap.ratio,
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
      }
    : null;
}

// ── Shared snap state for renderer ──────────────────────────
// Module-level so the render loop can read it without store subscription

/** Current snap point during arrow endpoint drag (null = no snap). */
export let currentDragSnapPoint: { x: number; y: number } | null = null;

/** Whether an arrow endpoint drag is in progress. */
export let isDraggingArrowEndpoint: boolean = false;

/** Find the best anchor on a shape facing toward a target point (smart routing). */
function findBestAnchorForDrag(
  expr: VisualExpression,
  toward: { x: number; y: number },
  currentAnchor?: string,
  currentRatio?: number,
): { anchor: string; point: { x: number; y: number }; ratio: number } {
  const { x, y } = expr.position;
  const { width, height } = expr.size;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const dx = toward.x - cx;
  const dy = toward.y - cy;

  let anchor: string;
  if (Math.abs(dx) > Math.abs(dy)) {
    anchor = dx > 0 ? "right" : "left";
  } else {
    anchor = dy > 0 ? "bottom" : "top";
  }

  // Keep existing ratio if edge didn't change
  let ratio: number;
  if (anchor === currentAnchor && currentRatio !== undefined) {
    ratio = currentRatio;
  } else {
    ratio = 0.5;
  }

  const point = getAnchorPoint(expr, anchor, ratio);
  return { anchor, point, ratio };
}
