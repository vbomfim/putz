/**
 * @infinicanvas/engine — public API.
 *
 * Re-exports the canvas store, components, camera math, renderers,
 * hooks, and type definitions.
 *
 * @module
 */

// ── State store ────────────────────────────────────────────
export { useCanvasStore, _resetWaypointCounter, _resetLayerCounter } from './store/canvasStore';
export { useUiStore, applyThemeToDocument, THEME_STORAGE_KEY } from './store/uiStore';
export type { Theme, UiState, UiActions } from './store/uiStore';

// ── History ────────────────────────────────────────────────
export { HistoryManager } from './history/historyManager';
export type { CanvasSnapshot } from './history/historyManager';

// ── Camera math ────────────────────────────────────────────
export {
  screenToWorld,
  worldToScreen,
  applyTransform,
  zoomAtPoint,
  clampZoom,
  computeFitToContent,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
} from './camera';

// ── Renderers ──────────────────────────────────────────────
export { renderGrid, getGridSpacing } from './renderer/gridRenderer';
export { renderPages, computePageGrid, PAGE_SIZES } from './renderer/pageRenderer';
export type { PageGrid } from './renderer/pageRenderer';
export { createRenderLoop } from './renderer/renderLoop';
export type { RenderLoop, ExpressionProvider, SelectionProvider, DrawPreviewProvider, EditingProvider, GridProvider, PageProvider, LayerProvider } from './renderer/renderLoop';
export {
  renderExpressions,
  renderLabel,
  renderArrowhead,
  wrapText,
  clearDrawableCache,
  clearImageCache,
} from './renderer/primitiveRenderer';
export {
  renderArrowheadFromRegistry,
  getArrowheadRenderer,
  ALL_ARROWHEAD_TYPES,
} from './renderer/arrowheads';
export { mapStyleToRoughOptions, computeStyleHash, computeRenderHash } from './renderer/styleMapper';
export { isVisible, getWorldViewport } from './renderer/viewportCulling';
export type { BoundingBox, WorldViewport } from './renderer/viewportCulling';
export { createDrawableCache } from './renderer/drawableCache';
export type { DrawableCache, RenderContext } from './renderer/drawableCache';
export { renderSelection } from './renderer/selectionRenderer';
export { renderDrawPreview } from './renderer/drawPreviewRenderer';
export {
  registerCompositeRenderer,
  getCompositeRenderer,
  clearCompositeRenderers,
} from './renderer/compositeRegistry';
export type { CompositeRenderer } from './renderer/compositeRegistry';
export { renderFlowchart, clearLayoutCache } from './renderer/composites/flowchartRenderer';
export {
  renderSequenceDiagram,
  clearLayoutCache as clearSequenceLayoutCache,
  computeSequenceLayout,
} from './renderer/composites/sequenceDiagramRenderer';
export {
  renderMindMap,
  clearLayoutCache as clearMindMapLayoutCache,
  computeMindMapLayout,
} from './renderer/composites/mindMapRenderer';
export {
  renderReasoningChain,
  clearLayoutCache as clearReasoningLayoutCache,
  computeReasoningLayout,
} from './renderer/composites/reasoningChainRenderer';
export { renderKanban } from './renderer/composites/kanbanRenderer';
export { renderTable } from './renderer/composites/tableRenderer';
export { renderWireframe } from './renderer/composites/wireframeRenderer';
export { renderRoadmap } from './renderer/composites/roadmapRenderer';
export { renderCodeBlock } from './renderer/composites/codeBlockRenderer';
export { renderSlide } from './renderer/composites/slideRenderer';
export { renderCollaborationDiagram } from './renderer/composites/collaborationDiagramRenderer';
export { renderDecisionTree } from './renderer/composites/decisionTreeRenderer';
export { renderContainer } from './renderer/composites/containerRenderer';

// ── Stencil catalog ────────────────────────────────────────
export type { StencilEntry, StencilMeta, CategoryLoader } from './renderer/stencils/index';
export {
  STENCIL_CATALOG,
  getStencil,
  getStencilsByCategory,
  getAllCategories,
  getCategories,
  getCategoryStencils,
  getAllStencilMeta,
  registerCategoryLoader,
  registerCategoryMeta,
  svgToDataUri,
} from './renderer/stencils/index';

// ── Connector Helpers ──────────────────────────────────────
export {
  findSnapPoint,
  getAnchorPoint,
  resolveBindings,
  findBoundArrows,
  clearBindingsForDeletedExpression,
} from './interaction/connectorHelpers';

// ── Connection Points & Routing ───────────────────────────
export { BINDABLE_KINDS } from './connectors/constants';
export {
  getConnectionPoints,
  findNearestConnectionPoint,
} from './connectors/connectionPoints';
export type {
  ShapeConnectionPoint,
  ShapeConnectionPointPosition,
} from './connectors/connectionPoints';
export { computeOrthogonalRoute } from './connectors/orthogonalRouter';
export { computeCurvedRoute } from './connectors/curvedRouter';
export { computeEntityRelationRoute } from './connectors/entityRelationRouter';
export { computeIsometricRoute } from './connectors/isometricRouter';
export { getRouter } from './connectors/routerRegistry';
export type { PathSegment, RouterFunction, RouterOptions } from './connectors/routerTypes';

