/**
 * Tool handler interface and registry.
 *
 * Defines the contract all drawing tools must implement and provides
 * a registry to dispatch pointer events to the active tool.
 *
 * Each tool handles pointer lifecycle (down/move/up) in world coordinates
 * and can produce transient draw previews rendered by the render loop.
 *
 * @module
 */

import type { ToolType } from "../types/index";
import type { ShapeConnectionPoint } from "../connectors/connectionPoints";

/**
 * Transient draw preview state rendered during active tool drag.
 *
 * Displayed as a dashed outline in the render loop and NOT committed
 * to the store until the tool completes (pointerup).
 */
export interface DrawPreview {
  /** The kind of shape being previewed. */
  kind:
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "line"
    | "arrow"
    | "freehand"
    | "sticky-note";
  /** World-space x coordinate. */
  x: number;
  /** World-space y coordinate. */
  y: number;
  /** Preview width (for area shapes). */
  width: number;
  /** Preview height (for area shapes). */
  height: number;
  /** Points for line/arrow/freehand previews. */
  points?: [number, number][];
  /** Snap point for connector preview (arrow tool). */
  snapPoint?: { x: number; y: number };
  /** ID of the shape being snapped to (arrow tool). */
  snapTargetId?: string;
  /** All connection points on the hovered shape for visual feedback. */
  connectionPoints?: ShapeConnectionPoint[];
}

/**
 * Contract that all drawing tool handlers must implement.
 *
 * All coordinates are in world space (already converted via screenToWorld).
 */
export interface ToolHandler {
  /** Called when the pointer is pressed down. */
  onPointerDown(worldX: number, worldY: number, event: PointerEvent): void;
  /** Called when the pointer moves (only during active drag). */
  onPointerMove(worldX: number, worldY: number, event: PointerEvent): void;
  /** Called when the pointer is released. */
  onPointerUp(worldX: number, worldY: number, event: PointerEvent): void;
  /** Cancel the current draw operation (e.g., ESC key). */
  onCancel(): void;
  /** Current transient preview to render, or null if not drawing. */
  getPreview(): DrawPreview | null;
}

/** Registry mapping tool types to their handler instances. */
export type ToolHandlerRegistry = Record<ToolType, ToolHandler | undefined>;

/**
 * Create an empty tool handler registry.
 *
 * The `select` tool has no ToolHandler — it uses the existing
 * selection/manipulation interaction hooks. Only drawing tools
 * need handlers.
 */
export function createToolHandlerRegistry(): ToolHandlerRegistry {
  return {
    select: undefined,
    rectangle: undefined,
    ellipse: undefined,
    diamond: undefined,
    line: undefined,
    arrow: undefined,
    freehand: undefined,
    text: undefined,
    "sticky-note": undefined,
  };
}
