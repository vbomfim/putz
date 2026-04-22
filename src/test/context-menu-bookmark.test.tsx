/**
 * Integration tests for RegionTabBar context menu bookmark item (F5).
 *
 * Verifies that the "⭐ Bookmark …" context menu item appears/disappears
 * and shows correct labels for different tab types.
 *
 * Tags: [TDD], [AC-8], [AC-9], [F5]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock @tauri-apps/api/core (dynamic import in RegionTabBar for search tab)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock cwdRegistry
vi.mock("../components/Terminal/cwdRegistry", () => ({
  getSessionCwd: vi.fn(),
  clearSessionCwd: vi.fn(),
}));

// Mock bookmarkHelpers — control isBookmarkActionAvailable per test
const mockIsBookmarkActionAvailable = vi.fn().mockReturnValue(false);
const mockHandleAddBookmarkFromTab = vi.fn();
vi.mock("../utils/bookmarkHelpers", () => ({
  isBookmarkActionAvailable: (...args: unknown[]) =>
    mockIsBookmarkActionAvailable(...args),
  handleAddBookmarkFromTab: (...args: unknown[]) =>
    mockHandleAddBookmarkFromTab(...args),
}));

// Comprehensive layoutStore mock
const mockStoreActions = {
  activateTab: vi.fn(),
  closeTab: vi.fn(),
  renameTab: vi.fn(),
  setFocusedRegion: vi.fn(),
  setTabPosition: vi.fn(),
  splitRegion: vi.fn(),
  splitTabToNew: vi.fn(),
  addTerminalTab: vi.fn(),
  addEditorTab: vi.fn(),
  addSearchTab: vi.fn(),
  moveTab: vi.fn(),
  regions: {},
};

vi.mock("../stores/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(mockStoreActions)),
    { getState: () => mockStoreActions },
  ),
  MAX_TITLE_LENGTH: 100,
}));

// ─── Import under test ──────────────────────────────────────────────

import { RegionTabBar } from "../components/Region/RegionTabBar";
import type { RegionTab, TabPosition } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────

function makeTab(overrides: Partial<RegionTab>): RegionTab {
  return {
    id: "tab-1",
    title: "Test Tab",
    type: "terminal",
    sessionId: "s-1",
    status: "local",
    ...overrides,
  };
}

function renderTabBar(tabs: RegionTab[], activeTabId?: string) {
  return render(
    <RegionTabBar
      regionId="r-1"
      tabs={tabs}
      activeTabId={activeTabId ?? tabs[0]?.id ?? ""}
      isFocused={true}
      tabPosition={"top" as TabPosition}
    />,
  );
}

/** Right-clicks the tab element (identified by data-tab-id) to open context menu. */
function openContextMenu(tabId: string) {
  const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (!tabEl) throw new Error(`Tab with data-tab-id="${tabId}" not found`);
  fireEvent.contextMenu(tabEl, { clientX: 100, clientY: 100 });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("RegionTabBar context menu bookmark item [F5]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBookmarkActionAvailable.mockReturnValue(false);
  });

  it("shows '⭐ Bookmark this file' for editor tab with path", () => {
    const tab = makeTab({
      id: "t-editor",
      type: "editor",
      title: "config.ts",
      editorFilePath: "/abs/config.ts",
    });
    mockIsBookmarkActionAvailable.mockReturnValue(true);

    renderTabBar([tab]);
    openContextMenu("t-editor");

    const bookmarkItem = screen.getByText("⭐ Bookmark this file");
    expect(bookmarkItem).toBeTruthy();

    // Click it — should trigger handler
    fireEvent.click(bookmarkItem);
    expect(mockHandleAddBookmarkFromTab).toHaveBeenCalledTimes(1);
  });

  it("shows '⭐ Bookmark current folder' for terminal tab (with or without cached CWD)", () => {
    const tab = makeTab({ id: "t-term", type: "terminal", title: "Terminal" });
    // After H1: terminal tabs always show as available
    mockIsBookmarkActionAvailable.mockReturnValue(true);

    renderTabBar([tab]);
    openContextMenu("t-term");

    const bookmarkItem = screen.getByText("⭐ Bookmark current folder");
    expect(bookmarkItem).toBeTruthy();

    fireEvent.click(bookmarkItem);
    expect(mockHandleAddBookmarkFromTab).toHaveBeenCalledTimes(1);
  });

  it("does NOT show bookmark item for diff tab", () => {
    const tab = makeTab({ id: "t-diff", type: "diff", title: "Diff View" });
    mockIsBookmarkActionAvailable.mockReturnValue(false);

    renderTabBar([tab]);
    openContextMenu("t-diff");

    expect(screen.queryByText("⭐ Bookmark this file")).toBeNull();
    expect(screen.queryByText("⭐ Bookmark current folder")).toBeNull();
  });

  it("does NOT show bookmark item for settings tab", () => {
    const tab = makeTab({ id: "t-settings", type: "settings", title: "Settings" });
    mockIsBookmarkActionAvailable.mockReturnValue(false);

    renderTabBar([tab]);
    openContextMenu("t-settings");

    expect(screen.queryByText("⭐ Bookmark this file")).toBeNull();
    expect(screen.queryByText("⭐ Bookmark current folder")).toBeNull();
  });

  it("does NOT show bookmark item for search tab", () => {
    const tab = makeTab({ id: "t-search", type: "search", title: "Search" });
    mockIsBookmarkActionAvailable.mockReturnValue(false);

    renderTabBar([tab]);
    openContextMenu("t-search");

    expect(screen.queryByText("⭐ Bookmark this file")).toBeNull();
    expect(screen.queryByText("⭐ Bookmark current folder")).toBeNull();
  });

  it("shows '⭐ Bookmark this file' for CSV tab with path", () => {
    const tab = makeTab({
      id: "t-csv",
      type: "csv",
      title: "data.csv",
      editorFilePath: "/data/report.csv",
    });
    mockIsBookmarkActionAvailable.mockReturnValue(true);

    renderTabBar([tab]);
    openContextMenu("t-csv");

    expect(screen.getByText("⭐ Bookmark this file")).toBeTruthy();
  });

  it("shows '⭐ Bookmark this file' for markdown tab with path", () => {
    const tab = makeTab({
      id: "t-md",
      type: "markdown",
      title: "README.md",
      editorFilePath: "/docs/README.md",
    });
    mockIsBookmarkActionAvailable.mockReturnValue(true);

    renderTabBar([tab]);
    openContextMenu("t-md");

    expect(screen.getByText("⭐ Bookmark this file")).toBeTruthy();
  });
});
