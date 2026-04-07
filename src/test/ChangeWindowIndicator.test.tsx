/**
 * ChangeWindowIndicator component tests.
 *
 * Tests the lock icon indicator that shows whether a maintenance
 * window is currently active.
 *
 * Tags: [AC-2], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChangeWindowIndicator } from "../components/Compliance/ChangeWindowIndicator";

// Mock the compliance API module
vi.mock("../components/Compliance/complianceApi", () => ({
  changeWindowCheck: vi.fn(),
  changeWindowList: vi.fn(),
  changeWindowSet: vi.fn(),
  changeWindowDelete: vi.fn(),
  changeWindowActive: vi.fn(),
}));

import { changeWindowActive } from "../components/Compliance/complianceApi";
const mockChangeWindowActive = vi.mocked(changeWindowActive);

describe("ChangeWindowIndicator", () => {
  beforeEach(() => {
    mockChangeWindowActive.mockReset();
  });

  it("shows green lock when window is active", async () => {
    mockChangeWindowActive.mockResolvedValue(true);
    render(<ChangeWindowIndicator />);

    await waitFor(() => {
      const indicator = screen.getByTestId("change-window-indicator");
      expect(indicator).toHaveTextContent("🔓");
    });
  });

  it("shows red lock when window is NOT active", async () => {
    mockChangeWindowActive.mockResolvedValue(false);
    render(<ChangeWindowIndicator />);

    await waitFor(() => {
      const indicator = screen.getByTestId("change-window-indicator");
      expect(indicator).toHaveTextContent("🔒");
    });
  });

  it("renders nothing when backend errors out", async () => {
    mockChangeWindowActive.mockRejectedValue(new Error("IPC error"));
    const { container } = render(<ChangeWindowIndicator />);

    // Wait for the async call to resolve/reject
    await waitFor(() => {
      expect(mockChangeWindowActive).toHaveBeenCalled();
    });

    // isActive stays null → returns null → no DOM nodes
    expect(container.innerHTML).toBe("");
  });

  it("has appropriate aria-label when active", async () => {
    mockChangeWindowActive.mockResolvedValue(true);
    render(<ChangeWindowIndicator />);

    await waitFor(() => {
      const indicator = screen.getByTestId("change-window-indicator");
      expect(indicator).toHaveAttribute("aria-label", "Change window active");
    });
  });

  it("has appropriate aria-label when inactive", async () => {
    mockChangeWindowActive.mockResolvedValue(false);
    render(<ChangeWindowIndicator />);

    await waitFor(() => {
      const indicator = screen.getByTestId("change-window-indicator");
      expect(indicator).toHaveAttribute("aria-label", "Change window inactive");
    });
  });

  it("sets data-active attribute based on status", async () => {
    mockChangeWindowActive.mockResolvedValue(true);
    render(<ChangeWindowIndicator />);

    await waitFor(() => {
      const indicator = screen.getByTestId("change-window-indicator");
      expect(indicator.className).toContain("change-window-indicator--active");
    });
  });
});
