/**
 * ExportMenu — dropdown menu for export and import actions.
 *
 * Provides Export PNG, Export SVG, Export JSON, Export .drawio,
 * Import JSON, and Import .drawio options. Uses file inputs for
 * JSON and draw.io import with validation. [CLEAN-CODE]
 *
 * @module
 */

import { useState, useRef, useCallback } from 'react';
import { useCanvasStoreApi, useUiStore } from '../../engine';
import { exportToJson, importFromJson, buildSvgString, downloadSvg, exportToPng } from '../../engine';
import { expressionsToDrawio, drawioToExpressions } from '../../protocol';
import { Download } from 'lucide-react';

/** Menu option definition. */
interface MenuOption {
  action: string;
  label: string;
  onClick: () => void;
}

/** Export/Import menu dropdown component. */
export function ExportMenu() {
  const storeApi = useCanvasStoreApi();
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawioFileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJson = useCallback(() => {
    const { expressions, expressionOrder } = storeApi.getState();
    const json = exportToJson(expressions, expressionOrder);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'infinicanvas-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsOpen(false);
  }, [storeApi]);

  const handleExportSvg = useCallback(() => {
    const { expressions, expressionOrder } = storeApi.getState();
    const theme = useUiStore.getState().theme;
    const svg = buildSvgString(expressions, expressionOrder, theme);
    downloadSvg(svg, 'infinicanvas-export.svg');
    setIsOpen(false);
  }, [storeApi]);

  const handleExportPng = useCallback(() => {
    const { expressions, expressionOrder } = storeApi.getState();
    const theme = useUiStore.getState().theme;

    void exportToPng(
      expressions,
      expressionOrder,
      theme,
      (ctx, exprs, order) => {
        // Simple rendering for PNG: draw rectangles for each expression
        for (const id of order) {
          const expr = exprs[id];
          if (!expr) continue;
          ctx.strokeStyle = expr.style.strokeColor;
          ctx.lineWidth = expr.style.strokeWidth;
          const fill = expr.style.backgroundColor;
          if (fill && fill !== 'transparent') {
            ctx.fillStyle = fill;
            ctx.fillRect(expr.position.x, expr.position.y, expr.size.width, expr.size.height);
          }
          ctx.strokeRect(expr.position.x, expr.position.y, expr.size.width, expr.size.height);
        }
      },
    );
    setIsOpen(false);
  }, [storeApi]);

  const handleImportJson = useCallback(() => {
    fileInputRef.current?.click();
    setIsOpen(false);
  }, []);

  const handleExportDrawio = useCallback(() => {
    const { expressions, expressionOrder } = storeApi.getState();
    const expressionArray = expressionOrder
      .map((id) => expressions[id])
      .filter((e): e is NonNullable<typeof e> => e != null);
    const xml = expressionsToDrawio(expressionArray);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'infinicanvas-export.drawio';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsOpen(false);
  }, [storeApi]);

  const handleImportDrawio = useCallback(() => {
    drawioFileInputRef.current?.click();
    setIsOpen(false);
  }, []);

  const handleDrawioFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      try {
        const imported = drawioToExpressions(content);
        if (imported.length === 0) {
          alert('No drawable elements found in the draw.io file.');
          return;
        }
        const store = storeApi.getState();
        const mergedExpressions = { ...store.expressions };
        const mergedOrder = [...store.expressionOrder];
        for (const expr of imported) {
          mergedExpressions[expr.id] = expr;
          mergedOrder.push(expr.id);
        }
        store.replaceState(Object.values(mergedExpressions), mergedOrder);
      } catch (err) {
        console.error('[ExportMenu] draw.io import failed:', err);
        alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.onerror = () => alert('Failed to read file.');
    reader.readAsText(file);

    // Reset input so same file can be re-imported
    e.target.value = '';
  }, [storeApi]);

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const result = importFromJson(content);
      if (result.success) {
        storeApi.getState().replaceState(
          result.data.expressions,
          result.data.expressionOrder,
        );
      } else {
        console.error('[ExportMenu] Import failed:', result.error);
        // Use alert for user-facing error — simple and accessible
        alert(`Import failed: ${result.error}`);
      }
    };
    reader.onerror = () => alert('Failed to read file.');
    reader.readAsText(file);

    // Reset input so same file can be re-imported
    e.target.value = '';
  }, [storeApi]);

  const options: MenuOption[] = [
    { action: 'export-png', label: 'Export PNG', onClick: handleExportPng },
    { action: 'export-svg', label: 'Export SVG', onClick: handleExportSvg },
    { action: 'export-json', label: 'Export JSON', onClick: handleExportJson },
    { action: 'export-drawio', label: 'Export .drawio', onClick: handleExportDrawio },
    { action: 'import-json', label: 'Import JSON', onClick: handleImportJson },
    { action: 'import-drawio', label: 'Import .drawio', onClick: handleImportDrawio },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Export menu"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          backgroundColor: 'transparent',
          color: 'var(--text-primary, #333333)',
          transition: 'background-color 0.15s, color 0.15s',
        }}
      >
        <Download size={18} />
      </button>

      {isOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 160,
            backgroundColor: 'var(--bg-toolbar, #ffffff)',
            border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 8,
            boxShadow: '0 4px 12px var(--shadow, rgba(0,0,0,0.12))',
            padding: '4px 0',
            zIndex: 100,
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.action}
              type="button"
              role="menuitem"
              data-action={opt.action}
              onClick={opt.onClick}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-primary, #333333)',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* Hidden file input for draw.io import */}
      <input
        ref={drawioFileInputRef}
        type="file"
        accept=".drawio,.xml,application/xml"
        onChange={handleDrawioFileSelected}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
}
