/**
 * Engine type definitions.
 *
 * @module
 */

import type { VisualExpression, ProtocolOperation, ExpressionStyle, Layer, ArrowData, ArrowheadType, RoutingMode } from '../../protocol';

/** Tools available for canvas interaction. */
export type ToolType =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'text'
  | 'sticky-note';

/** Camera state for viewport panning and zooming. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** A saved camera position for presentation mode navigation. */
export interface CameraWaypoint {
  x: number;
  y: number;
  zoom: number;
  label?: string;
}

/** Grid display type — dots or lines. */
export type GridType = 'dot' | 'line';

/** Default style applied to newly created arrows. */
export interface DefaultArrowStyle {
  /** Routing algorithm for the connector path. */
  routing: RoutingMode;
  /** Arrowhead at the start of the arrow. */
  startArrowhead: ArrowheadType | 'none';
  /** Arrowhead at the end of the arrow. */
  endArrowhead: ArrowheadType | 'none';
}

/** Complete canvas state shape managed by Zustand. */
export interface CanvasState {
  /** All expressions on the canvas, keyed by ID. */
  expressions: Record<string, VisualExpression>;
  /** Ordered list of expression IDs representing z-order (back to front). */
  expressionOrder: string[];
  /** Currently selected expression IDs. */
  selectedIds: Set<string>;
  /** The currently active drawing/interaction tool. */
  activeTool: ToolType;
  /** Camera viewport state. */
  camera: Camera;
  /** Saved camera waypoints for presentation mode. */
  waypoints: CameraWaypoint[];
  /** Active waypoint index (-1 = not in presentation mode). */
  presentationIndex: number;
  /** Whether the waypoint panel is open (controls keyboard shortcut behavior). */
  waypointPanelOpen: boolean;
  /** Log of all protocol operations applied to the canvas. */
  operationLog: ProtocolOperation[];
  /** Last style used for drawing — applied to new expressions. */
  lastUsedStyle: ExpressionStyle;
  /** Whether the background grid is visible. */
  gridVisible: boolean;
  /** Grid rendering style: dots or lines. */
  gridType: GridType;
  /** Grid spacing in world units. */
  gridSize: number;
  /** Whether shapes snap to grid intersections during drag. */
  snapEnabled: boolean;
  /** Whether page/paper boundaries are visible. */
  pageVisible: boolean;
  /** Page dimensions in world units (pixels at 96 DPI). */
  pageSize: { width: number; height: number };
  /** All layers on the canvas, ordered by `order` field. */
  layers: Layer[];
  /** ID of the layer where new expressions are created. */
  activeLayerId: string;
  /** Default style applied to newly created arrows. */
  defaultArrowStyle: DefaultArrowStyle;
}

