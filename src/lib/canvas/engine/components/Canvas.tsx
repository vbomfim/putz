/**
 * Canvas — full-viewport HTML canvas element with camera system.
 *
 * Renders a white canvas that fills the entire viewport (100vw × 100vh).
 * Uses ResizeObserver to track window resize with debouncing (100ms). [AC3]
 * Integrates render loop for grid + camera transforms. [AC8]
 * Integrates pan/zoom interactions via useCanvasInteraction hook. [AC1, AC2]
 * Wrapped in ErrorBoundary for crash resilience. [AC9]
 *
 * @module
 */

import { useEffect, useRef, useCallback } from 'react';
import rough from 'roughjs';
import { ErrorBoundary } from './ErrorBoundary';
import { ShortcutsHelpPanel } from './ShortcutsHelpPanel';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useSelectionInteraction } from '../hooks/useSelectionInteraction';
import { useManipulationInteraction } from '../hooks/useManipulationInteraction';
import { useDrawingInteraction } from '../hooks/useDrawingInteraction';
import { useInlineEditor } from '../hooks/useInlineEditor';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTouchGestures } from '../hooks/useTouchGestures';
import { useMetadataTooltip, formatRelativeTime } from '../hooks/useMetadataTooltip';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvasStore';
import { worldToScreen, screenToWorld } from '../camera';
import { resolveTextConfig } from '../text/textConfig';
import { createRenderLoop } from '../renderer/renderLoop';
import type { RenderLoop } from '../renderer/renderLoop';
import type { VisualExpression } from '../../protocol';
import { STENCIL_CATALOG } from '../renderer/stencils/index';
import { DEFAULT_EXPRESSION_STYLE } from '../../protocol';
import { nanoid } from 'nanoid';

/** Minimum canvas dimensions to prevent zero-size or negative canvas. */
const MIN_WIDTH = 1;
const MIN_HEIGHT = 1;

/** Debounce delay for ResizeObserver callbacks (ms). */
const RESIZE_DEBOUNCE_MS = 100;

