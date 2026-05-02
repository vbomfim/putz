/**
 * SessionSidebar component tests.
 *
 * Tags: [AC-2], [AC-9], [TDD]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the Tauri invoke API
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Import after mocking
import { SessionSidebar } from "../components/SessionManager/SessionSidebar";

describe("SessionSidebar", () => {
  let onSessionOpen: ReturnType<typeof vi.fn>;
  let onToggle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSessionOpen = vi.fn();
    onToggle = vi.fn();
    mockInvoke.mockReset().mockResolvedValue([]);
  });

  // ─── Visibility ──────────────────────────────────────────

  it("renders nothing when closed", () => {
    render(
      <SessionSidebar
        isOpen={false}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    expect(screen.queryByTestId("session-sidebar")).not.toBeInTheDocument();
  });

  it("renders sidebar when open", () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    expect(screen.getByTestId("session-sidebar")).toBeInTheDocument();
  });

  it("has Sessions title", () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });

  it("has ARIA label", () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    expect(screen.getByLabelText("Session Manager")).toBeInTheDocument();
  });

  // ─── Close button ────────────────────────────────────────

  it("calls onToggle when close button clicked", async () => {
    const user = userEvent.setup();
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );

    const closeBtn = screen.getByTestId("session-sidebar-close");
    await user.click(closeBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  // ─── Search ──────────────────────────────────────────────

  it("renders search input", () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    expect(screen.getByTestId("session-search")).toBeInTheDocument();
  });

  // ─── Add button ──────────────────────────────────────────

  it("renders add session button", () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );
    const addBtn = screen.getByTestId("session-add-btn");
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).toHaveTextContent("+ New Session");
  });

  it("opens editor when add button clicked", async () => {
    const user = userEvent.setup();
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );

    await user.click(screen.getByTestId("session-add-btn"));
    expect(screen.getByTestId("session-editor")).toBeInTheDocument();
  });

  // ─── Loads tree on mount ─────────────────────────────────

  it("calls session_list on mount when open", async () => {
    render(
      <SessionSidebar
        isOpen={true}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );

    // Wait for effect
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_list");
    });
  });

  // ─── Keyboard shortcut ────────────────────────────────────

  it("toggles on Ctrl+B", async () => {
    const user = userEvent.setup();
    render(
      <SessionSidebar
        isOpen={false}
        onToggle={onToggle}
        onSessionOpen={onSessionOpen}
      />,
    );

    await user.keyboard("{Control>}b{/Control}");
    expect(onToggle).toHaveBeenCalled();
  });
});
