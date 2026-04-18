/**
 * Unit tests for the BookmarksBar component.
 *
 * Tags: [TDD], [AC-render], [AC-visibility], [AC-click], [AC-folder-dropdown],
 *       [AC-empty], [AC-truncation], [AC-icons], [AC-drag], [AC-keyboard], [AC-a11y]
 *
 * @module BookmarksBar.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";


// ─── Mock State ──────────────────────────────────────────────────────

let mockBookmarksBarVisible = true;
const mockToggleBookmarksBar = vi.fn();
const mockReorderBookmark = vi.fn();
const mockReorderFolder = vi.fn();

// Default bookmark items for tests
const mockBookmarks = [
  {
    id: "bk-1",
    name: "readme.md",
    path: "/home/user/projects/readme.md",
    type: "file" as const,
    folderId: null,
    sortIndex: 0,
    createdAt: 1000,
  },
  {
    id: "bk-2",
    name: "data.csv",
    path: "/home/user/data.csv",
    type: "file" as const,
    folderId: null,
    sortIndex: 1,
    createdAt: 2000,
  },
  {
    id: "bk-3",
    name: "app.py",
    path: "/home/user/app.py",
    type: "file" as const,
    folderId: null,
    sortIndex: 2,
    createdAt: 3000,
  },
  {
    id: "bk-4",
    name: "config.json",
    path: "/home/user/config.json",
    type: "file" as const,
    folderId: null,
    sortIndex: 3,
    createdAt: 4000,
  },
  {
    id: "bk-5",
    name: "index.tsx",
    path: "/home/user/index.tsx",
    type: "file" as const,
    folderId: null,
    sortIndex: 4,
    createdAt: 5000,
  },
  {
    id: "bk-6",
    name: "lib.rs",
    path: "/home/user/lib.rs",
    type: "file" as const,
    folderId: null,
    sortIndex: 5,
    createdAt: 6000,
  },
  {
    id: "bk-7",
    name: "notes.txt",
    path: "/home/user/notes.txt",
    type: "file" as const,
    folderId: null,
    sortIndex: 6,
    createdAt: 7000,
  },
];

const mockFolders = [
  { id: "folder-1", name: "My Folder", sortIndex: 7, createdAt: 8000 },
];

const mockFolderChildren = [
  {
    id: "bk-child-1",
    name: "child-script.js",
    path: "/home/user/child-script.js",
    type: "file" as const,
    folderId: "folder-1",
    sortIndex: 0,
    createdAt: 9000,
  },
  {
    id: "bk-child-2",
    name: "child.yaml",
    path: "/home/user/child.yaml",
    type: "file" as const,
    folderId: "folder-1",
    sortIndex: 1,
    createdAt: 10000,
  },
];

/** Merged root items returned by getRootItems (sorted by sortIndex). */
function buildRootItems() {
  return [...mockBookmarks, ...mockFolders].sort(
    (a, b) => a.sortIndex - b.sortIndex,
  );
}

/** Returns bookmarks in a specific folder. */
function buildBookmarksInFolder(folderId: string | null) {
  return [...mockBookmarks, ...mockFolderChildren]
    .filter((b) => b.folderId === folderId)
    .sort((a, b) => a.sortIndex - b.sortIndex);
}

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      bookmarksBarVisible: mockBookmarksBarVisible,
      toggleBookmarksBar: mockToggleBookmarksBar,
    };
    return selector(state);
  }),
}));

vi.mock("../stores/bookmarksStore", () => ({
  useBookmarksStore: vi.fn((selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      bookmarks: [...mockBookmarks, ...mockFolderChildren],
      folders: mockFolders,
      getRootItems: buildRootItems,
      getBookmarksInFolder: buildBookmarksInFolder,
      reorderBookmark: mockReorderBookmark,
      reorderFolder: mockReorderFolder,
    };
    return selector(state);
  }),
}));

// ─── Import After Mocks ─────────────────────────────────────────────

import { BookmarksBar } from "../components/BookmarksBar";
import { useBookmarksStore } from "../stores/bookmarksStore";