function CanvasInner() {
  const storeApi = useCanvasStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const renderLoopRef = useRef<RenderLoop | null>(null);
  const { canvasRef, cursor: canvasCursor } = useCanvasInteraction();
  const { getMarquee } = useSelectionInteraction(canvasRef);
  const { cursor: manipulationCursor } = useManipulationInteraction(canvasRef);
  const { getDrawPreview, textTool, cancelDraw } = useDrawingInteraction(canvasRef);
  const inlineEditor = useInlineEditor(canvasRef);
  useTouchGestures(canvasRef);
  const tooltip = useMetadataTooltip(canvasRef);

  // Ref to expose editingId to the render loop without stale closures
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = inlineEditor.editingId;

  // Shared ref so container-level handlers can read the textarea's current value
  const editorTextRef = useRef<string>('');

  // Wire TextTool → inline editor so text tool creates expression + starts editing
  textTool.setStartEditing(inlineEditor.startEditing);

  // Track active tool for cursor and text overlay
  const activeTool = useCanvasStore((s) => s.activeTool);
  const camera = useCanvasStore((s) => s.camera);

  // Inline editor: look up the expression being edited
  const editingExpr = useCanvasStore((s) =>
    inlineEditor.editingId ? s.expressions[inlineEditor.editingId] ?? null : null,
  );

  // Manipulation cursor takes priority, then drawing crosshair/text, then canvas default
  let cursor = canvasCursor;
  if (manipulationCursor !== 'default') {
    cursor = manipulationCursor;
  } else if (activeTool === 'text') {
    cursor = 'text';
  } else if (activeTool !== 'select') {
    cursor = 'crosshair';
  }

  // Register centralized keyboard shortcuts (tool switching, undo/redo,
  // delete, duplicate, select all, escape, help panel) [Issue #10]
  const { showShortcutsHelp, setShowShortcutsHelp } = useKeyboardShortcuts({ cancelDraw, startEditing: inlineEditor.startEditing });

  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(container.clientWidth, MIN_WIDTH);
    const height = Math.max(container.clientHeight, MIN_HEIGHT);

    // Set canvas backing store to physical pixels for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Set CSS display size to logical pixels
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Scale context so drawing uses logical coordinates
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Update render loop viewport size
    if (renderLoopRef.current) {
      renderLoopRef.current.updateSize(width, height);
    }
  }, [canvasRef]);

  // ── Render loop lifecycle ──────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = containerRef.current;
    const width = Math.max(container?.clientWidth ?? MIN_WIDTH, MIN_WIDTH);
    const height = Math.max(container?.clientHeight ?? MIN_HEIGHT, MIN_HEIGHT);

    const getCamera = () => storeApi.getState().camera;
    const roughCanvas = rough.canvas(canvas);
    const expressionProvider = {
      getExpressions: () => storeApi.getState().expressions,
      getExpressionOrder: () => storeApi.getState().expressionOrder,
    };
    const selectionProvider = {
      getSelectedIds: () => storeApi.getState().selectedIds,
    };
    const drawPreviewProvider = {
      getDrawPreview,
    };
    const marqueeProvider = {
      getMarquee,
    };
    const editingProvider = {
      getEditingId: () => editingIdRef.current,
    };
    const gridProvider = {
      getGridVisible: () => storeApi.getState().gridVisible,
      getGridType: () => storeApi.getState().gridType,
      getGridSize: () => storeApi.getState().gridSize,
    };
    const pageProvider = {
      getPageVisible: () => storeApi.getState().pageVisible,
      getPageSize: () => storeApi.getState().pageSize,
    };
    const dpr = window.devicePixelRatio || 1;
    const loop = createRenderLoop(ctx, getCamera, width, height, roughCanvas, expressionProvider, selectionProvider, drawPreviewProvider, dpr, marqueeProvider, editingProvider, gridProvider, pageProvider);

    renderLoopRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
      renderLoopRef.current = null;
    };
  }, [canvasRef, getDrawPreview, getMarquee, storeApi]);

  // ── Screenshot capture via render loop ────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        requestId: string;
        respond: (imageBase64: string, w: number, h: number) => void;
      };
      const canvas = canvasRef.current;
      const loop = renderLoopRef.current;
      if (!canvas || !loop) return;

      // Capture AFTER the next render paint
      loop.captureAfterPaint(() => {
        try {
          const imageBase64 = canvas.toDataURL('image/png');
          detail.respond(imageBase64, canvas.width, canvas.height);
        } catch {
          detail.respond('', 0, 0);
        }
      });
    };
    window.addEventListener('infinicanvas-screenshot', handler);
    return () => window.removeEventListener('infinicanvas-screenshot', handler);
  }, [canvasRef]);

  // ── Resize observer ────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set initial size
    updateCanvasSize();

    // Debounced resize handler
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(updateCanvasSize, RESIZE_DEBOUNCE_MS);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [updateCanvasSize]);

  /** Handle stencil drops from the StencilPalette. */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const stencilId = e.dataTransfer.getData('application/x-infinicanvas-stencil');
    if (!stencilId) return;

    const entry = STENCIL_CATALOG.get(stencilId);
    if (!entry) return;

    const { camera } = storeApi.getState();
    const world = screenToWorld(e.clientX, e.clientY, camera);

    // Scale size inversely by zoom so stencils appear the same screen size
    const w = entry.defaultSize.width / camera.zoom;
    const h = entry.defaultSize.height / camera.zoom;

    const expression: VisualExpression = {
      id: nanoid(),
      kind: 'stencil',
      position: { x: world.x - w / 2, y: world.y - h / 2 },
      size: { width: w, height: h },
      angle: 0,
      style: { ...DEFAULT_EXPRESSION_STYLE, fontSize: 10 },
      meta: {
        author: { type: 'human', id: 'local-user', name: 'User' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
        locked: false,
      },
      data: { kind: 'stencil' as const, stencilId: entry.id, category: entry.category, label: entry.label },
    };

    storeApi.getState().addExpression(expression);
    storeApi.getState().setSelectedIds(new Set([expression.id]));
  }, [storeApi]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-infinicanvas-stencil')) {
      e.preventDefault();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onContextMenu={(e) => {
        e.preventDefault();
        // Commit any active inline edit (right-click should finalize text)
        if (inlineEditor.editingId) {
          inlineEditor.commitEdit(editorTextRef.current);
        }
      }}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        position: 'relative',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          backgroundColor: 'var(--bg-canvas, #ffffff)',
          cursor,
        }}
      />
      {/* Unified text editor for both new text creation and inline editing */}
      {editingExpr && (
        <TextEditor
          expression={editingExpr}
          initialText={inlineEditor.getEditingText()}
          camera={camera}
          editorTextRef={editorTextRef}
          onCommit={(text, shrunkFontSize) => {
            inlineEditor.commitEdit(text);
            // Only save font size if it was actually shrunk
            if (shrunkFontSize !== undefined && editingExpr) {
              const worldFontSize = shrunkFontSize / camera.zoom;
              storeApi.getState().styleExpressions(
                [editingExpr.id],
                { fontSize: worldFontSize },
              );
            }
          }}
          onCancel={() => {
            inlineEditor.cancelEdit();
          }}
        />
      )}
      {/* Keyboard shortcuts help panel */}
      {showShortcutsHelp && (
        <ShortcutsHelpPanel onClose={() => setShowShortcutsHelp(false)} />
      )}
      {/* Metadata tooltip on expression hover */}
      {tooltip && (
        <div
          data-testid="metadata-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            padding: '6px 10px',
            backgroundColor: 'var(--bg-toolbar, #ffffff)',
            border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 6,
            boxShadow: '0 2px 8px var(--shadow, rgba(0,0,0,0.12))',
            fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: 'var(--text-primary, #333333)',
            pointerEvents: 'none',
            zIndex: 50,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {tooltip.data.kind}
          </div>
          <div style={{ color: 'var(--text-secondary, #666666)' }}>
            {tooltip.data.authorName} · {formatRelativeTime(tooltip.data.createdAt)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-viewport canvas component with camera system and error boundary. */
export function Canvas() {
  return (
    <ErrorBoundary>
      <CanvasInner />
    </ErrorBoundary>
  );
}

// ── Unified Text Editor ────────────────────────────────────

interface TextEditorProps {
  expression: VisualExpression;
  initialText: string;
  camera: { x: number; y: number; zoom: number };
  editorTextRef: React.MutableRefObject<string>;
  onCommit: (text: string, fontSize?: number) => void;
  onCancel: () => void;
}

/**
 * Unified textarea overlay for editing text on ANY expression.
 *
 * Uses resolveTextConfig() to match the renderer's exact font, size,
 * color, alignment, and position — ensuring WYSIWYG editing.
 *
 * Replaces the former TextInputOverlay (text tool) and InlineEditOverlay
 * (double-click editing) with a single component.
 *
 * [DRY] One component, one code path for all text editing.
 * [CLEAN-CODE] Single Responsibility — renders textarea matching rendered text.
 */
function TextEditor({ expression, initialText, camera, editorTextRef, onCommit, onCancel }: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);
  const currentFontSizeRef = useRef<number | null>(null);

  // Keep editorTextRef in sync so container-level handlers can read current value
  editorTextRef.current = initialText;

  const config = resolveTextConfig(expression);

  // Convert world position to screen position
  const screenPos = config
    ? worldToScreen(config.worldX, config.worldY, camera)
    : worldToScreen(expression.position.x, expression.position.y, camera);

  // Scale to screen dimensions
  const screenWidth = config
    ? config.worldWidth * camera.zoom
    : expression.size.width * camera.zoom;
  const screenHeight = config
    ? config.worldHeight * camera.zoom
    : expression.size.height * camera.zoom;

  // Font scaled to screen
  const scaledFontSize = config
    ? config.fontSize * camera.zoom
    : 16 * camera.zoom;

  const fontFamily = config?.fontFamily ?? 'Architects Daughter, cursive';
  const textAlign = config?.textAlign ?? 'center';
  const color = config?.color ?? '#000000';
  const background = config?.background ?? 'transparent';
  const verticalAlign = config?.verticalAlign ?? 'middle';

  /** Resize textarea: shrink font to fit, then grow height to content. */
  const fitTextarea = (el: HTMLTextAreaElement) => {
    if (verticalAlign === 'middle') {
      let fs = scaledFontSize;
      el.style.fontSize = `${fs}px`;
      el.style.height = 'auto';
      while (el.scrollHeight > effectiveHeight * 0.9 && fs > 6) {
        fs -= 1;
        el.style.fontSize = `${fs}px`;
        el.style.height = 'auto';
      }
      currentFontSizeRef.current = fs;
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
      fitTextarea(textarea);
    }
  }, []);

  const doCommit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    // Only report fontSize if it was shrunk below the original
    const shrunk = (currentFontSizeRef.current !== null && currentFontSizeRef.current < scaledFontSize)
      ? currentFontSizeRef.current : undefined;
    onCommit(textareaRef.current?.value ?? '', shrunk);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committedRef.current = true; // Prevent blur from also committing
      onCancel();
    }
  };

  const handleBlur = () => {
    doCommit();
  };

  const effectiveWidth = Math.max(screenWidth, 80);
  const effectiveHeight = Math.max(screenHeight, 24);

  // Use a wrapper div with flexbox for true vertical+horizontal centering
  if (verticalAlign === 'middle') {
    return (
      <div
        style={{
          position: 'absolute',
          left: `${screenPos.x}px`,
          top: `${screenPos.y}px`,
          width: `${effectiveWidth}px`,
          height: `${effectiveHeight}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: '2px',
          zIndex: 10,
          boxSizing: 'border-box',
          background: background,
        }}
        onClick={(e) => {
          // Focus textarea when clicking the wrapper
          e.stopPropagation();
          textareaRef.current?.focus();
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          data-testid="inline-edit-overlay"
          defaultValue={initialText}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onContextMenu={(e) => { e.preventDefault(); doCommit(); }}
          onInput={(e) => {
            editorTextRef.current = e.currentTarget.value;
            fitTextarea(e.currentTarget);
          }}
          style={{
            width: '85%',
            maxHeight: `${effectiveHeight * 0.9}px`,
            padding: 0,
            margin: 0,
            border: 'none',
            outline: 'none',
            fontSize: `${scaledFontSize}px`,
            fontFamily: fontFamily,
            color: color,
            textAlign: textAlign as React.CSSProperties['textAlign'],
            verticalAlign: 'top',
            background: 'transparent',
            resize: 'none',
            overflow: 'hidden',
            lineHeight: 1.4,
            display: 'block',
          }}
        />
      </div>
    );
  }

  return (
    <textarea
      ref={textareaRef}
      data-testid="inline-edit-overlay"
      defaultValue={initialText}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onContextMenu={(e) => { e.preventDefault(); doCommit(); }}
      style={{
        position: 'absolute',
        left: `${screenPos.x}px`,
        top: `${screenPos.y}px`,
        width: `${effectiveWidth}px`,
        height: `${effectiveHeight}px`,
        padding: 0,
        margin: 0,
        border: 'none',
        borderRadius: '2px',
        outline: 'none',
        fontSize: `${scaledFontSize}px`,
        fontFamily: fontFamily,
        color: color,
        textAlign: textAlign as React.CSSProperties['textAlign'],
        verticalAlign: 'top',
        background: background,
        resize: 'none',
        zIndex: 10,
        boxSizing: 'border-box',
        overflow: 'hidden',
        lineHeight: 1.4,
        display: 'block',
      }}
    />
  );
}