/** Actions available on the canvas store. */
export interface CanvasActions {
  /** Add a new expression to the canvas. Validates with Zod schema. */
  addExpression: (expression: VisualExpression) => void;
  /** Update an existing expression with partial data. */
  updateExpression: (id: string, partial: Partial<VisualExpression>) => void;
  /** Delete one or more expressions by ID. */
  deleteExpressions: (ids: string[]) => void;
  /** Set the currently selected expression IDs. */
  setSelectedIds: (ids: Set<string>) => void;
  /** Set the active tool. */
  setActiveTool: (tool: ToolType) => void;
  /** Set the camera viewport state. */
  setCamera: (camera: Camera) => void;
  /** Undo the last content mutation, restoring previous canvas state. */
  undo: () => void;
  /** Redo the last undone action, restoring next canvas state. */
  redo: () => void;
  /** Whether there are actions to undo. */
  canUndo: boolean;
  /** Whether there are actions to redo. */
  canRedo: boolean;
  /** Reset undo/redo history stacks. */
  clearHistory: () => void;
  /**
   * Apply a remote operation from the gateway without appending to operationLog.
   * Prevents infinite send loops during collaboration.
   */
  applyRemoteOperation: (op: ProtocolOperation) => void;
  /**
   * Replace all canvas state for full state sync on session join.
   * Validates each expression with Zod schema; rejects invalid ones. [S7-1]
   * Clears operationLog and selection.
   */
  replaceState: (expressions: VisualExpression[], expressionOrder: string[]) => void;
  /**
   * Move expressions to new positions. Emits `move` ProtocolOperations.
   * Accepts original positions so undo snapshot reflects pre-drag state.
   */
  moveExpressions: (
    moves: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number } }>,
  ) => void;
  /**
   * Transform an expression (resize). Emits `transform` ProtocolOperation.
   * Accepts original values so undo snapshot reflects pre-drag state.
   */
  transformExpression: (
    id: string,
    original: { position: { x: number; y: number }; size: { width: number; height: number } },
    final: { position: { x: number; y: number }; size: { width: number; height: number } },
  ) => void;
  /**
   * Apply style changes to multiple expressions. Emits `style` ProtocolOperation.
   * Also updates `lastUsedStyle` for new expression defaults.
   */
  styleExpressions: (ids: string[], style: Partial<ExpressionStyle>) => void;
  /**
   * Set the last-used style (merged with existing lastUsedStyle).
   * UI-only — does NOT emit operations.
   */
  setLastUsedStyle: (style: Partial<ExpressionStyle>) => void;
  /**
   * Group multiple expressions under a new group ID.
   * Sets `parentId` on each expression and emits a `group` ProtocolOperation.
   * Requires at least 2 valid (existing) expression IDs.
   * Returns the generated group ID, or empty string if grouping was skipped.
   */
  groupExpressions: (ids: string[]) => string;
  /**
   * Ungroup all expressions belonging to the given group.
   * Clears `parentId` on each member and emits an `ungroup` ProtocolOperation.
   * No-op if no expressions have the given parentId.
   */
  ungroupExpressions: (groupId: string) => void;
  /**
   * Get all expression IDs that share the given parentId (group members).
   * Returns an empty array if no expressions belong to the group.
   */
  getGroupMembers: (groupId: string) => string[];
  /**
   * Expand a selection set to include all group members.
   * For each selected expression with a parentId, adds all siblings to the set.
   */
  expandSelectionToGroups: (ids: Set<string>) => Set<string>;
  /**
   * Duplicate a set of expressions, preserving group structure with new IDs.
   * Returns the IDs of the newly created expressions.
   */
  duplicateGrouped: (ids: Set<string>) => string[];
  /** Move expressions to the front of the z-order (rendered last = on top). */
  bringToFront: (ids: string[]) => void;
  /** Move expressions to the back of the z-order (rendered first = behind). */
  sendToBack: (ids: string[]) => void;
  /** Move expressions one step forward in z-order. */
  bringForward: (ids: string[]) => void;
  /** Move expressions one step backward in z-order. */
  sendBackward: (ids: string[]) => void;
  /** Add a camera waypoint. Snapshots current camera if no argument. */
  addWaypoint: (waypoint?: CameraWaypoint) => void;
  /** Update a waypoint's properties (label, position, zoom). */
  updateWaypoint: (index: number, partial: Partial<CameraWaypoint>) => void;
  /** Remove a waypoint by index. */
  removeWaypoint: (index: number) => void;
  /** Reorder waypoints by moving one from `fromIndex` to `toIndex`. */
  reorderWaypoints: (fromIndex: number, toIndex: number) => void;
  /** Clear all waypoints and exit presentation mode. */
  clearWaypoints: () => void;
  /** Navigate to a specific waypoint by index. */
  goToWaypoint: (index: number) => void;
  /** Advance to the next waypoint (wraps around). */
  nextWaypoint: () => void;
  /** Go to the previous waypoint (wraps around). */
  prevWaypoint: () => void;
  /** Exit presentation mode without clearing waypoints. */
  exitPresentation: () => void;
  /** Set whether the waypoint panel is open. */
  setWaypointPanelOpen: (open: boolean) => void;
  /** Toggle background grid visibility. */
  toggleGrid: () => void;
  /** Set the grid rendering type. */
  setGridType: (type: 'dot' | 'line') => void;
  /** Set the grid spacing in world units. */
  setGridSize: (size: number) => void;
  /** Toggle snap-to-grid for shape dragging. */
  toggleSnapEnabled: () => void;
  /** Toggle page/paper boundary visibility. */
  togglePage: () => void;
  /** Set page dimensions. Rejects non-positive or non-finite values. */
  setPageSize: (size: { width: number; height: number }) => void;
  /** Add a new layer. Returns the new layer's ID. */
  addLayer: (name?: string) => string;
  /** Remove a layer by ID. Moves its expressions to the default layer. Cannot remove the default layer. */
  removeLayer: (layerId: string) => void;
  /** Rename a layer. */
  renameLayer: (layerId: string, name: string) => void;
  /** Toggle a layer's visibility. */
  toggleLayerVisibility: (layerId: string) => void;
  /** Toggle a layer's locked state. */
  toggleLayerLock: (layerId: string) => void;
  /** Set the active layer for new expressions. */
  setActiveLayer: (layerId: string) => void;
  /** Reorder layers by providing the full ordered array of layer IDs. */
  reorderLayers: (layerIds: string[]) => void;
  /** Move expressions to a different layer. */
  moveToLayer: (expressionIds: string[], layerId: string) => void;
  /**
   * Create a container expression and add it to the canvas.
   * Returns the new container's expression ID.
   */
  createContainer: (
    title: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => string;
  /**
   * Toggle a container's collapsed state.
   * When collapsed, only the header bar is visible; children are hidden.
   * No-op if the expression is not a container or doesn't exist.
   */
  toggleContainerCollapse: (id: string) => void;
  /**
   * Check if an expression was dropped inside a container and auto-parent it.
   * Sets `parentId` on the expression if it overlaps a container's bounds.
   * Prefers the smallest matching container (innermost nesting).
   */
  autoParentOnDrop: (expressionId: string) => void;
  /**
   * Check if an expression was dragged outside its parent container.
   * Clears `parentId` if the expression no longer overlaps its parent.
   */
  autoUnparentOnDrag: (expressionId: string) => void;

  /**
   * Compute and apply an automatic layout to canvas expressions.
   *
   * Uses the specified algorithm to calculate new positions, then
   * moves expressions with undo support and move operations.
   * Skips locked expressions and expressions on hidden/locked layers.
   *
   * @param options - Layout algorithm and configuration
   * @param scope - 'all' to layout all expressions, 'selected' for only selected ones
   * @returns Number of expressions that were repositioned
   */
  applyLayout: (options: import('../layout/types.js').LayoutOptions, scope: 'all' | 'selected') => number;

  /**
   * Update arrow-specific data fields on an existing arrow expression.
   * Pushes an undo snapshot and emits a protocol operation.
   * No-op if the expression doesn't exist or isn't an arrow.
   * Also updates `defaultArrowStyle` with routing/arrowhead changes.
   */
  updateArrowData: (expressionId: string, updates: Partial<ArrowData>) => void;

  /**
   * Set the default arrow style (merged with existing defaults).
   * UI-only — does NOT emit operations. Applied to new arrows by ArrowTool.
   */
  setDefaultArrowStyle: (style: Partial<DefaultArrowStyle>) => void;

  /**
   * Apply a theme preset to expressions.
   * @param themeId - ID of the theme preset to apply
   * @param scope - 'all' applies to all expressions, 'selected' only to selected
   */
  applyTheme: (themeId: string, scope: 'all' | 'selected') => void;
}
