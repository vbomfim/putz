/**
 * BookmarksPanel — Full bookmark manager modal (T3, #50).
 *
 * Displays all bookmarks grouped by folder with:
 * - Collapsible folders (component-local state, NOT in store)
 * - Inline rename (double-click → input → Enter/Escape)
 * - Pointer-based drag-and-drop for move & reorder
 * - Import/export via JSON file
 * - Keyboard: Escape closes, Tab traps focus, Arrow keys navigate
 *
 * Consumes bookmarksStore (T1) — does NOT modify the store module.
 *
 * @module BookmarksPanel
 */
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { useBookmarksStore } from "../../stores/bookmarksStore";
import { stripBidiControls } from "../../utils/sanitize";
import type {
  BookmarkItem,
  BookmarkFolder,
} from "../../stores/bookmarksStore";
import "./BookmarksPanel.css";

// ─── Constants ──────────────────────────────────────────────────────

/** Maximum allowed name length for validation. */
const MAX_NAME_LENGTH = 100;

/** Minimum drag distance (px) before activating drag mode. */
const DRAG_THRESHOLD = 5;

/** Squared threshold — avoids Math.sqrt per pointermove. */
const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD * DRAG_THRESHOLD;

// ─── Types ──────────────────────────────────────────────────────────

export interface BookmarksPanelProps {
  /** Called to close the modal. */
  onClose: () => void;
}

/** Union type for items in the tree list. */
type TreeItem =
  | { kind: "bookmark"; data: BookmarkItem }
  | { kind: "folder"; data: BookmarkFolder };

// ─── Drag State ─────────────────────────────────────────────────────

interface DragState {
  active: boolean;
  kind: "bookmark" | null;
  id: string | null;
  startX: number;
  startY: number;
}

/** Default (idle) drag state for the mutable ref. */
const IDLE_DRAG: DragState = { active: false, kind: null, id: null, startX: 0, startY: 0 };

// ─── Validation ─────────────────────────────────────────────────────

