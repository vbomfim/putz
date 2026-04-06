/**
 * Integration tests for App component user interactions.
 *
 * Tests the terminal lifecycle: spawn, error handling, and retry flow.
 * Updated for Issue #3: App now renders a terminal instead of the greet form.
 *
 * Tags: [BOUNDARY], [EDGE], [CONTRACT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Mock module — re-declared per file so each test file is independent
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

describe("App — User Interaction Flow", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  /**
   * [BOUNDARY] Tests the complete spawn flow:
   * App mounts → calls pty_spawn → renders terminal with session ID.
   */
  it("spawns PTY session on mount and renders terminal", async () => {
    mockInvoke.mockResolvedValueOnce("session-abc-123");

    render(<App />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });

    await waitFor(() => {
      const wrapper = screen.getByTestId("terminal-wrapper");
      expect(wrapper).toBeInTheDocument();
    });
  });

  /**
   * [CONTRACT] Verifies pty_spawn is called exactly once on initial mount.
   */
  it("calls pty_spawn exactly once on mount", async () => {
    mockInvoke.mockResolvedValueOnce("session-id");

    render(<App />);

    await waitFor(() => {
      const spawnCalls = mockInvoke.mock.calls.filter(
        (call: unknown[]) => call[0] === "pty_spawn",
      );
      expect(spawnCalls).toHaveLength(1);
    });
  });

  /**
   * [EDGE] Tests error state when PTY spawn fails.
   * User should see an error message with a retry button.
   */
  it("shows error and retry when pty_spawn fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("No shell found"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("app-error")).toBeInTheDocument();
      expect(screen.getByText(/Failed to Start Terminal/)).toBeInTheDocument();
      expect(screen.getByText(/No shell found/)).toBeInTheDocument();
    });
  });

  /**
   * [BOUNDARY] Tests the retry flow:
   * Spawn fails → user clicks Retry → spawn is called again.
   */
  it("retries pty_spawn when user clicks Retry after error", async () => {
    const user = userEvent.setup();

    // First call fails, second succeeds
    mockInvoke
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockResolvedValueOnce("new-session-id");

    render(<App />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByTestId("app-error")).toBeInTheDocument();
    });

    // Click retry
    const retryButton = screen.getByRole("button", { name: "Retry" });
    await user.click(retryButton);

    // Should call pty_spawn again (2 spawn calls total, plus potential pty_resize/pty_close)
    await waitFor(() => {
      const spawnCalls = mockInvoke.mock.calls.filter(
        (call: unknown[]) => call[0] === "pty_spawn",
      );
      expect(spawnCalls).toHaveLength(2);
    });

    // Should now show terminal
    await waitFor(() => {
      const wrapper = screen.getByTestId("terminal-wrapper");
      expect(wrapper).toBeInTheDocument();
    });
  });

  /**
   * [EDGE] Tests loading → terminal transition.
   * Loading state should disappear once the terminal is ready.
   */
  it("transitions from loading to terminal", async () => {
    let resolveSpawn: (value: string) => void;
    mockInvoke.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveSpawn = resolve;
      }),
    );

    render(<App />);

    // Should be in loading state
    expect(screen.getByTestId("app-loading")).toBeInTheDocument();

    // Resolve the spawn
    resolveSpawn!("session-id");

    // Should transition to terminal
    await waitFor(() => {
      expect(screen.getByTestId("terminal-wrapper")).toBeInTheDocument();
    });
  });
});
