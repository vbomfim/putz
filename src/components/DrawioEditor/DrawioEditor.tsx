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
import { nanoid } from "nanoid";
import {
  Canvas,
  useCanvasStoreApi,
  CanvasStoreProvider,
  computeFitToContent,
} from "../../lib/canvas/engine";
import type { VisualExpression } from "../../lib/canvas/protocol";
import type { DrawioPage } from "../../lib/canvas/protocol";
import { drawioToPages, pagesToDrawio } from "../../lib/canvas/protocol";
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

/** Cached per-page store snapshot. */
interface PageCache {
  expressions: VisualExpression[];
  order: string[];
  camera: { x: number; y: number; zoom: number };
}

/**
 * Inner component that uses the canvas store (must be inside CanvasStoreProvider).
 */
function DrawioEditorInner({
  filePath,
  isActive,
}: {
  filePath: string;
  isActive: boolean;
}) {
  const storeApi = useCanvasStoreApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStencilPalette, setShowStencilPalette] = useState(false);
  const [pages, setPages] = useState<DrawioPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const filePathRef = useRef(filePath);
  const lastMtimeRef = useRef<number>(0);
  const pageCacheRef = useRef<Map<number, PageCache>>(new Map());

  /** Snapshot the current store state for caching. */
  const snapshotStore = useCallback((): PageCache => {
    const { expressions, expressionOrder, camera } = storeApi.getState();
    const ordered: VisualExpression[] = expressionOrder
      .map((id: string) => expressions[id])
      .filter(Boolean) as VisualExpression[];
    return {
      expressions: ordered,
      order: [...expressionOrder],
      camera: { ...camera },
    };
  }, [storeApi]);

  /** Load expressions into the store from a page cache or raw expressions. */
  const loadPageIntoStore = useCallback(
    (cache: PageCache | null, exprs?: VisualExpression[]) => {
      if (cache) {
        storeApi.getState().replaceState(cache.expressions, cache.order);
        storeApi.getState().setCamera(cache.camera);
      } else if (exprs) {
        const exprMap: Record<string, VisualExpression> = {};
        const order: string[] = [];
        for (const expr of exprs) {
          exprMap[expr.id] = expr;
          order.push(expr.id);
        }
        const cam =
          exprs.length > 0
            ? computeFitToContent(
                exprMap,
                order,
                window.innerWidth,
                window.innerHeight,
              )
            : { x: 0, y: 0, zoom: 1 };
        const ordered = order
          .map((id) => exprMap[id])
          .filter(Boolean) as VisualExpression[];
        storeApi.getState().replaceState(ordered, order);
        storeApi.getState().setCamera(cam);
      }
    },
    [storeApi],
  );

  /** Load file from disk into the store. */
  const loadFromDisk = useCallback(async () => {
    try {
      const xml = await invoke<string>("file_read", { path: filePath });
      const mtime = await invoke<number>("file_mtime", { path: filePath });
      lastMtimeRef.current = mtime;

      if (!xml.trim()) {
        setPages([{ id: nanoid(), name: "Page 1", expressions: [] }]);
        storeApi.getState().replaceState([], []);
        setActivePageIndex(0);
        pageCacheRef.current.clear();
        setLoading(false);
        return;
      }

      const loadedPages = drawioToPages(xml);
      if (loadedPages.length === 0) {
        setPages([{ id: nanoid(), name: "Page 1", expressions: [] }]);
        storeApi.getState().replaceState([], []);
      } else {
        setPages(loadedPages);
        loadPageIntoStore(null, loadedPages[0].expressions);
      }
      setActivePageIndex(0);
      pageCacheRef.current.clear();
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [filePath, storeApi, loadPageIntoStore]);

  /** Switch to a different page. */
  const switchPage = useCallback(
    (targetIndex: number) => {
      if (targetIndex === activePageIndex) return;

      // Save current page state to cache
      pageCacheRef.current.set(activePageIndex, snapshotStore());

      // Load target page from cache or from pages array
      const cached = pageCacheRef.current.get(targetIndex);
      if (cached) {
        loadPageIntoStore(cached);
      } else {
        loadPageIntoStore(null, pages[targetIndex]?.expressions ?? []);
      }

      setActivePageIndex(targetIndex);
    },
    [activePageIndex, pages, snapshotStore, loadPageIntoStore],
  );

  /** Add a new empty page. */
  const addPage = useCallback(() => {
    const newPage: DrawioPage = {
      id: nanoid(),
      name: `Page ${pages.length + 1}`,
      expressions: [],
    };
    const newPages = [...pages, newPage];
    setPages(newPages);
    // Switch to the new page
    pageCacheRef.current.set(activePageIndex, snapshotStore());
    storeApi.getState().replaceState([], []);
    storeApi.getState().setCamera({ x: 0, y: 0, zoom: 1 });
    setActivePageIndex(newPages.length - 1);
  }, [pages, activePageIndex, snapshotStore, storeApi]);

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

  // Reload when the same file is re-opened (tab already exists)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.filePath === filePath) {
        invoke<number>("file_mtime", { path: filePath })
          .then((mtime) => {
            if (mtime > lastMtimeRef.current) {
              loadFromDisk();
            }
          })
          .catch(() => {});
      }
    };
    window.addEventListener("drawio-reactivate", handler);
    return () => window.removeEventListener("drawio-reactivate", handler);
  }, [filePath, loadFromDisk]);

  /** Build the full DrawioPage[] from cache + current store state. */
  const buildAllPages = useCallback((): DrawioPage[] => {
    return pages.map((page, i) => {
      if (i === activePageIndex) {
        // Active page — read live from store
        const { expressions, expressionOrder } = storeApi.getState();
        const ordered: VisualExpression[] = expressionOrder
          .map((id: string) => expressions[id])
          .filter(Boolean) as VisualExpression[];
        return { ...page, expressions: ordered };
      }
      // Inactive page — read from cache or original
      const cached = pageCacheRef.current.get(i);
      if (cached) {
        return { ...page, expressions: cached.expressions };
      }
      return page;
    });
  }, [pages, activePageIndex, storeApi]);

  // Save to disk
  const saveToDisk = useCallback(async () => {
    try {
      const allPages = buildAllPages();
      const xml = pagesToDrawio(allPages);
      await invoke("file_write", { path: filePathRef.current, content: xml });
      const mtime = await invoke<number>("file_mtime", {
        path: filePathRef.current,
      });
      lastMtimeRef.current = mtime;
    } catch (err) {
      console.error("Failed to save .drawio:", err);
    }
  }, [buildAllPages]);

  // Save on Cmd+S (only when active)
  const handleSave = useCallback(async () => {
    await saveToDisk();
  }, [saveToDisk]);

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
      <div className="drawio-editor__page-bar">
        {pages.map((page, i) => (
          <button
            key={page.id}
            className={`drawio-editor__page-tab ${i === activePageIndex ? "drawio-editor__page-tab--active" : ""}`}
            onClick={() => switchPage(i)}
          >
            {page.name}
          </button>
        ))}
        <button
          className="drawio-editor__page-tab drawio-editor__page-tab--add"
          onClick={addPage}
        >
          +
        </button>
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
