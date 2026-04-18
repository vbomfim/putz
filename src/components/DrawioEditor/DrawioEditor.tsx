/**
 * DrawioEditor — native .drawio visual editor tab.
 *
 * Reads a .drawio XML file, converts to canvas expressions via
 * the protocol serializer, renders the full infinicanvas editor,
 * and saves back to .drawio XML on Cmd+S.
 *
 * Each tab has its own CanvasStoreProvider — giving it fully
 * independent state. Split-view diagrams render independently.
 *
 * @module
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Canvas, useCanvasStoreApi, CanvasStoreProvider, computeFitToContent } from "../../lib/canvas/engine";
import type { VisualExpression } from "../../lib/canvas/protocol";
import { drawioToExpressions, expressionsToDrawio } from "../../lib/canvas/protocol";
import { Toolbar } from "../../lib/canvas/ui/toolbar/Toolbar";
import { StylePanel } from "../../lib/canvas/ui/panels/StylePanel";
import { FloatingConnectorPanel } from "../../lib/canvas/ui/panels/FloatingConnectorPanel";
import { ZoomControls } from "../../lib/canvas/ui/panels/ZoomControls";
import { ExportMenu } from "../../lib/canvas/ui/panels/ExportMenu";
import { ThemeToggle } from "../../lib/canvas/ui/panels/ThemeToggle";
import { StencilPalette } from "../../lib/canvas/ui/toolbar/StencilPalette";
import "../../lib/canvas/ui/styles/theme.css";
import "./DrawioEditor.css";

interface DrawioEditorProps {
  filePath: string;
  regionId: string;
  tabId: string;
  isActive: boolean;
}

/**
 * Inner component that uses the canvas store (must be inside CanvasStoreProvider).
 */
function DrawioEditorInner({ filePath, isActive }: { filePath: string; isActive: boolean }) {
  const storeApi = useCanvasStoreApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStencilPalette, setShowStencilPalette] = useState(false);
  const filePathRef = useRef(filePath);
  const lastMtimeRef = useRef<number>(0);

  /** Load file from disk into the store. */
  const loadFromDisk = useCallback(async () => {
    try {
      const xml = await invoke<string>("file_read", { path: filePath });
      const mtime = await invoke<number>("file_mtime", { path: filePath });
      lastMtimeRef.current = mtime;

      if (!xml.trim()) {
        storeApi.getState().replaceState([], []);
        setLoading(false);
        return;
      }
      const expressions = drawioToExpressions(xml);
      const exprMap: Record<string, VisualExpression> = {};
      const order: string[] = [];
      for (const expr of expressions) {
        exprMap[expr.id] = expr;
        order.push(expr.id);
      }
      const cam = expressions.length > 0
        ? computeFitToContent(exprMap, order, window.innerWidth, window.innerHeight)
        : { x: 0, y: 0, zoom: 1 };
      const ordered = order.map((id) => exprMap[id]).filter(Boolean) as VisualExpression[];
      storeApi.getState().replaceState(ordered, order);
      storeApi.getState().setCamera(cam);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [filePath, storeApi]);

  // Initial load
  useEffect(() => {
    loadFromDisk();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when tab becomes active if file changed on disk
  useEffect(() => {
    if (!isActive || loading) return;
    invoke<number>("file_mtime", { path: filePath })
      .then((mtime) => {
        if (mtime > lastMtimeRef.current) {
          loadFromDisk();
        }
      })
      .catch(() => {});
  }, [isActive, filePath, loading, loadFromDisk]);

  // Save on Cmd+S (only when active)
  const handleSave = useCallback(async () => {
    try {
      const { expressions, expressionOrder } = storeApi.getState();
      const ordered: VisualExpression[] = expressionOrder
        .map((id: string) => expressions[id])
        .filter(Boolean) as VisualExpression[];
      const xml = expressionsToDrawio(ordered);
      await invoke("file_write", { path: filePathRef.current, content: xml });
      // Update mtime so we don't trigger a reload for our own save
      const mtime = await invoke<number>("file_mtime", { path: filePathRef.current });
      lastMtimeRef.current = mtime;
    } catch (err) {
      console.error("Failed to save .drawio:", err);
    }
  }, [storeApi]);

  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, isActive]);

  if (error) {
    return (
      <div className="drawio-editor drawio-editor--error">
        <p>Failed to load {filePath}</p>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="drawio-editor drawio-editor--loading">
        Loading diagram…
      </div>
    );
  }

  return (
    <div className="drawio-editor">
      <Canvas />
      <Toolbar
        onToggleStencilPalette={() => setShowStencilPalette((prev) => !prev)}
        isStencilPaletteOpen={showStencilPalette}
        onToggleWaypointPanel={() => {}}
        isWaypointPanelOpen={false}
      />
      <StylePanel />
      <FloatingConnectorPanel />
      <StencilPalette
        onInsert={(expr: VisualExpression) => {
          storeApi.getState().addExpression(expr);
          storeApi.getState().setSelectedIds(new Set([expr.id]));
        }}
        isOpen={showStencilPalette}
      />
      <ZoomControls />
      <div className="drawio-editor__top-bar">
        <ThemeToggle />
        <ExportMenu />
      </div>
    </div>
  );
}

/**
 * Outer component that provides an independent canvas store per editor instance.
 */
export function DrawioEditor({ filePath, isActive }: DrawioEditorProps) {
  return (
    <CanvasStoreProvider>
      <DrawioEditorInner filePath={filePath} isActive={isActive} />
    </CanvasStoreProvider>
  );
}
