/**
 * Integration tests for session logging — tabStore ↔ IPC contract.
 *
 * Tests the full toggleLogging flow: user action → Zustand state → IPC call,
 * including optimistic update, rollback on failure, and indicator state.
 *
 * Tags: [AC-1], [AC-7], [EDGE], [BOUNDARY], [INTEGRATION]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Import after mocks
import { useTabStore } from "../stores/tabStore";
import type { Tab } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────

/** Creates a minimal tab with a given session ID. */
function makeTab(id: string, sessionId: string, title = "Terminal 1"): Tab {
  return {
    id,
    title,
    layout: { type: "leaf", terminalSessionId: sessionId },
    status: "local",
    createdAt: Date.now(),
  };
}

/** Resets Zustand store to a clean state with optional tabs. */
function resetStore(tabs: Tab[] = [], activeTabId = "") {
  useTabStore.setState({
    tabs,
    activeTabId,
    tabCounter: tabs.length,
    isSearchOpen: false,
    loggingSessions: new Set<string>(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Logging Integration", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
    mockInvoke.mockResolvedValue(undefined);
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── AC-7: Manual log toggle ─────────────────────────────────────────

  describe("toggleLogging — start [AC-7]", () => {
    it("adds session to loggingSessions and calls logging_start IPC", async () => {
      const tab = makeTab("tab-1", "session-abc", "My Session");
      resetStore([tab], "tab-1");
      mockInvoke.mockResolvedValueOnce("/home/user/putz-logs/my-session.log");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        // Allow the IPC promise to resolve
        await new Promise((r) => setTimeout(r, 0));
      });

      const state = useTabStore.getState();
      expect(state.loggingSessions.has("session-abc")).toBe(true);

      // Verify IPC was called with correct args
      expect(mockInvoke).toHaveBeenCalledWith("logging_start", {
        sessionId: "session-abc",
        config: expect.objectContaining({
          sessionName: "my-session",
          timestamps: true,
          stripAnsi: true,
          maxFileSize: 100 * 1024 * 1024,
          flushIntervalMs: 100,
        }),
      });
    });

    it("[AC-7] sanitizes tab title for sessionName (spaces → single dash, lowercase)", async () => {
      const tab = makeTab("tab-1", "session-abc", "My  SSH   Server");
      resetStore([tab], "tab-1");
      mockInvoke.mockResolvedValueOnce("ok");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      // \\s+ replaces any run of whitespace with a single "-"
      expect(mockInvoke).toHaveBeenCalledWith("logging_start", {
        sessionId: "session-abc",
        config: expect.objectContaining({
          sessionName: "my-ssh-server",
        }),
      });
    });

    it("sends empty directory so Rust uses default ~/putz-logs/", async () => {
      const tab = makeTab("tab-1", "session-abc");
      resetStore([tab], "tab-1");
      mockInvoke.mockResolvedValueOnce("ok");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockInvoke).toHaveBeenCalledWith("logging_start", {
        sessionId: "session-abc",
        config: expect.objectContaining({
          directory: "",
        }),
      });
    });
  });

  describe("toggleLogging — stop [AC-7]", () => {
    it("removes session from loggingSessions and calls logging_stop IPC", async () => {
      const tab = makeTab("tab-1", "session-abc");
      resetStore([tab], "tab-1");

      // Pre-set as logging
      useTabStore.setState({
        loggingSessions: new Set(["session-abc"]),
      });

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      const state = useTabStore.getState();
      expect(state.loggingSessions.has("session-abc")).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith("logging_stop", {
        sessionId: "session-abc",
      });
    });
  });

  describe("toggleLogging — rollback on failure [EDGE]", () => {
    it("rolls back loggingSessions when logging_start IPC fails", async () => {
      const tab = makeTab("tab-1", "session-abc");
      resetStore([tab], "tab-1");
      mockInvoke.mockRejectedValueOnce(new Error("Disk full"));

      await act(async () => {
        useTabStore.getState().toggleLogging();
        // Wait for the catch to fire
        await new Promise((r) => setTimeout(r, 50));
      });

      const state = useTabStore.getState();
      // Should have been rolled back
      expect(state.loggingSessions.has("session-abc")).toBe(false);
    });

    it("logging_stop failure triggers rollback — session re-added to set", async () => {
      const tab = makeTab("tab-1", "session-abc");
      resetStore([tab], "tab-1");
      useTabStore.setState({
        loggingSessions: new Set(["session-abc"]),
      });
      mockInvoke.mockRejectedValueOnce(new Error("Not found"));

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 50));
      });

      // Session should be re-added to set after logging_stop failure (rollback)
      const state = useTabStore.getState();
      expect(state.loggingSessions.has("session-abc")).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe("toggleLogging — edge cases [EDGE]", () => {
    it("does nothing when no active tab exists", async () => {
      resetStore([], "");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(useTabStore.getState().loggingSessions.size).toBe(0);
    });

    it("does nothing when activeTabId points to non-existent tab", async () => {
      resetStore([], "non-existent-tab");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("uses first leaf session when tab has split panes", async () => {
      const tab: Tab = {
        id: "tab-1",
        title: "Split Tab",
        layout: {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "leaf", terminalSessionId: "session-left" },
            { type: "leaf", terminalSessionId: "session-right" },
          ],
          ratio: 0.5,
        },
        status: "local",
        createdAt: Date.now(),
      };
      resetStore([tab], "tab-1");
      mockInvoke.mockResolvedValueOnce("ok");

      await act(async () => {
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 0));
      });

      // Should target the first leaf (leftmost)
      expect(mockInvoke).toHaveBeenCalledWith("logging_start", {
        sessionId: "session-left",
        config: expect.objectContaining({
          sessionName: "split-tab",
        }),
      });
      expect(useTabStore.getState().loggingSessions.has("session-left")).toBe(
        true,
      );
    });

    it("rapid toggle on/off doesn't create duplicate IPC calls", async () => {
      const tab = makeTab("tab-1", "session-abc");
      resetStore([tab], "tab-1");
      mockInvoke.mockResolvedValue("ok");

      await act(async () => {
        // Toggle on
        useTabStore.getState().toggleLogging();
        // Immediately toggle off
        useTabStore.getState().toggleLogging();
        await new Promise((r) => setTimeout(r, 50));
      });

      // Should have called logging_start then logging_stop
      const calls = mockInvoke.mock.calls;
      const startCalls = calls.filter((c) => c[0] === "logging_start");
      const stopCalls = calls.filter((c) => c[0] === "logging_stop");
      expect(startCalls).toHaveLength(1);
      expect(stopCalls).toHaveLength(1);

      // Final state: logging OFF
      expect(useTabStore.getState().loggingSessions.has("session-abc")).toBe(
        false,
      );
    });
  });

  // ── setLogging & isLogging ──────────────────────────────────────────

  describe("setLogging / isLogging [AC-1]", () => {
    it("setLogging(id, true) adds session to Set", () => {
      resetStore();

      act(() => {
        useTabStore.getState().setLogging("session-xyz", true);
      });

      expect(useTabStore.getState().loggingSessions.has("session-xyz")).toBe(
        true,
      );
    });

    it("setLogging(id, false) removes session from Set", () => {
      resetStore();
      useTabStore.setState({
        loggingSessions: new Set(["session-xyz"]),
      });

      act(() => {
        useTabStore.getState().setLogging("session-xyz", false);
      });

      expect(useTabStore.getState().loggingSessions.has("session-xyz")).toBe(
        false,
      );
    });

    it("isLogging returns true for active sessions", () => {
      resetStore();
      useTabStore.setState({
        loggingSessions: new Set(["session-abc"]),
      });

      expect(useTabStore.getState().isLogging("session-abc")).toBe(true);
      expect(useTabStore.getState().isLogging("session-xyz")).toBe(false);
    });

    it("multiple sessions can be logged independently", () => {
      resetStore();

      act(() => {
        useTabStore.getState().setLogging("session-a", true);
        useTabStore.getState().setLogging("session-b", true);
      });

      expect(useTabStore.getState().isLogging("session-a")).toBe(true);
      expect(useTabStore.getState().isLogging("session-b")).toBe(true);

      act(() => {
        useTabStore.getState().setLogging("session-a", false);
      });

      expect(useTabStore.getState().isLogging("session-a")).toBe(false);
      expect(useTabStore.getState().isLogging("session-b")).toBe(true);
    });
  });

  // ── Search integration ──────────────────────────────────────────────

  describe("search store integration [AC-3]", () => {
    it("toggleSearch flips isSearchOpen state", () => {
      resetStore();
      expect(useTabStore.getState().isSearchOpen).toBe(false);

      act(() => {
        useTabStore.getState().toggleSearch();
      });
      expect(useTabStore.getState().isSearchOpen).toBe(true);

      act(() => {
        useTabStore.getState().toggleSearch();
      });
      expect(useTabStore.getState().isSearchOpen).toBe(false);
    });

    it("closeSearch always sets isSearchOpen to false", () => {
      resetStore();

      act(() => {
        useTabStore.getState().toggleSearch(); // Open
      });
      expect(useTabStore.getState().isSearchOpen).toBe(true);

      act(() => {
        useTabStore.getState().closeSearch();
      });
      expect(useTabStore.getState().isSearchOpen).toBe(false);

      // Calling closeSearch when already closed is a no-op
      act(() => {
        useTabStore.getState().closeSearch();
      });
      expect(useTabStore.getState().isSearchOpen).toBe(false);
    });
  });
});
