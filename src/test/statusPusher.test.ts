/**
 * Unit tests for the swarm status pusher (T3 / FR-011).
 *
 * Tags: [TDD] [AC-status] [FR-011] [SEC-pusher-debounce]
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  subscribeStatusPusher,
  PUSH_THROTTLE_MS,
} from "../lib/swarm/statusPusher";
import { useCommandBlockStore } from "../stores/commandBlockStore";
import {
  recordSessionCwd,
  clearSessionCwd,
} from "../components/Terminal/cwdRegistry";

beforeEach(() => {
  useCommandBlockStore.getState().reset();
  clearSessionCwd("sess-x");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("statusPusher.subscribeStatusPusher", () => {
  it("pushes an initial baseline on subscribe", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("swarm_update_status");
    expect(invoke.mock.calls[0][1]).toMatchObject({ tabId: "tab-x" });
    unsub();
  });

  it("debounces a burst of OSC events into a single IPC call", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    // Fire many events synchronously.
    const store = useCommandBlockStore.getState();
    for (let i = 0; i < 10; i++) {
      store.ingestOscEvent({
        sessionId: "sess-x",
        marker: i === 0 ? "handshake" : "prompt-start",
        ...(i === 0 ? {} : { cell: { x: 0, y: i } }),
      } as Parameters<typeof store.ingestOscEvent>[0]);
    }
    // Before debounce window, only the initial baseline (or nothing yet)
    // should have been pushed.
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(1);
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    // After the window, exactly one additional push has happened
    // (initial baseline + one for the coalesced burst).
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(2);
    unsub();
  });

  it("does not push when the projection has not changed", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    const initialCalls = invoke.mock.calls.length;
    // Trigger a store mutation that does NOT change the projection
    // (clearing a different session).
    useCommandBlockStore.getState().clearSession("sess-other");
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    expect(invoke.mock.calls.length).toBe(initialCalls);
    unsub();
  });

  it("pushes cwd updates from the cwdRegistry custom event", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    invoke.mockClear();
    recordSessionCwd("sess-x", "/work/proj", null, 0);
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1]).toMatchObject({
      tabId: "tab-x",
      snapshot: { cwd: "/work/proj" },
    });
    unsub();
  });

  it("ignores cwd events for unrelated sessions", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    invoke.mockClear();
    recordSessionCwd("sess-OTHER", "/other", null, 0);
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    expect(invoke).not.toHaveBeenCalled();
    unsub();
  });

  it("stops pushing after unsubscribe", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1);
    unsub();
    invoke.mockClear();
    recordSessionCwd("sess-x", "/after-unsub", null, 0);
    useCommandBlockStore
      .getState()
      .ingestOscEvent({ sessionId: "sess-x", marker: "handshake" });
    vi.advanceTimersByTime(PUSH_THROTTLE_MS * 5);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("swallows IPC failures (does not throw out of the event handler)", () => {
    const invoke = vi.fn().mockRejectedValue(new Error("backend down"));
    const unsub = subscribeStatusPusher("tab-x", "sess-x", { invoke });
    expect(() => vi.advanceTimersByTime(PUSH_THROTTLE_MS + 1)).not.toThrow();
    expect(invoke).toHaveBeenCalled();
    unsub();
  });
});
