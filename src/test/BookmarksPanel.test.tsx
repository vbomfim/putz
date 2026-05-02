/**
 * Unit tests for BookmarksPanel component (T3 — #50).
 *
 * TDD: tests written FIRST. Covers AC1–AC11, a11y, keyboard,
 * drag-and-drop, import/export, edge cases.
 *
 * Tags: [TDD], [AC-1] through [AC-11]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Store mock state ────────────────────────────────────────────────

const mockAddBookmark = vi.fn();
const mockRemoveBookmark = vi.fn();
const mockRenameBookmark = vi.fn();
const mockMoveBookmark = vi.fn();
const mockReorderBookmark = vi.fn();
const mockAddFolder = vi.fn();
const mockRemoveFolder = vi.fn();
const mockRenameFolder = vi.fn();
const mockReorderFolder = vi.fn();
const mockExportBookmarks = vi
  .fn()
  .mockReturnValue('{"bookmarks":[],"folders":[]}');
const mockImportBookmarks = vi.fn();

interface MockBookmark {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  folderId: string | null;
  sortIndex: number;
  createdAt: number;
}

interface MockFolder {
  id: string;
  name: string;
  sortIndex: number;
  createdAt: number;
}

let mockBookmarks: MockBookmark[] = [];
let mockFolders: MockFolder[] = [];

/** Builds the current mock state object. */
function getMockState() {
  return {
    bookmarks: mockBookmarks,
    folders: mockFolders,
    addBookmark: mockAddBookmark,
    removeBookmark: mockRemoveBookmark,
    renameBookmark: mockRenameBookmark,
    moveBookmark: mockMoveBookmark,
    reorderBookmark: mockReorderBookmark,
    addFolder: mockAddFolder,
    removeFolder: mockRemoveFolder,
    renameFolder: mockRenameFolder,
    reorderFolder: mockReorderFolder,
    exportBookmarks: mockExportBookmarks,
    importBookmarks: mockImportBookmarks,
    getBookmarksInFolder: (folderId: string | null) =>
      mockBookmarks
        .filter((b) => b.folderId === folderId)
        .sort((a, b) => a.sortIndex - b.sortIndex),
    getRootItems: () =>
      [
        ...mockBookmarks.filter((b) => b.folderId === null),
        ...mockFolders,
      ].sort((a, b) => a.sortIndex - b.sortIndex),
  };
}

vi.mock("../stores/bookmarksStore", () => ({
  useBookmarksStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(getMockState())),
    { getState: () => getMockState() },
  ),
}));

// Mock sanitize
vi.mock("../utils/sanitize", () => ({
  stripBidiControls: (s: string) =>
    s.replace(/[\u200E\u200F\u061C\u2066-\u2069\u202A-\u202E]/g, ""),
}));

// ─── Import component after mocks ───────────────────────────────────

import { BookmarksPanel } from "../components/BookmarksPanel";

// ─── Test Fixtures ──────────────────────────────────────────────────

function makeBookmark(overrides: Partial<MockBookmark> = {}): MockBookmark {
  return {
    id: "bm-1",
    name: "config.ts",
    path: "/Users/me/config.ts",
    type: "file",
    folderId: null,
    sortIndex: 0,
    createdAt: 1000,
    ...overrides,
  };
}

