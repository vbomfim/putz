/**
 * Bookmark state management using Zustand.
 *
 * Manages bookmark items and bookmark folders with CRUD, reorder,
 * move, and import/export. Persisted to localStorage.
 *
 * One level of folder nesting: bookmarks live at root or inside
 * exactly one folder. Folders themselves are always at root level.
 *
 * @module bookmarksStore
 */
import { create } from "zustand";

// ─── Data Model ──────────────────────────────────────────────────────

/** A bookmarked file or directory path. */
export interface BookmarkItem {
  /** UUID v4 identifier. */
  id: string;
  /** User-editable display name (defaults to basename of path). */
  name: string;
  /** Absolute filesystem path. */
  path: string;
  /** Whether the bookmarked path is a file or directory. */
  type: "file" | "folder";
  /** Parent folder ID, or null for root-level bookmarks. */
  folderId: string | null;
  /** Position within its container (root or folder). */
  sortIndex: number;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
}

/** A grouping folder that contains BookmarkItems. */
export interface BookmarkFolder {
  /** UUID v4 identifier. */
  id: string;
  /** User-editable display name. */
  name: string;
  /** Position in the bookmark bar. */
  sortIndex: number;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────

/** localStorage key for persisting bookmarks. */
const STORAGE_KEY = "putz-bookmarks";

/** Maximum allowed path length. */
const MAX_PATH_LENGTH = 1024;

/** Maximum allowed name length. */
const MAX_NAME_LENGTH = 100;

/** Maximum importable bookmark items (B7 — DoS limit). */
const MAX_BOOKMARKS = 1000;

/** Maximum importable folders (B7 — DoS limit). */
const MAX_FOLDERS = 100;

/** Regex matching ASCII control characters (0x00–0x1F) and DEL (0x7F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

// ─── Utility Helpers ─────────────────────────────────────────────────

/** Generates a UUID v4 using the crypto API. */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Extracts the basename from a filesystem path.
 * Handles both Unix (`/`) and Windows (`\`) separators. [B1]
 */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (!trimmed) return path;
  const lastSep = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  return lastSep >= 0 ? trimmed.substring(lastSep + 1) : trimmed;
}

/** Truncates a string to maxLength. */
function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Returns the next available sortIndex from a set of sortable items. [B2] */
function nextSortIndex(items: Array<{ sortIndex: number }>): number {
  return items.length > 0 ? Math.max(...items.map((i) => i.sortIndex)) + 1 : 0;
}

/**
 * Resolves a folderId: returns `folderId` if it exists in `folders`,
 * otherwise returns `null` (root). Shared by addBookmark and moveBookmark. [B4]
 */
function resolveFolderId(
  folders: BookmarkFolder[],
  folderId: string | null | undefined,
): string | null {
  if (!folderId) return null;
  return folders.some((f) => f.id === folderId) ? folderId : null;
}

/**
 * Returns `null` if the path contains control characters (B6 — PTY injection defense).
 * Otherwise returns the sanitized (trimmed) path.
 */
function sanitizePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > MAX_PATH_LENGTH) return null;
  if (CONTROL_CHAR_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reorders an array of items by moving one item to a new index.
 * Returns a new array with sequential sortIndex values (0, 1, 2…).
 */
function reorderItems<T extends { sortIndex: number }>(
  items: T[],
  itemId: string,
  getId: (item: T) => string,
  newIndex: number,
): T[] {
  const sorted = [...items].sort((a, b) => a.sortIndex - b.sortIndex);
  const currentIndex = sorted.findIndex((item) => getId(item) === itemId);
  if (currentIndex === -1) return items;

  const clamped = Math.max(0, Math.min(newIndex, sorted.length - 1));
  const [moved] = sorted.splice(currentIndex, 1);
  sorted.splice(clamped, 0, moved);

  return sorted.map((item, i) => ({ ...item, sortIndex: i }));
}

/**
 * Builds a sortIndex map for siblings when inserting a new item at `targetIndex`.
 * Returns a Map<id, newSortIndex> for O(1) lookup. [B4]
 * Accepts any array of items with `id` field (bookmarks, folders, or mixed). [C1]
 */
function reindexSiblings(
  siblings: Array<{ id: string }>,
  targetIndex: number,
): Map<string, number> {
  const clamped = Math.max(0, Math.min(targetIndex, siblings.length));
  const map = new Map<string, number>();
  siblings.forEach((b, i) => {
    map.set(b.id, i >= clamped ? i + 1 : i);
  });
  return map;
}

/**
 * Returns the combined root-level items (root bookmarks + all folders),
 * sorted by current sortIndex. Used by all root-level reorder/move ops. [C1]
 */
function rootSiblings(
  bookmarks: BookmarkItem[],
  folders: BookmarkFolder[],
): Array<BookmarkItem | BookmarkFolder> {
  return [
    ...bookmarks.filter((b) => b.folderId === null),
    ...folders,
  ].sort((a, b) => a.sortIndex - b.sortIndex);
}

/**
 * Applies a reindex Map (id → newSortIndex) to both bookmarks and folders arrays.
 * Returns new arrays with updated sortIndices; items not in the Map are unchanged. [C1]
 */
function applyRootReindex(
  indexMap: Map<string, number>,
  bookmarks: BookmarkItem[],
  folders: BookmarkFolder[],
): { bookmarks: BookmarkItem[]; folders: BookmarkFolder[] } {
  return {
    bookmarks: bookmarks.map((b) => {
      const newIdx = indexMap.get(b.id);
      return newIdx !== undefined ? { ...b, sortIndex: newIdx } : b;
    }),
    folders: folders.map((f) => {
      const newIdx = indexMap.get(f.id);
      return newIdx !== undefined ? { ...f, sortIndex: newIdx } : f;
    }),
  };
}

// ─── Validation Helpers (B3) ─────────────────────────────────────────

/** Returns true if obj has dangerous prototype-polluting own-properties. */
function hasProtoPollution(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor")
  );
}

/** Validates and returns a BookmarkItem, or throws with a descriptive message. */
function validateBookmarkItem(raw: unknown, index: number): BookmarkItem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is not an object.`,
    );
  }
  if (hasProtoPollution(raw)) {
    throw new Error(
      `Invalid import: bookmark at index ${index} contains forbidden property.`,
    );
  }
  const item = raw as Record<string, unknown>;

  if (typeof item.id !== "string" || !item.id) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'id'.`,
    );
  }
  if (typeof item.name !== "string" || !item.name.toString().trim()) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'name'.`,
    );
  }
  if (typeof item.path !== "string" || !item.path) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'path'.`,
    );
  }
  const safePath = sanitizePath(item.path);
  if (safePath === null) {
    throw new Error(
      `Invalid import: bookmark at index ${index} has invalid path (contains control characters or too long).`,
    );
  }
  if (item.type !== "file" && item.type !== "folder") {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'type'.`,
    );
  }
  if (item.folderId !== null && typeof item.folderId !== "string") {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'folderId'.`,
    );
  }
  if (typeof item.sortIndex !== "number" || !Number.isFinite(item.sortIndex) || !Number.isInteger(item.sortIndex)) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'sortIndex'.`,
    );
  }
  if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) {
    throw new Error(
      `Invalid import: bookmark at index ${index} is missing/invalid field 'createdAt'.`,
    );
  }

  return {
    id: item.id,
    name: truncate(String(item.name).trim(), MAX_NAME_LENGTH),
    path: safePath,
    type: item.type as "file" | "folder",
    folderId: (item.folderId as string | null),
    sortIndex: item.sortIndex,
    createdAt: item.createdAt,
  };
}

