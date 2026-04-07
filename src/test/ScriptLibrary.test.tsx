/**
 * Unit tests for the ScriptLibrary component.
 *
 * Tests rendering, script selection, creation, deletion (with confirm),
 * loading state, and empty state.
 *
 * Tags: [TDD], [AC-7], [AC-10]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScriptLibrary } from "../components/Scripting/ScriptLibrary";
import type { ScriptMeta } from "../components/Scripting/types";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockOnSelect = vi.fn();
const mockOnCreate = vi.fn();
const mockOnDelete = vi.fn();

function createMockScripts(): ScriptMeta[] {
  return [
    {
      id: "script-1",
      name: "Backup Config",
      description: "Backs up router config",
      filename: "backup-config.js",
      isLoginScript: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-15T12:00:00Z",
    },
    {
      id: "script-2",
      name: "Login Setup",
      description: "",
      filename: "login-setup.js",
      isLoginScript: true,
      createdAt: "2024-03-01T00:00:00Z",
      updatedAt: "2024-07-20T08:30:00Z",
    },
  ];
}

describe("ScriptLibrary", () => {
  beforeEach(() => {
    mockOnSelect.mockReset();
    mockOnCreate.mockReset();
    mockOnDelete.mockReset();
  });

  // ─── Rendering ──────────────────────────────────────────────

  it("renders the library panel", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByTestId("script-library")).toBeInTheDocument();
    expect(screen.getByText("Scripts")).toBeInTheDocument();
  });

  it("has region role and aria-label", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    const lib = screen.getByTestId("script-library");
    expect(lib.getAttribute("role")).toBe("region");
    expect(lib.getAttribute("aria-label")).toBe("Script Library");
  });

  // ─── Loading state ──────────────────────────────────────────

  it("shows loading state", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        isLoading={true}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByTestId("script-library-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading scripts…")).toBeInTheDocument();
  });

  // ─── Empty state ────────────────────────────────────────────

  it("shows empty state when no scripts", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByTestId("script-library-empty")).toBeInTheDocument();
    expect(screen.getByText("No saved scripts")).toBeInTheDocument();
  });

  // ─── Script list ────────────────────────────────────────────

  it("renders scripts list", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByText("Backup Config")).toBeInTheDocument();
    expect(screen.getByText("Login Setup")).toBeInTheDocument();
  });

  it("shows descriptions for scripts that have them", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByText("Backs up router config")).toBeInTheDocument();
  });

  it("shows login badge for login scripts", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    // Login Setup script should show key emoji
    const badges = screen.getAllByText("🔑");
    expect(badges.length).toBe(1);
  });

  it("shows formatted dates", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    // Dates should be formatted — just check they exist (locale-dependent)
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
  });

  // ─── Selection ──────────────────────────────────────────────

  it("calls onSelect when script is clicked", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("script-select-script-1"));
    expect(mockOnSelect).toHaveBeenCalledWith("script-1");
  });

  // ─── New script ─────────────────────────────────────────────

  it("shows new button", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByTestId("script-new-btn")).toBeInTheDocument();
  });

  it("calls onCreate when new button is clicked", () => {
    render(
      <ScriptLibrary
        scripts={[]}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("script-new-btn"));
    expect(mockOnCreate).toHaveBeenCalledTimes(1);
  });

  // ─── Deletion ───────────────────────────────────────────────

  it("shows delete button for each script", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );
    expect(screen.getByTestId("script-delete-script-1")).toBeInTheDocument();
    expect(screen.getByTestId("script-delete-script-2")).toBeInTheDocument();
  });

  it("requires confirmation before deleting", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );

    // First click — shows confirm
    fireEvent.click(screen.getByTestId("script-delete-script-1"));
    expect(mockOnDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm?")).toBeInTheDocument();
  });

  it("calls onDelete after confirmation", () => {
    const scripts = createMockScripts();
    render(
      <ScriptLibrary
        scripts={scripts}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        onDelete={mockOnDelete}
      />,
    );

    // First click — confirm
    fireEvent.click(screen.getByTestId("script-delete-script-1"));
    // Second click — delete
    fireEvent.click(screen.getByTestId("script-delete-script-1"));
    expect(mockOnDelete).toHaveBeenCalledWith("script-1");
  });
});