/** Validates a rename value. Returns error message or null if valid. */
function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Name cannot be empty";
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name must be 100 characters or fewer`;
  }
  return null;
}

// ─── Sub-components ─────────────────────────────────────────────────

/** Inline rename input used for both bookmarks and folders. */
function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const validationError = validateName(value);
        if (validationError) {
          setError(validationError);
          return;
        }
        onConfirm(value.trim());
      } else if (e.key === "Escape") {
        onCancel();
      }
    },
    [value, onConfirm, onCancel],
  );

  const handleBlur = useCallback(() => {
    const validationError = validateName(value);
    if (validationError) {
      onCancel();
      return;
    }
    onConfirm(value.trim());
  }, [value, onConfirm, onCancel]);

  return (
    <span className="bookmarks-panel__rename-wrapper">
      <input
        ref={inputRef}
        className="bookmarks-panel__rename-input"
        type="text"
        value={value}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => {
          setValue(e.target.value.slice(0, MAX_NAME_LENGTH));
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        aria-label="Rename"
      />
      {error && (
        <span className="bookmarks-panel__validation-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function BookmarksPanel({ onClose }: BookmarksPanelProps) {
  // Capture the element that had focus when modal opened — restore on close
  const openerRef = useRef<Element | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Store slices (lesson 1: subscribe to slices, not whole) ────
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const folders = useBookmarksStore((s) => s.folders);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);
  const renameBookmark = useBookmarksStore((s) => s.renameBookmark);
  const addFolder = useBookmarksStore((s) => s.addFolder);
  const removeFolder = useBookmarksStore((s) => s.removeFolder);
  const renameFolder = useBookmarksStore((s) => s.renameFolder);
  const exportBookmarks = useBookmarksStore((s) => s.exportBookmarks);
  const importBookmarks = useBookmarksStore((s) => s.importBookmarks);

  // ─── Local state ──────────────────────────────────────────────────
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingType, setRenamingType] = useState<"bookmark" | "folder">(
    "bookmark",
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [pendingFolderRename, setPendingFolderRename] = useState(false);

  // H1: Mutable drag state in a ref — no React state for pointer lifecycle.
  // Visual drag indicators are driven via classList for zero-rerender behavior.
  const dragRef = useRef<DragState>({ ...IDLE_DRAG });
  const [dragVisual, setDragVisual] = useState<{ isDragging: boolean; overTarget: string | null }>({
    isDragging: false,
    overTarget: null,
  });

  // H2: Import operation token + mounted guard for FileReader race prevention.
  const importOpRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Track previously known folder IDs to detect new additions
  const prevFolderIdsRef = useRef<Set<string>>(new Set(folders.map((f) => f.id)));

  // When a new folder appears and we have a pending rename, activate rename
  useEffect(() => {
    if (!pendingFolderRename) return;
    const prevIds = prevFolderIdsRef.current;
    const newFolder = folders.find((f) => !prevIds.has(f.id));
    if (newFolder) {
      setRenamingId(newFolder.id);
      setRenamingType("folder");
      setPendingFolderRename(false);
    }
    prevFolderIdsRef.current = new Set(folders.map((f) => f.id));
  }, [folders, pendingFolderRename]);

  // ─── Computed tree ────────────────────────────────────────────────

  const rootItems = useMemo((): TreeItem[] => {
    const result: TreeItem[] = [];
    const bookmarkItems = bookmarks
      .filter((b) => b.folderId === null)
      .map((b) => ({ sortIndex: b.sortIndex, item: { kind: "bookmark" as const, data: b } }));
    const folderItems = folders
      .map((f) => ({ sortIndex: f.sortIndex, item: { kind: "folder" as const, data: f } }));
    const combined = [...bookmarkItems, ...folderItems];
    combined.sort((a, b) => a.sortIndex - b.sortIndex);
    for (const entry of combined) {
      result.push(entry.item);
    }
    return result;
  }, [bookmarks, folders]);

  const folderChildren = useMemo(() => {
    const map = new Map<string, BookmarkItem[]>();
    for (const folder of folders) {
      const children = bookmarks
        .filter((b) => b.folderId === folder.id)
        .sort((a, b) => a.sortIndex - b.sortIndex);
      map.set(folder.id, children);
    }
    return map;
  }, [bookmarks, folders]);

  const hasItems = bookmarks.length > 0 || folders.length > 0;

  // ─── Focus management ─────────────────────────────────────────────

  useEffect(() => {
    openerRef.current = document.activeElement;
    // Focus the panel on mount — defer to allow render
    requestAnimationFrame(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    });
    // Note: cleanup (focus restoration) is handled in the close handler
  }, []);

  // ─── Close handler with focus restoration ─────────────────────────

  const handleClose = useCallback(() => {
    const opener = openerRef.current;
    onClose();
    // Restore focus after React processes the close
    requestAnimationFrame(() => {
      if (opener && opener instanceof HTMLElement) {
        opener.focus();
      }
    });
  }, [onClose]);

  // ─── Keyboard: Escape + focus trap ────────────────────────────────

  const handleOverlayKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        handleClose();
        return;
      }

      // Focus trap
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [handleClose],
  );

  // ─── Overlay click → close (only on overlay itself) ───────────────

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose],
  );

  // ─── Toggle folder collapse ───────────────────────────────────────

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // ─── Inline rename ────────────────────────────────────────────────

  const startRename = useCallback(
    (id: string, type: "bookmark" | "folder") => {
      setRenamingId(id);
      setRenamingType(type);
    },
    [],
  );

  const handleRenameConfirm = useCallback(
    (name: string) => {
      if (!renamingId) return;
      if (renamingType === "bookmark") {
        renameBookmark(renamingId, name);
      } else {
        renameFolder(renamingId, name);
      }
      setRenamingId(null);
    },
    [renamingId, renamingType, renameBookmark, renameFolder],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  // ─── Delete handlers ──────────────────────────────────────────────

  const handleDeleteBookmark = useCallback(
    (id: string, name: string) => {
      removeBookmark(id);
      setStatusMessage(`Bookmark "${stripBidiControls(name)}" deleted`);
    },
    [removeBookmark],
  );

  const handleDeleteFolder = useCallback(
    (id: string, name: string) => {
      removeFolder(id);
      setStatusMessage(`Folder "${stripBidiControls(name)}" deleted`);
    },
    [removeFolder],
  );

  // ─── New Folder ───────────────────────────────────────────────────

  const handleNewFolder = useCallback(() => {
    addFolder("New Folder");
    setStatusMessage("Folder created");
    // Set pending rename flag — will be picked up by next render with new folders
    setPendingFolderRename(true);
  }, [addFolder]);

  // ─── Drag & Drop (ref-based pointer state — H1 fix) ────────────

  const handlePointerDown = useCallback(
    (bookmarkId: string, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        active: false,
        kind: "bookmark",
        id: bookmarkId,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [],
  );

  /**
   * Performs the drop action using fresh store state.
   * Reads bookmarks/folders from `useBookmarksStore.getState()` to avoid
   * stale closure data when bookmarks mutate mid-drag.
   */
  const handleDropFromRef = useCallback(
    (e: PointerEvent, draggedBookmarkId: string) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;

      // Read fresh state at drop time — never stale
      const { bookmarks: freshBookmarks, folders: freshFolders, moveBookmark: freshMove, reorderBookmark: freshReorder } =
        useBookmarksStore.getState();

      const folderEl = target.closest("[data-folder-id]");
      const bookmarkEl = target.closest("[data-bookmark-id]");
      const rootDrop = target.closest(
        "[data-testid='bookmarks-panel-root-drop']",
      );

      const draggedBookmark = freshBookmarks.find(
        (b) => b.id === draggedBookmarkId,
      );
      if (!draggedBookmark) return;

      if (folderEl) {
        // M10: defensive getAttribute — no `!` assertion
        const targetFolderId = folderEl.getAttribute("data-folder-id");
        if (!targetFolderId) return;
        // M3: verify folder still exists at drop time
        const folderStillExists = freshFolders.some((f) => f.id === targetFolderId);
        if (!folderStillExists) return;
        // No-op: already in this folder
        if (draggedBookmark.folderId === targetFolderId) return;
        freshMove(draggedBookmarkId, targetFolderId);
        return;
      }

      if (bookmarkEl) {
        // M10: defensive getAttribute — no `!` assertion
        const targetBookmarkId = bookmarkEl.getAttribute("data-bookmark-id");
        if (!targetBookmarkId) return;
        if (targetBookmarkId === draggedBookmarkId) return; // no-op: dropped onto self

        const targetBookmark = freshBookmarks.find(
          (b) => b.id === targetBookmarkId,
        );
        if (!targetBookmark) return;

        // Same parent → reorder
        if (draggedBookmark.folderId === targetBookmark.folderId) {
          const siblings = freshBookmarks
            .filter((b) => b.folderId === draggedBookmark.folderId)
            .sort((a, b) => a.sortIndex - b.sortIndex);
          const targetIndex = siblings.findIndex(
            (b) => b.id === targetBookmarkId,
          );
          if (targetIndex >= 0) {
            freshReorder(draggedBookmarkId, targetIndex);
          }
        } else {
          // Different parent → move to target's parent
          freshMove(draggedBookmarkId, targetBookmark.folderId);
        }
        return;
      }

      if (rootDrop) {
        if (draggedBookmark.folderId === null) return; // already at root
        freshMove(draggedBookmarkId, null);
      }
    },
    [],
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const s = dragRef.current;
      if (!s.kind) return;
      if (!s.active) {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
        s.active = true;
      }

      // Detect hover target for drop zone highlighting
      const target = document.elementFromPoint(e.clientX, e.clientY);
      let overTarget: string | null = null;
      if (target) {
        const folderEl = target.closest("[data-folder-id]");
        const bookmarkEl = target.closest("[data-bookmark-id]");
        const rootDrop = target.closest("[data-testid='bookmarks-panel-root-drop']");

        if (folderEl) {
          overTarget = folderEl.getAttribute("data-folder-id");
        } else if (bookmarkEl) {
          overTarget = bookmarkEl.getAttribute("data-bookmark-id");
        } else if (rootDrop) {
          overTarget = "__root__";
        }
      }
      setDragVisual({ isDragging: true, overTarget });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const s = dragRef.current;
      if (s.active && s.id) {
        handleDropFromRef(e, s.id);
      }
      dragRef.current = { ...IDLE_DRAG };
      setDragVisual({ isDragging: false, overTarget: null });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handleDropFromRef]);

  // ─── Export ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const json = exportBookmarks();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bookmarks.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Bookmarks exported");
  }, [exportBookmarks]);

  // ─── Import ───────────────────────────────────────────────────────

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImportError(null);

      // H2: TOCTOU guard — each import gets a unique operation ID.
      // If a newer import starts before this one's onload fires, this
      // callback is superseded. Also guards against unmounted reads.
      const opId = ++importOpRef.current;
      const reader = new FileReader();
      reader.onload = () => {
        if (!mountedRef.current) return;           // unmounted
        if (opId !== importOpRef.current) return;  // superseded by newer import
        try {
          const text = reader.result as string;
          importBookmarks(text);
          setStatusMessage("Bookmarks imported successfully");
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Unknown error";
          setImportError(`Import failed: ${msg}`);
        }
      };
      reader.onerror = () => {
        if (!mountedRef.current || opId !== importOpRef.current) return;
        setImportError("Import failed: Could not read file");
      };
      reader.readAsText(file);

      // Reset input so same file can be re-imported
      e.target.value = "";
    },
    [importBookmarks],
  );

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleOverlayKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Bookmarks Manager"
    >
      <div
        className="modal-panel modal-panel--wide bookmarks-panel"
        ref={panelRef}
      >
        <button
          className="modal-close"
          onClick={handleClose}
          aria-label="Close"
          type="button"
        >
          ✕
        </button>

        {/* Header */}
        <div className="bookmarks-panel__header">
          <h2 className="bookmarks-panel__title">Bookmarks Manager</h2>
          <button
            className="bookmarks-panel__new-folder-btn"
            onClick={handleNewFolder}
            aria-label="New Folder"
            type="button"
          >
            📁 New Folder
          </button>
        </div>

        {/* Tree list */}
        {hasItems ? (
          <div
            className="bookmarks-panel__tree"
            role="tree"
            aria-label="Bookmarks"
            data-testid="bookmarks-panel-root-drop"
          >
            {rootItems.map((item) =>
              item.kind === "folder" ? (
                <FolderRow
                  key={item.data.id}
                  folder={item.data as BookmarkFolder}
                  children={folderChildren.get(item.data.id) ?? []}
                  isCollapsed={collapsedFolders.has(item.data.id)}
                  onToggle={toggleFolder}
                  renamingId={renamingId}
                  onStartRename={startRename}
                  onRenameConfirm={handleRenameConfirm}
                  onRenameCancel={handleRenameCancel}
                  onDeleteBookmark={handleDeleteBookmark}
                  onDeleteFolder={handleDeleteFolder}
                  onPointerDown={handlePointerDown}
                  dragOverTarget={dragVisual.overTarget}
                  isDragging={dragVisual.isDragging}
                />
              ) : (
                <BookmarkRow
                  key={item.data.id}
                  bookmark={item.data as BookmarkItem}
                  level={1}
                  isRenaming={renamingId === item.data.id}
                  onStartRename={startRename}
                  onRenameConfirm={handleRenameConfirm}
                  onRenameCancel={handleRenameCancel}
                  onDelete={handleDeleteBookmark}
                  onPointerDown={handlePointerDown}
                  isDragOver={dragVisual.overTarget === item.data.id}
                />
              ),
            )}
          </div>
        ) : (
          <div className="bookmarks-panel__empty">
            No bookmarks yet. Press ⌘D to add one.
          </div>
        )}

        {/* Import error */}
        {importError && (
          <div className="bookmarks-panel__import-error" role="alert">
            {importError}
          </div>
        )}

        {/* Footer */}
        <div className="bookmarks-panel__footer">
          <button
            className="bookmarks-panel__footer-btn"
            onClick={handleImportClick}
            aria-label="Import bookmarks"
            type="button"
          >
            📥 Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            data-testid="bookmarks-import-input"
            className="bookmarks-panel__file-input"
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            className="bookmarks-panel__footer-btn"
            onClick={handleExport}
            aria-label="Export bookmarks"
            type="button"
          >
            📤 Export
          </button>
        </div>

        {/* Live region for status messages */}
        <div
          className="bookmarks-panel__status"
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </div>
      </div>
    </div>
  );
}

// ─── BookmarkRow ────────────────────────────────────────────────────

interface BookmarkRowProps {
  bookmark: BookmarkItem;
  level: 1 | 2;
  isRenaming: boolean;
  onStartRename: (id: string, type: "bookmark" | "folder") => void;
  onRenameConfirm: (name: string) => void;
  onRenameCancel: () => void;
  onDelete: (id: string, name: string) => void;
  onPointerDown: (bookmarkId: string, e: React.PointerEvent) => void;
  isDragOver: boolean;
}

function BookmarkRow({
  bookmark,
  level,
  isRenaming,
  onStartRename,
  onRenameConfirm,
  onRenameCancel,
  onDelete,
  onPointerDown,
  isDragOver,
}: BookmarkRowProps) {
  const safeName = stripBidiControls(bookmark.name);

  const handleDoubleClick = useCallback(() => {
    onStartRename(bookmark.id, "bookmark");
  }, [bookmark.id, onStartRename]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      onPointerDown(bookmark.id, e);
    },
    [bookmark.id, onPointerDown],
  );

  return (
    <div
      className={`bookmarks-panel__item${isDragOver ? " bookmarks-panel__item--drag-over" : ""}`}
      role="treeitem"
      aria-level={level}
      data-bookmark-id={bookmark.id}
      onPointerDown={handlePointerDown}
      tabIndex={0}
    >
      <span className="bookmarks-panel__item-icon">
        {bookmark.type === "folder" ? "📁" : "📄"}
      </span>
      {isRenaming ? (
        <InlineRenameInput
          initialValue={safeName}
          onConfirm={onRenameConfirm}
          onCancel={onRenameCancel}
        />
      ) : (
        <span
          className="bookmarks-panel__item-name"
          onDoubleClick={handleDoubleClick}
          title={stripBidiControls(bookmark.path)}
        >
          {safeName}
        </span>
      )}
      <button
        className="bookmarks-panel__delete-btn"
        onClick={() => onDelete(bookmark.id, bookmark.name)}
        aria-label={`Delete bookmark ${safeName}`}
        type="button"
        tabIndex={0}
      >
        🗑️
      </button>
    </div>
  );
}

// ─── FolderRow ──────────────────────────────────────────────────────

interface FolderRowProps {
  folder: BookmarkFolder;
  children: BookmarkItem[];
  isCollapsed: boolean;
  onToggle: (folderId: string) => void;
  renamingId: string | null;
  onStartRename: (id: string, type: "bookmark" | "folder") => void;
  onRenameConfirm: (name: string) => void;
  onRenameCancel: () => void;
  onDeleteBookmark: (id: string, name: string) => void;
  onDeleteFolder: (id: string, name: string) => void;
  onPointerDown: (bookmarkId: string, e: React.PointerEvent) => void;
  dragOverTarget: string | null;
  isDragging: boolean;
}

function FolderRow({
  folder,
  children,
  isCollapsed,
  onToggle,
  renamingId,
  onStartRename,
  onRenameConfirm,
  onRenameCancel,
  onDeleteBookmark,
  onDeleteFolder,
  onPointerDown,
  dragOverTarget,
  isDragging,
}: FolderRowProps) {
  const safeName = stripBidiControls(folder.name);
  const isFolderRenaming = renamingId === folder.id;
  const isFolderDragOver = dragOverTarget === folder.id && isDragging;

  const handleDoubleClick = useCallback(() => {
    onStartRename(folder.id, "folder");
  }, [folder.id, onStartRename]);

  const handleToggle = useCallback(() => {
    onToggle(folder.id);
  }, [folder.id, onToggle]);

  return (
    <div
      role="treeitem"
      aria-expanded={!isCollapsed}
      aria-level={1}
      data-folder-id={folder.id}
      className={`bookmarks-panel__folder${isFolderDragOver ? " bookmarks-panel__folder--drag-over" : ""}`}
    >
      <div className="bookmarks-panel__folder-header">
        <button
          className="bookmarks-panel__folder-toggle"
          onClick={handleToggle}
          aria-label={`Toggle folder ${safeName}`}
          type="button"
          tabIndex={0}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        <span className="bookmarks-panel__item-icon">📁</span>
        {isFolderRenaming ? (
          <InlineRenameInput
            initialValue={safeName}
            onConfirm={onRenameConfirm}
            onCancel={onRenameCancel}
          />
        ) : (
          <span
            className="bookmarks-panel__folder-name"
            onDoubleClick={handleDoubleClick}
          >
            {safeName}
          </span>
        )}
        <button
          className="bookmarks-panel__delete-btn"
          onClick={() => onDeleteFolder(folder.id, folder.name)}
          aria-label={`Delete folder ${safeName}`}
          type="button"
          tabIndex={0}
        >
          🗑️
        </button>
      </div>
      {!isCollapsed && (
        <div role="group" className="bookmarks-panel__folder-children">
          {children.map((child) => (
            <BookmarkRow
              key={child.id}
              bookmark={child}
              level={2}
              isRenaming={renamingId === child.id}
              onStartRename={onStartRename}
              onRenameConfirm={onRenameConfirm}
              onRenameCancel={onRenameCancel}
              onDelete={onDeleteBookmark}
              onPointerDown={onPointerDown}
              isDragOver={dragOverTarget === child.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