/** Validates and returns a BookmarkFolder, or throws with a descriptive message. */
function validateFolder(raw: unknown, index: number): BookmarkFolder {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `Invalid import: folder at index ${index} is not an object.`,
    );
  }
  if (hasProtoPollution(raw)) {
    throw new Error(
      `Invalid import: folder at index ${index} contains forbidden property.`,
    );
  }
  const item = raw as Record<string, unknown>;

  if (typeof item.id !== "string" || !item.id) {
    throw new Error(
      `Invalid import: folder at index ${index} is missing/invalid field 'id'.`,
    );
  }
  if (typeof item.name !== "string" || !item.name.toString().trim()) {
    throw new Error(
      `Invalid import: folder at index ${index} is missing/invalid field 'name'.`,
    );
  }
  if (typeof item.sortIndex !== "number" || !Number.isFinite(item.sortIndex) || !Number.isInteger(item.sortIndex)) {
    throw new Error(
      `Invalid import: folder at index ${index} is missing/invalid field 'sortIndex'.`,
    );
  }
  if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) {
    throw new Error(
      `Invalid import: folder at index ${index} is missing/invalid field 'createdAt'.`,
    );
  }

  return {
    id: item.id,
    name: truncate(String(item.name).trim(), MAX_NAME_LENGTH),
    sortIndex: item.sortIndex,
    createdAt: item.createdAt,
  };
}

