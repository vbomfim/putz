/**
 * Accessibility tests for the App component.
 *
 * Verifies semantic HTML structure and ARIA attributes.
 * Updated for Issue #5: App now renders a tabbed UI with TabBar + SplitContainer.
 *
 * Tags: [COVERAGE], [AC-2]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { useLayoutStore } from "../stores/layoutStore";

// Mock Tauri APIs
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

describe("App — Accessibility", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
    // Reset layoutStore to empty region
    useLayoutStore.setState({
      layout: { type: "region", regionId: "region-1" },
      regions: {
        "region-1": { id: "region-1", tabs: [], activeTabId: "" },
      },
      focusedRegionId: "region-1",
    });
  });

  /**
   * [COVERAGE] The main container uses semantic <main> element,
   * which is critical for screen readers to identify the primary content.
   */
  it("uses semantic <main> element as app container", async () => {
    mockInvoke.mockResolvedValueOnce("session-1");

    render(<App />);

    await waitFor(() => {
      const main = screen.getByRole("main");
      expect(main).toBeInTheDocument();
    });
  });

  /**
   * [COVERAGE] Tab bar uses role="tablist" for screen readers.
   */
  it("tab bar has role tablist", async () => {
    mockInvoke.mockResolvedValueOnce("session-1");

    render(<App />);

    await waitFor(() => {
      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeInTheDocument();
    });
  });

  /**
   * [COVERAGE] Each tab uses role="tab" with aria-selected.
   */
  it("tab has role tab with aria-selected", async () => {
    mockInvoke.mockResolvedValueOnce("session-1");

    render(<App />);

    await waitFor(() => {
      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    });
  });

  /**
   * [COVERAGE] Add button has aria-label.
   */
  it("add tab button has accessible label", async () => {
    mockInvoke.mockResolvedValueOnce("session-1");

    render(<App />);

    await waitFor(() => {
      const addBtn = screen.getByLabelText("New tab");
      expect(addBtn).toBeInTheDocument();
    });
  });

  /**
   * [COVERAGE] Terminal container is present after successful spawn.
   */
  it("terminal container is present after successful spawn", async () => {
    mockInvoke.mockResolvedValueOnce("session-123");

    render(<App />);

    await waitFor(() => {
      const wrappers = screen.getAllByTestId("terminal-wrapper");
      expect(wrappers.length).toBeGreaterThanOrEqual(1);
    });
  });
});
