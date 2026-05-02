/**
 * Unit tests for Bug 4 (tab reorder context menu) and Bug 5 (split pane close).
 *
 * Bug 4: "Move Left" / "Move Right" in tab context menu as a reliable
 *         alternative to HTML5 drag-and-drop (broken in Tauri 2.0 webviews).
 * Bug 5: Close button on split-pane leaves so users can unsplit.
 *
 * Tags: [TDD], [AC-tab-reorder], [AC-pane-close]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Tauri API mocks ──────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ─── Allotment mock ──────────────────────────────────────────────

vi.mock("allotment", () => {
  const AllotmentComponent = ({
    children,
    vertical,
  }: {
    children: React.ReactNode;
    vertical?: boolean;
  }) => (
    <div
      data-testid="allotment-container"
      data-vertical={vertical ? "true" : "false"}
    >
      {children}
    </div>
  );

  AllotmentComponent.Pane = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="allotment-pane">{children}</div>
  );

  return { Allotment: AllotmentComponent };
});

vi.mock("allotment/dist/style.css", () => ({}));

// ─── Bug 4: Tab reorder via context menu ─────────────────────────

import type { Tab } from "../types";
import { TabBar } from "../components/TabBar";

const mockAddTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockActivateTab = vi.fn();
const mockMoveTab = vi.fn();
const mockRenameTab = vi.fn();
const mockDuplicateTab = vi.fn();
const mockCloseOtherTabs = vi.fn();
const mockCloseAllTabs = vi.fn();

let mockTabs: Tab[] = [];
let mockActiveTabId = "";

vi.mock("../stores/tabStore", () => ({
  useTabStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        tabs: mockTabs,
        activeTabId: mockActiveTabId,
        addTab: mockAddTab,
        removeTab: mockRemoveTab,
        activateTab: mockActivateTab,
        moveTab: mockMoveTab,
        renameTab: mockRenameTab,
        duplicateTab: mockDuplicateTab,
        closeOtherTabs: mockCloseOtherTabs,
        closeAllTabs: mockCloseAllTabs,
        loggingSessions: new Set<string>(),
        unsplitPane: vi.fn(),
        isSearchOpen: false,
        closeSearch: vi.fn(),
      };
      return selector(state);
    }),
    {
      getState: () => ({
        activeTabId: mockActiveTabId,
        tabs: mockTabs,
      }),
    },
  ),
  MAX_TITLE_LENGTH: 100,
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      isActive: false,
      targetTabIds: new Set<string>(),
    };
    return selector(state);
  }),
}));

function createMockTab(id: string, title: string): Tab {
  return {
    id,
    title,
    layout: { type: "leaf", terminalSessionId: `session-${id}` },
    createdAt: Date.now(),
  };
}

describe("Bug 4: Tab reorder via context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabs = [
      createMockTab("tab-1", "Terminal 1"),
      createMockTab("tab-2", "Terminal 2"),
      createMockTab("tab-3", "Terminal 3"),
    ];
    mockActiveTabId = "tab-2";
  });

  it("context menu shows Move Left and Move Right options", () => {
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]); // right-click tab-2 (middle)

    expect(screen.getByText("Move Left")).toBeInTheDocument();
    expect(screen.getByText("Move Right")).toBeInTheDocument();
  });

  it("Move Left calls moveTab(currentIndex, currentIndex - 1)", async () => {
    const user = userEvent.setup();
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]); // tab-2 at index 1

    const moveLeft = screen.getByText("Move Left");
    await user.click(moveLeft);

    expect(mockMoveTab).toHaveBeenCalledWith(1, 0);
  });

  it("Move Right calls moveTab(currentIndex, currentIndex + 1)", async () => {
    const user = userEvent.setup();
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]); // tab-2 at index 1

    const moveRight = screen.getByText("Move Right");
    await user.click(moveRight);

    expect(mockMoveTab).toHaveBeenCalledWith(1, 2);
  });

  it("Move Left is disabled for the first tab", () => {
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[0]); // tab-1 at index 0

    const moveLeft = screen.getByText("Move Left");
    expect(moveLeft).toBeDisabled();
  });

  it("Move Right is disabled for the last tab", () => {
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[2]); // tab-3 at index 2 (last)

    const moveRight = screen.getByText("Move Right");
    expect(moveRight).toBeDisabled();
  });

  it("Move Left is enabled for a middle tab", () => {
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]); // tab-2 at index 1

    const moveLeft = screen.getByText("Move Left");
    expect(moveLeft).not.toBeDisabled();
  });

  it("Move Right is enabled for a middle tab", () => {
    render(<TabBar />);

    const tabs = screen.getAllByRole("tab");
    fireEvent.contextMenu(tabs[1]); // tab-2 at index 1

    const moveRight = screen.getByText("Move Right");
    expect(moveRight).not.toBeDisabled();
  });
});

// ─── Bug 5: Split pane close button ──────────────────────────────

import { SplitContainer } from "../components/SplitPane";
import type { PaneNode } from "../types";

describe("Bug 5: Split pane close button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  it("does NOT show close button for a single (non-split) pane", async () => {
    const layout: PaneNode = {
      type: "leaf",
      terminalSessionId: "session-1",
    };

    await act(async () => {
      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);
    });

    const closeBtn = screen.queryByTestId("pane-close-btn");
    expect(closeBtn).not.toBeInTheDocument();
  });

  it("shows close buttons for leaf panes inside a split", async () => {
    const layout: PaneNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", terminalSessionId: "session-1" },
        { type: "leaf", terminalSessionId: "session-2" },
      ],
      ratio: 0.5,
    };

    await act(async () => {
      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);
    });

    const closeBtns = screen.getAllByTestId("pane-close-btn");
    expect(closeBtns).toHaveLength(2);
  });

  it("close button has correct aria-label", async () => {
    const layout: PaneNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", terminalSessionId: "session-1" },
        { type: "leaf", terminalSessionId: "session-2" },
      ],
      ratio: 0.5,
    };

    await act(async () => {
      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);
    });

    const closeBtns = screen.getAllByTestId("pane-close-btn");
    for (const btn of closeBtns) {
      expect(btn).toHaveAttribute("aria-label", "Close pane");
    }
  });

  it("nested splits show close buttons on inner leaves", async () => {
    const layout: PaneNode = {
      type: "split",
      direction: "vertical",
      children: [
        { type: "leaf", terminalSessionId: "session-1" },
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", terminalSessionId: "session-2" },
            { type: "leaf", terminalSessionId: "session-3" },
          ],
          ratio: 0.5,
        },
      ],
      ratio: 0.5,
    };

    await act(async () => {
      render(<SplitContainer layout={layout} tabId="tab-1" isActive={true} />);
    });

    // All 3 leaf nodes are inside splits → all should have close buttons
    const closeBtns = screen.getAllByTestId("pane-close-btn");
    expect(closeBtns).toHaveLength(3);
  });
});