/** Silently validates a BookmarkItem for localStorage load. Returns null on failure. */
function tryValidateBookmarkItem(raw: unknown): BookmarkItem | null {
  try {
    return validateBookmarkItem(raw, 0);
  } catch {
    return null;
  }
}

/** Silently validates a BookmarkFolder for localStorage load. Returns null on failure. */
function tryValidateFolder(raw: unknown): BookmarkFolder | null {
  try {
    return validateFolder(raw, 0);
  } catch {
    return null;
  }
}

// ─── Persistence Helpers ─────────────────────────────────────────────

/** Shape serialized to localStorage. */
interface PersistedBookmarks {
  bookmarks: BookmarkItem[];
  folders: BookmarkFolder[];
}

/** Loads persisted bookmarks from localStorage, returning defaults on failure. [B3] */
function loadPersistedBookmarks(): PersistedBookmarks {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedBookmarks>;
      const rawBookmarks = Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [];
      const rawFolders = Array.isArray(parsed.folders) ? parsed.folders : [];

      // [C3] DoS limit on load — truncate, don't crash
      if (rawBookmarks.length > MAX_BOOKMARKS) {
        console.warn(
          `bookmarksStore: truncated persisted bookmarks from ${rawBookmarks.length} to ${MAX_BOOKMARKS}`,
        );
        rawBookmarks.length = MAX_BOOKMARKS;
      }
      if (rawFolders.length > MAX_FOLDERS) {
        console.warn(
          `bookmarksStore: truncated persisted folders from ${rawFolders.length} to ${MAX_FOLDERS}`,
        );
        rawFolders.length = MAX_FOLDERS;
      }

      const bookmarks: BookmarkItem[] = [];
      let droppedBookmarks = 0;
      for (const item of rawBookmarks) {
        const valid = tryValidateBookmarkItem(item);
        if (valid) {
          bookmarks.push(valid);
        } else {
          droppedBookmarks++;
        }
      }

      const folders: BookmarkFolder[] = [];
      let droppedFolders = 0;
      for (const item of rawFolders) {
        const valid = tryValidateFolder(item);
        if (valid) {
          folders.push(valid);
        } else {
          droppedFolders++;
        }
      }

      const totalDropped = droppedBookmarks + droppedFolders;
      if (totalDropped > 0) {
        console.warn(
          `bookmarksStore: dropped ${totalDropped} invalid items from storage`,
        );
      }

      return { bookmarks, folders };
    }
  } catch {
    // Corrupted localStorage — fall through to defaults
  }
  return { bookmarks: [], folders: [] };
}

/** Saves bookmarks to localStorage. */
function persistBookmarks(data: PersistedBookmarks): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silent fail
  }
}

// ─── Store Definition ────────────────────────────────────────────────

interface BookmarksState {
  /** Flat array of all bookmark items. */
  bookmarks: BookmarkItem[];
  /** Array of all bookmark folders. */
  folders: BookmarkFolder[];

