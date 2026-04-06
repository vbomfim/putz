/**
 * Integration tests for terminal lifecycle management.
 *
 * Tests the data flow bridges between React components and Tauri IPC:
 * - PTY exit event → exit overlay UI [AC-1 edge case]
 * - listen() failure → error state [EDGE]
 * - Unmount → cleanup (pty_close, unlisten) [COVERAGE]
 * - Event listener setup with session-scoped names [BOUNDARY]
 * - Window resize handling [AC-4]
 *
 * These tests capture Tauri event callbacks to simulate backend events
 * and verify the frontend responds correctly.
 *
 * Tags: [BOUNDARY], [EDGE], [AC-1], [AC-4], [COVERAGE]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TerminalView } from "../components/Terminal/TerminalView";

// --- Mock Tauri IPC with callback capture ---

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Captured event listeners indexed by event name
type EventCallback = (event: { payload: unknown }) => void;
let capturedListeners: Map<string, EventCallback>;
let mockUnlistenFns: Array<ReturnType<typeof vi.fn>>;

const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// --- Helper to reset all mock state ---

function resetMocks() {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  capturedListeners = new Map();
  mockUnlistenFns = [];
  mockListen.mockReset().mockImplementation(
    (eventName: string, callback: EventCallback) => {
      capturedListeners.set(eventName, callback);
      const unlisten = vi.fn();
      mockUnlistenFns.push(unlisten);
      return Promise.resolve(unlisten);
    },
  );
}

// ============================================================
// PTY Exit Event → UI
// ============================================================

describe("Terminal Lifecycle — PTY Exit", () => {
  beforeEach(resetMocks);

  /**
   * [BOUNDARY] [AC-1] PTY exit event triggers exit overlay with restart button.
   *
   * Issue #3 edge case: "Shell process exits unexpectedly →
   * display 'Process exited with code N', offer restart"
   */
  it("shows exit overlay when PTY exit event fires", async () => {
    const onRestart = vi.fn();

    await act(async () => {
      render(
        <TerminalView sessionId="exit-test-session" onRestart={onRestart} />,
      );
    });

    // Wait for listeners to be set up
    await waitFor(() => {
      expect(capturedListeners.has("pty-exit-exit-test-session")).toBe(true);
    });

    // Fire exit event (code 1 = error exit)
    const exitHandler = capturedListeners.get("pty-exit-exit-test-session")!;
    act(() => {
      exitHandler({ payload: { code: 1 } });
    });

    // Exit overlay should appear with restart button
    await waitFor(() => {
      expect(screen.getByTestId("terminal-exit-overlay")).toBeInTheDocument();
      expect(screen.getByText("Restart Terminal")).toBeInTheDocument();
    });
  });

  /**
   * [BOUNDARY] Normal exit (code 0) also shows restart button.
   */
  it("shows exit overlay on normal exit (code 0)", async () => {
    await act(async () => {
      render(
        <TerminalView
          sessionId="normal-exit-session"
          onRestart={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(
        capturedListeners.has("pty-exit-normal-exit-session"),
      ).toBe(true);
    });

    act(() => {
      capturedListeners.get("pty-exit-normal-exit-session")!({
        payload: { code: 0 },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("terminal-exit-overlay")).toBeInTheDocument();
    });
  });

  /**
   * [EDGE] No exit overlay when onRestart is not provided.
   * TerminalView: {hasExited && onRestart && (...)}
   */
  it("does not show exit overlay without onRestart prop", async () => {
    await act(async () => {
      render(<TerminalView sessionId="no-restart-session" />);
    });

    await waitFor(() => {
      expect(
        capturedListeners.has("pty-exit-no-restart-session"),
      ).toBe(true);
    });

    act(() => {
      capturedListeners.get("pty-exit-no-restart-session")!({
        payload: { code: 0 },
      });
    });

    // Should NOT show overlay because onRestart is not provided
    expect(
      screen.queryByTestId("terminal-exit-overlay"),
    ).not.toBeInTheDocument();
  });

  /**
   * [COVERAGE] Clicking restart in exit overlay calls onRestart.
   */
  it("clicking restart calls onRestart callback", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();

    await act(async () => {
      render(
        <TerminalView
          sessionId="restart-click-session"
          onRestart={onRestart}
        />,
      );
    });

    await waitFor(() => {
      expect(
        capturedListeners.has("pty-exit-restart-click-session"),
      ).toBe(true);
    });

    act(() => {
      capturedListeners.get("pty-exit-restart-click-session")!({
        payload: { code: 0 },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Restart Terminal")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Restart Terminal"));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Event Listener Setup
// ============================================================

describe("Terminal Lifecycle — Event Listeners", () => {
  beforeEach(resetMocks);

  /**
   * [BOUNDARY] Registers session-scoped output and exit event listeners.
   * Event names must include the sessionId to isolate sessions.
   */
  it("registers output and exit listeners with sessionId in name", async () => {
    await act(async () => {
      render(<TerminalView sessionId="listener-test-id" />);
    });

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        "pty-output-listener-test-id",
        expect.any(Function),
      );
      expect(mockListen).toHaveBeenCalledWith(
        "pty-exit-listener-test-id",
        expect.any(Function),
      );
    });
  });

  /**
   * [COVERAGE] Unmount calls all unlisten functions (prevents memory leaks).
   */
  it("calls unlisten functions on unmount", async () => {
    let unmountFn: () => void;

    await act(async () => {
      const result = render(
        <TerminalView sessionId="cleanup-session" />,
      );
      unmountFn = result.unmount;
    });

    // Wait for listeners to register
    await waitFor(() => {
      expect(mockUnlistenFns.length).toBeGreaterThanOrEqual(2);
    });

    // Unmount
    act(() => {
      unmountFn!();
    });

    // All unlisten functions should have been called
    for (const unlisten of mockUnlistenFns) {
      expect(unlisten).toHaveBeenCalled();
    }
  });

  /**
   * [COVERAGE] Unmount calls pty_close to clean up the backend session.
   */
  it("calls pty_close on unmount", async () => {
    let unmountFn: () => void;

    await act(async () => {
      const result = render(
        <TerminalView sessionId="close-on-unmount" />,
      );
      unmountFn = result.unmount;
    });

    act(() => {
      unmountFn!();
    });

    expect(mockInvoke).toHaveBeenCalledWith("pty_close", {
      sessionId: "close-on-unmount",
    });
  });
});

// ============================================================
// Error Handling
// ============================================================

describe("Terminal Lifecycle — Error Handling", () => {
  beforeEach(resetMocks);

  /**
   * [EDGE] listen() failure → error state shown to user.
   * If the Tauri event system is unavailable, the user sees an error.
   */
  it("shows error when listen() rejects", async () => {
    mockListen.mockRejectedValue(new Error("Event system unavailable"));

    await act(async () => {
      render(<TerminalView sessionId="listen-fail-session" />);
    });

    await waitFor(() => {
      const error = screen.getByTestId("terminal-error");
      expect(error).toBeInTheDocument();
      expect(error).toHaveTextContent("Failed to set up terminal events");
    });
  });

  /**
   * [EDGE] Error state shows retry button when onRestart is provided.
   */
  it("error state shows retry button with onRestart", async () => {
    mockListen.mockRejectedValue(new Error("Network error"));

    await act(async () => {
      render(
        <TerminalView
          sessionId="error-retry-session"
          onRestart={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("terminal-error")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  /**
   * [EDGE] Error state shows helpful hint about shell availability.
   */
  it("error state includes troubleshooting hint", async () => {
    mockListen.mockRejectedValue(new Error("Failed"));

    await act(async () => {
      render(<TerminalView sessionId="error-hint-session" />);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Check that a shell is available/),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================
// Window Resize Handling
// ============================================================

describe("Terminal Lifecycle — Window Resize [AC-4]", () => {
  beforeEach(resetMocks);

  /**
   * [AC-4] Window resize event does not crash the terminal.
   * useTerminal adds window.addEventListener("resize", handleWindowResize).
   */
  it("handles window resize events without error", async () => {
    await act(async () => {
      render(<TerminalView sessionId="resize-session" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("terminal-wrapper")).toBeInTheDocument();
    });

    // Fire window resize — should not throw
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("terminal-wrapper")).toBeInTheDocument();
  });

  /**
   * [EDGE] [AC-4] 50 rapid resize events don't crash the terminal.
   * Real scenario: user dragging window edge rapidly.
   */
  it("handles rapid window resize events without crash", async () => {
    await act(async () => {
      render(<TerminalView sessionId="rapid-resize-session" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("terminal-wrapper")).toBeInTheDocument();
    });

    // Fire 50 resize events in quick succession
    act(() => {
      for (let i = 0; i < 50; i++) {
        window.dispatchEvent(new Event("resize"));
      }
    });

    expect(screen.getByTestId("terminal-wrapper")).toBeInTheDocument();
  });

  /**
   * [COVERAGE] Window resize listener is added on mount and removed on unmount.
   */
  it("adds and removes window resize listener", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    let unmountFn: () => void;

    await act(async () => {
      const result = render(
        <TerminalView sessionId="resize-cleanup-session" />,
      );
      unmountFn = result.unmount;
    });

    // Should have added a resize listener
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      unmountFn!();
    });

    // Should have removed the resize listener
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

// ============================================================
// Initial Size Sync
// ============================================================

describe("Terminal Lifecycle — Initial Size Sync", () => {
  beforeEach(resetMocks);

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * [AC-4] [COVERAGE] Initial PTY size sync fires pty_resize after 100ms delay.
   * useTerminal uses setTimeout(100ms) to wait for DOM to settle.
   */
  it("sends pty_resize after initial delay for size sync", async () => {
    vi.useFakeTimers();

    await act(async () => {
      render(<TerminalView sessionId="initial-size-session" />);
    });

    // Advance past the 100ms initial size sync delay
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // pty_resize should have been called for initial size sync
    const resizeCalls = mockInvoke.mock.calls.filter(
      (call: unknown[]) => call[0] === "pty_resize",
    );
    expect(resizeCalls.length).toBeGreaterThanOrEqual(1);

    // Should include the session ID and valid dimensions
    const lastResize = resizeCalls[resizeCalls.length - 1];
    expect(lastResize[1]).toMatchObject({
      sessionId: "initial-size-session",
      cols: expect.any(Number),
      rows: expect.any(Number),
    });
  });
});
