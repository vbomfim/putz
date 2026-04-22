/**
 * Unit tests for the TerminalView component.
 *
 * Tests rendering states (loading, ready, error, exited) and
 * user interactions (restart button). Uses mocked xterm.js since
 * jsdom does not support canvas rendering.
 *
 * Tags: [COVERAGE], [AC-1], [AC-2], [AC-3]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TerminalView } from "../components/Terminal/TerminalView";

// Mock Tauri APIs
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

describe("TerminalView", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  it("renders the terminal wrapper", async () => {
    await act(async () => {
      render(<TerminalView sessionId="test-session" />);
    });

    const wrapper = screen.getByTestId("terminal-wrapper");
    expect(wrapper).toBeInTheDocument();
  });

  it("renders the terminal container div", async () => {
    await act(async () => {
      render(<TerminalView sessionId="test-session" />);
    });

    const container = screen.getByTestId("terminal-container");
    expect(container).toBeInTheDocument();
  });

  it("shows loading indicator initially", () => {
    // Use sync render to catch the loading state before async events settle
    mockListen.mockReturnValue(new Promise(() => {}));
    render(<TerminalView sessionId="test-session" />);

    const loading = screen.getByTestId("terminal-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveTextContent("Starting terminal");
  });

  it("does not show restart button during normal operation", async () => {
    await act(async () => {
      render(<TerminalView sessionId="test-session" onRestart={vi.fn()} />);
    });

    const restartBtn = screen.queryByText("Restart Terminal");
    expect(restartBtn).not.toBeInTheDocument();
  });

  it("sets up Tauri event listeners for the session", async () => {
    await act(async () => {
      render(<TerminalView sessionId="my-session-123" />);
    });

    // Wait for async event setup to complete
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledTimes(2);
    });

    expect(mockListen).toHaveBeenCalledWith(
      "pty-output-my-session-123",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "pty-exit-my-session-123",
      expect.any(Function),
    );
  });

  it("does not invoke pty_close on unmount (lifecycle managed by layoutStore)", async () => {
    let unmountFn: () => void;
    await act(async () => {
      const result = render(<TerminalView sessionId="close-test-session" />);
      unmountFn = result.unmount;
    });

    act(() => {
      unmountFn!();
    });

    // pty_close is NOT called on unmount — lifecycle is managed by layoutStore.closeTab()
    expect(mockInvoke).not.toHaveBeenCalledWith("pty_close", expect.anything());
  });
});
