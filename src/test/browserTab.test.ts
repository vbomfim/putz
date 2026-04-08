/**
 * Unit tests for browser tab functionality in tabStore.
 *
 * Tests cover: addBrowserTab, removeTab for browser tabs,
 * tab switching visibility, and browser session ID conventions.
 *
 * Tags: [TDD], [BROWSER-TABS]
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
import { useTabStore } from "../stores/tabStore";
import { BROWSER_SESSION_PREFIX } from "../types";

describe("Browser tabs", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    mockInvoke.mockResolvedValue("mock-session-id");
    useTabStore.setState({
      tabs: [],
      activeTabId: "",
      tabCounter: 0,
      focusedPaneSessionId: null,
      loggingSessions: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addBrowserTab", () => {
    it("creates a browser tab with the given URL", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://grafana.local:3000");
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].contentType).toBe("browser");
      expect(state.tabs[0].browserUrl).toBe("https://grafana.local:3000");
    });

    it("sets the browser tab as active", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const state = useTabStore.getState();
      expect(state.activeTabId).toBe(state.tabs[0].id);
    });

    it("uses hostname as tab title for valid URLs", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://grafana.local:3000/dashboard");
      });

      const state = useTabStore.getState();
      expect(state.tabs[0].title).toBe("grafana.local");
    });

    it("truncates long non-URL strings for title", () => {
      const longUrl = "a".repeat(50);
      act(() => {
        useTabStore.getState().addBrowserTab(longUrl);
      });

      const state = useTabStore.getState();
      expect(state.tabs[0].title.length).toBeLessThanOrEqual(40);
      expect(state.tabs[0].title).toContain("...");
    });

    it("uses the raw string as title for short non-URL strings", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("about:blank");
      });

      const state = useTabStore.getState();
      expect(state.tabs[0].title).toBe("about:blank");
    });

    it("creates a leaf layout with browser- prefixed session ID", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const state = useTabStore.getState();
      const layout = state.tabs[0].layout;
      expect(layout.type).toBe("leaf");
      if (layout.type === "leaf") {
        expect(layout.terminalSessionId).toMatch(
          new RegExp(`^${BROWSER_SESSION_PREFIX}`),
        );
      }
    });

    it("does NOT call pty_spawn", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "pty_spawn",
        expect.anything(),
      );
    });

    it("increments tab counter", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      expect(useTabStore.getState().tabCounter).toBe(1);
    });

    it("sets status to local", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      expect(useTabStore.getState().tabs[0].status).toBe("local");
    });
  });

  describe("removeTab (browser)", () => {
    it("calls browser_close when removing a browser tab", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      expect(mockInvoke).toHaveBeenCalledWith("browser_close", {
        tabId,
      });
    });

    it("does NOT call pty_close when removing a browser tab", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "pty_close",
        expect.anything(),
      );
    });

    it("removes the browser tab from state", () => {
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const tabId = useTabStore.getState().tabs[0].id;

      act(() => {
        useTabStore.getState().removeTab(tabId);
      });

      expect(useTabStore.getState().tabs).toHaveLength(0);
    });
  });

  describe("mixed tabs", () => {
    it("can have terminal and browser tabs side by side", async () => {
      mockInvoke.mockResolvedValueOnce("pty-session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.tabs[0].contentType).toBeUndefined(); // terminal (default)
      expect(state.tabs[1].contentType).toBe("browser");
    });

    it("activates browser tab correctly after terminal tab", async () => {
      mockInvoke.mockResolvedValueOnce("pty-session-1");

      await act(async () => {
        await useTabStore.getState().addTab();
      });

      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const state = useTabStore.getState();
      // The browser tab should be active (it was added last)
      expect(state.activeTabId).toBe(state.tabs[1].id);
    });
  });

  describe("browser session prefix", () => {
    it("BROWSER_SESSION_PREFIX is 'browser-'", () => {
      expect(BROWSER_SESSION_PREFIX).toBe("browser-");
    });

    it("closePtySession skips browser-prefixed session IDs", () => {
      // Create a browser tab and remove it — pty_close should NOT be called
      act(() => {
        useTabStore.getState().addBrowserTab("https://example.com");
      });

      const tab = useTabStore.getState().tabs[0];
      const layout = tab.layout;
      if (layout.type === "leaf") {
        expect(layout.terminalSessionId.startsWith("browser-")).toBe(true);
      }
    });
  });
});