  // ─── Bookmark Actions ──────────────────────────────────────

  /** Adds a new bookmark. Deduplicates by path (idempotent). */
  addBookmark: (
    path: string,
    type: "file" | "folder",
    folderId?: string,
  ) => void;

  /** Removes a bookmark by ID. No-op for unknown IDs. */
  removeBookmark: (id: string) => void;

  /** Renames a bookmark. Trims whitespace; rejects empty names. */
  renameBookmark: (id: string, name: string) => void;

  /** Moves a bookmark into or out of a folder. */
  moveBookmark: (
    id: string,
    targetFolderId: string | null,
    index?: number,
  ) => void;

  /** Reorders a bookmark within its current container. */
  reorderBookmark: (id: string, newIndex: number) => void;

  // ─── Folder Actions ────────────────────────────────────────

  /** Creates a bookmark folder. */
  addFolder: (name: string) => void;

  /** Removes a folder; children are moved to root. */
  removeFolder: (id: string) => void;

  /** Renames a folder. Trims whitespace; rejects empty names. */
  renameFolder: (id: string, name: string) => void;

  /** Reorders a folder in the bookmark bar. */
  reorderFolder: (id: string, newIndex: number) => void;

  // ─── Selectors ─────────────────────────────────────────────

  /** Returns bookmarks in a specific folder (null = root), sorted by sortIndex. */
  getBookmarksInFolder: (folderId: string | null) => BookmarkItem[];

  /** Returns ordered root-level items (bookmarks + folders interleaved by sortIndex). */
  getRootItems: () => (BookmarkItem | BookmarkFolder)[];

  // ─── Import / Export ───────────────────────────────────────

  /** Serializes all bookmarks and folders to a JSON string. */
  exportBookmarks: () => string;

  /** Replaces all bookmarks and folders from a JSON string. Throws on invalid input. */
  importBookmarks: (json: string) => void;
}

