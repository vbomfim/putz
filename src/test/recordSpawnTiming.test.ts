/**
 * Unit tests for recordSpawnTiming (perf instrumentation).
 *
 * Tests cover:
 * - No-op when perf_enabled returns false
 * - Listens for pty-perf event when perf is enabled
 * - One-shot: unlisten after matching session event
 *
 * checkPerfEnabled() caches its result at module level. To exercise
 * both perf=on and perf=off in the same file we call `vi.resetModules()`
 * before each `it` and dynamically re-import the module under test —
 * which is `../utils/recordSpawnTiming`, NOT `../stores/tabStore`. The
 * old test imported tabStore through `vi.doMock` + a dynamic import;
 * because tabStore pulls in the entire Terminal barrel (xterm, monaco,
 * a tabStore↔useTerminal cycle), that dynamic import hung after
 * `vi.resetModules()`. Extracting recordSpawnTiming into its own module
 * (commit accompanying this test rewrite) lets us reset only the timer
 * cache and test the function directly.
 *
 * Tags: [TDD], [Fix-8]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mock fns — `vi.mock` factories run before any imports, so
// the captured refs must live in `vi.hoisted`.
const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

/** Drains microtasks + macrotask queue so the fire-and-forget
 *  recordSpawnTiming async block can observably reach its IPC calls
 *  before we assert. Using setTimeout(0) yields to the macrotask queue. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("recordSpawnTiming (perf disabled)", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not register listener when perf_enabled returns false", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "perf_enabled") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });

    const { recordSpawnTiming } = await import("../utils/recordSpawnTiming");
    recordSpawnTiming("session-perf-off", 0);

    // Flush the fire-and-forget async block.
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("perf_enabled");
    });
    await flushAsync();

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
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers pty-perf listener when perf_enabled returns true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "perf_enabled") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    const { recordSpawnTiming } = await import("../utils/recordSpawnTiming");
    recordSpawnTiming("session-perf-on", 0);

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
      if (cmd === "perf_enabled") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });

    const { recordSpawnTiming } = await import("../utils/recordSpawnTiming");
    recordSpawnTiming("session-abc12345", 0);

    // Wait for pty-perf listener to be registered
    await vi.waitFor(() => {
      const perfListenCalls = mockListen.mock.calls.filter(
        (call: unknown[]) => call[0] === "pty-perf",
      );
      expect(perfListenCalls).toHaveLength(1);
    });

    // Grab the callback that was registered
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
