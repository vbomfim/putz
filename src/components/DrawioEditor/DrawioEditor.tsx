/**
 * DrawioEditor — native .drawio visual editor tab.
 *
 * Reads a .drawio XML file, converts to canvas expressions via
 * the protocol serializer, renders the full infinicanvas editor,
 * and saves back to .drawio XML on Cmd+S.
 *
 * @module
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Canvas, useCanvasStore, computeFitToContent } from "../../lib/canvas/engine";
import { drawioToExpressions, expressionsToDrawio } from "../../lib/canvas/protocol";
import type { VisualExpression } from "../../lib/canvas/protocol";
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
}

export function DrawioEditor({ filePath }: DrawioEditorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStencilPalette, setShowStencilPalette] = useState(false);
  const filePathRef = useRef(filePath);
  const loadedRef = useRef(false);

  // Load .drawio file on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        const xml = await invoke<string>("file_read", { path: filePath });
        if (!xml.trim()) {
          // Empty file — start with blank canvas
          useCanvasStore.getState().replaceState([], []);
          setLoading(false);
          return;
        }
        const expressions = drawioToExpressions(xml);
        const store = useCanvasStore.getState();
        const exprMap: Record<string, VisualExpression> = {};
        const order: string[] = [];
        for (const expr of expressions) {
          exprMap[expr.id] = expr;
          order.push(expr.id);
        }
        store.replaceState(expressions, order);
        // Fit camera to content
        if (expressions.length > 0) {
          const cam = computeFitToContent(exprMap, order, window.innerWidth, window.innerHeight);
          store.setCamera(cam);
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
  }, [filePath]);

  // Save on Cmd+S
  const handleSave = useCallback(async () => {
    try {
      const { expressions, expressionOrder } = useCanvasStore.getState();
      const ordered: VisualExpression[] = expressionOrder
        .map((id) => expressions[id])
        .filter(Boolean) as VisualExpression[];
      const xml = expressionsToDrawio(ordered);
      await invoke("file_write", { path: filePathRef.current, content: xml });
    } catch (err) {
      console.error("Failed to save .drawio:", err);
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

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
          useCanvasStore.getState().addExpression(expr);
          useCanvasStore.getState().setSelectedIds(new Set([expr.id]));
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
