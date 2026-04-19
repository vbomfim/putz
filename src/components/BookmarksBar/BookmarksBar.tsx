/**
 * BookmarksBar — Horizontal bar displaying user bookmarks.
 *
 * Consumes `bookmarksStore` (T1) for data and `settingsStore` for
 * visibility toggle. Renders root-level bookmarks and folders.
 * Folders open as dropdowns (rendered via `createPortal` to avoid
 * overflow clipping). Supports pointer-based drag-to-reorder,
 * keyboard navigation, and horizontal scroll overflow.
 *
 * @module BookmarksBar
 */
import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  memo,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBookmarksStore } from "../../stores/bookmarksStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { stripBidiControls } from "../../utils/sanitize";
import type {
  BookmarkItem,
  BookmarkFolder,
  CommandBookmark,
  CommandGroup,
} from "../../stores/bookmarksStore";
import "./BookmarksBar.css";

// ─── Types ───────────────────────────────────────────────────────────

export interface BookmarksBarProps {
  /** Called when a bookmark item is clicked. */
  onBookmarkClick: (bookmark: BookmarkItem) => void;
}

// ─── Icon Mapping ────────────────────────────────────────────────────

/** Extension-to-emoji mapping per ticket AC7. */
const EXTENSION_ICONS: ReadonlyMap<string, string> = new Map([
  ["csv", "📊"],
  ["tsv", "📊"],
  ["md", "📖"],
  ["markdown", "📖"],
  ["py", "🐍"],
  ["js", "📜"],
  ["ts", "📜"],
  ["jsx", "📜"],
  ["tsx", "📜"],
  ["json", "⚙️"],
  ["yaml", "⚙️"],
  ["yml", "⚙️"],
  ["toml", "⚙️"],
  ["rs", "🦀"],
]);

const FOLDER_ICON = "📁";
const DEFAULT_ICON = "📄";

/** Returns the emoji icon for a bookmark based on its extension or type. */
function getBookmarkIcon(bookmark: BookmarkItem): string {
  if (bookmark.type === "folder") return FOLDER_ICON;
  const dotIndex = bookmark.name.lastIndexOf(".");
  if (dotIndex < 0) return DEFAULT_ICON;
  const ext = bookmark.name.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_ICONS.get(ext) ?? DEFAULT_ICON;
}

// ─── Type Guard ──────────────────────────────────────────────────────

/** Discriminates BookmarkItem from BookmarkFolder in a union. */
function isBookmarkItem(
  item: BookmarkItem | BookmarkFolder | CommandBookmark | CommandGroup,
): item is BookmarkItem {
  return "path" in item;
}

/** Discriminates CommandBookmark from others. */
function isCommandBookmark(
  item: BookmarkItem | BookmarkFolder | CommandBookmark | CommandGroup,
): item is CommandBookmark {
  return "command" in item;
}

/** Discriminates CommandGroup from BookmarkFolder. CommandGroup is in commandGroups array. */
function isCommandGroup(
  item: BookmarkItem | BookmarkFolder | CommandBookmark | CommandGroup,
  commandGroupIds: Set<string>,
): item is CommandGroup {
  return commandGroupIds.has(item.id);
}

// ─── Bidi Sanitizer ──────────────────────────────────────────────────

/**
 * Strips Unicode bidi control characters from display strings.
 * Delegates to the canonical `stripBidiControls` in `sanitize.ts`.
 */
function sanitizeDisplayName(name: string): string {
  return stripBidiControls(name);
}

// ─── Dir Entry Type ──────────────────────────────────────────────────

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

// ─── File Tree Dropdown ──────────────────────────────────────────────

/** Send a cd command to the focused terminal. */
function cdInTerminal(dirPath: string) {
  const state = useLayoutStore.getState();
  const region = state.regions[state.focusedRegionId];
  if (!region) return;
  const tab = region.tabs.find((t) => t.id === region.activeTabId);
  if (!tab || tab.type !== "terminal") return;
  const sessionId = tab.sessionId;
  const escaped = dirPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
  const data = Array.from(new TextEncoder().encode(`cd "${escaped}"\n`));
  invoke("pty_write", { sessionId, data }).then(() => {
    // Fire CWD update after shell processes the cd
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("putz-cwd-change", { detail: { sessionId, cwd: dirPath } }));
    }, 300);
  }).catch(() => {});
}

