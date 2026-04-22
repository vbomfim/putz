/**
 * Unit tests for the App component with tabbed UI.
 *
 * Updated for Issue #5: App now renders a TabBar + SplitContainer
 * instead of a single terminal. Tab/PTY lifecycle is managed by tabStore.
 *
 * Tags: [COVERAGE], [AC-1]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { useLayoutStore } from "../stores/layoutStore";

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

// Mock allotment for split panes
vi.mock("allotment", () => {
  const AllotmentComponent = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="allotment-container">{children}</div>
  );

  AllotmentComponent.Pane = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return { Allotment: AllotmentComponent };
});

vi.mock("allotment/dist/style.css", () => ({}));

describe("App", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    const regionId = "region-init";
    useLayoutStore.setState({
      layout: { type: "region" as const, regionId },
      regions: {
        [regionId]: {
          id: regionId,
          tabs: [],
          activeTabId: "",
          tabPosition: "top" as const,
        },
      },
      focusedRegionId: regionId,
      tabCounter: 0,
    });
  });

  it("has the app-root test id on the main container", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      const root = screen.getByTestId("app-root");
      expect(root).toBeInTheDocument();
    });
  });

  it("calls pty_spawn on mount to create the first tab", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });
  });

  it("renders the tab bar", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeInTheDocument();
    });
  });

  it("renders a terminal after successful spawn", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      const wrappers = screen.getAllByTestId("terminal-wrapper");
      expect(wrappers.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders the add tab button", async () => {
    mockInvoke.mockResolvedValueOnce("test-session-id");

    render(<App />);

    await waitFor(() => {
      const addBtn = screen.getByLabelText("New Terminal");
      expect(addBtn).toBeInTheDocument();
    });
  });
});