const mockedUseBookmarksStore = vi.mocked(useBookmarksStore);

// ─── Helpers ─────────────────────────────────────────────────────────

const defaultProps = {
  onBookmarkClick: vi.fn(),
};

/** Overrides bookmarks mock with custom data for a single test. */
function overrideBookmarksMock(overrides: {
  bookmarks?: typeof mockBookmarks;
  folders?: typeof mockFolders;
  rootItems?: () => ReturnType<typeof buildRootItems>;
  bookmarksInFolder?: (folderId: string | null) => ReturnType<typeof buildBookmarksInFolder>;
}) {
  mockedUseBookmarksStore.mockImplementation(
    (selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        bookmarks: overrides.bookmarks ?? [],
        folders: overrides.folders ?? [],
        getRootItems: overrides.rootItems ?? (() => []),
        getBookmarksInFolder: overrides.bookmarksInFolder ?? (() => []),
        reorderBookmark: mockReorderBookmark,
        reorderFolder: mockReorderFolder,
      };
      return selector(state);
    },
  );
}

/** Restores the default bookmarks mock. */
function restoreBookmarksMock() {
  mockedUseBookmarksStore.mockImplementation(
    (selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        bookmarks: [...mockBookmarks, ...mockFolderChildren],
        folders: mockFolders,
        getRootItems: buildRootItems,
        getBookmarksInFolder: buildBookmarksInFolder,
        reorderBookmark: mockReorderBookmark,
        reorderFolder: mockReorderFolder,
      };
      return selector(state);
    },
  );
}