interface FileTreeDropdownProps {
  rootPath: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** Lazy-loading file tree dropdown for folder bookmarks. */
function FileTreeDropdown({ rootPath, anchorRef, onClose }: FileTreeDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 260;
    const maxH = 400;
    let left = rect.left;
    let top = rect.bottom + 2;
    if (left + width > window.innerWidth) left = window.innerWidth - width - 8;
    if (top + maxH > window.innerHeight) {
      top = rect.top - maxH - 2;
      if (top < 0) top = 8;
    }
    setStyle({ position: "fixed", left, top, zIndex: 200, width, maxHeight: maxH });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div ref={menuRef} className="bookmarks-bar__dropdown" style={style}>
      <button
        className="bookmarks-bar__dropdown-item"
        type="button"
        role="menuitem"
        onClick={() => { cdInTerminal(rootPath); onClose(); }}
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4, paddingBottom: 8 }}
      >
        <span className="bookmarks-bar__icon" aria-hidden="true">💻</span>
        <span className="bookmarks-bar__label">Open in Terminal</span>
      </button>
      <FileTreeNode path={rootPath} depth={0} onClose={onClose} />
    </div>,
    document.body,
  );
}

/** Extension to icon mapping for the tree. */
const TREE_ICONS: Record<string, string> = {
  drawio: "📐", csv: "📊", tsv: "📊", md: "📖", markdown: "📖",
  py: "🐍", js: "📜", ts: "📜", json: "⚙️", yaml: "⚙️", yml: "⚙️",
  rs: "🦀", toml: "⚙️", xml: "📄", txt: "📄", cfg: "📄", conf: "📄",
  log: "📄", sh: "📄",
};

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return TREE_ICONS[ext] ?? "📄";
}

interface FileTreeNodeProps {
  path: string;
  depth: number;
  onClose: () => void;
}

/** A single level of the file tree — loads children lazily on expand. */
function FileTreeNode({ path, depth, onClose }: FileTreeNodeProps) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoke<DirEntry[]>("dir_list", { path })
      .then(setEntries)
      .catch(() => setError(true));
  }, [path]);

  const handleFileClick = useCallback((entry: DirEntry) => {
    const focusedRegionId = useLayoutStore.getState().focusedRegionId;
    useLayoutStore.getState().addEditorTab(focusedRegionId, entry.path);
    onClose();
  }, [onClose]);

  const toggleDir = useCallback((dirPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });
  }, []);

  const handleDirClick = useCallback((entry: DirEntry) => {
    cdInTerminal(entry.path);
    onClose();
  }, [onClose]);

  if (error) return <span className="bookmarks-bar__empty" style={{ paddingLeft: depth * 16 + 12 }}>Failed to read</span>;
  if (!entries) return <span className="bookmarks-bar__empty" style={{ paddingLeft: depth * 16 + 12 }}>Loading…</span>;
  if (entries.length === 0) return <span className="bookmarks-bar__empty" style={{ paddingLeft: depth * 16 + 12 }}>Empty</span>;

  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <div className="bookmarks-bar__dropdown-item" style={{ paddingLeft: depth * 16 + 12, display: "flex", alignItems: "center", gap: 6 }}>
            {entry.isDir && (
              <button
                type="button"
                title={expanded.has(entry.path) ? "Collapse" : "Expand"}
                onClick={() => toggleDir(entry.path)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: "0.6rem", lineHeight: 1, flexShrink: 0 }}
              >
                {expanded.has(entry.path) ? "▾" : "▸"}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              title={entry.isDir ? `cd ${entry.path}` : entry.path}
              onClick={() => entry.isDir ? handleDirClick(entry) : handleFileClick(entry)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, textAlign: "left" }}
            >
              <span className="bookmarks-bar__icon" aria-hidden="true">
                {entry.isDir && expanded.has(entry.path) ? "📂" : getFileIcon(entry.name, entry.isDir)}
              </span>
              <span className="bookmarks-bar__label">{entry.name}</span>
            </button>
          </div>
          {entry.isDir && expanded.has(entry.path) && (
            <FileTreeNode path={entry.path} depth={depth + 1} onClose={onClose} />
          )}
        </div>
      ))}
    </>
  );
}

