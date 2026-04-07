/**
 * Integration tests for App component user interactions.
 *
 * Tests the tabbed terminal lifecycle: tab creation, tab switching, and terminal rendering.
 * Updated for Issue #5: App now renders a TabBar + SplitContainer.
 *
 * Tags: [BOUNDARY], [EDGE], [CONTRACT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useTabStore, resetTabCounter } from "../stores/tabStore";

// Mock module — re-declared per file so each test file is independent
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock allotment
vi.mock("allotment", () => {
  const AllotmentComponent = ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="allotment-container">{children}</div>;

  AllotmentComponent.Pane = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return { Allotment: AllotmentComponent };
});

vi.mock("allotment/dist/style.css", () => ({}));

describe("App — User Interaction Flow (Tabbed UI)", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    useTabStore.setState({ tabs: [], activeTabId: "" });
    resetTabCounter();
  });

  /**
   * [BOUNDARY] Tests the complete spawn flow:
   * App mounts → calls addTab → tab renders with terminal.
   */
  it("creates initial tab on mount and renders terminal", async () => {
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
   * [BOUNDARY] Adding a second tab shows two tabs.
   */
  it("shows two tabs after clicking add", async () => {
    const user = userEvent.setup();
    mockInvoke
      .mockResolvedValueOnce("session-1")
      .mockResolvedValueOnce("session-2");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("tab")).toBeInTheDocument();
    });

    const addBtn = screen.getByLabelText("New tab");
    await user.click(addBtn);

    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
    });
  });

  /**
   * [BOUNDARY] Clicking a tab activates it.
   */
  it("clicking a tab switches the active tab", async () => {
    const user = userEvent.setup();
    mockInvoke
      .mockResolvedValueOnce("session-1")
      .mockResolvedValueOnce("session-2");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("tab")).toBeInTheDocument();
    });

    // Add second tab
    const addBtn = screen.getByLabelText("New tab");
    await user.click(addBtn);

    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
    });

    // Click first tab
    const tabs = screen.getAllByRole("tab");
    await user.click(tabs[0]);

    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });
});
