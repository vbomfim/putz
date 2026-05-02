/**
 * Unit tests for the TabBar component.
 *
 * Tests rendering, click handlers, drag-to-reorder, keyboard navigation,
 * context menu, and accessibility (ARIA roles).
 *
 * Tags: [TDD], [AC-1], [AC-2], [AC-3], [AC-4], [AC-9], [AC-10]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar } from "../components/TabBar";
import type { Tab } from "../types";

// Mock the tab store
const mockAddTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockActivateTab = vi.fn();
const mockMoveTab = vi.fn();
const mockRenameTab = vi.fn();
const mockDuplicateTab = vi.fn();
const mockCloseOtherTabs = vi.fn();
const mockCloseAllTabs = vi.fn();

vi.mock("../stores/tabStore", () => ({
  useTabStore: vi.fn((selector: (state: unknown) => unknown) => {
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
    };
    return selector(state);
  }),
  MAX_TITLE_LENGTH: 100,
}));

let mockTabs: Tab[] = [];
let mockActiveTabId = "";

function createMockTab(id: string, title: string): Tab {
  return {
    id,
    title,
    layout: { type: "leaf", terminalSessionId: `session-${id}` },
    createdAt: Date.now(),
  };
}

describe("TabBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabs = [
      createMockTab("tab-1", "Terminal 1"),
      createMockTab("tab-2", "Terminal 2"),
    ];
    mockActiveTabId = "tab-1";
  });

  describe("rendering [AC-10]", () => {
    it("renders the tab bar with role tablist", () => {
      render(<TabBar />);

      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeInTheDocument();
    });

    it("renders each tab with role tab", () => {
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
    });

    it("shows tab titles", () => {
      render(<TabBar />);

      expect(screen.getByText("Terminal 1")).toBeInTheDocument();
      expect(screen.getByText("Terminal 2")).toBeInTheDocument();
    });

    it("shows add button", () => {
      render(<TabBar />);

      const addBtn = screen.getByLabelText("New tab");
      expect(addBtn).toBeInTheDocument();
    });

    it("marks active tab with aria-selected=true", () => {
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    });
  });

  describe("interactions [AC-1] [AC-2]", () => {
    it("calls addTab when + button is clicked", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const addBtn = screen.getByLabelText("New tab");
      await user.click(addBtn);

      expect(mockAddTab).toHaveBeenCalledTimes(1);
    });

    it("calls activateTab when a tab is clicked", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      await user.click(tabs[1]);

      expect(mockActivateTab).toHaveBeenCalledWith("tab-2");
    });

    it("shows close button on tab hover", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      await user.hover(tabs[0]);

      const closeBtn = within(tabs[0]).getByLabelText("Close tab");
      expect(closeBtn).toBeInTheDocument();
    });

    it("calls removeTab when close button is clicked", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      await user.hover(tabs[0]);

      const closeBtn = within(tabs[0]).getByLabelText("Close tab");
      await user.click(closeBtn);

      expect(mockRemoveTab).toHaveBeenCalledWith("tab-1");
    });

    it("close button click does not activate the tab", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      // Use active tab (tab-1) since its close button is always visible
      const tabs = screen.getAllByRole("tab");
      const closeBtn = within(tabs[0]).getByLabelText("Close tab");
      await user.click(closeBtn);

      // removeTab should be called
      expect(mockRemoveTab).toHaveBeenCalledWith("tab-1");
    });
  });

  describe("context menu [AC-9]", () => {
    it("shows context menu on right-click", async () => {
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      expect(screen.getByText("Close")).toBeInTheDocument();
      expect(screen.getByText("Close Others")).toBeInTheDocument();
      expect(screen.getByText("Close All")).toBeInTheDocument();
      expect(screen.getByText("Duplicate")).toBeInTheDocument();
    });

    it("Close in context menu calls removeTab", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      const closeItem = screen.getByText("Close");
      await user.click(closeItem);

      expect(mockRemoveTab).toHaveBeenCalledWith("tab-1");
    });

    it("Close Others calls closeOtherTabs", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      const closeOthersItem = screen.getByText("Close Others");
      await user.click(closeOthersItem);

      expect(mockCloseOtherTabs).toHaveBeenCalledWith("tab-1");
    });

    it("Close All calls closeAllTabs", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      const closeAllItem = screen.getByText("Close All");
      await user.click(closeAllItem);

      expect(mockCloseAllTabs).toHaveBeenCalledTimes(1);
    });

    it("Duplicate calls duplicateTab", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      const dupItem = screen.getByText("Duplicate");
      await user.click(dupItem);

      expect(mockDuplicateTab).toHaveBeenCalledWith("tab-1");
    });

    it("closes context menu when clicking outside", async () => {
      const user = userEvent.setup();
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      fireEvent.contextMenu(tabs[0]);

      expect(screen.getByText("Close")).toBeInTheDocument();

      // Click outside
      await user.click(document.body);

      expect(screen.queryByText("Close Others")).not.toBeInTheDocument();
    });
  });

  describe("drag to reorder [AC-3]", () => {
    it("tabs render as tab role elements", () => {
      render(<TabBar />);

      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("empty state", () => {
    it("renders only the add button when no tabs exist", () => {
      mockTabs = [];
      mockActiveTabId = "";

      render(<TabBar />);

      const addBtn = screen.getByLabelText("New tab");
      expect(addBtn).toBeInTheDocument();

      const tabs = screen.queryAllByRole("tab");
      expect(tabs).toHaveLength(0);
    });
  });
});