function makeFolder(overrides: Partial<MockFolder> = {}): MockFolder {
  return {
    id: "folder-1",
    name: "Work",
    sortIndex: 1,
    createdAt: 1000,
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

const noop = () => {};

/**
 * Mock document.elementFromPoint — jsdom doesn't support it.
 * We map coordinates to elements for DnD testing.
 */
let elementFromPointTarget: Element | null = null;

function setDropTarget(el: Element | null) {
  elementFromPointTarget = el;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("BookmarksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockFolders = [];
    mockExportBookmarks.mockReturnValue('{"bookmarks":[],"folders":[]}');
    elementFromPointTarget = null;
    // Mock document.elementFromPoint for DnD tests
    document.elementFromPoint = vi.fn(() => elementFromPointTarget);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Rendering & empty state ──────────────────────────────────────

  it("renders modal when mounted", () => {
    render(<BookmarksPanel onClose={noop} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows empty state message when no bookmarks", () => {
    render(<BookmarksPanel onClose={noop} />);
    expect(screen.getByText(/No bookmarks yet/)).toBeInTheDocument();
    expect(screen.getByText(/⌘D/)).toBeInTheDocument();
  });

  // ─── AC1: List bookmarks grouped by folder ─────────────────────────

  it("renders all bookmarks and folders", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "root-file.ts", sortIndex: 0 }),
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);
    expect(screen.getByText("root-file.ts")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("child.ts")).toBeInTheDocument();
  });

  it("folders are collapsible — default expanded", () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];

    render(<BookmarksPanel onClose={noop} />);
    // Child visible by default (expanded)
    expect(screen.getByText("child.ts")).toBeInTheDocument();
  });

  it("clicking folder toggle collapses and hides children", async () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];

    render(<BookmarksPanel onClose={noop} />);
    // Click the folder toggle to collapse
    const folderRow = screen.getByText("Work").closest("[role='treeitem']");
    expect(folderRow).not.toBeNull();
    const toggle = within(folderRow!).getByRole("button", { name: /toggle/i });
    await userEvent.click(toggle);

    // Child should be hidden
    expect(screen.queryByText("child.ts")).not.toBeInTheDocument();
  });

  it("clicking folder toggle again expands and shows children", async () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];

    render(<BookmarksPanel onClose={noop} />);
    const folderRow = screen.getByText("Work").closest("[role='treeitem']");
    const toggle = within(folderRow!).getByRole("button", { name: /toggle/i });

    // Collapse
    await userEvent.click(toggle);
    expect(screen.queryByText("child.ts")).not.toBeInTheDocument();

    // Expand again
    await userEvent.click(toggle);
    expect(screen.getByText("child.ts")).toBeInTheDocument();
  });

  // ─── AC2: Inline rename bookmark ──────────────────────────────────

  it("double-click bookmark name → inline input appears", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    const nameEl = screen.getByText("config.ts");
    await userEvent.dblClick(nameEl);

    const input = screen.getByDisplayValue("config.ts");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("inline rename: Enter calls renameBookmark with new name", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    await userEvent.dblClick(screen.getByText("config.ts"));
    const input = screen.getByDisplayValue("config.ts");
    await userEvent.clear(input);
    await userEvent.type(input, "new-name.ts{Enter}");

    expect(mockRenameBookmark).toHaveBeenCalledWith("bm-1", "new-name.ts");
  });

  it("inline rename: Escape cancels — renameBookmark NOT called", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    await userEvent.dblClick(screen.getByText("config.ts"));
    const input = screen.getByDisplayValue("config.ts");
    await userEvent.clear(input);
    await userEvent.type(input, "changed{Escape}");

    expect(mockRenameBookmark).not.toHaveBeenCalled();
  });

  it("inline rename rejects empty string", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    await userEvent.dblClick(screen.getByText("config.ts"));
    const input = screen.getByDisplayValue("config.ts");
    // Use fireEvent to change value without triggering blur
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(mockRenameBookmark).not.toHaveBeenCalled();
    // Validation message should be visible
    expect(screen.getByText(/Name cannot be empty/i)).toBeInTheDocument();
  });

  it("inline rename caps input at 100 chars (M11 defense-in-depth)", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    await userEvent.dblClick(screen.getByText("config.ts"));
    const input = screen.getByDisplayValue("config.ts");

    // Attempt to set value longer than 100 chars — onChange caps it
    const longName = "x".repeat(150);
    fireEvent.change(input, { target: { value: longName } });

    // The displayed value should be capped at 100 chars
    expect((input as HTMLInputElement).value).toHaveLength(100);

    // Enter should succeed (100 chars is valid)
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(mockRenameBookmark).toHaveBeenCalledWith("bm-1", "x".repeat(100));
  });

  // ─── AC3: Delete bookmark ─────────────────────────────────────────

  it("delete button calls removeBookmark(id)", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    const item = screen.getByText("config.ts").closest("[data-bookmark-id]");
    const deleteBtn = within(item!).getByRole("button", { name: /delete/i });
    await userEvent.click(deleteBtn);

    expect(mockRemoveBookmark).toHaveBeenCalledWith("bm-1");
  });

  // ─── AC4: New Folder ──────────────────────────────────────────────

  it("New Folder button calls addFolder and activates rename", async () => {
    // After addFolder is called, simulate the folder appearing
    mockAddFolder.mockImplementation(() => {
      mockFolders = [
        ...mockFolders,
        makeFolder({ id: "folder-new", name: "New Folder", sortIndex: 0 }),
      ];
    });

    render(<BookmarksPanel onClose={noop} />);

    const newFolderBtn = screen.getByRole("button", { name: /new folder/i });
    await userEvent.click(newFolderBtn);

    expect(mockAddFolder).toHaveBeenCalledWith("New Folder");
  });

  // ─── AC5: Drag bookmark onto folder ───────────────────────────────

  it("drag bookmark onto folder calls moveBookmark(id, folderId)", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "root-file.ts", sortIndex: 0 }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("root-file.ts")
      .closest("[data-bookmark-id]")!;
    const folderEl = screen.getByText("Work").closest("[data-folder-id]")!;

    // Start drag on bookmark
    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    // Move enough to trigger drag — set drop target to folder
    setDropTarget(folderEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    // Drop on folder
    fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });

    expect(mockMoveBookmark).toHaveBeenCalledWith("bm-1", "folder-1");
  });

  // ─── AC6: Drag bookmark to root ───────────────────────────────────

  it("drag bookmark to root area calls moveBookmark(id, null)", () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];

    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("child.ts")
      .closest("[data-bookmark-id]")!;
    const rootArea = screen.getByTestId("bookmarks-panel-root-drop");

    // Start drag
    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    // Move with drop target set to root
    setDropTarget(rootArea);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 200 });
    // Drop
    fireEvent.pointerUp(window);

    expect(mockMoveBookmark).toHaveBeenCalledWith("bm-2", null);
  });

  // ─── AC7: Delete folder ───────────────────────────────────────────

  it("delete folder calls removeFolder(id)", async () => {
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];
    render(<BookmarksPanel onClose={noop} />);

    const folderRow = screen.getByText("Work").closest("[data-folder-id]")!;
    const deleteBtn = within(folderRow).getByRole("button", {
      name: /delete/i,
    });
    await userEvent.click(deleteBtn);

    expect(mockRemoveFolder).toHaveBeenCalledWith("folder-1");
  });

  // ─── AC8: Double-click folder → inline rename ─────────────────────

  it("double-click folder name → inline rename, Enter calls renameFolder", async () => {
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];
    render(<BookmarksPanel onClose={noop} />);

    // Double-click on the folder name to enter rename mode
    const folderName = screen.getByText("Work");
    await userEvent.dblClick(folderName);
    const input = screen.getByDisplayValue("Work");
    // Use fireEvent to change value without blur side-effects
    fireEvent.change(input, { target: { value: "Personal" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(mockRenameFolder).toHaveBeenCalledWith("folder-1", "Personal");
  });

  // ─── AC9: Drag to reorder ────────────────────────────────────────

  it("drag bookmark to reorder within same parent calls reorderBookmark", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "first.ts", sortIndex: 0 }),
      makeBookmark({ id: "bm-2", name: "second.ts", sortIndex: 1 }),
    ];

    render(<BookmarksPanel onClose={noop} />);

    const firstEl = screen.getByText("first.ts").closest("[data-bookmark-id]")!;
    const secondEl = screen
      .getByText("second.ts")
      .closest("[data-bookmark-id]")!;

    // Drag first after second — set drop target to second
    fireEvent.pointerDown(firstEl, { clientX: 10, clientY: 10, button: 0 });
    setDropTarget(secondEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
    fireEvent.pointerUp(window);

    expect(mockReorderBookmark).toHaveBeenCalledWith("bm-1", 1);
  });

  // ─── AC10: Close modal ───────────────────────────────────────────

  it("closes on ✕ click", async () => {
    const onClose = vi.fn();
    render(<BookmarksPanel onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: /close/i });
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on overlay click (outside modal)", () => {
    const onClose = vi.fn();
    render(<BookmarksPanel onClose={onClose} />);

    const overlay = screen.getByRole("dialog");
    // Click on the overlay itself, not child
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when clicking inside modal panel", () => {
    const onClose = vi.fn();
    render(<BookmarksPanel onClose={onClose} />);

    // Click on the panel content
    const heading = screen.getByText("Bookmarks Manager");
    fireEvent.click(heading);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<BookmarksPanel onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ─── AC11: Import/Export ──────────────────────────────────────────

  it("Export button triggers blob download", async () => {
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:test-url");
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    // Spy on createElement to intercept the anchor creation
    const originalCreateElement = document.createElement.bind(document);
    const mockClick = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        const anchor = originalCreateElement("a");
        anchor.click = mockClick;
        return anchor;
      }
      return originalCreateElement(tag);
    });

    try {
      mockExportBookmarks.mockReturnValue('{"bookmarks":[],"folders":[]}');
      render(<BookmarksPanel onClose={noop} />);

      const exportBtn = screen.getByRole("button", { name: /export/i });
      await userEvent.click(exportBtn);

      expect(mockExportBookmarks).toHaveBeenCalled();
      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:test-url");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("Import button reads file and calls importBookmarks", async () => {
    render(<BookmarksPanel onClose={noop} />);

    const fileInput = screen.getByTestId(
      "bookmarks-import-input",
    ) as HTMLInputElement;
    const validJson = '{"bookmarks":[],"folders":[]}';
    const file = new File([validJson], "bookmarks.json", {
      type: "application/json",
    });

    // Simulate file selection
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      // Wait for FileReader
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockImportBookmarks).toHaveBeenCalledWith(validJson);
  });

  it("Import with invalid data shows inline error from store rejection", async () => {
    mockImportBookmarks.mockImplementation(() => {
      throw new Error("Invalid import: unexpected token");
    });

    render(<BookmarksPanel onClose={noop} />);

    const fileInput = screen.getByTestId(
      "bookmarks-import-input",
    ) as HTMLInputElement;
    const file = new File(["not-json!!!"], "bad.json", {
      type: "application/json",
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockImportBookmarks).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/import failed/i)).toBeInTheDocument();
  });

  // ─── Accessibility ────────────────────────────────────────────────

  it("has role=dialog and aria-modal=true", () => {
    render(<BookmarksPanel onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has aria-label on dialog", () => {
    render(<BookmarksPanel onClose={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Bookmarks Manager");
  });

  it("has role=tree on bookmarks list", () => {
    mockBookmarks = [makeBookmark()];
    render(<BookmarksPanel onClose={noop} />);
    expect(screen.getByRole("tree")).toBeInTheDocument();
  });

  it("bookmark items have role=treeitem", () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);
    const items = screen.getAllByRole("treeitem");
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("folder has aria-expanded attribute", () => {
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];
    render(<BookmarksPanel onClose={noop} />);
    const folderItem = screen.getByText("Work").closest("[role='treeitem']")!;
    expect(folderItem).toHaveAttribute("aria-expanded", "true");
  });

  it("folder children have role=group", () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        folderId: "folder-1",
        sortIndex: 0,
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];

    render(<BookmarksPanel onClose={noop} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("aria-live region announces bookmark deleted", async () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    const item = screen.getByText("config.ts").closest("[data-bookmark-id]")!;
    const deleteBtn = within(item).getByRole("button", { name: /delete/i });
    await userEvent.click(deleteBtn);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent(/deleted/i);
  });

  it("focus trap: Tab wraps from last to first focusable", () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    const dialog = screen.getByRole("dialog");
    const panel = dialog.querySelector(".bookmarks-panel")!;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Tab from last → wraps to first
    (last as HTMLElement).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from first → wraps to last
    (first as HTMLElement).focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("focus is restored to trigger element on close", async () => {
    const triggerBtn = document.createElement("button");
    triggerBtn.textContent = "Open";
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    try {
      const onClose = vi.fn();
      render(<BookmarksPanel onClose={onClose} />);

      // Close via Escape
      fireEvent.keyDown(screen.getByRole("dialog"), {
        key: "Escape",
        code: "Escape",
      });

      expect(onClose).toHaveBeenCalledTimes(1);

      // Wait for the rAF focus restoration
      await new Promise((r) => requestAnimationFrame(r));
      expect(document.activeElement).toBe(triggerBtn);
    } finally {
      document.body.removeChild(triggerBtn);
    }
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it("drag bookmark onto itself is a no-op", () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "config.ts" })];
    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("config.ts")
      .closest("[data-bookmark-id]")!;

    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    setDropTarget(bookmarkEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 30 });
    fireEvent.pointerUp(window);

    expect(mockMoveBookmark).not.toHaveBeenCalled();
    expect(mockReorderBookmark).not.toHaveBeenCalled();
  });

  it("empty folder still renders with delete button", () => {
    mockFolders = [
      makeFolder({ id: "folder-1", name: "Empty Folder", sortIndex: 0 }),
    ];
    render(<BookmarksPanel onClose={noop} />);

    expect(screen.getByText("Empty Folder")).toBeInTheDocument();
    const folderRow = screen
      .getByText("Empty Folder")
      .closest("[data-folder-id]")!;
    expect(
      within(folderRow).getByRole("button", { name: /delete/i }),
    ).toBeInTheDocument();
  });

  it("bidi-stripped names render correctly", () => {
    mockBookmarks = [makeBookmark({ id: "bm-1", name: "safe\u200Ename.ts" })];
    render(<BookmarksPanel onClose={noop} />);
    // The bidi character should be stripped
    expect(screen.getByText("safename.ts")).toBeInTheDocument();
  });

  it("Escape stops propagation (does not bleed to parent)", () => {
    const parentHandler = vi.fn();
    const onClose = vi.fn();

    render(
      <div onKeyDown={parentHandler}>
        <BookmarksPanel onClose={onClose} />
      </div>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    });

    expect(onClose).toHaveBeenCalled();
    // The parent handler should NOT receive the event (stopPropagation)
    expect(parentHandler).not.toHaveBeenCalled();
  });

  // ─── Root items & aria-level ──────────────────────────────────────

  it("root items have aria-level=1, folder children have aria-level=2", () => {
    mockBookmarks = [
      makeBookmark({
        id: "bm-1",
        name: "root.ts",
        sortIndex: 0,
        folderId: null,
      }),
      makeBookmark({
        id: "bm-2",
        name: "child.ts",
        sortIndex: 0,
        folderId: "folder-1",
      }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);

    const rootItem = screen.getByText("root.ts").closest("[role='treeitem']")!;
    expect(rootItem).toHaveAttribute("aria-level", "1");

    const childItem = screen
      .getByText("child.ts")
      .closest("[role='treeitem']")!;
    expect(childItem).toHaveAttribute("aria-level", "2");
  });

  // ─── H1: Fast drag — synchronous lifecycle ───────────────────────

  it("H1: fast drag (same tick) calls moveBookmark without awaiting React commit", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "root-file.ts", sortIndex: 0 }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("root-file.ts")
      .closest("[data-bookmark-id]")!;
    const folderEl = screen.getByText("Work").closest("[data-folder-id]")!;

    // All three events in the SAME synchronous tick — no `await act` in between
    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    setDropTarget(folderEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });

    expect(mockMoveBookmark).toHaveBeenCalledWith("bm-1", "folder-1");
  });

  it("H1: stale bookmarks during drag — drop targets correct bookmark after mutation", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "root-file.ts", sortIndex: 0 }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("root-file.ts")
      .closest("[data-bookmark-id]")!;
    const folderEl = screen.getByText("Work").closest("[data-folder-id]")!;

    // Start drag
    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    setDropTarget(folderEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });

    // Mutate bookmarks mid-drag — add a new one (simulating external store update)
    mockBookmarks = [
      ...mockBookmarks,
      makeBookmark({ id: "bm-new", name: "new.ts", sortIndex: 2 }),
    ];

    // Release — should still target the correct bookmark and folder
    fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });

    expect(mockMoveBookmark).toHaveBeenCalledWith("bm-1", "folder-1");
  });

  // ─── H2: Import TOCTOU — overlapping imports ─────────────────────

  it("H2: overlapping imports — first onload is ignored when second starts", async () => {
    render(<BookmarksPanel onClose={noop} />);

    const fileInput = screen.getByTestId(
      "bookmarks-import-input",
    ) as HTMLInputElement;

    // Capture FileReader instances by intercepting readAsText
    const readers: { onload: (() => void) | null; result: string | null }[] =
      [];
    const OriginalFileReader = globalThis.FileReader;
    const mockFileReaderCtor = vi.fn().mockImplementation(() => {
      const instance = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        result: null as string | null,
        readAsText: vi.fn().mockImplementation(function (
          this: typeof instance,
          file: File,
        ) {
          // Read file content synchronously for test purposes
          const reader = new OriginalFileReader();
          reader.onload = () => {
            this.result = reader.result as string;
          };
          reader.readAsText(file);
          // Don't fire onload yet — let the test control timing
          readers.push(this);
        }),
      };
      return instance;
    });
    globalThis.FileReader = mockFileReaderCtor as unknown as typeof FileReader;

    try {
      const fileA = new File(
        ['{"bookmarks":[{"id":"a"}],"folders":[]}'],
        "a.json",
        { type: "application/json" },
      );
      const fileB = new File(
        ['{"bookmarks":[{"id":"b"}],"folders":[]}'],
        "b.json",
        { type: "application/json" },
      );

      // Start import A
      fireEvent.change(fileInput, { target: { files: [fileA] } });
      // Start import B (supersedes A)
      fireEvent.change(fileInput, { target: { files: [fileB] } });

      // Wait for file reads
      await new Promise((r) => setTimeout(r, 50));

      // Fire onload for A first, then B
      if (readers[0]?.onload) readers[0].onload();
      if (readers[1]?.onload) readers[1].onload();

      // A's onload should have been ignored (superseded).
      // Only B's content should have been passed to importBookmarks.
      expect(mockImportBookmarks).toHaveBeenCalledTimes(1);
      expect(mockImportBookmarks).toHaveBeenCalledWith(
        expect.stringContaining('"id":"b"'),
      );
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });

  it("H2: close during import — onload after unmount does NOT call importBookmarks", async () => {
    const { unmount } = render(<BookmarksPanel onClose={noop} />);

    const fileInput = screen.getByTestId(
      "bookmarks-import-input",
    ) as HTMLInputElement;

    const readers: { onload: (() => void) | null; result: string | null }[] =
      [];
    const OriginalFileReader = globalThis.FileReader;
    const mockFileReaderCtor = vi.fn().mockImplementation(() => {
      const instance = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        result: null as string | null,
        readAsText: vi.fn().mockImplementation(function (
          this: typeof instance,
          file: File,
        ) {
          const reader = new OriginalFileReader();
          reader.onload = () => {
            this.result = reader.result as string;
          };
          reader.readAsText(file);
          readers.push(this);
        }),
      };
      return instance;
    });
    globalThis.FileReader = mockFileReaderCtor as unknown as typeof FileReader;

    try {
      const file = new File(['{"bookmarks":[],"folders":[]}'], "test.json", {
        type: "application/json",
      });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await new Promise((r) => setTimeout(r, 50));

      // Unmount (close) before onload fires
      unmount();

      // Fire onload after unmount
      if (readers[0]?.onload) readers[0].onload();

      // importBookmarks should NOT have been called — unmounted guard
      expect(mockImportBookmarks).not.toHaveBeenCalled();
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });

  // ─── M3: Drop onto deleted folder ────────────────────────────────

  it("M3: drop onto deleted folder is a no-op", () => {
    mockBookmarks = [
      makeBookmark({ id: "bm-1", name: "root-file.ts", sortIndex: 0 }),
    ];
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 1 })];

    render(<BookmarksPanel onClose={noop} />);

    const bookmarkEl = screen
      .getByText("root-file.ts")
      .closest("[data-bookmark-id]")!;
    const folderEl = screen.getByText("Work").closest("[data-folder-id]")!;

    // Start drag
    fireEvent.pointerDown(bookmarkEl, { clientX: 10, clientY: 10, button: 0 });
    setDropTarget(folderEl);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 80 });

    // Delete the target folder mid-drag (simulating external store update)
    mockFolders = [];

    // Release on the now-deleted folder's element
    fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });

    // moveBookmark should NOT be called — folder no longer exists
    expect(mockMoveBookmark).not.toHaveBeenCalled();
  });

  // ─── M6: pendingFolderRename — auto-activate rename for new folder ─

  it("M6: New Folder activates inline rename on the new folder", () => {
    // Start with no folders
    mockFolders = [];
    mockAddFolder.mockImplementation(() => {
      mockFolders = [
        makeFolder({ id: "folder-new", name: "New Folder", sortIndex: 0 }),
      ];
    });

    const { rerender } = render(<BookmarksPanel onClose={noop} />);

    // Click New Folder
    const newFolderBtn = screen.getByRole("button", { name: /new folder/i });
    fireEvent.click(newFolderBtn);

    expect(mockAddFolder).toHaveBeenCalledWith("New Folder");

    // Re-render to pick up new folders
    rerender(<BookmarksPanel onClose={noop} />);

    // The rename input should appear for the new folder
    const renameInput = screen.queryByDisplayValue("New Folder");
    expect(renameInput).toBeInTheDocument();
  });

  // ─── M7: AC8 folder Escape test ───────────────────────────────────

  it("M7: folder rename — Escape cancels without calling renameFolder", async () => {
    mockFolders = [makeFolder({ id: "folder-1", name: "Work", sortIndex: 0 })];
    render(<BookmarksPanel onClose={noop} />);

    // Double-click to enter rename mode
    const folderName = screen.getByText("Work");
    await userEvent.dblClick(folderName);

    const input = screen.getByDisplayValue("Work");
    // Type some text then press Escape
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    expect(mockRenameFolder).not.toHaveBeenCalled();
  });
});
