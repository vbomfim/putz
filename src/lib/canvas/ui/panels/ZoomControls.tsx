/**
 * ZoomControls — bottom-right zoom control panel.
 *
 * Displays "−" zoom out, zoom percentage, "+" zoom in,
 * and "⊡" fit-to-content buttons. [CLEAN-CODE]
 *
 * Zoom in/out adjusts by 20% per click. Fit-to-content computes
 * bounding box of all expressions and centers camera with 10% padding.
 * Empty canvas → reset to origin at 100% zoom.
 *
 * @module
 */

import { useCallback } from "react";
import {
  useCanvasStore,
  useCanvasStoreApi,
  clampZoom,
  computeFitToContent,
  ZOOM_STEP,
} from "../../engine";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3x3,
  Magnet,
  FileText,
} from "lucide-react";
import type { VisualExpression } from "../../protocol";

/** Button size in pixels. */
const BUTTON_SIZE = 32;

/** Icon size in pixels. */
const ICON_SIZE = 16;

/** ZoomControls — bottom-right zoom panel. */
export function ZoomControls() {
  const storeApi = useCanvasStoreApi();
  const camera = useCanvasStore((s) => s.camera);
  const gridVisible = useCanvasStore((s) => s.gridVisible);
  const snapEnabled = useCanvasStore((s) => s.snapEnabled);
  const pageVisible = useCanvasStore((s) => s.pageVisible);

  const handleZoomIn = useCallback(() => {
    const { camera: cam, setCamera: setCam } = storeApi.getState();
    const newZoom = clampZoom(cam.zoom + ZOOM_STEP);
    setCam({ ...cam, zoom: newZoom });
  }, [storeApi]);

  const handleZoomOut = useCallback(() => {
    const { camera: cam, setCamera: setCam } = storeApi.getState();
    const newZoom = clampZoom(cam.zoom - ZOOM_STEP);
    setCam({ ...cam, zoom: newZoom });
  }, [storeApi]);

  const handleFitToContent = useCallback(() => {
    const {
      expressions: exprs,
      expressionOrder: order,
      setCamera: setCam,
    } = storeApi.getState();

    // Use window dimensions as viewport size
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const newCamera = computeFitToContent(
      exprs as Record<string, VisualExpression>,
      order,
      viewportWidth,
      viewportHeight,
    );
    setCam(newCamera);
  }, [storeApi]);

  const handleToggleGrid = useCallback(() => {
    storeApi.getState().toggleGrid();
  }, [storeApi]);

  const handleToggleSnap = useCallback(() => {
    storeApi.getState().toggleSnapEnabled();
  }, [storeApi]);

  const handleTogglePage = useCallback(() => {
    storeApi.getState().togglePage();
  }, [storeApi]);

  const zoomPercent = Math.round(camera.zoom * 100);

  return (
    <div
      data-testid="zoom-controls"
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        backgroundColor: "var(--bg-toolbar, #ffffff)",
        borderRadius: 10,
        boxShadow: "0 2px 8px var(--shadow, rgba(0,0,0,0.12))",
        border: "1px solid var(--border, #e0e0e0)",
        zIndex: 20,
      }}
    >
      {/* Zoom out */}
      <button
        type="button"
        data-testid="zoom-out"
        aria-label="Zoom out"
        onClick={handleZoomOut}
        style={buttonStyle}
      >
        <ZoomOut size={ICON_SIZE} />
      </button>

      {/* Zoom percentage display */}
      <span
        data-testid="zoom-display"
        style={{
          minWidth: 48,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "var(--text-primary, #333333)",
          userSelect: "none",
        }}
      >
        {zoomPercent}%
      </span>

      {/* Zoom in */}
      <button
        type="button"
        data-testid="zoom-in"
        aria-label="Zoom in"
        onClick={handleZoomIn}
        style={buttonStyle}
      >
        <ZoomIn size={ICON_SIZE} />
      </button>

      {/* Fit to content */}
      <button
        type="button"
        data-testid="zoom-fit"
        aria-label="Fit to content"
        onClick={handleFitToContent}
        style={buttonStyle}
      >
        <Maximize size={ICON_SIZE} />
      </button>

      {/* Grid toggle */}
      <button
        type="button"
        data-testid="grid-toggle"
        aria-label={gridVisible ? "Hide grid" : "Show grid"}
        title={gridVisible ? "Hide grid (Ctrl+')" : "Show grid (Ctrl+')"}
        onClick={handleToggleGrid}
        style={{
          ...buttonStyle,
          color: gridVisible
            ? "var(--accent, #4A90D9)"
            : "var(--text-primary, #333333)",
        }}
      >
        <Grid3x3 size={ICON_SIZE} />
      </button>

      {/* Snap toggle */}
      <button
        type="button"
        data-testid="snap-toggle"
        aria-label={
          snapEnabled ? "Disable snap to grid" : "Enable snap to grid"
        }
        aria-pressed={snapEnabled}
        title={
          snapEnabled
            ? "Disable snap (Ctrl+Shift+')"
            : "Enable snap (Ctrl+Shift+')"
        }
        onClick={handleToggleSnap}
        style={{
          ...buttonStyle,
          color: snapEnabled
            ? "var(--accent, #4A90D9)"
            : "var(--text-primary, #333333)",
        }}
      >
        <Magnet size={ICON_SIZE} />
      </button>

      {/* Page boundary toggle */}
      <button
        type="button"
        data-testid="page-toggle"
        aria-label={
          pageVisible ? "Hide page boundaries" : "Show page boundaries"
        }
        aria-pressed={pageVisible}
        title={pageVisible ? "Hide page boundaries" : "Show page boundaries"}
        onClick={handleTogglePage}
        style={{
          ...buttonStyle,
          color: pageVisible
            ? "var(--accent, #4A90D9)"
            : "var(--text-primary, #333333)",
        }}
      >
        <FileText size={ICON_SIZE} />
      </button>
    </div>
  );
}

/** Shared button style for zoom controls. */
const buttonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  backgroundColor: "transparent",
  color: "var(--text-primary, #333333)",
  transition: "background-color 0.15s",
};