// ─── Memoized Bookmark Button ────────────────────────────────────────

interface BookmarkButtonProps {
  bookmark: BookmarkItem;
  onBookmarkClick: (bookmark: BookmarkItem) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  isDragging: boolean;
}

/** Single bookmark button — memoized to avoid re-renders. */
const BookmarkButton = memo(function BookmarkButton({
  bookmark,
  onBookmarkClick,
  onDragStart,
  isDragging,
}: BookmarkButtonProps) {
  const icon = getBookmarkIcon(bookmark);
  const displayName = sanitizeDisplayName(bookmark.name);
  const [treeOpen, setTreeOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const isFolder = bookmark.type === "folder";

  const handleClick = useCallback(() => {
    if (isFolder) {
      setTreeOpen((prev) => !prev);
    } else {
      onBookmarkClick(bookmark);
    }
  }, [bookmark, onBookmarkClick, isFolder]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      onDragStart(bookmark.id, e);
    },
    [bookmark.id, onDragStart],
  );

  const className = isDragging
    ? "bookmarks-bar__item bookmarks-bar__item--dragging"
    : "bookmarks-bar__item";

  return (
    <>
      <button
        ref={btnRef}
        className={className}
        type="button"
        role="button"
        title={displayName}
        aria-label={displayName}
        aria-haspopup={isFolder ? "true" : undefined}
        aria-expanded={isFolder ? treeOpen : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        data-bookmark-id={bookmark.id}
      >
        <span className="bookmarks-bar__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="bookmarks-bar__label">{displayName}</span>
        {isFolder && (
          <span className="bookmarks-bar__chevron" aria-hidden="true">▾</span>
        )}
      </button>
      {isFolder && treeOpen && (
        <FileTreeDropdown
          rootPath={bookmark.path}
          anchorRef={btnRef}
          onClose={() => setTreeOpen(false)}
        />
      )}
    </>
  );
});

// ─── Folder Button + Dropdown ────────────────────────────────────────

interface FolderButtonProps {
  folder: BookmarkFolder;
  onBookmarkClick: (bookmark: BookmarkItem) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  isDragging: boolean;
}

/** Folder button with dropdown menu of children (rendered via portal). */
const FolderButton = memo(function FolderButton({
  folder,
  onBookmarkClick,
  onDragStart,
  isDragging,
}: FolderButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const children = useMemo(
    () =>
      bookmarks
        .filter((b: BookmarkItem) => b.folderId === folder.id)
        .sort((a: BookmarkItem, b: BookmarkItem) => a.sortIndex - b.sortIndex),
    [bookmarks, folder.id],
  );
  const displayName = sanitizeDisplayName(folder.name);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleItemClick = useCallback(
    (bookmark: BookmarkItem) => {
      onBookmarkClick(bookmark);
      setIsOpen(false);
    },
    [onBookmarkClick],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      onDragStart(folder.id, e);
    },
    [folder.id, onDragStart],
  );

  // Compute dropdown position when open
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownWidth = 200;
    const dropdownMaxHeight = 300;

    let left = rect.left;
    let top = rect.bottom + 2;

    // Viewport-edge clamping: prevent overflow on right
    if (left + dropdownWidth > window.innerWidth) {
      left = window.innerWidth - dropdownWidth - 8;
    }
    // Prevent overflow on bottom — flip upward if needed
    if (top + dropdownMaxHeight > window.innerHeight) {
      top = rect.top - dropdownMaxHeight - 2;
      if (top < 0) top = 8;
    }

    setDropdownStyle({
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 200,
    });
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  // Close on Escape + keyboard nav within dropdown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }
      if (e.key === "ArrowDown" && isOpen && menuRef.current) {
        e.preventDefault();
        const first = menuRef.current.querySelector<HTMLButtonElement>(
          "[role='menuitem']",
        );
        first?.focus();
      }
    },
    [isOpen],
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
        return;
      }
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      );
      if (!items?.length) return;

      const current = Array.from(items).indexOf(
        document.activeElement as HTMLButtonElement,
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = (current + 1) % items.length;
        items[next].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = current <= 0 ? items.length - 1 : current - 1;
        items[prev].focus();
      }
    },
    [],
  );

  const className = isDragging
    ? "bookmarks-bar__item bookmarks-bar__item--dragging"
    : "bookmarks-bar__item";

  const dropdown = isOpen
    ? createPortal(
        <div
          ref={menuRef}
          className="bookmarks-bar__dropdown"
          role="menu"
          style={dropdownStyle}
          onKeyDown={handleMenuKeyDown}
        >
          {children.map((child) => {
            const childName = sanitizeDisplayName(child.name);
            return (
              <button
                key={child.id}
                className="bookmarks-bar__dropdown-item"
                type="button"
                role="menuitem"
                title={childName}
                aria-label={childName}
                onClick={() => handleItemClick(child)}
              >
                <span className="bookmarks-bar__icon" aria-hidden="true">
                  {getBookmarkIcon(child)}
                </span>
                <span className="bookmarks-bar__label">{childName}</span>
              </button>
            );
          })}
          {children.length === 0 && (
            <span className="bookmarks-bar__empty">Empty folder</span>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative" }}
      data-bookmark-id={folder.id}
    >
      <button
        ref={buttonRef}
        className={className}
        type="button"
        role="button"
        title={displayName}
        aria-label={displayName}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
      >
        <span className="bookmarks-bar__icon" aria-hidden="true">
          {FOLDER_ICON}
        </span>
        <span className="bookmarks-bar__label">{displayName}</span>
        <span className="bookmarks-bar__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {dropdown}
    </div>
  );
});

