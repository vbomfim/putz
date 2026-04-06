import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";

// Mock the Tauri invoke API — must always return a promise
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock Tauri event listener — listen returns an unlisten function
const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

describe("App", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    // Default: listen returns a no-op unlisten function
    mockListen.mockResolvedValue(vi.fn());
  });

  it("shows loading state initially before PTY spawns", () => {
    // Never resolve invoke — stays in loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(<App />);

    const loading = screen.getByTestId("app-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveTextContent("Starting terminal");
  });

  it("has the app-root test id on the main container", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(<App />);

    const root = screen.getByTestId("app-root");
    expect(root).toBeInTheDocument();
  });

  it("calls pty_spawn on mount with default dimensions", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });
  });

  it("renders terminal container after successful spawn", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      const container = screen.getByTestId("terminal-wrapper");
      expect(container).toBeInTheDocument();
    });
  });

  it("shows error state when pty_spawn fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Shell not found"));

    render(<App />);

    await waitFor(() => {
      const error = screen.getByTestId("app-error");
      expect(error).toBeInTheDocument();
      expect(error).toHaveTextContent("Failed to Start Terminal");
    });
  });

  it("shows retry button on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Shell not found"));

    render(<App />);

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Retry" });
      expect(button).toBeInTheDocument();
    });
  });
});

