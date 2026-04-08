/**
 * Edge case tests for the App component with tabbed UI.
 *
 * Tests empty state, multi-tab management, and UI state transitions
 * specific to the tabbed architecture (Issue #5).
 *
 * Tags: [EDGE], [COVERAGE], [AC-1], [AC-2]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useLayoutStore } from "../stores/layoutStore";

// --- Mock Tauri APIs ---

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
  const AllotmentComponent = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="allotment-container">{children}</div>
  );

  AllotmentComponent.Pane = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return { Allotment: AllotmentComponent };
});

vi.mock("allotment/dist/style.css", () => ({}));

describe("App — Edge Cases (Tabbed UI)", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    useLayoutStore.setState({ layout: { type: "region", regionId: "region-1" }, regions: { "region-1": { id: "region-1", tabs: [], activeTabId: "" } }, focusedRegionId: "region-1" });
  });

  /**
   * [EDGE] App creates exactly one tab on mount.
   */
  it("creates exactly one tab on initial mount", async () => {
    mockInvoke.mockResolvedValueOnce("session-1");

    render(<App />);

    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(1);
    });
  });

  /**
   * [EDGE] Adding a new tab via the + button creates a second tab.
   */
  it("adds a new tab when + button is clicked", async () => {
    const user = userEvent.setup();
    mockInvoke
      .mockResolvedValueOnce("session-1") // initial tab
      .mockResolvedValueOnce("session-2"); // new tab

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
});

describe("App — Session Management (Tabbed UI)", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    useLayoutStore.setState({ layout: { type: "region", regionId: "region-1" }, regions: { "region-1": { id: "region-1", tabs: [], activeTabId: "" } }, focusedRegionId: "region-1" });
  });

  /**
   * [CONTRACT] [AC-1] pty_spawn is called for the initial tab.
   */
  it("calls pty_spawn for the initial tab", async () => {
    mockInvoke.mockResolvedValueOnce("session-abc");

    render(<App />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
        cols: 80,
        rows: 24,
      });
    });
  });
});
