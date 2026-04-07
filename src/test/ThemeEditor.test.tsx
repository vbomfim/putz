/**
 * Unit tests for ThemeEditor component.
 *
 * Tags: [TDD], [AC-2]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeEditor } from "../components/Terminal/ThemeEditor";
import type { Theme, ThemeColors } from "../components/Terminal/themeTypes";

function sampleColors(): ThemeColors {
  return {
    foreground: "#e0e0e0",
    background: "#1a1a2e",
    cursor: "#e0e0e0",
    cursorAccent: "#1a1a2e",
    selectionBackground: "#0f346080",
    selectionForeground: "",
    black: "#1a1a2e",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#e0e0e0",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  };
}

function sampleTheme(overrides: Partial<Theme> = {}): Theme {
  return {
    id: "theme-1",
    name: "Test Theme",
    colors: sampleColors(),
    isBuiltin: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ThemeEditor", () => {
  it("renders the editor with title", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("New Theme")).toBeInTheDocument();
  });

  it("shows 'Edit Theme' when editing an existing theme", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={sampleTheme()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Edit Theme")).toBeInTheDocument();
  });

  it("pre-fills name when editing", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={sampleTheme({ name: "My Custom" })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("theme-name-input") as HTMLInputElement;
    expect(input.value).toBe("My Custom");
  });

  it("disables save button when name is empty", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const saveBtn = screen.getByTestId("theme-save-btn");
    expect(saveBtn).toBeDisabled();
  });

  it("enables save button when name is provided", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("theme-name-input");
    fireEvent.change(input, { target: { value: "My Theme" } });
    const saveBtn = screen.getByTestId("theme-save-btn");
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls onSave with name and colors when save is clicked", () => {
    const onSave = vi.fn();
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("theme-name-input");
    fireEvent.change(input, { target: { value: "New Theme" } });
    fireEvent.click(screen.getByTestId("theme-save-btn"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("New Theme", expect.any(Object));
  });

  it("calls onCancel when cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("theme-cancel-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows live preview with theme colors", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={sampleTheme()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const preview = screen.getByTestId("theme-preview");
    expect(preview).toBeInTheDocument();
    expect(preview.style.backgroundColor).toBeTruthy();
    expect(preview.style.color).toBeTruthy();
  });

  it("renders color pickers for all 22 colors", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={sampleTheme()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Check a representative set of color inputs
    expect(screen.getByTestId("color-foreground")).toBeInTheDocument();
    expect(screen.getByTestId("color-background")).toBeInTheDocument();
    expect(screen.getByTestId("color-cursor")).toBeInTheDocument();
    expect(screen.getByTestId("color-red")).toBeInTheDocument();
    expect(screen.getByTestId("color-brightWhite")).toBeInTheDocument();
  });

  it("shows base theme selector when creating new", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme(), sampleTheme({ id: "t2", name: "Another" })]}
        editingTheme={null}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("base-theme-select")).toBeInTheDocument();
  });

  it("hides base theme selector when editing", () => {
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={sampleTheme()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("base-theme-select")).not.toBeInTheDocument();
  });

  it("does not call onSave with whitespace-only name", () => {
    const onSave = vi.fn();
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("theme-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("theme-save-btn"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("trims name before saving", () => {
    const onSave = vi.fn();
    render(
      <ThemeEditor
        themes={[sampleTheme()]}
        editingTheme={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("theme-name-input");
    fireEvent.change(input, { target: { value: "  Padded Name  " } });
    fireEvent.click(screen.getByTestId("theme-save-btn"));
    expect(onSave).toHaveBeenCalledWith("Padded Name", expect.any(Object));
  });
});