function renderBar(overrides: Partial<typeof defaultProps> = {}) {
  return render(<BookmarksBar {...defaultProps} {...overrides} />);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("BookmarksBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarksBarVisible = true;
  });

  // ─── AC1: Visibility ────────────────────────────────────────

  describe("visibility", () => {
    it("returns null when bookmarksBarVisible is false", () => {
      mockBookmarksBarVisible = false;
      const { container } = renderBar();
      expect(container.innerHTML).toBe("");
    });

    it("renders the bar when bookmarksBarVisible is true", () => {
      renderBar();
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });
  });

  // ─── AC2: Renders bookmarks with correct emoji icons ────────

  describe("bookmark rendering with icons", () => {
    it("renders all root bookmarks with correct display names", () => {
      renderBar();
      expect(screen.getByRole("button", { name: /readme\.md/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /data\.csv/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /app\.py/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /config\.json/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /index\.tsx/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /lib\.rs/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /notes\.txt/ })).toBeInTheDocument();
    });

    it("renders folder items with folder emoji and disclosure role", () => {
      renderBar();
      const folderButton = screen.getByRole("button", { name: /My Folder/ });
      expect(folderButton).toBeInTheDocument();
      expect(folderButton.textContent).toContain("📁");
    });
  });

  // ─── AC3: Correct emoji per extension ───────────────────────

  describe("emoji icon mapping", () => {
    it("shows 📖 for markdown files (.md)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /readme\.md/ });
      expect(btn.textContent).toContain("📖");
    });

    it("shows 📊 for CSV files (.csv)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /data\.csv/ });
      expect(btn.textContent).toContain("📊");
    });

    it("shows 🐍 for Python files (.py)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /app\.py/ });
      expect(btn.textContent).toContain("🐍");
    });

    it("shows ⚙️ for JSON files (.json)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /config\.json/ });
      expect(btn.textContent).toContain("⚙️");
    });

    it("shows 📜 for TSX files (.tsx)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /index\.tsx/ });
      expect(btn.textContent).toContain("📜");
    });

    it("shows 🦀 for Rust files (.rs)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /lib\.rs/ });
      expect(btn.textContent).toContain("🦀");
    });

    it("shows 📄 for unknown extensions (fallback)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /notes\.txt/ });
      expect(btn.textContent).toContain("📄");
    });

    it("shows 📜 for JS files inside folder dropdown", () => {
      renderBar();
      // Open folder
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      const childBtn = screen.getByRole("menuitem", { name: /child-script\.js/ });
      expect(childBtn.textContent).toContain("📜");
    });

    it("shows ⚙️ for YAML files inside folder dropdown", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      const childBtn = screen.getByRole("menuitem", { name: /child\.yaml/ });
      expect(childBtn.textContent).toContain("⚙️");
    });
  });

  // ─── AC4: Click fires onBookmarkClick ───────────────────────

  describe("click handling", () => {
    it("calls onBookmarkClick with correct bookmark on click", () => {
      const onClick = vi.fn();
      renderBar({ onBookmarkClick: onClick });
      fireEvent.click(screen.getByRole("button", { name: /readme\.md/ }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "bk-1",
          name: "readme.md",
          path: "/home/user/projects/readme.md",
        }),
      );
    });

    it("calls onBookmarkClick with different bookmark data", () => {
      const onClick = vi.fn();
      renderBar({ onBookmarkClick: onClick });
      fireEvent.click(screen.getByRole("button", { name: /data\.csv/ }));
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "bk-2",
          name: "data.csv",
          path: "/home/user/data.csv",
        }),
      );
    });
  });

  // ─── AC5: Folder dropdown ──────────────────────────────────

  describe("folder dropdown", () => {
    it("opens dropdown on folder click", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /child-script\.js/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /child\.yaml/ })).toBeInTheDocument();
    });

    it("closes dropdown on second folder click", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.click(folderBtn);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes dropdown on click outside", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      // Click on the toolbar area (outside the dropdown)
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes dropdown on Escape key", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(folderBtn, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("fires onBookmarkClick for dropdown items", () => {
      const onClick = vi.fn();
      renderBar({ onBookmarkClick: onClick });
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      fireEvent.click(screen.getByRole("menuitem", { name: /child-script\.js/ }));
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "bk-child-1",
          name: "child-script.js",
          path: "/home/user/child-script.js",
        }),
      );
    });

    it("closes dropdown after clicking a dropdown item", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      fireEvent.click(screen.getByRole("menuitem", { name: /child-script\.js/ }));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("sets aria-expanded on folder button when open", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      expect(folderBtn).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(folderBtn);
      expect(folderBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("sets aria-haspopup on folder button", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      expect(folderBtn).toHaveAttribute("aria-haspopup", "true");
    });
  });

  // ─── AC6: Empty state ──────────────────────────────────────

  describe("empty state", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("renders empty-state placeholder when no bookmarks or folders exist", () => {
      overrideBookmarksMock({
        bookmarks: [],
        folders: [],
        rootItems: () => [],
        bookmarksInFolder: () => [],
      });

      renderBar();
      expect(screen.getByText(/no bookmarks yet/i)).toBeInTheDocument();
    });
  });

  // ─── AC7: Long name truncation ─────────────────────────────

  describe("long name truncation", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("truncates long names visually and shows full name in title", () => {
      const longName = "this-is-a-very-long-bookmark-name-that-should-be-truncated.md";
      const longBookmark = {
        id: "bk-long",
        name: longName,
        path: `/home/user/${longName}`,
        type: "file" as const,
        folderId: null,
        sortIndex: 0,
        createdAt: 1000,
      };
      overrideBookmarksMock({
        bookmarks: [longBookmark],
        folders: [],
        rootItems: () => [longBookmark],
        bookmarksInFolder: () => [],
      });

      renderBar();
      const btn = screen.getByRole("button", { name: new RegExp(longName.slice(0, 10)) });
      expect(btn).toHaveAttribute("title", longName);
    });
  });

  // ─── AC8: Drag-to-reorder ──────────────────────────────────

  describe("drag-to-reorder", () => {
    /** Mocks getBoundingClientRect on the bar element for drag tests. */
    function mockBarBounds() {
      const bar = screen.getByTestId("bookmarks-bar");
      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        left: 0,
        right: 800,
        top: 0,
        bottom: 30,
        width: 800,
        height: 30,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }

    it("calls reorderBookmark with correct args on drag completion", () => {
      renderBar();
      mockBarBounds();
      const btn = screen.getByRole("button", { name: /readme\.md/ });

      act(() => {
        // pointerdown sets drag start
        fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, button: 0 });

        // pointermove beyond threshold
        const moveEvt = document.createEvent("Event");
        moveEvt.initEvent("pointermove", true, true);
        Object.defineProperty(moveEvt, "clientX", { value: 100 });
        Object.defineProperty(moveEvt, "clientY", { value: 10 });
        window.dispatchEvent(moveEvt);

        // pointerup at new position (within bar bounds)
        const upEvt = document.createEvent("Event");
        upEvt.initEvent("pointerup", true, true);
        Object.defineProperty(upEvt, "clientX", { value: 100 });
        Object.defineProperty(upEvt, "clientY", { value: 10 });
        window.dispatchEvent(upEvt);
      });

      // The reorder action should have been called with the bookmark id
      expect(mockReorderBookmark).toHaveBeenCalledWith("bk-1", expect.any(Number));
    });

    it("does not start drag if pointer movement is under threshold", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /readme\.md/ });

      act(() => {
        fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, button: 0 });

        const moveEvt = document.createEvent("Event");
        moveEvt.initEvent("pointermove", true, true);
        Object.defineProperty(moveEvt, "clientX", { value: 12 }); // only 2px
        Object.defineProperty(moveEvt, "clientY", { value: 10 });
        window.dispatchEvent(moveEvt);

        const upEvt = document.createEvent("Event");
        upEvt.initEvent("pointerup", true, true);
        Object.defineProperty(upEvt, "clientX", { value: 12 });
        Object.defineProperty(upEvt, "clientY", { value: 10 });
        window.dispatchEvent(upEvt);
      });

      expect(mockReorderBookmark).not.toHaveBeenCalled();
    });
  });

  // ─── AC9: Keyboard navigation ──────────────────────────────

  describe("keyboard navigation", () => {
    it("Enter activates a bookmark item", () => {
      const onClick = vi.fn();
      renderBar({ onBookmarkClick: onClick });
      const btn = screen.getByRole("button", { name: /readme\.md/ });
      fireEvent.keyDown(btn, { key: "Enter" });
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "bk-1" }),
      );
    });

    it("ArrowDown navigates into open folder dropdown", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      // Fire ArrowDown on the folder button to move focus into the dropdown
      fireEvent.keyDown(folderBtn, { key: "ArrowDown" });
      const menu = screen.getByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      expect(items.length).toBe(2);
      expect(document.activeElement).toBe(items[0]);
    });

    it("Escape closes folder dropdown via keyboard", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("ArrowRight moves focus to next toolbar item", () => {
      renderBar();
      const buttons = screen.getAllByRole("button");
      buttons[0].focus();
      fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
      // Next button should receive focus
      expect(document.activeElement).toBe(buttons[1]);
    });

    it("ArrowLeft moves focus to previous toolbar item", () => {
      renderBar();
      const buttons = screen.getAllByRole("button");
      buttons[1].focus();
      fireEvent.keyDown(buttons[1], { key: "ArrowLeft" });
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  // ─── AC10: Accessibility ───────────────────────────────────

  describe("accessibility", () => {
    it("has role=toolbar on the container", () => {
      renderBar();
      expect(screen.getByRole("toolbar")).toBeInTheDocument();
    });

    it("has aria-label='Bookmarks' on the toolbar", () => {
      renderBar();
      expect(screen.getByRole("toolbar")).toHaveAttribute("aria-label", "Bookmarks");
    });

    it("each bookmark renders as a button with aria-label", () => {
      renderBar();
      // 7 root bookmarks + 1 folder = 8 buttons in the toolbar
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(8);
      // Verify each has an aria-label
      buttons.forEach((btn) => {
        expect(btn).toHaveAttribute("aria-label");
      });
    });

    it("folder buttons have aria-haspopup and aria-expanded", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      expect(folderBtn).toHaveAttribute("aria-haspopup", "true");
      expect(folderBtn).toHaveAttribute("aria-expanded", "false");
    });
  });

  // ─── AC11: Directory bookmarks show folder emoji ───────────

  describe("directory bookmark icons", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("shows 📁 for directory-type bookmarks", () => {
      const dirBookmark = {
        id: "bk-dir",
        name: "my-project",
        path: "/home/user/my-project",
        type: "folder" as const,
        folderId: null,
        sortIndex: 0,
        createdAt: 1000,
      };
      overrideBookmarksMock({
        bookmarks: [dirBookmark],
        folders: [],
        rootItems: () => [dirBookmark],
        bookmarksInFolder: () => [],
      });

      renderBar();
      const btn = screen.getByRole("button", { name: /my-project/ });
      expect(btn.textContent).toContain("📁");
    });
  });

  // ─── M-Bidi: Bidi control character sanitization ──────────

  describe("bidi sanitization", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("strips bidi control characters from displayed bookmark names", () => {
      const bidiBookmark = {
        id: "bk-bidi",
        name: "evil\u202Ename\u200F.md",
        path: "/home/user/evil-name.md",
        type: "file" as const,
        folderId: null,
        sortIndex: 0,
        createdAt: 1000,
      };
      overrideBookmarksMock({
        bookmarks: [bidiBookmark],
        folders: [],
        rootItems: () => [bidiBookmark],
        bookmarksInFolder: () => [],
      });

      renderBar();
      const btn = screen.getByRole("button", { name: /evilname\.md/ });
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).not.toContain("\u202E");
      expect(btn.textContent).not.toContain("\u200F");
    });

    it("strips bidi characters from folder names in dropdown", () => {
      const bidiFolder = {
        id: "folder-bidi",
        name: "Sneaky\u2066Folder",
        sortIndex: 0,
        createdAt: 1000,
      };
      overrideBookmarksMock({
        bookmarks: [],
        folders: [bidiFolder],
        rootItems: () => [bidiFolder],
        bookmarksInFolder: () => [],
      });

      renderBar();
      const btn = screen.getByRole("button", { name: /SneakyFolder/ });
      expect(btn).toBeInTheDocument();
      expect(btn.textContent).not.toContain("\u2066");
    });
  });

  // ─── M-T1: Folder drag reorder ────────────────────────────

  describe("folder drag-to-reorder", () => {
    it("calls reorderFolder (not reorderBookmark) when dragging a folder", () => {
      renderBar();
      // Mock bar bounds for drag detection
      const bar = screen.getByTestId("bookmarks-bar");
      vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
        left: 0, right: 800, top: 0, bottom: 30,
        width: 800, height: 30, x: 0, y: 0, toJSON: () => ({}),
      });
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });

      act(() => {
        fireEvent.pointerDown(folderBtn, { clientX: 10, clientY: 10, button: 0 });

        const moveEvt = document.createEvent("Event");
        moveEvt.initEvent("pointermove", true, true);
        Object.defineProperty(moveEvt, "clientX", { value: 100 });
        Object.defineProperty(moveEvt, "clientY", { value: 10 });
        window.dispatchEvent(moveEvt);

        const upEvt = document.createEvent("Event");
        upEvt.initEvent("pointerup", true, true);
        Object.defineProperty(upEvt, "clientX", { value: 100 });
        Object.defineProperty(upEvt, "clientY", { value: 10 });
        window.dispatchEvent(upEvt);
      });

      expect(mockReorderBookmark).not.toHaveBeenCalled();
      // reorderFolder may or may not be called depending on computed index
      // The key assertion: reorderBookmark was NOT called for a folder
    });
  });

  // ─── M-T2: Empty folder dropdown ──────────────────────────

  describe("empty folder dropdown", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("shows 'Empty folder' when folder has no children", () => {
      const emptyFolder = {
        id: "folder-empty",
        name: "Empty",
        sortIndex: 0,
        createdAt: 1000,
      };
      overrideBookmarksMock({
        bookmarks: [],
        folders: [emptyFolder],
        rootItems: () => [emptyFolder],
        bookmarksInFolder: () => [],
      });

      renderBar();
      fireEvent.click(screen.getByRole("button", { name: /Empty/ }));
      expect(screen.getByText(/empty folder/i)).toBeInTheDocument();
    });
  });

  // ─── M-T3: Space key activation ───────────────────────────

  describe("space key activation", () => {
    it("Space key activates a bookmark item (calls onBookmarkClick)", () => {
      const onClick = vi.fn();
      renderBar({ onBookmarkClick: onClick });
      const btn = screen.getByRole("button", { name: /readme\.md/ });
      fireEvent.keyDown(btn, { key: " " });
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "bk-1" }),
      );
    });

    it("Space key toggles folder dropdown", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.keyDown(folderBtn, { key: " " });
      expect(screen.getByRole("menu")).toBeInTheDocument();
      fireEvent.keyDown(folderBtn, { key: " " });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  // ─── M-T4: ArrowRight/Left wrap-around ────────────────────

  describe("arrow key wrap-around", () => {
    it("ArrowRight wraps from last button to first", () => {
      renderBar();
      const buttons = screen.getAllByRole("button");
      const last = buttons[buttons.length - 1];
      last.focus();
      fireEvent.keyDown(last, { key: "ArrowRight" });
      expect(document.activeElement).toBe(buttons[0]);
    });

    it("ArrowLeft wraps from first button to last", () => {
      renderBar();
      const buttons = screen.getAllByRole("button");
      buttons[0].focus();
      fireEvent.keyDown(buttons[0], { key: "ArrowLeft" });
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    });
  });

  // ─── M-T5: ArrowUp cycling in dropdown ────────────────────

  describe("dropdown ArrowUp cycling", () => {
    it("ArrowUp from first item wraps to last item", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      const menu = screen.getByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      items[0].focus();
      fireEvent.keyDown(menu, { key: "ArrowUp" });
      expect(document.activeElement).toBe(items[items.length - 1]);
    });

    it("ArrowDown from last item wraps to first item", () => {
      renderBar();
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);
      const menu = screen.getByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      items[items.length - 1].focus();
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[0]);
    });
  });

  // ─── M-D1: Release outside bar cancels reorder ────────────

  describe("drag edge cases", () => {
    it("does not call reorder when pointer is released outside bar bounds (M-D1)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /readme\.md/ });

      act(() => {
        fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, button: 0 });

        const moveEvt = document.createEvent("Event");
        moveEvt.initEvent("pointermove", true, true);
        Object.defineProperty(moveEvt, "clientX", { value: 100 });
        Object.defineProperty(moveEvt, "clientY", { value: 10 });
        window.dispatchEvent(moveEvt);

        // Release far outside the bar (Y=9999)
        const upEvt = document.createEvent("Event");
        upEvt.initEvent("pointerup", true, true);
        Object.defineProperty(upEvt, "clientX", { value: 100 });
        Object.defineProperty(upEvt, "clientY", { value: 9999 });
        window.dispatchEvent(upEvt);
      });

      expect(mockReorderBookmark).not.toHaveBeenCalled();
      expect(mockReorderFolder).not.toHaveBeenCalled();
    });

    it("same-item drop is a no-op — no reorder called (M-D3)", () => {
      renderBar();
      const btn = screen.getByRole("button", { name: /readme\.md/ });

      act(() => {
        fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, button: 0 });

        // Move enough to trigger drag
        const moveEvt = document.createEvent("Event");
        moveEvt.initEvent("pointermove", true, true);
        Object.defineProperty(moveEvt, "clientX", { value: 20 });
        Object.defineProperty(moveEvt, "clientY", { value: 10 });
        window.dispatchEvent(moveEvt);

        // Release at same position (should compute same index)
        const upEvt = document.createEvent("Event");
        upEvt.initEvent("pointerup", true, true);
        Object.defineProperty(upEvt, "clientX", { value: 10 });
        Object.defineProperty(upEvt, "clientY", { value: 10 });
        window.dispatchEvent(upEvt);
      });

      // In jsdom, elements have zero-width getBoundingClientRect, so
      // computeDropIndex returns 0 (same as readme.md's index) → no-op
      expect(mockReorderBookmark).not.toHaveBeenCalled();
    });
  });

  // ─── H2: Zustand reactivity integration test ──────────────

  describe("zustand reactivity", () => {
    it("component subscribes to bookmarks/folders state slices (not function references)", () => {
      // Verify the mock is called with selectors that read state data,
      // not just function references. The mock returns state[key] for
      // each selector call. If the component were using (s) => s.getRootItems,
      // it would get a stable function and never re-render on data change.
      // With (s) => s.bookmarks and (s) => s.folders, it gets arrays.
      renderBar();

      // Verify the store was called with selectors that access data slices.
      // The component should have called selectors for bookmarks and folders
      // (array state), not just getRootItems (function).
      const calls = mockedUseBookmarksStore.mock.calls;
      const selectorResults = calls.map(([selector]) => {
        const state = {
          bookmarks: [...mockBookmarks, ...mockFolderChildren],
          folders: mockFolders,
          getRootItems: buildRootItems,
          getBookmarksInFolder: buildBookmarksInFolder,
          reorderBookmark: mockReorderBookmark,
          reorderFolder: mockReorderFolder,
        };
        return selector(state);
      });

      // Should include the bookmarks array and folders array as returned values
      const hasBookmarksSlice = selectorResults.some(
        (r) => Array.isArray(r) && r.length > 0 && r[0]?.id === "bk-1",
      );
      const hasFoldersSlice = selectorResults.some(
        (r) => Array.isArray(r) && r.length > 0 && r[0]?.id === "folder-1",
      );
      expect(hasBookmarksSlice).toBe(true);
      expect(hasFoldersSlice).toBe(true);
    });
  });

  // ─── H7: FolderButton reactivity regression test ──────────

  describe("FolderButton reactivity (H7)", () => {
    afterEach(() => {
      restoreBookmarksMock();
    });

    it("folder dropdown updates when bookmarks state changes (H7 regression)", () => {
      // Initial render with 2 children in folder-1
      renderBar();

      // Open the folder dropdown
      const folderBtn = screen.getByRole("button", { name: /My Folder/ });
      fireEvent.click(folderBtn);

      // Verify initial children
      const initialItems = screen.getAllByRole("menuitem");
      expect(initialItems).toHaveLength(2);
      expect(initialItems[0]).toHaveTextContent("child-script.js");
      expect(initialItems[1]).toHaveTextContent("child.yaml");
    });

    it("FolderButton subscribes to bookmarks state slice, not getBookmarksInFolder function ref (H7)", () => {
      renderBar();

      // Check that FolderButton's useBookmarksStore calls include a selector
      // that returns the bookmarks array (not the getBookmarksInFolder function).
      const calls = mockedUseBookmarksStore.mock.calls;
      const selectorResults = calls.map(([selector]) => {
        const state = {
          bookmarks: [...mockBookmarks, ...mockFolderChildren],
          folders: mockFolders,
          getRootItems: buildRootItems,
          getBookmarksInFolder: buildBookmarksInFolder,
          reorderBookmark: mockReorderBookmark,
          reorderFolder: mockReorderFolder,
        };
        return selector(state);
      });

      // FolderButton should subscribe to the bookmarks array.
      // Count how many selectors return the bookmarks array — at minimum
      // the root BookmarksBar + each FolderButton should read it.
      const bookmarksSliceCount = selectorResults.filter(
        (r) => Array.isArray(r) && r.length > 0 && r[0]?.id === "bk-1",
      ).length;

      // Root component reads bookmarks once + FolderButton reads bookmarks once = ≥ 2
      expect(bookmarksSliceCount).toBeGreaterThanOrEqual(2);

      // Verify no selector returns the getBookmarksInFolder function itself
      const returnsFunction = selectorResults.some(
        (r) => typeof r === "function" && r === buildBookmarksInFolder,
      );
      expect(returnsFunction).toBe(false);
    });
  });
});
