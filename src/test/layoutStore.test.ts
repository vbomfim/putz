/**
 * Unit tests for the layout store (Zustand).
 *
 * Tests cover: region creation, tab management, splitting, closing,
 * focus, and navigation — the new region-based layout architecture.
 *
 * Tags: [TDD], [AC-region], [AC-tab], [AC-split], [AC-close], [AC-focus]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

// Mock monaco-editor — jsdom lacks document.queryCommandSupported
// which monaco needs at module load (transitive import via RegionContainer).
vi.mock("monaco-editor", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({}));

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
import { useLayoutStore } from "../stores/layoutStore";

/** Helper to reset store to a clean initial state. */
function resetStore(): void {
  const initialRegionId = "test-region-1";
  const initialState = {
    layout: { type: "region" as const, regionId: initialRegionId },
    regions: {
      [initialRegionId]: {
        id: initialRegionId,
        tabs: [],
        activeTabId: "",
        tabPosition: "top" as const,
      },
    },
    focusedRegionId: initialRegionId,
    isSearchOpen: false,
    loggingSessions: new Set<string>(),
    tabCounter: 0,
  };
  useLayoutStore.setState(initialState);
}

describe("layoutStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    // Default: pty_spawn returns a session ID
    mockInvoke.mockResolvedValue("mock-session-id");
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Region Creation ──────────────────────────────────────────────

  describe("initial state", () => {
    it("starts with one region and no tabs", () => {
      const state = useLayoutStore.getState();
      expect(state.layout.type).toBe("region");
      const regionIds = Object.keys(state.regions);
      expect(regionIds).toHaveLength(1);
      const region = state.regions[regionIds[0]];
      expect(region.tabs).toHaveLength(0);
      expect(state.focusedRegionId).toBe(regionIds[0]);
    });
  });

  // ─── Tab Management ───────────────────────────────────────────────

  describe("addTerminalTab", () => {
    it("adds a terminal tab to the focused region", async () => {
      mockInvoke.mockResolvedValueOnce("session-abc");

      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabs).toHaveLength(1);
      expect(region.tabs[0].type).toBe("terminal");
      expect(region.tabs[0].sessionId).toBe("session-abc");
      expect(region.activeTabId).toBe(region.tabs[0].id);
    });

    it("adds a terminal tab to a specific region", async () => {
      mockInvoke.mockResolvedValueOnce("session-xyz");
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      await act(async () => {
        await useLayoutStore.getState().addTerminalTab(regionId);
      });

      const updated = useLayoutStore.getState();
      const region = updated.regions[regionId];
      expect(region.tabs).toHaveLength(1);
      expect(region.tabs[0].sessionId).toBe("session-xyz");
    });

    it("handles PTY spawn failure gracefully", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("spawn failed"));

      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabs).toHaveLength(0);
    });

    it("increments tab counter for unique titles", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      mockInvoke.mockResolvedValueOnce("session-2");

      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabs[0].title).not.toBe(region.tabs[1].title);
    });
  });

  describe("closeTab", () => {
    it("removes a tab from its region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tabId = state.regions[regionId].tabs[0].id;

      act(() => {
        useLayoutStore.getState().closeTab(regionId, tabId);
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].tabs).toHaveLength(0);
    });

    it("calls pty_close for terminal tabs", async () => {
      mockInvoke.mockResolvedValueOnce("session-to-close");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tabId = state.regions[regionId].tabs[0].id;
      mockInvoke.mockClear();

      act(() => {
        useLayoutStore.getState().closeTab(regionId, tabId);
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-to-close",
      });
    });

    it("activates the next tab when the active tab is closed", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tab1Id = state.regions[regionId].tabs[0].id;
      const tab2Id = state.regions[regionId].tabs[1].id;

      // Close the active tab (tab2), tab1 should become active
      act(() => {
        useLayoutStore.getState().closeTab(regionId, tab2Id);
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].activeTabId).toBe(tab1Id);
    });

    it("closes the region when the last tab is closed", async () => {
      // First, split to have two regions
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      // Split the region
      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const stateAfterSplit = useLayoutStore.getState();
      expect(stateAfterSplit.layout.type).toBe("split");

      // Close the tab in the focused region
      const regionId = stateAfterSplit.focusedRegionId;
      const tabId = stateAfterSplit.regions[regionId].tabs[0].id;

      act(() => {
        useLayoutStore.getState().closeTab(regionId, tabId);
      });

      const updated = useLayoutStore.getState();
      // Should collapse back to a single region
      expect(updated.layout.type).toBe("region");
    });
  });

  describe("activateTab", () => {
    it("sets the active tab in a region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tab1Id = state.regions[regionId].tabs[0].id;

      act(() => {
        useLayoutStore.getState().activateTab(regionId, tab1Id);
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].activeTabId).toBe(tab1Id);
    });
  });

  // ─── Split / Close Region ─────────────────────────────────────────

  describe("splitRegion", () => {
    it("splits the focused region vertically", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-new");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      expect(state.layout.type).toBe("split");
      if (state.layout.type === "split") {
        expect(state.layout.direction).toBe("vertical");
        expect(state.layout.children[0].type).toBe("region");
        expect(state.layout.children[1].type).toBe("region");
        expect(state.layout.ratio).toBe(0.5);
      }
      // Should have two regions now
      expect(Object.keys(state.regions)).toHaveLength(2);
    });

    it("splits the focused region horizontally", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-new");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("horizontal");
      });

      const state = useLayoutStore.getState();
      if (state.layout.type === "split") {
        expect(state.layout.direction).toBe("horizontal");
      }
    });

    it("focuses the new region after split", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const originalRegionId = useLayoutStore.getState().focusedRegionId;
      mockInvoke.mockResolvedValueOnce("session-new");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      // Focus should be on the new region (not original)
      expect(state.focusedRegionId).not.toBe(originalRegionId);
    });

    it("creates a new terminal tab in the new region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _originalRegionId = useLayoutStore.getState().focusedRegionId;
      mockInvoke.mockResolvedValueOnce("session-new");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      const newRegionId = state.focusedRegionId;
      const newRegion = state.regions[newRegionId];
      expect(newRegion.tabs).toHaveLength(1);
      expect(newRegion.tabs[0].sessionId).toBe("session-new");
    });

    it("does not split a region with no tabs", async () => {
      // Region is empty — should not split
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      expect(state.layout.type).toBe("region");
    });
  });

  describe("closeRegion", () => {
    it("closes a region and expands the sibling", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const stateAfterSplit = useLayoutStore.getState();
      const newRegionId = stateAfterSplit.focusedRegionId;

      act(() => {
        useLayoutStore.getState().closeRegion(newRegionId);
      });

      const updated = useLayoutStore.getState();
      expect(updated.layout.type).toBe("region");
      expect(Object.keys(updated.regions)).toHaveLength(1);
    });

    it("does not close the last remaining region", () => {
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      act(() => {
        useLayoutStore.getState().closeRegion(regionId);
      });

      const updated = useLayoutStore.getState();
      // Still has one region
      expect(Object.keys(updated.regions)).toHaveLength(1);
    });

    it("closes PTY sessions when closing a region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      const newRegionId = state.focusedRegionId;
      mockInvoke.mockClear();

      act(() => {
        useLayoutStore.getState().closeRegion(newRegionId);
      });

      expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
        sessionId: "session-2",
      });
    });
  });

  // ─── Focus ────────────────────────────────────────────────────────

  describe("setFocusedRegion", () => {
    it("updates the focused region ID", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const state = useLayoutStore.getState();
      const allRegionIds = Object.keys(state.regions);
      const otherRegionId = allRegionIds.find(
        (id) => id !== state.focusedRegionId,
      )!;

      act(() => {
        useLayoutStore.getState().setFocusedRegion(otherRegionId);
      });

      expect(useLayoutStore.getState().focusedRegionId).toBe(otherRegionId);
    });
  });

  // ─── Tab Navigation ───────────────────────────────────────────────

  describe("nextTab / prevTab", () => {
    it("cycles to next tab in the focused region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      mockInvoke.mockResolvedValueOnce("session-2");
      mockInvoke.mockResolvedValueOnce("session-3");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tab3Id = state.regions[regionId].tabs[2].id;
      expect(state.regions[regionId].activeTabId).toBe(tab3Id);

      act(() => {
        useLayoutStore.getState().nextTab();
      });

      // Should wrap around to tab 1
      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].activeTabId).toBe(
        state.regions[regionId].tabs[0].id,
      );
    });

    it("cycles to previous tab in the focused region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      mockInvoke.mockResolvedValueOnce("session-2");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      // Active tab is tab 2 — go to previous (tab 1)
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tab1Id = state.regions[regionId].tabs[0].id;

      act(() => {
        useLayoutStore.getState().prevTab();
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].activeTabId).toBe(tab1Id);
    });

    it("does nothing when there is one or zero tabs", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const originalActiveId = state.regions[regionId].activeTabId;

      act(() => {
        useLayoutStore.getState().nextTab();
      });

      expect(useLayoutStore.getState().regions[regionId].activeTabId).toBe(
        originalActiveId,
      );
    });
  });

  // ─── Search & Logging (preserved from tabStore) ───────────────────

  describe("search", () => {
    it("toggles search state", () => {
      expect(useLayoutStore.getState().isSearchOpen).toBe(false);

      act(() => {
        useLayoutStore.getState().toggleSearch();
      });
      expect(useLayoutStore.getState().isSearchOpen).toBe(true);

      act(() => {
        useLayoutStore.getState().toggleSearch();
      });
      expect(useLayoutStore.getState().isSearchOpen).toBe(false);
    });

    it("closes search explicitly", () => {
      act(() => {
        useLayoutStore.getState().toggleSearch();
      });
      expect(useLayoutStore.getState().isSearchOpen).toBe(true);

      act(() => {
        useLayoutStore.getState().closeSearch();
      });
      expect(useLayoutStore.getState().isSearchOpen).toBe(false);
    });
  });

  // ─── Helpers ──────────────────────────────────────────────────────

  describe("getActiveSessionId", () => {
    it("returns the session ID of the active tab in the focused region", async () => {
      mockInvoke.mockResolvedValueOnce("session-focused");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const sessionId = useLayoutStore.getState().getActiveSessionId();
      expect(sessionId).toBe("session-focused");
    });

    it("returns null when no tabs exist", () => {
      const sessionId = useLayoutStore.getState().getActiveSessionId();
      expect(sessionId).toBeNull();
    });
  });

  describe("renameTab", () => {
    it("renames a tab in a region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tabId = state.regions[regionId].tabs[0].id;

      act(() => {
        useLayoutStore.getState().renameTab(regionId, tabId, "My Custom Tab");
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].tabs[0].title).toBe("My Custom Tab");
    });

    it("rejects empty names", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;
      const tabId = state.regions[regionId].tabs[0].id;
      const originalTitle = state.regions[regionId].tabs[0].title;

      act(() => {
        useLayoutStore.getState().renameTab(regionId, tabId, "   ");
      });

      expect(useLayoutStore.getState().regions[regionId].tabs[0].title).toBe(
        originalTitle,
      );
    });
  });

  // ─── Tab Position ────────────────────────────────────────────────

  describe("tabPosition", () => {
    it("defaults tabPosition to 'top' on initial region", () => {
      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabPosition).toBe("top");
    });

    it("sets tabPosition to 'left' via setTabPosition", () => {
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      act(() => {
        useLayoutStore.getState().setTabPosition(regionId, "left");
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].tabPosition).toBe("left");
    });

    it("sets tabPosition to 'bottom' via setTabPosition", () => {
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      act(() => {
        useLayoutStore.getState().setTabPosition(regionId, "bottom");
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].tabPosition).toBe("bottom");
    });

    it("sets tabPosition to 'right' via setTabPosition", () => {
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      act(() => {
        useLayoutStore.getState().setTabPosition(regionId, "right");
      });

      const updated = useLayoutStore.getState();
      expect(updated.regions[regionId].tabPosition).toBe("right");
    });

    it("sets tabPosition back to 'top' from any position", () => {
      const state = useLayoutStore.getState();
      const regionId = state.focusedRegionId;

      for (const pos of ["bottom", "left", "right"] as const) {
        act(() => {
          useLayoutStore.getState().setTabPosition(regionId, pos);
        });
        act(() => {
          useLayoutStore.getState().setTabPosition(regionId, "top");
        });
        const updated = useLayoutStore.getState();
        expect(updated.regions[regionId].tabPosition).toBe("top");
      }
    });

    it("ignores setTabPosition for non-existent region", () => {
      act(() => {
        useLayoutStore.getState().setTabPosition("nonexistent-region", "left");
      });

      // Should not throw, and state should remain unchanged
      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabPosition).toBe("top");
    });

    it("preserves tabPosition: 'top' when splitting a region", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      mockInvoke.mockResolvedValueOnce("session-split");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("horizontal");
      });

      const state = useLayoutStore.getState();
      // New region should default to "top"
      const newRegion = state.regions[state.focusedRegionId];
      expect(newRegion.tabPosition).toBe("top");
    });

    it("per-region: each region can have different tabPosition", async () => {
      mockInvoke.mockResolvedValueOnce("session-1");
      await act(async () => {
        await useLayoutStore.getState().addTerminalTab();
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const originalRegionId = useLayoutStore.getState().focusedRegionId;

      mockInvoke.mockResolvedValueOnce("session-split");
      await act(async () => {
        await useLayoutStore.getState().splitRegion("vertical");
      });

      const newRegionId = useLayoutStore.getState().focusedRegionId;
      expect(newRegionId).not.toBe(originalRegionId);

      // Set left tabs on original region, right on new, verify independence
      act(() => {
        useLayoutStore.getState().setTabPosition(originalRegionId, "left");
      });
      act(() => {
        useLayoutStore.getState().setTabPosition(newRegionId, "right");
      });

      const state = useLayoutStore.getState();
      expect(state.regions[originalRegionId].tabPosition).toBe("left");
      expect(state.regions[newRegionId].tabPosition).toBe("right");
    });

    it("toggles tabPosition in cycle: top → bottom → left → right → top", () => {
      const regionId = useLayoutStore.getState().focusedRegionId;

      act(() => {
        useLayoutStore.getState().toggleTabPosition(regionId);
      });
      expect(useLayoutStore.getState().regions[regionId].tabPosition).toBe(
        "bottom",
      );

      act(() => {
        useLayoutStore.getState().toggleTabPosition(regionId);
      });
      expect(useLayoutStore.getState().regions[regionId].tabPosition).toBe(
        "left",
      );

      act(() => {
        useLayoutStore.getState().toggleTabPosition(regionId);
      });
      expect(useLayoutStore.getState().regions[regionId].tabPosition).toBe(
        "right",
      );

      act(() => {
        useLayoutStore.getState().toggleTabPosition(regionId);
      });
      expect(useLayoutStore.getState().regions[regionId].tabPosition).toBe(
        "top",
      );
    });

    it("ignores toggleTabPosition for non-existent region", () => {
      act(() => {
        useLayoutStore.getState().toggleTabPosition("nonexistent-region");
      });

      // Should not throw
      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      expect(region.tabPosition).toBe("top");
    });
  });

  // ─── addEditorTab extension routing ───────────────────────────────

  describe("addEditorTab extension routing", () => {
    it("routes .md files to addMarkdownTab", () => {
      const addMarkdownTabSpy = vi.spyOn(
        useLayoutStore.getState(),
        "addMarkdownTab",
      );

      act(() => {
        useLayoutStore
          .getState()
          .addEditorTab(undefined, "/Users/me/README.md");
      });

      expect(addMarkdownTabSpy).toHaveBeenCalledWith(
        expect.any(String),
        "/Users/me/README.md",
      );
      // Verify it created a markdown tab, not an editor tab
      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      const tab = region.tabs.find(
        (t) => t.editorFilePath === "/Users/me/README.md",
      );
      expect(tab).toBeDefined();
      expect(tab!.type).toBe("markdown");
    });

    it("routes .markdown files to addMarkdownTab", () => {
      act(() => {
        useLayoutStore
          .getState()
          .addEditorTab(undefined, "/Users/me/NOTES.markdown");
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      const tab = region.tabs.find(
        (t) => t.editorFilePath === "/Users/me/NOTES.markdown",
      );
      expect(tab).toBeDefined();
      expect(tab!.type).toBe("markdown");
    });

    it("routes .csv files to addCsvTab", () => {
      act(() => {
        useLayoutStore.getState().addEditorTab(undefined, "/Users/me/data.csv");
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      const tab = region.tabs.find(
        (t) => t.editorFilePath === "/Users/me/data.csv",
      );
      expect(tab).toBeDefined();
      expect(tab!.type).toBe("csv");
    });

    it("routes .ts files to regular editor tab", () => {
      act(() => {
        useLayoutStore.getState().addEditorTab(undefined, "/Users/me/app.ts");
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      const tab = region.tabs.find(
        (t) => t.editorFilePath === "/Users/me/app.ts",
      );
      expect(tab).toBeDefined();
      expect(tab!.type).toBe("editor");
    });

    it("uses text mode for .md when forceText is true", () => {
      act(() => {
        useLayoutStore
          .getState()
          .addEditorTab(undefined, "/Users/me/README.md", undefined, true);
      });

      const state = useLayoutStore.getState();
      const region = state.regions[state.focusedRegionId];
      const tab = region.tabs.find(
        (t) => t.editorFilePath === "/Users/me/README.md",
      );
      expect(tab).toBeDefined();
      expect(tab!.type).toBe("editor");
    });
  });
});
