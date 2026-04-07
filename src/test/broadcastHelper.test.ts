/**
 * Unit tests for the broadcastWrite helper function.
 *
 * Tests cover: active/inactive broadcast, active tab check,
 * multi-target writes, connection_write for remote tabs,
 * edge cases (missing tabs, same session, non-active tab).
 *
 * Tags: [TDD], [AC-broadcast]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock Tauri event listener (required by tabStore)
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { broadcastWrite } from "../utils/broadcastHelper";
import { useBroadcastStore } from "../stores/broadcastStore";
import { useTabStore } from "../stores/tabStore";
import type { Tab } from "../types";

function createMockTab(
  id: string,
  sessionId: string,
  status: Tab["status"] = "local",
): Tab {
  return {
    id,
    title: `Tab ${id}`,
    layout: { type: "leaf", terminalSessionId: sessionId },
    status,
    createdAt: Date.now(),
  };
}

describe("broadcastWrite", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);

    // Reset stores
    useBroadcastStore.setState({
      isActive: false,
      targetTabIds: new Set<string>(),
    });
    useTabStore.setState({
      tabs: [],
      activeTabId: "",
      tabCounter: 0,
      loggingSessions: new Set<string>(),
    });
  });

  it("does nothing when broadcast is not active", () => {
    useBroadcastStore.setState({ isActive: false });

    broadcastWrite("session-1", [104, 105]); // "hi"

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when source session is not in the active tab", () => {
    const tab1 = createMockTab("tab-1", "session-1");
    const tab2 = createMockTab("tab-2", "session-2");

    useTabStore.setState({
      tabs: [tab1, tab2],
      activeTabId: "tab-1", // tab-1 is active
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-1"]),
    });

    // Sending from session-2 (which is in tab-2, NOT active)
    broadcastWrite("session-2", [104, 105]);

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when source session is not found in any tab", () => {
    const tab1 = createMockTab("tab-1", "session-1");

    useTabStore.setState({
      tabs: [tab1],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-1"]),
    });

    broadcastWrite("session-unknown", [104, 105]);

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("writes to all target tabs when broadcasting from the active tab", () => {
    const tab1 = createMockTab("tab-1", "session-1");
    const tab2 = createMockTab("tab-2", "session-2");
    const tab3 = createMockTab("tab-3", "session-3");

    useTabStore.setState({
      tabs: [tab1, tab2, tab3],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2", "tab-3"]),
    });

    const data = [104, 105]; // "hi"
    broadcastWrite("session-1", data);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      sessionId: "session-2",
      data,
    });
    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      sessionId: "session-3",
      data,
    });
  });

  it("uses connection_write for connected (remote) target tabs", () => {
    const tab1 = createMockTab("tab-1", "session-1", "local");
    const tab2 = createMockTab("tab-2", "session-2", "connected");

    useTabStore.setState({
      tabs: [tab1, tab2],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2"]),
    });

    const data = [108, 115]; // "ls"
    broadcastWrite("session-1", data);

    expect(mockInvoke).toHaveBeenCalledWith("connection_write", {
      sessionId: "session-2",
      data,
    });
  });

  it("uses pty_write for local target tabs", () => {
    const tab1 = createMockTab("tab-1", "session-1", "local");
    const tab2 = createMockTab("tab-2", "session-2", "local");

    useTabStore.setState({
      tabs: [tab1, tab2],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2"]),
    });

    broadcastWrite("session-1", [65]); // "A"

    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      sessionId: "session-2",
      data: [65],
    });
  });

  it("skips target tabs that no longer exist in the tab store", () => {
    const tab1 = createMockTab("tab-1", "session-1");

    useTabStore.setState({
      tabs: [tab1], // tab-2 doesn't exist
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2"]), // Stale reference
    });

    broadcastWrite("session-1", [65]);

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not double-write to the source session if it appears in targets", () => {
    const tab1 = createMockTab("tab-1", "session-1");

    useTabStore.setState({
      tabs: [tab1],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-1"]), // Target is also source
    });

    broadcastWrite("session-1", [65]);

    // Should skip because target session === source session
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("handles mixed local and remote targets in one broadcast", () => {
    const tab1 = createMockTab("tab-1", "session-1", "local");
    const tab2 = createMockTab("tab-2", "session-2", "connected");
    const tab3 = createMockTab("tab-3", "session-3", "local");
    const tab4 = createMockTab("tab-4", "session-4", "connected");

    useTabStore.setState({
      tabs: [tab1, tab2, tab3, tab4],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2", "tab-3", "tab-4"]),
    });

    broadcastWrite("session-1", [13]); // Enter key

    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith("connection_write", {
      sessionId: "session-2",
      data: [13],
    });
    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      sessionId: "session-3",
      data: [13],
    });
    expect(mockInvoke).toHaveBeenCalledWith("connection_write", {
      sessionId: "session-4",
      data: [13],
    });
  });

  it("silently handles invoke failures (fire-and-forget)", async () => {
    const tab1 = createMockTab("tab-1", "session-1");
    const tab2 = createMockTab("tab-2", "session-2");

    useTabStore.setState({
      tabs: [tab1, tab2],
      activeTabId: "tab-1",
    });
    useBroadcastStore.setState({
      isActive: true,
      targetTabIds: new Set(["tab-2"]),
    });

    mockInvoke.mockRejectedValueOnce(new Error("PTY write failed"));

    // Should not throw
    expect(() => broadcastWrite("session-1", [65])).not.toThrow();
  });
});