// ─── Command Button ──────────────────────────────────────────────────

// ─── Command Button ──────────────────────────────────────────────────

interface CommandButtonProps {
  command: CommandBookmark;
  onExecute: (cmd: CommandBookmark) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  isDragging: boolean;
}

const CommandButton = memo(function CommandButton({
  command,
  onExecute,
  onDragStart,
  isDragging,
}: CommandButtonProps) {
  const displayName = sanitizeDisplayName(command.name);
  const removeCommand = useBookmarksStore((s) => s.removeCommand);
  const [showMenu, setShowMenu] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const handleClick = useCallback(() => {
    onExecute(command);
  }, [command, onExecute]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuStyle({ position: "fixed", left: rect.left, top: rect.bottom + 2, zIndex: 200 });
    }
    setShowMenu(true);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      onDragStart(command.id, e);
    },
    [command.id, onDragStart],
  );

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  const className = isDragging
    ? "bookmarks-bar__item bookmarks-bar__item--command bookmarks-bar__item--dragging"
    : "bookmarks-bar__item bookmarks-bar__item--command";

  return (
    <>
      <button
        ref={btnRef}
        className={className}
        type="button"
        title={`${displayName}\n${command.command}${command.hotkey ? `\n⌨ ${command.hotkey}` : ""}`}
        aria-label={displayName}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        data-bookmark-id={command.id}
        style={command.color ? { borderColor: command.color } : undefined}
      >
        <span className="bookmarks-bar__icon" aria-hidden="true">{command.icon || "⚡"}</span>
        <span className="bookmarks-bar__label">{displayName}</span>
        {command.hotkey && (
          <span className="bookmarks-bar__hotkey">{formatHotkey(command.hotkey)}</span>
        )}
      </button>
      {showMenu && createPortal(
        <div ref={menuRef} className="bookmarks-bar__dropdown" style={menuStyle}>
          <button className="bookmarks-bar__dropdown-item" type="button" role="menuitem"
            onClick={() => { setShowMenu(false); setShowEdit(true); }}>
            <span className="bookmarks-bar__icon">✏️</span>
            <span className="bookmarks-bar__label">Edit</span>
          </button>
          <button className="bookmarks-bar__dropdown-item" type="button" role="menuitem"
            onClick={() => { removeCommand(command.id); setShowMenu(false); }}>
            <span className="bookmarks-bar__icon">🗑</span>
            <span className="bookmarks-bar__label">Delete</span>
          </button>
        </div>,
        document.body,
      )}
      {showEdit && (
        <CommandDialog
          anchorRef={btnRef}
          onClose={() => setShowEdit(false)}
          editCommand={command}
        />
      )}
    </>
  );
});

// ─── Command Group Button ────────────────────────────────────────────

interface CommandGroupButtonProps {
  group: CommandGroup;
  onExecute: (cmd: CommandBookmark) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  isDragging: boolean;
}