export const useBookmarksStore = create<BookmarksState>((set, get) => {
  const persisted = loadPersistedBookmarks();

  /** Persists current state to localStorage. */
  const persist = (): void => {
    const { bookmarks, folders } = get();
    persistBookmarks({ bookmarks, folders });
  };

  return {
    bookmarks: persisted.bookmarks,
    folders: persisted.folders,

    // ─── Bookmark Actions ──────────────────────────────────────

    addBookmark: (
      path: string,
      type: "file" | "folder",
      folderId?: string,
    ) => {
      const trimmedPath = sanitizePath(path);
      if (!trimmedPath) return; // [B6] rejects control chars, empty, too long

      const { bookmarks, folders } = get();
      if (bookmarks.some((b) => b.path === trimmedPath)) return; // dedup

      const resolved = resolveFolderId(folders, folderId); // [B4]

      // [B2] Shared root sortIndex namespace
      const sortIdx = resolved === null
        ? nextSortIndex([
            ...bookmarks.filter((b) => b.folderId === null),
            ...folders,
          ])
        : nextSortIndex(bookmarks.filter((b) => b.folderId === resolved));

      const newBookmark: BookmarkItem = {
        id: generateId(),
        name: truncate(basename(trimmedPath), MAX_NAME_LENGTH),
        path: trimmedPath,
        type,
        folderId: resolved,
        sortIndex: sortIdx,
        createdAt: Date.now(),
      };

      set({ bookmarks: [...bookmarks, newBookmark] });
      persist();
    },

    removeBookmark: (id: string) => {
      const { bookmarks } = get();
      if (!bookmarks.some((b) => b.id === id)) return;
      set({ bookmarks: bookmarks.filter((b) => b.id !== id) });
      persist();
    },

    renameBookmark: (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const { bookmarks } = get();
      if (!bookmarks.some((b) => b.id === id)) return;

      set({
        bookmarks: bookmarks.map((b) =>
          b.id === id
            ? { ...b, name: truncate(trimmed, MAX_NAME_LENGTH) }
            : b,
        ),
      });
      persist();
    },

    moveBookmark: (
      id: string,
      targetFolderId: string | null,
      index?: number,
    ) => {
      const { bookmarks, folders } = get();
      if (!bookmarks.some((b) => b.id === id)) return;

      const resolved = resolveFolderId(folders, targetFolderId); // [B4]

      if (index !== undefined && resolved === null) {
        // [C1] Indexed insert at ROOT — siblings = combined root set (excl. moved item)
        const combined = rootSiblings(bookmarks, folders)
          .filter((item) => item.id !== id);
        const reindex = reindexSiblings(combined, Math.max(0, Math.min(index, combined.length)));
        const targetIdx = Math.max(0, Math.min(index, combined.length));
        reindex.set(id, targetIdx);
        const updated = applyRootReindex(reindex, bookmarks, folders);
        set({
          bookmarks: updated.bookmarks.map((b) =>
            b.id === id ? { ...b, folderId: null } : b,
          ),
          folders: updated.folders,
        });
      } else if (index !== undefined) {
        // Indexed insert into a folder — only bookmarks in that folder
        const siblings = bookmarks
          .filter((b) => b.folderId === resolved && b.id !== id)
          .sort((a, b) => a.sortIndex - b.sortIndex);
        const clamped = Math.max(0, Math.min(index, siblings.length));
        const reindex = reindexSiblings(siblings, clamped);
        set({
          bookmarks: bookmarks.map((b) => {
            if (b.id === id) return { ...b, folderId: resolved, sortIndex: clamped };
            const newIdx = reindex.get(b.id);
            return newIdx !== undefined ? { ...b, sortIndex: newIdx } : b;
          }),
        });
      } else {
        // Append to end — no indexed insert
        const targetIdx = resolved === null
          ? nextSortIndex(rootSiblings(bookmarks, folders)
              .filter((item) => item.id !== id))
          : nextSortIndex(bookmarks.filter((b) => b.folderId === resolved && b.id !== id));
        set({
          bookmarks: bookmarks.map((b) =>
            b.id === id ? { ...b, folderId: resolved, sortIndex: targetIdx } : b,
          ),
        });
      }
      persist();
    },

    reorderBookmark: (id: string, newIndex: number) => {
      const { bookmarks, folders } = get();
      const bookmark = bookmarks.find((b) => b.id === id);
      if (!bookmark) return;

      if (bookmark.folderId === null) {
        // [C1] Root reorder — combined root bookmarks + folders
        const combined = rootSiblings(bookmarks, folders);
        const reordered = reorderItems(combined, id, (item) => item.id, newIndex);
        const indexMap = new Map(reordered.map((item) => [item.id, item.sortIndex]));
        const updated = applyRootReindex(indexMap, bookmarks, folders);
        set(updated);
      } else {
        // Within-folder reorder — only bookmarks in that folder
        const siblings = bookmarks.filter((b) => b.folderId === bookmark.folderId);
        const others = bookmarks.filter((b) => b.folderId !== bookmark.folderId);
        const reordered = reorderItems(siblings, id, (b) => b.id, newIndex);
        set({ bookmarks: [...others, ...reordered] });
      }
      persist();
    },

    // ─── Folder Actions ────────────────────────────────────────

    addFolder: (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const { bookmarks, folders } = get();

      // [B2] Shared root sortIndex namespace
      const sortIdx = nextSortIndex([
        ...bookmarks.filter((b) => b.folderId === null),
        ...folders,
      ]);

      const newFolder: BookmarkFolder = {
        id: generateId(),
        name: truncate(trimmed, MAX_NAME_LENGTH),
        sortIndex: sortIdx,
        createdAt: Date.now(),
      };

      set({ folders: [...folders, newFolder] });
      persist();
    },

    removeFolder: (id: string) => {
      const { folders, bookmarks } = get();
      if (!folders.some((f) => f.id === id)) return;

      // [B5] Compute base sortIndex for orphans from existing root items
      const rootBookmarks = bookmarks.filter((b) => b.folderId === null);
      const survivingFolders = folders.filter((f) => f.id !== id);
      const baseIdx = nextSortIndex([...rootBookmarks, ...survivingFolders]);

      // Reindex orphaned children sequentially after existing root items [C4]
      const orphans = bookmarks
        .filter((b) => b.folderId === id)
        .sort((a, b) => a.sortIndex - b.sortIndex);
      const orphanRank = new Map(orphans.map((b, i) => [b.id, i] as const));

      const updatedBookmarks = bookmarks.map((b) => {
        if (b.folderId !== id) return b;
        const rank = orphanRank.get(b.id)!;
        return { ...b, folderId: null as string | null, sortIndex: baseIdx + rank };
      });

      set({ folders: survivingFolders, bookmarks: updatedBookmarks });
      persist();
    },

    renameFolder: (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const { folders } = get();
      if (!folders.some((f) => f.id === id)) return;

      set({
        folders: folders.map((f) =>
          f.id === id
            ? { ...f, name: truncate(trimmed, MAX_NAME_LENGTH) }
            : f,
        ),
      });
      persist();
    },

    reorderFolder: (id: string, newIndex: number) => {
      const { bookmarks, folders } = get();
      if (!folders.some((f) => f.id === id)) return;

      // [C1] Root reorder — combined root bookmarks + folders
      const combined = rootSiblings(bookmarks, folders);
      const reordered = reorderItems(combined, id, (item) => item.id, newIndex);
      const indexMap = new Map(reordered.map((item) => [item.id, item.sortIndex]));
      const updated = applyRootReindex(indexMap, bookmarks, folders);
      set(updated);
      persist();
    },

    // ─── Selectors ─────────────────────────────────────────────

    getBookmarksInFolder: (folderId: string | null): BookmarkItem[] => {
      return get()
        .bookmarks.filter((b) => b.folderId === folderId)
        .sort((a, b) => a.sortIndex - b.sortIndex);
    },

    getRootItems: (): (BookmarkItem | BookmarkFolder)[] => {
      const { bookmarks, folders } = get();
      const rootBookmarks = bookmarks.filter((b) => b.folderId === null);
      const items: (BookmarkItem | BookmarkFolder)[] = [
        ...rootBookmarks,
        ...folders,
      ];
      return items.sort((a, b) => a.sortIndex - b.sortIndex);
    },

    // ─── Import / Export ───────────────────────────────────────

    exportBookmarks: (): string => {
      const { bookmarks, folders } = get();
      return JSON.stringify({ bookmarks, folders });
    },

    importBookmarks: (json: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new Error(
          "Invalid JSON: could not parse bookmarks import data.",
        );
      }

      const data = parsed as Record<string, unknown>;
      if (!Array.isArray(data.bookmarks)) {
        throw new Error(
          "Invalid import data: missing or invalid 'bookmarks' array.",
        );
      }
      if (!Array.isArray(data.folders)) {
        throw new Error(
          "Invalid import data: missing or invalid 'folders' array.",
        );
      }

      // [B7] DoS limits
      if (data.bookmarks.length > MAX_BOOKMARKS) {
        throw new Error(
          `Import rejected: too many items (max ${MAX_BOOKMARKS} bookmarks, ${MAX_FOLDERS} folders).`,
        );
      }
      if (data.folders.length > MAX_FOLDERS) {
        throw new Error(
          `Import rejected: too many items (max ${MAX_BOOKMARKS} bookmarks, ${MAX_FOLDERS} folders).`,
        );
      }

      // [B3] Validate every item
      const validatedBookmarks = data.bookmarks.map((item: unknown, i: number) =>
        validateBookmarkItem(item, i),
      );
      const validatedFolders = data.folders.map((item: unknown, i: number) =>
        validateFolder(item, i),
      );

      set({ bookmarks: validatedBookmarks, folders: validatedFolders });
      persist();
    },
  };
});