// ── Interaction ────────────────────────────────────────────
export {
  hitTestRectangle,
  hitTestEllipse,
  hitTestDiamond,
  hitTestLine,
  hitTestArrow,
  hitTestFreehand,
  hitTestText,
  hitTestStickyNote,
  hitTestImage,
  hitTestStencil,
  hitTestExpression,
  distanceToBezier,
  distanceToPathSegments,
} from './interaction/hitTest';
export type { WorldPoint } from './interaction/hitTest';
export {
  findExpressionAtPoint,
  findExpressionsInMarquee,
} from './interaction/selectionManager';
export type { Marquee } from './interaction/selectionManager';
export {
  getHandlePositions,
  detectHandle,
  detectPointerTarget,
  getCursorForTarget,
  computeResize,
  getJettyHandlePosition,
  detectJettyHandle,
  MIN_SIZE,
} from './interaction/manipulationHelpers';
export type {
  HandleType,
  HandleHit,
  PointerTarget,
  JettyHandleHit,
  PointHandleHit,
} from './interaction/manipulationHelpers';
export { getCursorForToolState } from './interaction/cursorMapping';
export type { HoverTarget } from './interaction/cursorMapping';

// ── Drawing Tools ──────────────────────────────────────────
export type { ToolHandler, DrawPreview, ToolHandlerRegistry } from './tools/BaseTool';
export { createToolHandlerRegistry } from './tools/BaseTool';
export { RectangleTool } from './tools/RectangleTool';
export { EllipseTool } from './tools/EllipseTool';
export { DiamondTool } from './tools/DiamondTool';
export { LineTool } from './tools/LineTool';
export { ArrowTool } from './tools/ArrowTool';
export { FreehandTool } from './tools/FreehandTool';
export { TextTool } from './tools/TextTool';

// ── Persistence ────────────────────────────────────────────
export { saveCanvasState, loadCanvasState, STORAGE_KEY } from './persistence/localStorage';
export type { PersistedCanvasState } from './persistence/localStorage';

// ── Export/Import ──────────────────────────────────────────
export { exportToJson } from './export/toJson';
export type { ExportedCanvasState } from './export/toJson';
export { importFromJson } from './export/fromJson';
export type { ImportResult, ImportSuccess, ImportError } from './export/fromJson';
export { exportToPng, computeExportBounds, EXPORT_PADDING } from './export/toPng';
export type { ExportBounds } from './export/toPng';
export { buildSvgString, downloadSvg } from './export/toSvg';

// ── Hooks ──────────────────────────────────────────────────
export { useCanvasInteraction } from './hooks/useCanvasInteraction';
export type { CanvasInteraction } from './hooks/useCanvasInteraction';
export { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts';
export { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
export type {
  UseKeyboardShortcutsOptions,
  KeyboardShortcutsState,
} from './hooks/useKeyboardShortcuts';
export { useSelectionInteraction } from './hooks/useSelectionInteraction';
export type { SelectionInteraction, MarqueeRect } from './hooks/useSelectionInteraction';
export { useInlineEditor, EDITABLE_KINDS } from './hooks/useInlineEditor';
export type { InlineEditorState } from './hooks/useInlineEditor';
export { useManipulationInteraction } from './hooks/useManipulationInteraction';
export type { ManipulationInteraction } from './hooks/useManipulationInteraction';
export { useDrawingInteraction } from './hooks/useDrawingInteraction';
export type { DrawingInteraction } from './hooks/useDrawingInteraction';
export { useTouchGestures } from './hooks/useTouchGestures';
export {
  computePinchDistance,
  computeMidpoint,
  computePanDelta,
} from './hooks/useTouchGestures';
export { useMetadataTooltip, formatRelativeTime, buildTooltipData } from './hooks/useMetadataTooltip';
export type { TooltipInfo, TooltipData } from './hooks/useMetadataTooltip';
export { subscribeAutoSave, DEBOUNCE_MS } from './hooks/useAutoSave';

// ── Morph Engine ───────────────────────────────────────────
export { morphExpression, canMorph, getMorphTargets } from './morph/morphEngine';

// ── Components ─────────────────────────────────────────────
export { Canvas } from './components/Canvas';
export { ErrorBoundary } from './components/ErrorBoundary';
export { ShortcutsHelpPanel } from './components/ShortcutsHelpPanel';

// ── Text Configuration ─────────────────────────────────────
export { resolveTextConfig } from './text/textConfig';
export type { TextConfig } from './text/textConfig';

// ── Utilities ──────────────────────────────────────────────
export { snapToGrid, snapPosition, computeSnappedDelta } from './utils/snapToGrid';

// ── Themes ─────────────────────────────────────────────────
export { THEME_PRESETS, getThemeById, applyThemeToExpressions, computeThemedStyle } from './themes/presets';
export type { ThemePreset } from './themes/presets';

// ── Layout ─────────────────────────────────────────────────
export { computeLayout } from './layout/computeLayout';
export { computeTreeLayout } from './layout/treeLayout';
export { computeForceLayout } from './layout/forceLayout';
export { computeGridLayout } from './layout/gridLayout';
export type {
  LayoutAlgorithm,
  LayoutDirection,
  LayoutSpacing,
  LayoutOptions,
  TreeLayoutOptions,
  ForceLayoutOptions,
  GridLayoutOptions,
  LayoutEdge,
} from './layout/types';
export {
  DEFAULT_SPACING,
  DEFAULT_FORCE_ITERATIONS,
  DEFAULT_GRID_COLUMNS,
} from './layout/types';

// ── Types ──────────────────────────────────────────────────
export type {
  ToolType,
  Camera,
  CameraWaypoint,
  GridType,
  CanvasState,
  CanvasActions,
  DefaultArrowStyle,
} from './types/index';

export type { Layer } from '../protocol';
export { DEFAULT_LAYER_ID } from '../protocol';