const CommandGroupButton = memo(function CommandGroupButton({
  group,
  onExecute,
  onDragStart,
  isDragging,
}: CommandGroupButtonProps) {
  const displayName = sanitizeDisplayName(group.name);
  const commands = useBookmarksStore((s) => s.commands);
  const removeCommandGroup = useBookmarksStore((s) => s.removeCommandGroup);
  const children = useMemo(
    () => commands.filter((c) => c.groupId === group.id).sort((a, b) => a.sortIndex - b.sortIndex),
    [commands, group.id],
  );
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const handleToggle = useCallback(() => setIsOpen((p) => !p), []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onDragStart(group.id, e);
  }, [group.id, onDragStart]);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 2;
    if (left + 200 > window.innerWidth) left = window.innerWidth - 208;
    if (top + 300 > window.innerHeight) { top = rect.top - 300 - 2; if (top < 0) top = 8; }
    setDropdownStyle({ position: "fixed", left, top, zIndex: 200 });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node) &&
          menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const className = isDragging
    ? "bookmarks-bar__item bookmarks-bar__item--command bookmarks-bar__item--dragging"
    : "bookmarks-bar__item bookmarks-bar__item--command";

  const dropdown = isOpen ? createPortal(
    <div ref={menuRef} className="bookmarks-bar__dropdown" style={dropdownStyle}>
      {children.map((child) => (
        <button key={child.id} className="bookmarks-bar__dropdown-item" type="button" role="menuitem"
          title={child.command}
          onClick={() => { onExecute(child); setIsOpen(false); }}>
          <span className="bookmarks-bar__icon">{child.icon || "⚡"}</span>
          <span className="bookmarks-bar__label">{sanitizeDisplayName(child.name)}</span>
          {child.hotkey && <span className="bookmarks-bar__hotkey">{formatHotkey(child.hotkey)}</span>}
        </button>
      ))}
      {children.length === 0 && (
        <span className="bookmarks-bar__empty">Empty group</span>
      )}
      <button className="bookmarks-bar__dropdown-item bookmarks-bar__dropdown-item--danger" type="button" role="menuitem"
        onClick={() => { removeCommandGroup(group.id); setIsOpen(false); }}>
        <span className="bookmarks-bar__icon">🗑</span>
        <span className="bookmarks-bar__label">Delete group</span>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={containerRef} style={{ position: "relative" }} data-bookmark-id={group.id}>
      <button ref={buttonRef} className={className} type="button"
        title={displayName} aria-label={displayName}
        aria-haspopup="true" aria-expanded={isOpen}
        onClick={handleToggle} onPointerDown={handlePointerDown}>
        <span className="bookmarks-bar__icon" aria-hidden="true">⚡</span>
        <span className="bookmarks-bar__label">{displayName}</span>
        <span className="bookmarks-bar__chevron" aria-hidden="true">▾</span>
      </button>
      {dropdown}
    </div>
  );
});

/** Formats a hotkey string for display (e.g. "ctrl+shift+1" → "⌃⇧1"). */
function formatHotkey(hotkey: string): string {
  return hotkey
    .replace(/meta/i, "⌘")
    .replace(/ctrl/i, "⌃")
    .replace(/alt/i, "⌥")
    .replace(/shift/i, "⇧")
    .replace(/\+/g, "");
}

// ─── Command Dialog (Add / Edit / Create Group) ─────────────────────

const COMMAND_ICONS = ["⚡", "🚀", "🔧", "📡", "🤖", "💬", "🧪", "🔄", "📦", "🛠️", "🎯", "⭐"];

interface CommandDialogProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  editCommand?: CommandBookmark;
}

