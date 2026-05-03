/**
 * Unit tests for recordSpawnTiming (perf instrumentation).
 *
 * Tests cover:
 * - No-op when perf_enabled returns false
 * - Listens for pty-perf event when perf is enabled
 * - One-shot: unlisten after matching session event
 *
 * NOTE: checkPerfEnabled() caches the result at module level, so only
 * the FIRST call per test file determines the perf state. Tests that
 * need perf=true run first, then perf=false tests verify via separate
 * assertions. Each describe block uses vi.resetModules() for isolation.
 *
 * Tags: [TDD], [Fix-8]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

// Shared mock references — reset per describe block via resetModules
let mockInvoke: ReturnType<typeof vi.fn>;
let mockListen: ReturnType<typeof vi.fn>;

describe("recordSpawnTiming (perf disabled)", () => {
  beforeEach(async () => {
    vi.resetModules();

    mockInvoke = vi.fn();
    mockListen = vi.fn().mockResolvedValue(vi.fn());

    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: (...args: unknown[]) => mockInvoke(...args),
    }));

    vi.doMock("@tauri-apps/api/event", () => ({
      listen: (...args: unknown[]) => mockListen(...args),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not register listener when perf_enabled returns false", async () => {
    // perf_enabled returns false
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn") return Promise.resolve("session-perf-off");
      if (cmd === "perf_enabled") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    const { useTabStore } = await import("../stores/tabStore");
    useTabStore.setState({ tabs: [], activeTabId: "", tabCounter: 0 });

    await act(async () => {
      await useTabStore.getState().addTab();
    });

    // Flush the async void recordSpawnTiming
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("perf_enabled");
    });

    // listen should NOT have been called for pty-perf
    const perfListenCalls = mockListen.mock.calls.filter(
      (call: unknown[]) => call[0] === "pty-perf",
    );
    expect(perfListenCalls).toHaveLength(0);
  });
});

describe("recordSpawnTiming (perf enabled)", () => {
  beforeEach(async () => {
    vi.resetModules();

    mockInvoke = vi.fn();
    mockListen = vi.fn().mockResolvedValue(vi.fn());

    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: (...args: unknown[]) => mockInvoke(...args),
    }));

    vi.doMock("@tauri-apps/api/event", () => ({
      listen: (...args: unknown[]) => mockListen(...args),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers pty-perf listener when perf_enabled returns true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn") return Promise.resolve("session-perf-on");
      if (cmd === "perf_enabled") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    const { useTabStore } = await import("../stores/tabStore");
    useTabStore.setState({ tabs: [], activeTabId: "", tabCounter: 0 });

    await act(async () => {
      await useTabStore.getState().addTab();
    });

    // Flush the async void recordSpawnTiming
    await vi.waitFor(() => {
      const perfListenCalls = mockListen.mock.calls.filter(
        (call: unknown[]) => call[0] === "pty-perf",
      );
      expect(perfListenCalls).toHaveLength(1);
    });
  });

  it("logs perf_log and unlistens on matching pty-perf event", async () => {
    const mockUnlisten = vi.fn();
    mockListen.mockResolvedValue(mockUnlisten);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "pty_spawn") return Promise.resolve("session-abc12345");
      if (cmd === "perf_enabled") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    const { useTabStore } = await import("../stores/tabStore");
    useTabStore.setState({ tabs: [], activeTabId: "", tabCounter: 0 });

    await act(async () => {
      await useTabStore.getState().addTab();
    });

    // Wait for pty-perf listener to be registered
    await vi.waitFor(() => {
      const perfListenCalls = mockListen.mock.calls.filter(
        (call: unknown[]) => call[0] === "pty-perf",
      );
      expect(perfListenCalls).toHaveLength(1);
    });

    // Get the callback that was registered
    const perfListenCall = mockListen.mock.calls.find(
      (call: unknown[]) => call[0] === "pty-perf",
    );
    const callback = perfListenCall![1] as (event: {
      payload: {
        sessionId: string;
        shell: string;
        validationMs: number;
        openptyMs: number;
        spawnToReadyMs: number;
        spawnToFirstByteMs: number;
      };
    }) => void;

    // Simulate a pty-perf event for a DIFFERENT session — should be ignored
    callback({
      payload: {
        sessionId: "other-session",
        shell: "zsh",
        validationMs: 0.01,
        openptyMs: 1.0,
        spawnToReadyMs: 3.0,
        spawnToFirstByteMs: 15.0,
      },
    });

    // unlisten should NOT have been called
    expect(mockUnlisten).not.toHaveBeenCalled();

    // Simulate a pty-perf event for the MATCHING session
    callback({
      payload: {
        sessionId: "session-abc12345",
        shell: "zsh",
        validationMs: 0.01,
        openptyMs: 1.0,
        spawnToReadyMs: 3.0,
        spawnToFirstByteMs: 15.0,
      },
    });

    // unlisten SHOULD have been called (one-shot)
    expect(mockUnlisten).toHaveBeenCalledTimes(1);

    // perf_log should have been called with the timing data
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "perf_log",
        expect.objectContaining({
          line: expect.stringContaining("frontend_pty_perf"),
        }),
      );
    });
  });
});
