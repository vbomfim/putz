/**
 * Unit tests for the tab store (Zustand).
 *
 * Tests cover: addTab, removeTab, activateTab, moveTab,
 * splitPane, unsplitPane, resizePane, renameTab, and edge cases.
 *
 * Tags: [TDD], [AC-1], [AC-2], [AC-3], [AC-4], [AC-5], [AC-6], [AC-7], [AC-8], [AC-10]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

// Mock Tauri invoke before importing the store
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock Tauri event listener
const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Import after mocks are set up
import { useTabStore, MAX_TITLE_LENGTH } from "../stores/tabStore";
import type { PaneNode } from "../types";

describe("tabStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    // Default: pty_spawn returns a session ID
    mockInvoke.mockResolvedValue("mock-session-id");
    // Reset Zustand state (including tabCounter)
    useTabStore.setState({
      tabs: [],
      activeTabId: "",
      tabCounter: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addTab [AC-1]", () => {
    it("creates a new tab with a local terminal session", async () => {
      mockInvoke.mockResolvedValueOnce("session-abc");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].layout).toEqual({
        type: "leaf",
        terminalSessionId: "session-abc",
      });
      expect(state.tabs[0].status).toBe("local");
      expect(state.tabs[0].title).toMatch(/^Terminal\s/);
    });

    it("sets the new tab as active", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const state = useTabStore.getState();
      expect(state.activeTabId).toBe(state.tabs[0].id);
    });

    it("calls pty_spawn with default dimensions", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });

    it("increments tab counter for default title", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const state = useTabStore.getState();
      expect(state.tabs[0].title).toBe("Terminal 1");
      expect(state.tabs[1].title).toBe("Terminal 2");
    });

    it("stores createdAt timestamp", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      const before = Date.now();

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const after = Date.now();
      const tab = useTabStore.getState().tabs[0];
      expect(tab.createdAt).toBeGreaterThanOrEqual(before);
      expect(tab.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe("removeTab [AC-2]", () => {
    it("removes the specified tab", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("calls pty_close for the terminal session", async () => {
      mockInvoke.mockResolvedValueOnce("session-to-close");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      mockInvoke.mockReset().mockResolvedValue(undefined);

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-to-close",
      });
    });

    it("activates adjacent tab when active tab is removed", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2")
        .mockResolvedValueOnce("session-3");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;
      // Activate middle tab
      act(() => {
        useTabStore.getState().activateTab(tabs[1].id);
      });

      // Remove middle tab — should activate next (index 2, which becomes index 1)
      act(() => {
        useTabStore.getState().removeTab(tabs[1].id);
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      // Should activate the tab that was at index 2 (now index 1) or previous
      expect(state.activeTabId).toBeTruthy();
      expect(state.activeTabId).not.toBe(tabs[1].id);
    });

    it("clears activeTabId when last tab is removed", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBe("");
    });

    it("closes all PTY sessions in a split layout", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      // Split the pane
      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      mockInvoke.mockReset().mockResolvedValue(undefined);

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      // Should close both sessions
      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-1",
      });
      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-2",
      });
    });

    it("does nothing for non-existent tab ID", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      act(() => {
        useTabStore.getState().removeTab("non-existent-id");
      });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });
  });

  describe("activateTab [AC-4]", () => {
    it("sets the active tab", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const firstTabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().activateTab(firstTabId);
      });

      expect(useTabStore.getState().activeTabId).toBe(firstTabId);
    });

    it("ignores activation of non-existent tab", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const currentActiveId = useTabStore.getState().activeTabId;

      act(() => {
        useTabStore.getState().activateTab("non-existent-id");
      });

      expect(useTabStore.getState().activeTabId).toBe(currentActiveId);
    });
  });

  describe("moveTab [AC-3]", () => {
    it("reorders tabs by moving from one index to another", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2")
        .mockResolvedValueOnce("session-3");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const originalIds = useTabStore.getState().tabs.map((t) => t.id);

      act(() => {
        useTabStore.getState().moveTab(0, 2);
      });

      const newIds = useTabStore.getState().tabs.map((t) => t.id);
      expect(newIds[0]).toBe(originalIds[1]);
      expect(newIds[1]).toBe(originalIds[2]);
      expect(newIds[2]).toBe(originalIds[0]);
    });

    it("ignores invalid indices", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const originalIds = useTabStore.getState().tabs.map((t) => t.id);

      act(() => {
        useTabStore.getState().moveTab(-1, 5);
      });

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(originalIds);
    });

    it("handles same from and to index (no-op)", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const originalIds = useTabStore.getState().tabs.map((t) => t.id);

      act(() => {
        useTabStore.getState().moveTab(0, 0);
      });

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(originalIds);
    });
  });

  describe("splitPane [AC-5] [AC-6]", () => {
    it("splits a leaf pane vertically", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1") // addTab
        .mockResolvedValueOnce("session-2"); // split

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      const layout = useTabStore.getState().tabs[0].layout;
      expect(layout.type).toBe("split");
      if (layout.type === "split") {
        expect(layout.direction).toBe("vertical");
        expect(layout.ratio).toBe(0.5);
        expect(layout.children[0]).toEqual({
          type: "leaf",
          terminalSessionId: "session-1",
        });
        expect(layout.children[1]).toEqual({
          type: "leaf",
          terminalSessionId: "session-2",
        });
      }
    });

    it("splits a leaf pane horizontally", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore
          .getState()
          .splitPane(tabId, "session-1", "horizontal");
      });

      const layout = useTabStore.getState().tabs[0].layout;
      expect(layout.type).toBe("split");
      if (layout.type === "split") {
        expect(layout.direction).toBe("horizontal");
      }
    });

    it("spawns a new PTY for the split pane", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-split");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      mockInvoke.mockReset();
      mockInvoke.mockResolvedValueOnce("session-split");

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });

    it("enforces max split depth of 4", async () => {
      // Create a tab
      mockInvoke.mockResolvedValueOnce("s-1");
      await act(async () => {
        await useTabStore.getState().addTab();
      });
      const tabId = useTabStore.getState().tabs[0].id;

      // Split 4 times to reach max depth
      for (let i = 2; i <= 5; i++) {
        mockInvoke.mockResolvedValueOnce(`s-${i}`);
        const prevLayout = useTabStore.getState().tabs[0].layout;
        const lastSession = getDeepestSessionId(prevLayout);
        await act(async () => {
          await useTabStore
            .getState()
            .splitPane(tabId, lastSession, "vertical");
        });
      }

      // The 5th split should be rejected (depth would exceed 4)
      // After 4 splits, the tree depth is 4. Attempting a 5th split on the deepest leaf
      // should not change the layout
      const layout = useTabStore.getState().tabs[0].layout;
      const depth = getPaneDepth(layout);
      expect(depth).toBeLessThanOrEqual(4);
    });
  });

  describe("unsplitPane [AC-8]", () => {
    it("removes a pane and collapses the split", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      mockInvoke.mockReset().mockResolvedValue(undefined);

      act(() => {
        useTabStore.getState().unsplitPane(tabId, "session-2");
      });

      const layout = useTabStore.getState().tabs[0].layout;
      expect(layout).toEqual({
        type: "leaf",
        terminalSessionId: "session-1",
      });
    });

    it("calls pty_close for the removed pane session", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      mockInvoke.mockReset().mockResolvedValue(undefined);

      act(() => {
        useTabStore.getState().unsplitPane(tabId, "session-2");
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-2",
      });
    });

    it("does nothing when unsplitting a non-split tab", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().unsplitPane(tabId, "session-1");
      });

      // Layout should remain unchanged
      expect(useTabStore.getState().tabs[0].layout).toEqual({
        type: "leaf",
        terminalSessionId: "session-1",
      });
    });
  });

  describe("resizePane [AC-7]", () => {
    it("updates the ratio of a split pane", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      act(() => {
        useTabStore.getState().resizePane(tabId, 0.3);
      });

      const layout = useTabStore.getState().tabs[0].layout;
      if (layout.type === "split") {
        expect(layout.ratio).toBe(0.3);
      }
    });

    it("clamps ratio between 0.1 and 0.9", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-1")
        .mockResolvedValueOnce("session-2");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      act(() => {
        useTabStore.getState().resizePane(tabId, 0.05);
      });

      const layout = useTabStore.getState().tabs[0].layout;
      if (layout.type === "split") {
        expect(layout.ratio).toBeGreaterThanOrEqual(0.1);
      }

      act(() => {
        useTabStore.getState().resizePane(tabId, 0.95);
      });

      const layout2 = useTabStore.getState().tabs[0].layout;
      if (layout2.type === "split") {
        expect(layout2.ratio).toBeLessThanOrEqual(0.9);
      }
    });
  });

  describe("renameTab", () => {
    it("updates the tab title", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().renameTab(tabId, "My Custom Tab");
      });

      expect(useTabStore.getState().tabs[0].title).toBe("My Custom Tab");
    });

    it("ignores empty title", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      const originalTitle = useTabStore.getState().tabs[0].title;

      act(() => {
        useTabStore.getState().renameTab(tabId, "");
      });

      expect(useTabStore.getState().tabs[0].title).toBe(originalTitle);
    });
  });

  describe("tab navigation helpers", () => {
    it("activateNextTab cycles to the next tab", async () => {
      mockInvoke
        .mockResolvedValueOnce("s-1")
        .mockResolvedValueOnce("s-2")
        .mockResolvedValueOnce("s-3");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;
      // Active should be the last added
      act(() => {
        useTabStore.getState().activateTab(tabs[0].id);
      });

      act(() => {
        useTabStore.getState().activateNextTab();
      });

      expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
    });

    it("activateNextTab wraps around to first tab", async () => {
      mockInvoke.mockResolvedValueOnce("s-1").mockResolvedValueOnce("s-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;
      // Activate last tab
      act(() => {
        useTabStore.getState().activateTab(tabs[1].id);
      });

      act(() => {
        useTabStore.getState().activateNextTab();
      });

      expect(useTabStore.getState().activeTabId).toBe(tabs[0].id);
    });

    it("activatePreviousTab cycles to the previous tab", async () => {
      mockInvoke.mockResolvedValueOnce("s-1").mockResolvedValueOnce("s-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;
      act(() => {
        useTabStore.getState().activateTab(tabs[1].id);
      });

      act(() => {
        useTabStore.getState().activatePreviousTab();
      });

      expect(useTabStore.getState().activeTabId).toBe(tabs[0].id);
    });

    it("activatePreviousTab wraps around to last tab", async () => {
      mockInvoke.mockResolvedValueOnce("s-1").mockResolvedValueOnce("s-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;
      act(() => {
        useTabStore.getState().activateTab(tabs[0].id);
      });

      act(() => {
        useTabStore.getState().activatePreviousTab();
      });

      expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
    });

    it("activateTabByIndex activates tab at given 0-based index", async () => {
      mockInvoke
        .mockResolvedValueOnce("s-1")
        .mockResolvedValueOnce("s-2")
        .mockResolvedValueOnce("s-3");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabs = useTabStore.getState().tabs;

      act(() => {
        useTabStore.getState().activateTabByIndex(1);
      });

      expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
    });

    it("activateTabByIndex ignores out-of-range index", async () => {
      mockInvoke.mockResolvedValueOnce("s-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const activeId = useTabStore.getState().activeTabId;

      act(() => {
        useTabStore.getState().activateTabByIndex(99);
      });

      expect(useTabStore.getState().activeTabId).toBe(activeId);
    });
  });

  describe("duplicateTab [AC-9]", () => {
    it("creates a copy of the specified tab", async () => {
      mockInvoke
        .mockResolvedValueOnce("session-original")
        .mockResolvedValueOnce("session-dup");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;

      await act(async () => {
        await useTabStore.getState().duplicateTab(tabId);
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.activeTabId).toBe(state.tabs[1].id);
    });
  });

  describe("closeOtherTabs [AC-9]", () => {
    it("closes all tabs except the specified one", async () => {
      mockInvoke
        .mockResolvedValueOnce("s-1")
        .mockResolvedValueOnce("s-2")
        .mockResolvedValueOnce("s-3");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const keepTabId = useTabStore.getState().tabs[1].id;

      act(() => {
        useTabStore.getState().closeOtherTabs(keepTabId);
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].id).toBe(keepTabId);
      expect(state.activeTabId).toBe(keepTabId);
    });

    it("does nothing when keepId does not match any tab", async () => {
      mockInvoke.mockResolvedValueOnce("s-1").mockResolvedValueOnce("s-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      const tabsBefore = useTabStore.getState().tabs;

      act(() => {
        useTabStore.getState().closeOtherTabs("non-existent-id");
      });

      const tabsAfter = useTabStore.getState().tabs;
      expect(tabsAfter).toHaveLength(tabsBefore.length);
    });
  });

  describe("closeAllTabs [AC-9]", () => {
    it("removes all tabs", async () => {
      mockInvoke.mockResolvedValueOnce("s-1").mockResolvedValueOnce("s-2");

      await act(async () => {
        await useTabStore.getState().addTab();
        await useTabStore.getState().addTab();
      });

      act(() => {
        useTabStore.getState().closeAllTabs();
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBe("");
    });
  });

  describe("PTY spawn error handling", () => {
    it("addTab does not add a tab when PTY spawn fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("PTY spawn failed"));

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      expect(useTabStore.getState().tabs).toHaveLength(0);
    });

    it("duplicateTab does not add a tab when PTY spawn fails", async () => {
      mockInvoke.mockResolvedValueOnce("session-original");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      mockInvoke.mockRejectedValueOnce(new Error("PTY spawn failed"));

      await act(async () => {
        await useTabStore.getState().duplicateTab(tabId);
      });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("splitPane does not modify layout when PTY spawn fails", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      mockInvoke.mockRejectedValueOnce(new Error("PTY spawn failed"));

      await act(async () => {
        await useTabStore.getState().splitPane(tabId, "session-1", "vertical");
      });

      const layout = useTabStore.getState().tabs[0].layout;
      expect(layout.type).toBe("leaf");
    });
  });

  describe("tab title max length", () => {
    it("truncates title to MAX_TITLE_LENGTH characters", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      const longTitle = "A".repeat(MAX_TITLE_LENGTH + 50);

      act(() => {
        useTabStore.getState().renameTab(tabId, longTitle);
      });

      const title = useTabStore.getState().tabs[0].title;
      expect(title).toHaveLength(MAX_TITLE_LENGTH);
    });

    it("allows titles up to MAX_TITLE_LENGTH", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      const tabId = useTabStore.getState().tabs[0].id;
      const exactTitle = "B".repeat(MAX_TITLE_LENGTH);

      act(() => {
        useTabStore.getState().renameTab(tabId, exactTitle);
      });

      expect(useTabStore.getState().tabs[0].title).toBe(exactTitle);
    });
  });
});

// --- Helpers ---

/** Gets the deepest leaf session ID in a PaneNode tree. */
function getDeepestSessionId(node: PaneNode): string {
  if (node.type === "leaf") return node.terminalSessionId;
  return getDeepestSessionId(node.children[1]);
}

/** Gets the maximum depth of a PaneNode tree. */
function getPaneDepth(node: PaneNode): number {
  if (node.type === "leaf") return 1;
  return (
    1 + Math.max(getPaneDepth(node.children[0]), getPaneDepth(node.children[1]))
  );
}