function CommandDialog({ anchorRef, onClose, editCommand }: CommandDialogProps) {
  const addCommand = useBookmarksStore((s) => s.addCommand);
  const updateCommand = useBookmarksStore((s) => s.updateCommand);
  const addCommandGroup = useBookmarksStore((s) => s.addCommandGroup);
  const commandGroups = useBookmarksStore((s) => s.commandGroups);
  const [isGroupMode, setIsGroupMode] = useState(false);
  const [name, setName] = useState(editCommand?.name ?? "");
  const [cmd, setCmd] = useState(editCommand?.command ?? "");
  const [autoExec, setAutoExec] = useState(editCommand?.autoExecute ?? true);
  const [newTerm, setNewTerm] = useState(editCommand?.newTerminal ?? false);
  const [hotkey, setHotkey] = useState(editCommand?.hotkey ?? "");
  const [icon, setIcon] = useState(editCommand?.icon ?? "⚡");
  const [groupId, setGroupId] = useState<string>(editCommand?.groupId ?? "");
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.left;
    const top = rect.bottom + 4;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 308;
    setStyle({ position: "fixed", left, top, zIndex: 300, width: 300 });
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  useEffect(() => {
    if (!recordingHotkey) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingHotkey(false); return; }
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      if (e.metaKey) parts.push("meta");
      parts.push(e.key.toLowerCase());
      setHotkey(parts.join("+"));
      setRecordingHotkey(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingHotkey]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (isGroupMode) {
      addCommandGroup(name);
      onClose();
      return;
    }
    if (!cmd.trim()) return;
    if (editCommand) {
      updateCommand(editCommand.id, { name, command: cmd, autoExecute: autoExec, newTerminal: newTerm, hotkey, icon, groupId: groupId || null });
    } else {
      addCommand({ name, command: cmd, autoExecute: autoExec, newTerminal: newTerm, hotkey, icon, groupId: groupId || null });
    }
    onClose();
  };

  return createPortal(
    <div ref={dialogRef} className="bookmarks-bar__add-cmd" style={style}>
      <div className="bookmarks-bar__add-cmd-title">
        {editCommand ? "Edit Command" : isGroupMode ? "Create Group" : "Add Command Shortcut"}
      </div>

      {!editCommand && (
        <label className="bookmarks-bar__add-cmd-toggle">
          <input type="checkbox" checked={isGroupMode} onChange={(e) => setIsGroupMode(e.target.checked)} />
          Create a group
        </label>
      )}

      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} />

      {!isGroupMode && (
        <>
          <textarea placeholder="Command(s)…" value={cmd} onChange={(e) => setCmd(e.target.value)} rows={3} autoCorrect="off" autoCapitalize="off" spellCheck={false} />

          <div className="bookmarks-bar__add-cmd-icons">
            <span>Icon:</span>
            <div className="bookmarks-bar__add-cmd-icon-grid">
              {COMMAND_ICONS.map((ic) => (
                <button key={ic} type="button"
                  className={`bookmarks-bar__add-cmd-icon-btn ${icon === ic ? "bookmarks-bar__add-cmd-icon-btn--active" : ""}`}
                  onClick={() => setIcon(ic)}>{ic}</button>
              ))}
            </div>
          </div>

          {commandGroups.length > 0 && (
            <div className="bookmarks-bar__add-cmd-hotkey">
              <span>Group:</span>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">None (root)</option>
                {commandGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          <label><input type="checkbox" checked={autoExec} onChange={(e) => setAutoExec(e.target.checked)} /> Auto-execute</label>
          <label><input type="checkbox" checked={newTerm} onChange={(e) => setNewTerm(e.target.checked)} /> New terminal</label>
          <div className="bookmarks-bar__add-cmd-hotkey">
            <span>Hotkey:</span>
            <button type="button" className="bookmarks-bar__add-cmd-hotkey-btn"
              onClick={() => setRecordingHotkey(true)}>
              {recordingHotkey ? "Press keys…" : hotkey ? formatHotkey(hotkey) : "None (click to set)"}
            </button>
            {hotkey && <button type="button" onClick={() => setHotkey("")} className="bookmarks-bar__add-cmd-hotkey-clear">✕</button>}
          </div>
        </>
      )}

      <div className="bookmarks-bar__add-cmd-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={handleSubmit}
          disabled={!name.trim() || (!isGroupMode && !cmd.trim())}>
          {editCommand ? "Save" : isGroupMode ? "Create" : "Add"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ─── Drag-to-Reorder Hook ────────────────────────────────────────────

interface DragState {
  itemId: string;
  startX: number;
  startY: number;
  active: boolean;
}

/** Minimum pointer movement (px) before starting a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Custom hook for pointer-based drag-to-reorder within the bar.
 * Uses pointerdown/pointermove/pointerup (NOT HTML5 DnD — Tauri issues).
 *
 * M-D1: Cancels reorder if pointerup lands outside the bar bounds.
 * M-D2: Excludes the dragged item from drop-index midpoint calculation.
 * M-D3: Same source/target index → no-op (no store mutation).
 */
function useDragReorder(
  barRef: React.RefObject<HTMLDivElement | null>,
  rootItems: ReadonlyArray<BookmarkItem | BookmarkFolder | CommandBookmark>,
) {
  const reorderBookmark = useBookmarksStore((s) => s.reorderBookmark);
  const reorderFolder = useBookmarksStore((s) => s.reorderFolder);
  const reorderCommand = useBookmarksStore((s) => s.reorderCommand);

  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (id: string, e: React.PointerEvent) => {
      dragRef.current = {
        itemId: id,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    },
    [],
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (!drag.active && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        drag.active = true;
        setDraggingId(drag.itemId);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.active && barRef.current) {
        const barRect = barRef.current.getBoundingClientRect();
        const inBounds =
          e.clientX >= barRect.left &&
          e.clientX <= barRect.right &&
          e.clientY >= barRect.top &&
          e.clientY <= barRect.bottom;

        if (inBounds) {
          const newIndex = computeDropIndex(barRef.current, e.clientX, rootItems, drag.itemId);
          const currentIndex = rootItems.findIndex((i) => i.id === drag.itemId);
          const item = currentIndex >= 0 ? rootItems[currentIndex] : undefined;

          if (item && newIndex !== currentIndex) {
            if (isCommandBookmark(item)) {
              reorderCommand(drag.itemId, newIndex);
            } else if (isBookmarkItem(item)) {
              reorderBookmark(drag.itemId, newIndex);
            } else {
              reorderFolder(drag.itemId, newIndex);
            }
          }
        }
      }

      dragRef.current = null;
      setDraggingId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [barRef, rootItems, reorderBookmark, reorderFolder, reorderCommand]);

  return { draggingId, handleDragStart };
}

/**
 * Computes the target drop index based on pointer X within the bar.
 * Excludes the dragged item from midpoint calculations (M-D2).
 */
function computeDropIndex(
  barEl: HTMLElement,
  clientX: number,
  rootItems: ReadonlyArray<BookmarkItem | BookmarkFolder | CommandBookmark>,
  draggedId: string,
): number {
  const children = barEl.querySelectorAll<HTMLElement>("[data-bookmark-id]");
  let insertAt = 0;
  for (let i = 0; i < children.length; i++) {
    const id = children[i].getAttribute("data-bookmark-id");
    // M-D2: Skip the dragged item in midpoint calculation
    if (id === draggedId) continue;
    const rect = children[i].getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (clientX > midX) {
      insertAt = rootItems.findIndex((item) => item.id === id) + 1;
    }
  }
  return Math.min(insertAt, rootItems.length - 1);
}

// ─── Toolbar Keyboard Navigation ─────────────────────────────────────

/** Handles ArrowLeft/ArrowRight focus movement within the toolbar. */
function handleToolbarKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

  const toolbar = e.currentTarget;
  const focusable = toolbar.querySelectorAll<HTMLElement>(
    "button:not([disabled])",
  );
  if (focusable.length === 0) return;

  const current = Array.from(focusable).indexOf(
    document.activeElement as HTMLElement,
  );
  if (current === -1) return;

  e.preventDefault();

  if (e.key === "ArrowRight") {
    const next = (current + 1) % focusable.length;
    focusable[next].focus();
  } else {
    const prev = current === 0 ? focusable.length - 1 : current - 1;
    focusable[prev].focus();
  }
}

// ─── Main Component ──────────────────────────────────────────────────

/** BookmarksBar — Toggleable horizontal bar of user bookmarks. */
export function BookmarksBar({
  onBookmarkClick,
}: BookmarksBarProps): React.ReactElement | null {
  const visible = useSettingsStore((s) => s.bookmarksBarVisible);
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const folders = useBookmarksStore((s) => s.folders);
  const commands = useBookmarksStore((s) => s.commands);
  const commandGroups = useBookmarksStore((s) => s.commandGroups);
  const barRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [showAddCmd, setShowAddCmd] = useState(false);

  const rootItems = useMemo(() => {
    const rootBookmarks = bookmarks.filter((b) => b.folderId === null);
    const rootCommands = commands.filter((c) => c.groupId === null);
    const items: (BookmarkItem | BookmarkFolder | CommandBookmark | CommandGroup)[] = [
      ...rootBookmarks,
      ...folders,
      ...rootCommands,
      ...commandGroups,
    ];
    return items.sort((a, b) => a.sortIndex - b.sortIndex);
  }, [bookmarks, folders, commands, commandGroups]);

  const commandGroupIds = useMemo(() => new Set(commandGroups.map((g) => g.id)), [commandGroups]);

  const { draggingId, handleDragStart } = useDragReorder(barRef, rootItems);

  // Execute a command bookmark
  const executeCommand = useCallback((cmd: CommandBookmark) => {
    const state = useLayoutStore.getState();

    if (cmd.newTerminal) {
      // Open new terminal tab and send command after a short delay
      const regionId = state.focusedRegionId;
      useLayoutStore.getState().addTerminalTab(regionId);
      // Wait for terminal to spawn, then send the command
      setTimeout(() => {
        const updatedState = useLayoutStore.getState();
        const region = updatedState.regions[updatedState.focusedRegionId];
        if (!region) return;
        const tab = region.tabs.find((t) => t.id === region.activeTabId);
        if (!tab || tab.type !== "terminal" || !tab.sessionId) return;
        const suffix = cmd.autoExecute ? "\n" : "";
        const data = Array.from(new TextEncoder().encode(cmd.command + suffix));
        invoke("pty_write", { sessionId: tab.sessionId, data }).catch(() => {});
      }, 500);
    } else {
      // Send to current terminal
      const region = state.regions[state.focusedRegionId];
      if (!region) return;
      const tab = region.tabs.find((t) => t.id === region.activeTabId);
      if (!tab || tab.type !== "terminal" || !tab.sessionId) return;
      const suffix = cmd.autoExecute ? "\n" : "";
      const data = Array.from(new TextEncoder().encode(cmd.command + suffix));
      invoke("pty_write", { sessionId: tab.sessionId, data }).catch(() => {});
    }
  }, []);

  // Global hotkey listener
  useEffect(() => {
    if (commands.length === 0) return;
    const hotkeyMap = new Map<string, CommandBookmark>();
    for (const cmd of commands) {
      if (cmd.hotkey) hotkeyMap.set(cmd.hotkey.toLowerCase(), cmd);
    }
    if (hotkeyMap.size === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      if (e.metaKey) parts.push("meta");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");
      const cmd = hotkeyMap.get(combo);
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        executeCommand(cmd);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [commands, executeCommand]);

  if (!visible) return null;

  return (
    <div
      className="bookmarks-bar"
      role="toolbar"
      aria-label="Bookmarks"
      data-testid="bookmarks-bar"
      ref={barRef}
      onKeyDown={handleToolbarKeyDown}
    >
      {rootItems.length === 0 && (
        <span className="bookmarks-bar__empty">No bookmarks yet</span>
      )}
      {rootItems.map((item) =>
        isCommandBookmark(item) ? (
          <CommandButton
            key={item.id}
            command={item}
            onExecute={executeCommand}
            onDragStart={handleDragStart}
            isDragging={draggingId === item.id}
          />
        ) : isBookmarkItem(item) ? (
          <BookmarkButton
            key={item.id}
            bookmark={item}
            onBookmarkClick={onBookmarkClick}
            onDragStart={handleDragStart}
            isDragging={draggingId === item.id}
          />
        ) : isCommandGroup(item, commandGroupIds) ? (
          <CommandGroupButton
            key={item.id}
            group={item}
            onExecute={executeCommand}
            onDragStart={handleDragStart}
            isDragging={draggingId === item.id}
          />
        ) : (() => {
          const f = item as BookmarkFolder;
          return (
            <FolderButton
              key={f.id}
              folder={f}
              onBookmarkClick={onBookmarkClick}
              onDragStart={handleDragStart}
              isDragging={draggingId === f.id}
            />
          );
        })(),
      )}
      <button
        ref={addBtnRef}
        className="bookmarks-bar__add-cmd-btn"
        type="button"
        title="Add command shortcut"
        onClick={() => setShowAddCmd((v) => !v)}
      >
        ⚡+
      </button>
      {showAddCmd && (
        <CommandDialog anchorRef={addBtnRef} onClose={() => setShowAddCmd(false)} />
      )}
    </div>
  );
}

