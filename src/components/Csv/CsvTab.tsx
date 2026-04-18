/**
 * CsvTab — visual CSV / TSV editor.
 *
 * Features:
 *  - Auto-detected delimiter (comma, semicolon, tab, pipe)
 *  - Toggle: first row is header
 *  - Click header to sort (asc / desc / none)
 *  - Drag column header to reorder
 *  - Freeze N left columns + frozen header row
 *  - Search bar (substring across all cells)
 *  - Editable cells (click → input)
 *  - Add / delete row, add / delete / rename column
 *  - Save back to disk via PapaParse round-trip
 *  - Switch to text mode (open same file in Monaco)
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileRead, fileWrite, fileMtime } from "../Scripting/editorApi";
import { useLayoutStore } from "../../stores/layoutStore";
import { parseCsv, serializeCsv, columnName, type CsvParsed } from "./csvIo";
import "./CsvTab.css";

interface CsvTabProps {
  filePath: string;
  regionId: string;
  tabId: string;
}

type SortDirection = "asc" | "desc" | null;

const ROW_HEIGHT = 28;

export function CsvTab({ filePath, regionId, tabId }: CsvTabProps) {
  const [parsed, setParsed] = useState<CsvParsed | null>(null);
  const [columnOrder, setColumnOrder] = useState<number[]>([]); // permutation of [0..colCount-1]
  const [hasHeader, setHasHeader] = useState(false);
  const [sortBy, setSortBy] = useState<{ col: number; dir: SortDirection }>({ col: -1, dir: null });
  const [search, setSearch] = useState("");
  const [frozenCols, setFrozenCols] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renamingCol, setRenamingCol] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; col?: number; row?: number } | null>(null);
  const lastMtimeRef = useRef<number>(0);

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const dragColRef = useRef<number | null>(null);

  const addEditorTab = useLayoutStore((s) => s.addEditorTab);
  const closeTab = useLayoutStore((s) => s.closeTab);

  // Load file
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        const text = await fileRead(filePath);
        if (cancelled) return;
        const ext = filePath.split(".").pop()?.toLowerCase();
        const initialDelimiter = ext === "tsv" ? "\t" : undefined;
        const p = parseCsv(text, { hasHeader: false, delimiter: initialDelimiter });
        setParsed(p);
        setHasHeader(false);
        setColumnOrder(p.headers.map((_, i) => i));
        try {
          lastMtimeRef.current = await fileMtime(filePath);
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Toggle header — re-derive headers from current top row or synthesize
  const toggleHeader = useCallback(() => {
    if (!parsed) return;
    if (!hasHeader) {
      // promote first row to header
      if (parsed.rows.length === 0) return;
      const newHeaders = parsed.rows[0];
      const newRows = parsed.rows.slice(1);
      const newParsed: CsvParsed = { ...parsed, headers: newHeaders, rows: newRows, hasHeader: true };
      setParsed(newParsed);
      setHasHeader(true);
      setIsDirty(true);
    } else {
      // demote header back into rows
      const newRows = [parsed.headers, ...parsed.rows];
      const colCount = parsed.headers.length;
      const newHeaders: string[] = [];
      for (let i = 0; i < colCount; i++) newHeaders.push(columnName(i));
      const newParsed: CsvParsed = { ...parsed, headers: newHeaders, rows: newRows, hasHeader: false };
      setParsed(newParsed);
      setHasHeader(false);
      setIsDirty(true);
    }
  }, [parsed, hasHeader]);

  // Search filtering returns subset of rows with original indices
  const filteredRows = useMemo(() => {
    if (!parsed) return [] as { idx: number; row: string[] }[];
    const q = search.trim().toLowerCase();
    const indexed = parsed.rows.map((row, idx) => ({ idx, row }));
    if (!q) return indexed;
    return indexed.filter(({ row }) => row.some((cell) => cell.toLowerCase().includes(q)));
  }, [parsed, search]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (sortBy.col < 0 || !sortBy.dir) return filteredRows;
    const dir = sortBy.dir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = a.row[sortBy.col] ?? "";
      const bv = b.row[sortBy.col] ?? "";
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      const bothNum = !isNaN(an) && !isNaN(bn) && av.trim() !== "" && bv.trim() !== "";
      if (bothNum) return (an - bn) * dir;
      return av.localeCompare(bv) * dir;
    });
  }, [filteredRows, sortBy]);

  // Virtualizer (uses sortedRows length)
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Cell edit commit
  const commitEdit = useCallback(() => {
    if (!parsed || !editingCell) return;
    const { row, col } = editingCell;
    const newRows = parsed.rows.map((r, i) => {
      if (i !== row) return r;
      const out = r.slice();
      while (out.length <= col) out.push("");
      out[col] = editValue;
      return out;
    });
    setParsed({ ...parsed, rows: newRows });
    setEditingCell(null);
    setEditValue("");
    setIsDirty(true);
  }, [parsed, editingCell, editValue]);

  // Header rename commit
  const commitRename = useCallback(() => {
    if (!parsed || renamingCol === null) return;
    const newHeaders = parsed.headers.slice();
    newHeaders[renamingCol] = renameValue;
    setParsed({ ...parsed, headers: newHeaders });
    setRenamingCol(null);
    setRenameValue("");
    setIsDirty(true);
  }, [parsed, renamingCol, renameValue]);

  // Save
  const handleSave = useCallback(async () => {
    if (!parsed) return;
    try {
      const text = serializeCsv(parsed);
      await fileWrite(filePath, text);
      try {
        lastMtimeRef.current = await fileMtime(filePath);
      } catch {
        /* ignore */
      }
      setIsDirty(false);
      setStatusMessage("Saved");
      setTimeout(() => setStatusMessage(""), 2000);
    } catch (e) {
      setError(`Save failed: ${e}`);
    }
  }, [parsed, filePath]);

  // Open in text mode (close this tab, open Monaco on same file)
  const handleSwitchToText = useCallback(() => {
    closeTab(regionId, tabId);
    addEditorTab(regionId, filePath);
  }, [closeTab, regionId, tabId, addEditorTab, filePath]);

  // Column ops
  const insertColumn = useCallback(
    (afterCol: number) => {
      if (!parsed) return;
      const insertAt = afterCol + 1;
      const newHeaders = parsed.headers.slice();
      newHeaders.splice(insertAt, 0, columnName(parsed.headers.length));
      const newRows = parsed.rows.map((r) => {
        const out = r.slice();
        out.splice(insertAt, 0, "");
        return out;
      });
      setParsed({ ...parsed, headers: newHeaders, rows: newRows });
      setColumnOrder((prev) => {
        const expanded = [...prev, prev.length];
        return expanded;
      });
      setIsDirty(true);
    },
    [parsed],
  );

  const deleteColumn = useCallback(
    (col: number) => {
      if (!parsed) return;
      const newHeaders = parsed.headers.filter((_, i) => i !== col);
      const newRows = parsed.rows.map((r) => r.filter((_, i) => i !== col));
      setParsed({ ...parsed, headers: newHeaders, rows: newRows });
      setColumnOrder((prev) => prev.filter((i) => i !== col).map((i) => (i > col ? i - 1 : i)));
      setIsDirty(true);
    },
    [parsed],
  );

  const insertRow = useCallback(
    (afterRow: number) => {
      if (!parsed) return;
      const insertAt = afterRow + 1;
      const blank: string[] = parsed.headers.map(() => "");
      const newRows = parsed.rows.slice();
      newRows.splice(insertAt, 0, blank);
      setParsed({ ...parsed, rows: newRows });
      setIsDirty(true);
    },
    [parsed],
  );

  const deleteRow = useCallback(
    (row: number) => {
      if (!parsed) return;
      const newRows = parsed.rows.filter((_, i) => i !== row);
      setParsed({ ...parsed, rows: newRows });
      setIsDirty(true);
    },
    [parsed],
  );

  // Save shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  if (isLoading) return <div className="csv-tab__loading">Loading…</div>;
  if (error) return <div className="csv-tab__error">{error}</div>;
  if (!parsed) return <div className="csv-tab__loading">No data</div>;

  const orderedCols = columnOrder;
  const totalCols = parsed.headers.length;
  const safeFrozen = Math.min(frozenCols, Math.max(0, totalCols - 1));

  // Compute left offsets for frozen columns (by position in orderedCols)
  const frozenLeftOffsets: Map<number, number> = new Map();
  let cum = 40; // leading row-number column width
  for (let i = 0; i < safeFrozen && i < orderedCols.length; i++) {
    frozenLeftOffsets.set(i, cum);
    cum += 160;
  }

  return (
    <div className="csv-tab">
      <div className="csv-tab__toolbar">
        <button
          type="button"
          className="csv-tab__btn csv-tab__btn--primary"
          onClick={handleSave}
          disabled={!isDirty}
          title="Save (Cmd/Ctrl+S)"
        >
          {isDirty ? "● Save" : "Saved"}
        </button>
        <span className="csv-tab__sep" />
        <input
          type="search"
          className="csv-tab__search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="csv-tab__sep" />
        <label className="csv-tab__check" title="Treat the first row as column headers">
          <input type="checkbox" checked={hasHeader} onChange={toggleHeader} />
          <span>First row is header</span>
        </label>
        <label className="csv-tab__check" title="Number of frozen left columns">
          <span>Freeze:</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, totalCols - 1)}
            value={safeFrozen}
            onChange={(e) => setFrozenCols(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
            className="csv-tab__num"
          />
        </label>
        <span className="csv-tab__sep" />
        <button type="button" className="csv-tab__btn" onClick={() => insertRow(parsed.rows.length - 1)}>
          + Row
        </button>
        <button type="button" className="csv-tab__btn" onClick={() => insertColumn(totalCols - 1)}>
          + Col
        </button>
        <span className="csv-tab__sep" />
        <button type="button" className="csv-tab__btn" onClick={handleSwitchToText} title="Open this file in the text editor">
          Text Mode
        </button>
        <span className="csv-tab__spacer" />
        <span className="csv-tab__status">
          {sortedRows.length}/{parsed.rows.length} rows · {totalCols} cols ·
          {" "}
          {parsed.delimiter === "\t" ? "TAB" : `"${parsed.delimiter}"`}
          {statusMessage && <span className="csv-tab__status-msg"> · {statusMessage}</span>}
        </span>
      </div>

      <div className="csv-tab__container" ref={tableContainerRef}>
        <table className="csv-tab__table" style={{ width: 40 + orderedCols.length * 160 }}>
          <thead>
            <tr>
              <th className="csv-tab__th csv-tab__th--rownum csv-tab__th--frozen" style={{ left: 0, width: 40 }}>
                #
              </th>
              {orderedCols.map((colIdx, position) => {
                const isFrozen = position < safeFrozen;
                const headerLabel = parsed.headers[colIdx] ?? columnName(colIdx);
                const isSorted = sortBy.col === colIdx;
                const sortGlyph = isSorted ? (sortBy.dir === "asc" ? "▲" : "▼") : "";
                return (
                  <th
                    key={colIdx}
                    className={`csv-tab__th ${isFrozen ? "csv-tab__th--frozen" : ""}`}
                    style={isFrozen ? { left: frozenLeftOffsets.get(position) } : undefined}
                    draggable={renamingCol !== colIdx}
                    onDragStart={() => {
                      dragColRef.current = position;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      const from = dragColRef.current;
                      const to = position;
                      dragColRef.current = null;
                      if (from === null || from === to) return;
                      setColumnOrder((prev) => {
                        const next = prev.slice();
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        return next;
                      });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, col: colIdx });
                    }}
                  >
                    {renamingCol === colIdx ? (
                      <input
                        type="text"
                        autoFocus
                        className="csv-tab__rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setRenamingCol(null);
                            setRenameValue("");
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="csv-tab__th-btn"
                        onClick={() => {
                          setSortBy((prev) => {
                            if (prev.col !== colIdx) return { col: colIdx, dir: "asc" };
                            if (prev.dir === "asc") return { col: colIdx, dir: "desc" };
                            return { col: -1, dir: null };
                          });
                        }}
                        onDoubleClick={() => {
                          if (hasHeader) {
                            setRenamingCol(colIdx);
                            setRenameValue(headerLabel);
                          }
                        }}
                        title={hasHeader ? "Click: sort · Double-click: rename · Right-click: menu" : "Click: sort · Right-click: menu"}
                      >
                        <span className="csv-tab__th-label">{headerLabel}</span>
                        <span className="csv-tab__th-sort">{sortGlyph}</span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ height: rowVirtualizer.getTotalSize(), display: "block", position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = sortedRows[virtualRow.index];
              if (!item) return null;
              const { idx: realRowIdx, row } = item;
              return (
                <tr
                  key={virtualRow.key}
                  className="csv-tab__row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    height: ROW_HEIGHT,
                    display: "table",
                    tableLayout: "fixed",
                  }}
                >
                  <td className="csv-tab__td csv-tab__td--rownum csv-tab__td--frozen" style={{ left: 0, width: 40 }}>
                    {realRowIdx + 1}
                  </td>
                  {orderedCols.map((colIdx, position) => {
                    const isFrozen = position < safeFrozen;
                    const isEditing = editingCell?.row === realRowIdx && editingCell?.col === colIdx;
                    const cellVal = row[colIdx] ?? "";
                    return (
                      <td
                        key={colIdx}
                        className={`csv-tab__td ${isFrozen ? "csv-tab__td--frozen" : ""}`}
                        style={isFrozen ? { left: frozenLeftOffsets.get(position) } : undefined}
                        onClick={() => {
                          if (isEditing) return;
                          setEditingCell({ row: realRowIdx, col: colIdx });
                          setEditValue(cellVal);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, col: colIdx, row: realRowIdx });
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            className="csv-tab__cell-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") {
                                setEditingCell(null);
                                setEditValue("");
                              }
                            }}
                          />
                        ) : (
                          <span className="csv-tab__cell">{cellVal}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <div
          className="csv-tab__menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.col !== undefined && (
            <>
              {hasHeader && (
                <button
                  type="button"
                  className="csv-tab__menu-item"
                  onClick={() => {
                    const c = contextMenu.col!;
                    setRenamingCol(c);
                    setRenameValue(parsed.headers[c] ?? "");
                    setContextMenu(null);
                  }}
                >
                  Rename column
                </button>
              )}
              <button
                type="button"
                className="csv-tab__menu-item"
                onClick={() => {
                  insertColumn(contextMenu.col!);
                  setContextMenu(null);
                }}
              >
                Insert column right
              </button>
              <button
                type="button"
                className="csv-tab__menu-item csv-tab__menu-item--danger"
                onClick={() => {
                  deleteColumn(contextMenu.col!);
                  setContextMenu(null);
                }}
              >
                Delete column
              </button>
            </>
          )}
          {contextMenu.row !== undefined && (
            <>
              <div className="csv-tab__menu-sep" />
              <button
                type="button"
                className="csv-tab__menu-item"
                onClick={() => {
                  insertRow(contextMenu.row!);
                  setContextMenu(null);
                }}
              >
                Insert row below
              </button>
              <button
                type="button"
                className="csv-tab__menu-item csv-tab__menu-item--danger"
                onClick={() => {
                  deleteRow(contextMenu.row!);
                  setContextMenu(null);
                }}
              >
                Delete row
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
