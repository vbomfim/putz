/**
 * Unit tests for the HighlightEditor component.
 *
 * Tests rendering, form validation, create/edit modes,
 * and built-in preset read-only behavior.
 *
 * Tags: [TDD], [AC-4], [AC-5]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HighlightEditor } from "../components/Terminal/HighlightEditor";
import type { HighlightSet } from "../components/Terminal/highlightTypes";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockOnSave = vi.fn();
const mockOnCancel = vi.fn();

function createMockHighlightSet(
  overrides: Partial<HighlightSet> = {},
): HighlightSet {
  return {
    id: "test-set",
    name: "Test Set",
    description: "A test highlight set",
    rules: [
      {
        id: "rule-1",
        pattern: "ERROR",
        matchType: "exact",
        foregroundColor: "#FF5555",
        backgroundColor: "",
        bold: true,
        underline: false,
        priority: 100,
      },
    ],
    isBuiltin: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("HighlightEditor", () => {
  beforeEach(() => {
    mockOnSave.mockReset();
    mockOnCancel.mockReset();
  });

  // ─── Rendering ──────────────────────────────────────────────

  it("renders in create mode", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    expect(screen.getByTestId("highlight-editor")).toBeInTheDocument();
    expect(screen.getByText("Create Highlight Set")).toBeInTheDocument();
  });

  it("renders in edit mode", () => {
    const set = createMockHighlightSet();
    render(
      <HighlightEditor
        highlightSet={set}
        onSave={mockOnSave}
        onCancel={mockOnCancel}
      />,
    );
    expect(screen.getByText("Edit Highlight Set")).toBeInTheDocument();
  });

  it("renders as read-only for built-in presets", () => {
    const set = createMockHighlightSet({ isBuiltin: true });
    render(
      <HighlightEditor
        highlightSet={set}
        onSave={mockOnSave}
        onCancel={mockOnCancel}
      />,
    );
    expect(screen.getByText("View Preset")).toBeInTheDocument();
    // Save button should not be present
    expect(screen.queryByTestId("highlight-save-btn")).not.toBeInTheDocument();
    // Close button instead of Cancel
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  // ─── Form fields ────────────────────────────────────────────

  it("shows name input", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    expect(screen.getByTestId("highlight-name-input")).toBeInTheDocument();
  });

  it("shows description input", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    expect(
      screen.getByTestId("highlight-description-input"),
    ).toBeInTheDocument();
  });

  it("pre-fills form in edit mode", () => {
    const set = createMockHighlightSet({
      name: "Cisco IOS",
      description: "Cisco patterns",
    });
    render(
      <HighlightEditor
        highlightSet={set}
        onSave={mockOnSave}
        onCancel={mockOnCancel}
      />,
    );
    const nameInput = screen.getByTestId(
      "highlight-name-input",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Cisco IOS");
    const descInput = screen.getByTestId(
      "highlight-description-input",
    ) as HTMLInputElement;
    expect(descInput.value).toBe("Cisco patterns");
  });

  it("shows rule fields", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    expect(screen.getByTestId("highlight-rule-0")).toBeInTheDocument();
    expect(screen.getByTestId("rule-pattern-input-0")).toBeInTheDocument();
    expect(screen.getByTestId("rule-matchtype-select-0")).toBeInTheDocument();
  });

  // ─── Rule management ────────────────────────────────────────

  it("can add a rule", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const addBtn = screen.getByTestId("highlight-add-rule-btn");
    fireEvent.click(addBtn);
    expect(screen.getByTestId("highlight-rule-1")).toBeInTheDocument();
  });

  it("can remove a rule when more than one exists", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    // Add a second rule first
    fireEvent.click(screen.getByTestId("highlight-add-rule-btn"));
    expect(screen.getByTestId("highlight-rule-1")).toBeInTheDocument();

    // Remove the first rule
    fireEvent.click(screen.getByTestId("rule-remove-0"));
    expect(screen.queryByTestId("highlight-rule-1")).not.toBeInTheDocument();
  });

  // ─── Validation ─────────────────────────────────────────────

  it("shows error for empty name on save", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    // Clear the name input if pre-filled
    const nameInput = screen.getByTestId("highlight-name-input");
    fireEvent.change(nameInput, { target: { value: "" } });

    fireEvent.click(screen.getByTestId("highlight-save-btn"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("shows error for invalid regex pattern", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const nameInput = screen.getByTestId("highlight-name-input");
    fireEvent.change(nameInput, { target: { value: "Test Set" } });

    // Set pattern to invalid regex
    const patternInput = screen.getByTestId("rule-pattern-input-0");
    fireEvent.change(patternInput, { target: { value: "[invalid" } });

    // Change match type to regex
    const matchTypeSelect = screen.getByTestId("rule-matchtype-select-0");
    fireEvent.change(matchTypeSelect, { target: { value: "regex" } });

    fireEvent.click(screen.getByTestId("highlight-save-btn"));
    expect(screen.getByText("Invalid regex pattern")).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("rejects regex with nested quantifiers (ReDoS protection)", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const nameInput = screen.getByTestId("highlight-name-input");
    fireEvent.change(nameInput, { target: { value: "Test Set" } });

    // Set pattern to ReDoS-vulnerable regex
    const patternInput = screen.getByTestId("rule-pattern-input-0");
    fireEvent.change(patternInput, { target: { value: "(a+)+" } });

    // Change match type to regex
    const matchTypeSelect = screen.getByTestId("rule-matchtype-select-0");
    fireEvent.change(matchTypeSelect, { target: { value: "regex" } });

    fireEvent.click(screen.getByTestId("highlight-save-btn"));
    expect(
      screen.getByText("Pattern contains unsafe nested quantifiers"),
    ).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  // ─── Save callback ──────────────────────────────────────────

  it("calls onSave with valid input", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const nameInput = screen.getByTestId("highlight-name-input");
    fireEvent.change(nameInput, { target: { value: "My Set" } });

    const patternInput = screen.getByTestId("rule-pattern-input-0");
    fireEvent.change(patternInput, { target: { value: "ERROR" } });

    fireEvent.click(screen.getByTestId("highlight-save-btn"));

    expect(mockOnSave).toHaveBeenCalledTimes(1);
    const saved = mockOnSave.mock.calls[0][0];
    expect(saved.name).toBe("My Set");
    expect(saved.rules).toHaveLength(1);
    expect(saved.rules[0].pattern).toBe("ERROR");
  });

  // ─── Cancel callback ────────────────────────────────────────

  it("calls onCancel when cancel is clicked", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByTestId("highlight-cancel-btn"));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  // ─── Disabled during save ───────────────────────────────────

  it("disables buttons when saving", () => {
    render(
      <HighlightEditor
        onSave={mockOnSave}
        onCancel={mockOnCancel}
        isSaving={true}
      />,
    );
    const saveBtn = screen.getByTestId(
      "highlight-save-btn",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  // ─── Color palette ──────────────────────────────────────────

  it("shows color palette in create mode", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    expect(screen.getByTestId("palette-red")).toBeInTheDocument();
    expect(screen.getByTestId("palette-green")).toBeInTheDocument();
    expect(screen.getByTestId("palette-cyan")).toBeInTheDocument();
  });

  it("hides color palette for built-in presets", () => {
    const set = createMockHighlightSet({ isBuiltin: true });
    render(
      <HighlightEditor
        highlightSet={set}
        onSave={mockOnSave}
        onCancel={mockOnCancel}
      />,
    );
    expect(screen.queryByTestId("palette-red")).not.toBeInTheDocument();
  });

  // ─── Accessibility ──────────────────────────────────────────

  it("has dialog role", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const editor = screen.getByTestId("highlight-editor");
    expect(editor.getAttribute("role")).toBe("dialog");
  });

  it("has aria-label in create mode", () => {
    render(<HighlightEditor onSave={mockOnSave} onCancel={mockOnCancel} />);
    const editor = screen.getByTestId("highlight-editor");
    expect(editor.getAttribute("aria-label")).toBe("Create Highlight Set");
  });

  it("has aria-label in edit mode", () => {
    const set = createMockHighlightSet();
    render(
      <HighlightEditor
        highlightSet={set}
        onSave={mockOnSave}
        onCancel={mockOnCancel}
      />,
    );
    const editor = screen.getByTestId("highlight-editor");
    expect(editor.getAttribute("aria-label")).toBe("Edit Highlight Set");
  });
});
