/**
 * Accessibility tests for the App component.
 *
 * Verifies semantic HTML structure and ARIA attributes.
 * Updated for Issue #3: App now renders a terminal instead of the greet form.
 *
 * Tags: [COVERAGE], [AC-2]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";

// Mock Tauri APIs
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

describe("App — Accessibility", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(vi.fn());
  });

  /**
   * [COVERAGE] The main container uses semantic <main> element,
   * which is critical for screen readers to identify the primary content.
   */
  it("uses semantic <main> element as app container", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(<App />);

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
  });

  /**
   * [COVERAGE] Loading state is visible and descriptive for screen readers.
   */
  it("loading state has descriptive text", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(<App />);

    const loading = screen.getByTestId("app-loading");
    expect(loading).toHaveTextContent("Starting terminal");
  });

  /**
   * [COVERAGE] Error state has a heading for screen reader navigation.
   */
  it("error state has heading and descriptive text", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("test error"));

    render(<App />);

    await waitFor(() => {
      const heading = screen.getByRole("heading", { level: 2 });
      expect(heading).toHaveTextContent("Failed to Start Terminal");
    });
  });

  /**
   * [COVERAGE] Retry button has type="button" (not submit) and accessible name.
   */
  it("retry button is accessible", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("test error"));

    render(<App />);

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Retry" });
      expect(button).toHaveAttribute("type", "button");
    });
  });

  /**
   * [COVERAGE] Terminal wrapper is rendered with test ID for automation.
   */
  it("terminal container is present after successful spawn", async () => {
    mockInvoke.mockResolvedValueOnce("session-123");

    render(<App />);

    await waitFor(() => {
      const wrapper = screen.getByTestId("terminal-wrapper");
      expect(wrapper).toBeInTheDocument();
    });
  });
});
