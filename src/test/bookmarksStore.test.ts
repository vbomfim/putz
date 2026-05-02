/**
 * Unit tests for bookmarks store.
 *
 * Tags: [TDD], [AC-bookmark-CRUD], [AC-bookmark-reorder],
 *       [AC-bookmark-folder], [AC-bookmark-persist], [AC-bookmark-import-export]
 *
 * Covers all acceptance criteria from issue #46 (Bookmarks T1).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ─── localStorage mock ──────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Must import AFTER localStorage mock is set up
import { useBookmarksStore } from "../stores/bookmarksStore";
import type { BookmarkItem } from "../stores/bookmarksStore";

/** Helper: reset the store to empty defaults. */
function resetStore(): void {
  useBookmarksStore.setState({ bookmarks: [], folders: [] });
  localStorageMock.clear();
  vi.clearAllMocks();
}

describe("bookmarksStore", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Default State
  // ═══════════════════════════════════════════════════════════════════

  describe("default state", () => {
    it("starts with empty bookmarks array", () => {
      const { bookmarks } = useBookmarksStore.getState();
      expect(bookmarks).toEqual([]);
    });

    it("starts with empty folders array", () => {
      const { folders } = useBookmarksStore.getState();
      expect(folders).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC1: Add a file bookmark
  // ═══════════════════════════════════════════════════════════════════

  describe("addBookmark — file", () => {
    it("AC1: adds a file bookmark with correct fields", () => {
      useBookmarksStore.getState().addBookmark("/Users/me/config.ts", "file");
      const { bookmarks } = useBookmarksStore.getState();
      expect(bookmarks).toHaveLength(1);
      const bm = bookmarks[0];
      expect(bm.path).toBe("/Users/me/config.ts");
      expect(bm.type).toBe("file");
      expect(bm.name).toBe("config.ts");
      expect(bm.folderId).toBeNull();
      expect(bm.id).toBeTruthy();
      expect(bm.sortIndex).toBe(0);
      expect(bm.createdAt).toBeGreaterThan(0);
    });

    it("defaults name to basename of path", () => {
      useBookmarksStore.getState().addBookmark("/a/b/c/myfile.txt", "file");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("myfile.txt");
    });

    it("uses full path as name if no basename (root path)", () => {
      useBookmarksStore.getState().addBookmark("/", "folder");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("/");
    });

    it("assigns incremental sortIndex for multiple bookmarks", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      const bms = useBookmarksStore.getState().bookmarks;
      expect(bms[0].sortIndex).toBe(0);
      expect(bms[1].sortIndex).toBe(1);
      expect(bms[2].sortIndex).toBe(2);
    });

    it("generates unique IDs for each bookmark", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      const bms = useBookmarksStore.getState().bookmarks;
      expect(bms[0].id).not.toBe(bms[1].id);
    });

    it("persists to localStorage on add", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "putz-bookmarks",
        expect.any(String),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC2: Add a folder bookmark
  // ═══════════════════════════════════════════════════════════════════

  describe("addBookmark — folder type", () => {
    it("AC2: adds a folder-type bookmark with correct fields", () => {
      useBookmarksStore.getState().addBookmark("/Users/me/projects", "folder");
      const { bookmarks } = useBookmarksStore.getState();
      expect(bookmarks).toHaveLength(1);
      const bm = bookmarks[0];
      expect(bm.path).toBe("/Users/me/projects");
      expect(bm.type).toBe("folder");
      expect(bm.name).toBe("projects");
      expect(bm.folderId).toBeNull();
    });

    it("adds bookmark into a specific folder when folderId provided", () => {
      useBookmarksStore.getState().addFolder("My Folder");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      const bm = useBookmarksStore.getState().bookmarks[0];
      expect(bm.folderId).toBe(folderId);
    });

    it("ignores non-existent folderId and adds to root", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file", "nonexistent");
      const bm = useBookmarksStore.getState().bookmarks[0];
      expect(bm.folderId).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC3: Deduplicate by path
  // ═══════════════════════════════════════════════════════════════════

  describe("addBookmark — deduplication", () => {
    it("AC3: does not add duplicate path (idempotent)", () => {
      useBookmarksStore.getState().addBookmark("/Users/me/config.ts", "file");
      useBookmarksStore.getState().addBookmark("/Users/me/config.ts", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
    });

    it("treats different paths as unique", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases — addBookmark
  // ═══════════════════════════════════════════════════════════════════

  describe("addBookmark — edge cases", () => {
    it("rejects empty string path (no-op)", () => {
      useBookmarksStore.getState().addBookmark("", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("rejects whitespace-only path (no-op)", () => {
      useBookmarksStore.getState().addBookmark("   ", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("trims path before storing", () => {
      useBookmarksStore.getState().addBookmark("  /a/b.ts  ", "file");
      expect(useBookmarksStore.getState().bookmarks[0].path).toBe("/a/b.ts");
    });

    it("handles paths with spaces", () => {
      useBookmarksStore
        .getState()
        .addBookmark("/Users/me/My Documents/file.txt", "file");
      expect(useBookmarksStore.getState().bookmarks[0].path).toBe(
        "/Users/me/My Documents/file.txt",
      );
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("file.txt");
    });

    it("handles unicode paths", () => {
      useBookmarksStore
        .getState()
        .addBookmark("/Users/me/文件/テスト.ts", "file");
      const bm = useBookmarksStore.getState().bookmarks[0];
      expect(bm.path).toBe("/Users/me/文件/テスト.ts");
      expect(bm.name).toBe("テスト.ts");
    });

    it("rejects paths longer than 1024 characters (no-op)", () => {
      const longPath = "/" + "a".repeat(1024);
      useBookmarksStore.getState().addBookmark(longPath, "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("accepts paths of exactly 1024 characters", () => {
      const path = "/" + "a".repeat(1023);
      expect(path.length).toBe(1024);
      useBookmarksStore.getState().addBookmark(path, "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC4: Remove bookmark
  // ═══════════════════════════════════════════════════════════════════

  describe("removeBookmark", () => {
    it("AC4: removes existing bookmark", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().removeBookmark(id);
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("no-op for unknown ID (no throw)", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      expect(() =>
        useBookmarksStore.getState().removeBookmark("nonexistent"),
      ).not.toThrow();
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
    });

    it("persists to localStorage after removal", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      localStorageMock.setItem.mockClear();
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().removeBookmark(id);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Rename bookmark
  // ═══════════════════════════════════════════════════════════════════

  describe("renameBookmark", () => {
    it("updates display name", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().renameBookmark(id, "My Config");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("My Config");
    });

    it("no-op for unknown ID (no throw)", () => {
      expect(() =>
        useBookmarksStore.getState().renameBookmark("nonexistent", "test"),
      ).not.toThrow();
    });

    it("trims whitespace from name", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().renameBookmark(id, "  Trimmed  ");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("Trimmed");
    });

    it("rejects empty name (no-op)", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().renameBookmark(id, "");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("a.ts");
    });

    it("truncates name longer than 100 characters", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const id = useBookmarksStore.getState().bookmarks[0].id;
      const longName = "x".repeat(150);
      useBookmarksStore.getState().renameBookmark(id, longName);
      expect(useBookmarksStore.getState().bookmarks[0].name).toHaveLength(100);
    });

    it("persists to localStorage after rename", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      localStorageMock.setItem.mockClear();
      const id = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().renameBookmark(id, "Renamed");
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC5: Move bookmark into/out of folder
  // ═══════════════════════════════════════════════════════════════════

  describe("moveBookmark", () => {
    it("AC5: moves bookmark into a folder", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("My Folder");
      const bmId = useBookmarksStore.getState().bookmarks[0].id;
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().moveBookmark(bmId, folderId);
      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBe(folderId);
    });

    it("moves bookmark out of folder to root", () => {
      useBookmarksStore.getState().addFolder("My Folder");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      const bmId = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().moveBookmark(bmId, null);
      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBeNull();
    });

    it("updates sortIndex when moving to a new container", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      // Add some existing bookmarks to the folder
      useBookmarksStore
        .getState()
        .addBookmark("/existing.ts", "file", folderId);
      // Add a root bookmark and move it in
      useBookmarksStore.getState().addBookmark("/newcomer.ts", "file");
      const bmId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/newcomer.ts")!.id;
      useBookmarksStore.getState().moveBookmark(bmId, folderId);
      const moved = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.id === bmId)!;
      expect(moved.folderId).toBe(folderId);
    });

    it("moves to a specific index within target folder", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/b.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().moveBookmark(cId, folderId, 0);
      // c.ts should now be first in the folder
      const folderBms = useBookmarksStore
        .getState()
        .getBookmarksInFolder(folderId);
      expect(folderBms[0].path).toBe("/c.ts");
    });

    it("no-op for unknown bookmark ID", () => {
      expect(() =>
        useBookmarksStore.getState().moveBookmark("bad-id", null),
      ).not.toThrow();
    });

    it("no-op for unknown folder ID (moves to root)", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const bmId = useBookmarksStore.getState().bookmarks[0].id;
      useBookmarksStore.getState().moveBookmark(bmId, "nonexistent");
      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBeNull();
    });

    it("persists to localStorage after move", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      localStorageMock.setItem.mockClear();
      const bmId = useBookmarksStore.getState().bookmarks[0].id;
      const fId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().moveBookmark(bmId, fId);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC8: Reorder bookmark within container
  // ═══════════════════════════════════════════════════════════════════

  describe("reorderBookmark", () => {
    it("AC8: reorders within root container — move to first", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(cId, 0);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[0].path).toBe("/c.ts");
      expect(rootBms[1].path).toBe("/a.ts");
      expect(rootBms[2].path).toBe("/b.ts");
    });

    it("reorders within root — move to last", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      const aId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/a.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(aId, 2);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[0].path).toBe("/b.ts");
      expect(rootBms[1].path).toBe("/c.ts");
      expect(rootBms[2].path).toBe("/a.ts");
    });

    it("reorders within root — move to middle", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(cId, 1);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[0].path).toBe("/a.ts");
      expect(rootBms[1].path).toBe("/c.ts");
      expect(rootBms[2].path).toBe("/b.ts");
    });

    it("clamps negative index to 0", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      const bId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/b.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(bId, -5);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[0].path).toBe("/b.ts");
    });

    it("clamps out-of-bounds index to last position", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      const aId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/a.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(aId, 999);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[1].path).toBe("/a.ts");
    });

    it("reorders within a folder", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/b.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/c.ts", "file", folderId);
      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(cId, 0);
      const folderBms = useBookmarksStore
        .getState()
        .getBookmarksInFolder(folderId);
      expect(folderBms[0].path).toBe("/c.ts");
      expect(folderBms[1].path).toBe("/a.ts");
      expect(folderBms[2].path).toBe("/b.ts");
    });

    it("no-op for unknown ID", () => {
      expect(() =>
        useBookmarksStore.getState().reorderBookmark("bad-id", 0),
      ).not.toThrow();
    });

    it("persists to localStorage after reorder", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      localStorageMock.setItem.mockClear();
      const bId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/b.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(bId, 0);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Folder CRUD
  // ═══════════════════════════════════════════════════════════════════

  describe("addFolder", () => {
    it("creates a folder with correct fields", () => {
      useBookmarksStore.getState().addFolder("My Folder");
      const { folders } = useBookmarksStore.getState();
      expect(folders).toHaveLength(1);
      const f = folders[0];
      expect(f.name).toBe("My Folder");
      expect(f.id).toBeTruthy();
      expect(f.sortIndex).toBe(0);
      expect(f.createdAt).toBeGreaterThan(0);
    });

    it("assigns incremental sortIndex for multiple folders", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      const { folders } = useBookmarksStore.getState();
      expect(folders[0].sortIndex).toBe(0);
      expect(folders[1].sortIndex).toBe(1);
    });

    it("rejects empty name (no-op)", () => {
      useBookmarksStore.getState().addFolder("");
      expect(useBookmarksStore.getState().folders).toHaveLength(0);
    });

    it("rejects whitespace-only name (no-op)", () => {
      useBookmarksStore.getState().addFolder("   ");
      expect(useBookmarksStore.getState().folders).toHaveLength(0);
    });

    it("trims folder name", () => {
      useBookmarksStore.getState().addFolder("  My Folder  ");
      expect(useBookmarksStore.getState().folders[0].name).toBe("My Folder");
    });

    it("truncates name longer than 100 characters", () => {
      useBookmarksStore.getState().addFolder("x".repeat(150));
      expect(useBookmarksStore.getState().folders[0].name).toHaveLength(100);
    });

    it("persists to localStorage", () => {
      localStorageMock.setItem.mockClear();
      useBookmarksStore.getState().addFolder("F1");
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC6: Remove folder cascades children to root
  // ═══════════════════════════════════════════════════════════════════

  describe("removeFolder", () => {
    it("AC6: removes folder and moves children to root", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/b.ts", "file", folderId);
      useBookmarksStore.getState().removeFolder(folderId);
      const { folders, bookmarks } = useBookmarksStore.getState();
      expect(folders).toHaveLength(0);
      expect(bookmarks).toHaveLength(2);
      expect(bookmarks[0].folderId).toBeNull();
      expect(bookmarks[1].folderId).toBeNull();
    });

    it("no-op for unknown folder ID", () => {
      expect(() =>
        useBookmarksStore.getState().removeFolder("nonexistent"),
      ).not.toThrow();
    });

    it("persists to localStorage after removal", () => {
      useBookmarksStore.getState().addFolder("F1");
      localStorageMock.setItem.mockClear();
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().removeFolder(id);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("renameFolder", () => {
    it("updates folder display name", () => {
      useBookmarksStore.getState().addFolder("Old Name");
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().renameFolder(id, "New Name");
      expect(useBookmarksStore.getState().folders[0].name).toBe("New Name");
    });

    it("no-op for unknown folder ID", () => {
      expect(() =>
        useBookmarksStore.getState().renameFolder("bad-id", "test"),
      ).not.toThrow();
    });

    it("rejects empty name (no-op)", () => {
      useBookmarksStore.getState().addFolder("Keep");
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().renameFolder(id, "");
      expect(useBookmarksStore.getState().folders[0].name).toBe("Keep");
    });

    it("trims whitespace", () => {
      useBookmarksStore.getState().addFolder("F1");
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().renameFolder(id, "  Trimmed  ");
      expect(useBookmarksStore.getState().folders[0].name).toBe("Trimmed");
    });

    it("truncates name longer than 100 characters", () => {
      useBookmarksStore.getState().addFolder("F1");
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().renameFolder(id, "z".repeat(150));
      expect(useBookmarksStore.getState().folders[0].name).toHaveLength(100);
    });

    it("persists to localStorage", () => {
      useBookmarksStore.getState().addFolder("F1");
      localStorageMock.setItem.mockClear();
      const id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().renameFolder(id, "Renamed");
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe("reorderFolder", () => {
    it("reorders folder to first position", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      useBookmarksStore.getState().addFolder("F3");
      const f3Id = useBookmarksStore.getState().folders[2].id;
      useBookmarksStore.getState().reorderFolder(f3Id, 0);
      const { folders } = useBookmarksStore.getState();
      const sorted = [...folders].sort((a, b) => a.sortIndex - b.sortIndex);
      expect(sorted[0].name).toBe("F3");
      expect(sorted[1].name).toBe("F1");
      expect(sorted[2].name).toBe("F2");
    });

    it("reorders folder to last position", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      useBookmarksStore.getState().addFolder("F3");
      const f1Id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().reorderFolder(f1Id, 2);
      const { folders } = useBookmarksStore.getState();
      const sorted = [...folders].sort((a, b) => a.sortIndex - b.sortIndex);
      expect(sorted[0].name).toBe("F2");
      expect(sorted[1].name).toBe("F3");
      expect(sorted[2].name).toBe("F1");
    });

    it("no-op for unknown folder ID", () => {
      expect(() =>
        useBookmarksStore.getState().reorderFolder("bad-id", 0),
      ).not.toThrow();
    });

    it("clamps out-of-bounds index", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      const f1Id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().reorderFolder(f1Id, 999);
      const { folders } = useBookmarksStore.getState();
      const sorted = [...folders].sort((a, b) => a.sortIndex - b.sortIndex);
      expect(sorted[1].name).toBe("F1");
    });

    it("persists to localStorage", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      localStorageMock.setItem.mockClear();
      const f2Id = useBookmarksStore.getState().folders[1].id;
      useBookmarksStore.getState().reorderFolder(f2Id, 0);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Selectors / getters
  // ═══════════════════════════════════════════════════════════════════

  describe("getBookmarksInFolder", () => {
    it("returns root bookmarks when folderId is null", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/c.ts", "file", folderId);

      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms).toHaveLength(2);
      expect(rootBms.map((b) => b.path)).toEqual(["/a.ts", "/b.ts"]);
    });

    it("returns bookmarks in specific folder", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/b.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/root.ts", "file");

      const folderBms = useBookmarksStore
        .getState()
        .getBookmarksInFolder(folderId);
      expect(folderBms).toHaveLength(2);
      expect(folderBms.map((b) => b.path)).toEqual(["/a.ts", "/b.ts"]);
    });

    it("returns items sorted by sortIndex", () => {
      useBookmarksStore.getState().addBookmark("/c.ts", "file");
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      // Reorder: move c to last
      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(cId, 2);
      const rootBms = useBookmarksStore.getState().getBookmarksInFolder(null);
      expect(rootBms[0].path).toBe("/a.ts");
      expect(rootBms[1].path).toBe("/b.ts");
      expect(rootBms[2].path).toBe("/c.ts");
    });

    it("returns empty array for folder with no bookmarks", () => {
      useBookmarksStore.getState().addFolder("Empty Folder");
      const folderId = useBookmarksStore.getState().folders[0].id;
      const bms = useBookmarksStore.getState().getBookmarksInFolder(folderId);
      expect(bms).toEqual([]);
    });
  });

  describe("getRootItems", () => {
    it("returns interleaved bookmarks and folders sorted by sortIndex", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");

      const items = useBookmarksStore.getState().getRootItems();
      // B2: shared namespace → exact creation order: /a.ts(0), F1(1), /b.ts(2)
      expect(items).toHaveLength(3);
      expect((items[0] as BookmarkItem).path).toBe("/a.ts");
      expect(items[1].name).toBe("F1");
      expect((items[2] as BookmarkItem).path).toBe("/b.ts");
    });

    it("excludes bookmarks inside folders from root items", () => {
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/root.ts", "file");
      useBookmarksStore
        .getState()
        .addBookmark("/in-folder.ts", "file", folderId);

      const items = useBookmarksStore.getState().getRootItems();
      // Root items = 1 folder + 1 root bookmark = 2
      expect(items).toHaveLength(2);
      const paths = items
        .filter((i): i is BookmarkItem => "path" in i)
        .map((i) => i.path);
      expect(paths).toContain("/root.ts");
      expect(paths).not.toContain("/in-folder.ts");
    });

    it("returns items sorted by sortIndex globally (shared namespace)", () => {
      useBookmarksStore.getState().addBookmark("/z.ts", "file");
      useBookmarksStore.getState().addFolder("A-Folder");
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const items = useBookmarksStore.getState().getRootItems();
      // B2: shared namespace → creation order: /z.ts(0), A-Folder(1), /a.ts(2)
      expect(items.length).toBe(3);
      expect((items[0] as BookmarkItem).path).toBe("/z.ts");
      expect(items[1].name).toBe("A-Folder");
      expect((items[2] as BookmarkItem).path).toBe("/a.ts");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AC7: Persistence — localStorage save/load roundtrip
  // ═══════════════════════════════════════════════════════════════════

  describe("persistence", () => {
    it("AC7: saves bookmarks and folders to localStorage", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");

      const stored = JSON.parse(
        localStorageMock.setItem.mock.calls[
          localStorageMock.setItem.mock.calls.length - 1
        ][1],
      );
      expect(stored.bookmarks).toHaveLength(1);
      expect(stored.folders).toHaveLength(1);
    });

    it("uses the correct storage key", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "putz-bookmarks",
        expect.any(String),
      );
    });

    it("loads persisted state from localStorage on re-import", async () => {
      // Add data
      useBookmarksStore.getState().addBookmark("/persisted.ts", "file");
      useBookmarksStore.getState().addFolder("Persisted Folder");

      // Grab what was persisted
      const lastCall =
        localStorageMock.setItem.mock.calls[
          localStorageMock.setItem.mock.calls.length - 1
        ];
      const persistedJson = lastCall[1];

      // Simulate app restart: set localStorage, reset modules, re-import
      localStorageMock.clear();
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === "putz-bookmarks" ? persistedJson : null,
      );

      vi.resetModules();
      const mod = await import("../stores/bookmarksStore");
      const state = mod.useBookmarksStore.getState();
      expect(state.bookmarks).toHaveLength(1);
      expect(state.bookmarks[0].path).toBe("/persisted.ts");
      expect(state.folders).toHaveLength(1);
      expect(state.folders[0].name).toBe("Persisted Folder");
    });

    it("handles corrupted localStorage gracefully — falls back to empty", async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === "putz-bookmarks" ? "not-valid-json{{{" : null,
      );
      vi.resetModules();
      const mod = await import("../stores/bookmarksStore");
      const state = mod.useBookmarksStore.getState();
      expect(state.bookmarks).toEqual([]);
      expect(state.folders).toEqual([]);
    });

    it("handles partially corrupted localStorage — missing fields default", async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === "putz-bookmarks" ? JSON.stringify({ bookmarks: [] }) : null,
      );
      vi.resetModules();
      const mod = await import("../stores/bookmarksStore");
      const state = mod.useBookmarksStore.getState();
      expect(state.bookmarks).toEqual([]);
      expect(state.folders).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Import / Export JSON
  // ═══════════════════════════════════════════════════════════════════

  describe("exportBookmarks", () => {
    it("returns a JSON string", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const json = useBookmarksStore.getState().exportBookmarks();
      expect(typeof json).toBe("string");
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("exported JSON contains bookmarks and folders", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      const parsed = JSON.parse(useBookmarksStore.getState().exportBookmarks());
      expect(parsed.bookmarks).toHaveLength(1);
      expect(parsed.folders).toHaveLength(1);
    });

    it("exported JSON preserves all bookmark fields", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      const parsed = JSON.parse(useBookmarksStore.getState().exportBookmarks());
      const bm = parsed.bookmarks[0];
      expect(bm.id).toBeTruthy();
      expect(bm.path).toBe("/a.ts");
      expect(bm.name).toBe("a.ts");
      expect(bm.type).toBe("file");
      expect(bm.folderId).toBeNull();
      expect(typeof bm.sortIndex).toBe("number");
      expect(typeof bm.createdAt).toBe("number");
    });
  });

  describe("importBookmarks", () => {
    it("replaces all bookmarks from JSON", () => {
      useBookmarksStore.getState().addBookmark("/existing.ts", "file");
      const importData = {
        bookmarks: [
          {
            id: "imported-1",
            name: "imported.ts",
            path: "/imported.ts",
            type: "file" as const,
            folderId: null,
            sortIndex: 0,
            createdAt: Date.now(),
          },
        ],
        folders: [],
      };
      useBookmarksStore.getState().importBookmarks(JSON.stringify(importData));
      const { bookmarks } = useBookmarksStore.getState();
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].path).toBe("/imported.ts");
    });

    it("JSON roundtrip preserves all fields", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/b.ts", "file", folderId);

      const exported = useBookmarksStore.getState().exportBookmarks();

      // Clear and import
      useBookmarksStore.setState({ bookmarks: [], folders: [] });
      useBookmarksStore.getState().importBookmarks(exported);

      const { bookmarks, folders } = useBookmarksStore.getState();
      expect(bookmarks).toHaveLength(2);
      expect(folders).toHaveLength(1);
      expect(bookmarks.find((b) => b.path === "/a.ts")).toBeTruthy();
      expect(bookmarks.find((b) => b.path === "/b.ts")?.folderId).toBe(
        folderId,
      );
      expect(folders[0].name).toBe("F1");
    });

    it("throws descriptive error on invalid JSON", () => {
      expect(() =>
        useBookmarksStore.getState().importBookmarks("not-json{{{"),
      ).toThrow(/invalid/i);
    });

    it("throws descriptive error on missing bookmarks array", () => {
      expect(() =>
        useBookmarksStore
          .getState()
          .importBookmarks(JSON.stringify({ folders: [] })),
      ).toThrow(/bookmarks/i);
    });

    it("throws descriptive error on missing folders array", () => {
      expect(() =>
        useBookmarksStore
          .getState()
          .importBookmarks(JSON.stringify({ bookmarks: [] })),
      ).toThrow(/folders/i);
    });

    it("persists imported data to localStorage", () => {
      localStorageMock.setItem.mockClear();
      const importData = { bookmarks: [], folders: [] };
      useBookmarksStore.getState().importBookmarks(JSON.stringify(importData));
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "putz-bookmarks",
        expect.any(String),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B1 — basename() handles Windows paths
  // ═══════════════════════════════════════════════════════════════════

  describe("basename — Windows paths (B1)", () => {
    it("extracts basename from Windows path", () => {
      useBookmarksStore
        .getState()
        .addBookmark("C:\\Users\\me\\file.ts", "file");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("file.ts");
    });

    it("handles Windows root drive", () => {
      useBookmarksStore.getState().addBookmark("C:\\", "folder");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("C:");
    });

    it("handles UNC paths", () => {
      useBookmarksStore
        .getState()
        .addBookmark("\\\\server\\share\\file.txt", "file");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("file.txt");
    });

    it("handles Windows trailing backslash", () => {
      useBookmarksStore.getState().addBookmark("C:\\Users\\me\\", "folder");
      expect(useBookmarksStore.getState().bookmarks[0].name).toBe("me");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B2 — Root sortIndex shared namespace
  // ═══════════════════════════════════════════════════════════════════

  describe("root sortIndex namespace (B2)", () => {
    it("2 bookmarks then 1 folder → exact order [bm1, bm2, folder]", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      const items = useBookmarksStore.getState().getRootItems();
      expect(items).toHaveLength(3);
      expect((items[0] as BookmarkItem).path).toBe("/a.ts");
      expect((items[1] as BookmarkItem).path).toBe("/b.ts");
      expect(items[2].name).toBe("F1");
    });

    it("1 folder then 2 bookmarks → exact order [folder, bm1, bm2]", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      const items = useBookmarksStore.getState().getRootItems();
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("F1");
      expect((items[1] as BookmarkItem).path).toBe("/a.ts");
      expect((items[2] as BookmarkItem).path).toBe("/b.ts");
    });

    it("interleaved: bm, folder, bm, folder → exact creation order", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      useBookmarksStore.getState().addFolder("F2");
      const items = useBookmarksStore.getState().getRootItems();
      expect(items).toHaveLength(4);
      expect((items[0] as BookmarkItem).path).toBe("/a.ts");
      expect(items[1].name).toBe("F1");
      expect((items[2] as BookmarkItem).path).toBe("/b.ts");
      expect(items[3].name).toBe("F2");
    });

    it("reorder root items across bookmark/folder boundary", () => {
      useBookmarksStore.getState().addBookmark("/a.ts", "file");
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addBookmark("/b.ts", "file");
      // Initial root order: [/a.ts(0), F1(1), /b.ts(2)]
      const bId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/b.ts")!.id;
      // Move /b.ts to position 0 (before everything)
      useBookmarksStore.getState().reorderBookmark(bId, 0);
      const items = useBookmarksStore.getState().getRootItems();
      expect(items.length).toBe(3);
      // [C1] Exact identity: /b.ts first, then /a.ts, then F1
      expect(items[0]).toMatchObject({ path: "/b.ts", sortIndex: 0 });
      expect(items[1]).toMatchObject({ path: "/a.ts", sortIndex: 1 });
      expect(items[2]).toMatchObject({ name: "F1", sortIndex: 2 });
      // All sortIndices must be unique
      const indices = items.map((i) => i.sortIndex);
      expect(new Set(indices).size).toBe(indices.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B3 — Import validation
  // ═══════════════════════════════════════════════════════════════════

  describe("import validation (B3)", () => {
    it("rejects import with malformed array items (numbers)", () => {
      const data = { bookmarks: [42, null], folders: [] };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/bookmark at index 0/i);
    });

    it("rejects import with missing fields", () => {
      const data = {
        bookmarks: [{ id: "x", name: "test" }], // missing path, type, etc.
        folders: [],
      };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/bookmark at index 0/i);
    });

    it("rejects import with __proto__ payload — store unchanged", () => {
      // Use raw JSON string — JS object literals consume __proto__
      const malicious =
        '{"bookmarks":[{"__proto__":{"polluted":true},"id":"x","name":"test","path":"/test","type":"file","folderId":null,"sortIndex":0,"createdAt":1000}],"folders":[]}';

      // Store starts with a safe bookmark
      useBookmarksStore.getState().addBookmark("/safe.ts", "file");
      const before = useBookmarksStore.getState().bookmarks.length;

      expect(() =>
        useBookmarksStore.getState().importBookmarks(malicious),
      ).toThrow(/forbidden/i);

      // Store should be unchanged
      expect(useBookmarksStore.getState().bookmarks.length).toBe(before);
      // Object.prototype should be unaffected
      expect(
        Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
      ).toBe(false);
    });

    it("rejects import with NaN sortIndex", () => {
      const data = {
        bookmarks: [
          {
            id: "x",
            name: "test",
            path: "/test",
            type: "file",
            folderId: null,
            sortIndex: NaN,
            createdAt: Date.now(),
          },
        ],
        folders: [],
      };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/sortIndex/i);
    });

    it("rejects import with float sortIndex", () => {
      const data = {
        bookmarks: [
          {
            id: "x",
            name: "test",
            path: "/test",
            type: "file",
            folderId: null,
            sortIndex: 1.5,
            createdAt: Date.now(),
          },
        ],
        folders: [],
      };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/sortIndex/i);
    });

    it("loads corrupted localStorage with mix of valid + invalid items", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mixedData = {
        bookmarks: [
          {
            id: "valid-1",
            name: "good.ts",
            path: "/good.ts",
            type: "file",
            folderId: null,
            sortIndex: 0,
            createdAt: Date.now(),
          },
          42, // invalid
          { id: "bad", name: "", path: "", type: "file" }, // invalid — missing fields
        ],
        folders: [
          {
            id: "f-valid",
            name: "Good Folder",
            sortIndex: 0,
            createdAt: Date.now(),
          },
          null, // invalid
        ],
      };

      localStorageMock.getItem.mockImplementation((key: string) =>
        key === "putz-bookmarks" ? JSON.stringify(mixedData) : null,
      );
      vi.resetModules();
      const mod = await import("../stores/bookmarksStore");
      const state = mod.useBookmarksStore.getState();

      expect(state.bookmarks).toHaveLength(1);
      expect(state.bookmarks[0].path).toBe("/good.ts");
      expect(state.folders).toHaveLength(1);
      expect(state.folders[0].name).toBe("Good Folder");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropped 3 invalid items"),
      );

      warnSpy.mockRestore();
    });

    it("rejects import with constructor own-property (prototype pollution)", () => {
      const data = {
        bookmarks: [],
        folders: [
          {
            constructor: { prototype: {} },
            id: "x",
            name: "test",
            sortIndex: 0,
            createdAt: Date.now(),
          },
        ],
      };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/forbidden/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B5 — removeFolder reindexes orphaned children
  // ═══════════════════════════════════════════════════════════════════

  describe("removeFolder reindexes orphans (B5)", () => {
    it("orphaned children get sequential sortIndex after root items", () => {
      // Root items: 2 bookmarks
      useBookmarksStore.getState().addBookmark("/root1.ts", "file");
      useBookmarksStore.getState().addBookmark("/root2.ts", "file");
      // Folder with 2 children
      useBookmarksStore.getState().addFolder("F1");
      const folderId = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/child1.ts", "file", folderId);
      useBookmarksStore.getState().addBookmark("/child2.ts", "file", folderId);

      useBookmarksStore.getState().removeFolder(folderId);

      const { bookmarks, folders } = useBookmarksStore.getState();
      expect(folders).toHaveLength(0);
      expect(bookmarks).toHaveLength(4);

      // All should now be at root
      expect(bookmarks.every((b) => b.folderId === null)).toBe(true);

      // Sort indices should be unique
      const sortIndices = bookmarks.map((b) => b.sortIndex);
      expect(new Set(sortIndices).size).toBe(4);

      // Root items should keep their original positions
      const root1 = bookmarks.find((b) => b.path === "/root1.ts")!;
      const root2 = bookmarks.find((b) => b.path === "/root2.ts")!;
      const child1 = bookmarks.find((b) => b.path === "/child1.ts")!;
      const child2 = bookmarks.find((b) => b.path === "/child2.ts")!;

      expect(root1.sortIndex).toBeLessThan(child1.sortIndex);
      expect(root2.sortIndex).toBeLessThan(child1.sortIndex);
      expect(child1.sortIndex).toBeLessThan(child2.sortIndex);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B6 — Path control-character sanitization
  // ═══════════════════════════════════════════════════════════════════

  describe("path control-character sanitization (B6)", () => {
    it("rejects path with null byte (\\x00)", () => {
      useBookmarksStore.getState().addBookmark("/tmp\x00malicious", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("rejects path with newline (\\n)", () => {
      useBookmarksStore.getState().addBookmark("/tmp\nrm -rf /", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("rejects path with carriage return (\\r)", () => {
      useBookmarksStore.getState().addBookmark("/tmp\r/malicious", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("rejects path with escape character (\\x1B)", () => {
      useBookmarksStore.getState().addBookmark("/tmp\x1B[31m/red", "file");
      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    });

    it("import rejects path with control characters", () => {
      const data = {
        bookmarks: [
          {
            id: "x",
            name: "bad",
            path: "/tmp\nrm -rf /",
            type: "file",
            folderId: null,
            sortIndex: 0,
            createdAt: Date.now(),
          },
        ],
        folders: [],
      };
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/control characters/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // B7 — Import size DoS limits
  // ═══════════════════════════════════════════════════════════════════

  describe("import size limits (B7)", () => {
    it("rejects import with >1000 bookmarks", () => {
      const bookmarks = Array.from({ length: 1001 }, (_, i) => ({
        id: `bm-${i}`,
        name: `file${i}.ts`,
        path: `/file${i}.ts`,
        type: "file" as const,
        folderId: null,
        sortIndex: i,
        createdAt: Date.now(),
      }));
      expect(() =>
        useBookmarksStore
          .getState()
          .importBookmarks(JSON.stringify({ bookmarks, folders: [] })),
      ).toThrow(/too many/i);
    });

    it("rejects import with >100 folders", () => {
      const folders = Array.from({ length: 101 }, (_, i) => ({
        id: `f-${i}`,
        name: `Folder ${i}`,
        sortIndex: i,
        createdAt: Date.now(),
      }));
      expect(() =>
        useBookmarksStore
          .getState()
          .importBookmarks(JSON.stringify({ bookmarks: [], folders })),
      ).toThrow(/too many/i);
    });

    it("accepts import at exact limits (1000 bookmarks, 100 folders)", () => {
      const bookmarks = Array.from({ length: 1000 }, (_, i) => ({
        id: `bm-${i}`,
        name: `file${i}.ts`,
        path: `/file${i}.ts`,
        type: "file" as const,
        folderId: null,
        sortIndex: i,
        createdAt: Date.now(),
      }));
      const folders = Array.from({ length: 100 }, (_, i) => ({
        id: `f-${i}`,
        name: `Folder ${i}`,
        sortIndex: i,
        createdAt: Date.now(),
      }));
      expect(() =>
        useBookmarksStore
          .getState()
          .importBookmarks(JSON.stringify({ bookmarks, folders })),
      ).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup — folder-to-folder move test (Code Review #6)
  // ═══════════════════════════════════════════════════════════════════

  describe("moveBookmark — folder to folder", () => {
    it("moves a bookmark from F1 to F2 with correct folderId and sortIndex", () => {
      useBookmarksStore.getState().addFolder("F1");
      useBookmarksStore.getState().addFolder("F2");
      const f1Id = useBookmarksStore.getState().folders[0].id;
      const f2Id = useBookmarksStore.getState().folders[1].id;
      // Add an existing bookmark to F2
      useBookmarksStore.getState().addBookmark("/existing.ts", "file", f2Id);
      // Add bookmark to F1
      useBookmarksStore.getState().addBookmark("/moved.ts", "file", f1Id);
      const bmId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/moved.ts")!.id;

      useBookmarksStore.getState().moveBookmark(bmId, f2Id);

      const moved = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.id === bmId)!;
      expect(moved.folderId).toBe(f2Id);

      // Should get next sortIndex in F2's container
      const f2Bookmarks = useBookmarksStore
        .getState()
        .getBookmarksInFolder(f2Id);
      expect(f2Bookmarks).toHaveLength(2);
      // /moved.ts should be last (appended)
      expect(f2Bookmarks[1].path).toBe("/moved.ts");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C1 — Root sortIndex combined namespace (all indexed root operations)
  // ═══════════════════════════════════════════════════════════════════

  describe("root sortIndex — combined namespace (C1)", () => {
    it("reorderBookmark past folder at root — no sortIndex collisions", () => {
      useBookmarksStore.getState().addBookmark("/first.ts", "file"); // 0
      useBookmarksStore.getState().addFolder("Middle"); // 1
      useBookmarksStore.getState().addBookmark("/last.ts", "file"); // 2

      const lastId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/last.ts")!.id;
      // Move /last.ts from position 2 → position 1 (between /first.ts and Middle)
      useBookmarksStore.getState().reorderBookmark(lastId, 1);
      const items = useBookmarksStore.getState().getRootItems();
      expect(items.map((i) => i.name)).toEqual([
        "first.ts",
        "last.ts",
        "Middle",
      ]);
      // All sortIndices unique
      const indices = items.map((i) => i.sortIndex);
      expect(new Set(indices).size).toBe(3);
    });

    it("reorderFolder past bookmark at root — no sortIndex collisions", () => {
      useBookmarksStore.getState().addFolder("F1"); // 0
      useBookmarksStore.getState().addBookmark("/mid.ts", "file"); // 1
      useBookmarksStore.getState().addFolder("F2"); // 2

      const f1Id = useBookmarksStore
        .getState()
        .folders.find((f) => f.name === "F1")!.id;
      // Move F1 from position 0 → position 2 (after /mid.ts and F2)
      useBookmarksStore.getState().reorderFolder(f1Id, 2);
      const items = useBookmarksStore.getState().getRootItems();
      expect(items.map((i) => i.name)).toEqual(["mid.ts", "F2", "F1"]);
      const indices = items.map((i) => i.sortIndex);
      expect(new Set(indices).size).toBe(3);
    });

    it("moveBookmark to specific root position — interleaves with folders", () => {
      useBookmarksStore.getState().addBookmark("/root.ts", "file"); // 0
      useBookmarksStore.getState().addFolder("F1"); // 1
      useBookmarksStore.getState().addFolder("F2"); // 2

      const f1Id = useBookmarksStore
        .getState()
        .folders.find((f) => f.name === "F1")!.id;
      // Add a bookmark inside F1
      useBookmarksStore.getState().addBookmark("/inside.ts", "file", f1Id);
      const insideId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/inside.ts")!.id;

      // Move /inside.ts to root at index 1 (between /root.ts and F1)
      useBookmarksStore.getState().moveBookmark(insideId, null, 1);
      const items = useBookmarksStore.getState().getRootItems();
      expect(items.map((i) => i.name)).toEqual([
        "root.ts",
        "inside.ts",
        "F1",
        "F2",
      ]);
      const indices = items.map((i) => i.sortIndex);
      expect(new Set(indices).size).toBe(4);
    });

    it("all root sortIndices are unique after multiple mixed operations", () => {
      // Build: 2 bookmarks, 2 folders interleaved
      useBookmarksStore.getState().addBookmark("/a.ts", "file"); // 0
      useBookmarksStore.getState().addFolder("F1"); // 1
      useBookmarksStore.getState().addBookmark("/b.ts", "file"); // 2
      useBookmarksStore.getState().addFolder("F2"); // 3

      // Reorder /b.ts to front
      const bId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/b.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(bId, 0);

      // Reorder F2 to position 1
      const f2Id = useBookmarksStore
        .getState()
        .folders.find((f) => f.name === "F2")!.id;
      useBookmarksStore.getState().reorderFolder(f2Id, 1);

      const items = useBookmarksStore.getState().getRootItems();
      expect(items.length).toBe(4);
      const indices = items.map((i) => i.sortIndex);
      expect(new Set(indices).size).toBe(4);
      // Verify ordering: b.ts, F2, a.ts, F1
      expect(items.map((i) => i.name)).toEqual(["b.ts", "F2", "a.ts", "F1"]);
    });

    it("reorderBookmark inside folder does NOT affect root sortIndices", () => {
      useBookmarksStore.getState().addFolder("F1");
      const f1Id = useBookmarksStore.getState().folders[0].id;
      useBookmarksStore.getState().addBookmark("/a.ts", "file", f1Id);
      useBookmarksStore.getState().addBookmark("/b.ts", "file", f1Id);
      useBookmarksStore.getState().addBookmark("/c.ts", "file", f1Id);

      const cId = useBookmarksStore
        .getState()
        .bookmarks.find((b) => b.path === "/c.ts")!.id;
      useBookmarksStore.getState().reorderBookmark(cId, 0);

      const inFolder = useBookmarksStore.getState().getBookmarksInFolder(f1Id);
      expect(inFolder.map((b) => b.path)).toEqual(["/c.ts", "/a.ts", "/b.ts"]);
      // Root should only contain F1
      const root = useBookmarksStore.getState().getRootItems();
      expect(root.length).toBe(1);
      expect(root[0].name).toBe("F1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C2 — validateBookmarkItem stores sanitized path
  // ═══════════════════════════════════════════════════════════════════

  describe("import stores sanitized path (C2)", () => {
    it("trims whitespace from imported path", () => {
      const data = {
        bookmarks: [
          {
            id: "c2-1",
            name: "trimmed",
            path: "  /clean/path  ",
            type: "file",
            folderId: null,
            sortIndex: 0,
            createdAt: 1000,
          },
        ],
        folders: [],
      };
      useBookmarksStore.getState().importBookmarks(JSON.stringify(data));
      const stored = useBookmarksStore.getState().bookmarks[0];
      expect(stored.path).toBe("/clean/path");
    });

    it("rejects path with embedded tab (control character)", () => {
      const data = {
        bookmarks: [
          {
            id: "c2-2",
            name: "tabbed",
            path: "/old/\tpath",
            type: "folder",
            folderId: null,
            sortIndex: 0,
            createdAt: 2000,
          },
        ],
        folders: [],
      };
      // Tab (\t) in the middle is a control char → rejected
      expect(() =>
        useBookmarksStore.getState().importBookmarks(JSON.stringify(data)),
      ).toThrow(/invalid path/i);
    });

    it("trims leading/trailing spaces from imported path", () => {
      const data = {
        bookmarks: [
          {
            id: "c2-3",
            name: "spaced",
            path: "   /spaced/path   ",
            type: "file",
            folderId: null,
            sortIndex: 0,
            createdAt: 3000,
          },
        ],
        folders: [],
      };
      useBookmarksStore.getState().importBookmarks(JSON.stringify(data));
      const stored = useBookmarksStore.getState().bookmarks[0];
      // sanitizePath trims, so stored path has no leading/trailing spaces
      expect(stored.path).toBe("/spaced/path");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // C3 — loadPersistedBookmarks size cap
  // ═══════════════════════════════════════════════════════════════════

  describe("load size limits (C3)", () => {
    it("truncates bookmarks to 1000 during load and warns", async () => {
      const bookmarks = Array.from({ length: 1050 }, (_, i) => ({
        id: `load-bm-${i}`,
        name: `bm${i}`,
        path: `/path/load-${i}`,
        type: "file",
        folderId: null,
        sortIndex: i,
        createdAt: i * 1000,
      }));
      localStorage.setItem(
        "putz-bookmarks",
        JSON.stringify({ bookmarks, folders: [] }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Re-import the store to trigger loadPersistedBookmarks
      vi.resetModules();
      const { useBookmarksStore: freshStore } =
        await import("../stores/bookmarksStore");

      expect(freshStore.getState().bookmarks.length).toBeLessThanOrEqual(1000);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("truncated persisted bookmarks"),
      );
      warnSpy.mockRestore();
    });

    it("truncates folders to 100 during load and warns", async () => {
      const folders = Array.from({ length: 120 }, (_, i) => ({
        id: `load-f-${i}`,
        name: `folder${i}`,
        sortIndex: i,
        createdAt: i * 1000,
      }));
      localStorage.setItem(
        "putz-bookmarks",
        JSON.stringify({ bookmarks: [], folders }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      vi.resetModules();
      const { useBookmarksStore: freshStore } =
        await import("../stores/bookmarksStore");

      expect(freshStore.getState().folders.length).toBeLessThanOrEqual(100);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("truncated persisted folders"),
      );
      warnSpy.mockRestore();
    });
  });
});
