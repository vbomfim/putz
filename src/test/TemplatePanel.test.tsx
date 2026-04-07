/**
 * Unit tests for the TemplatePanel component.
 *
 * Tags: [TDD], [AC-6] Command Templates
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatePanel } from "../components/Templates/TemplatePanel";

// Mock the template API
vi.mock("../components/Templates/templateApi", () => ({
  templateList: vi.fn().mockResolvedValue([
    {
      id: "t1",
      name: "Backup Config",
      description: "Saves running config",
      isBuiltin: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "t2",
      name: "My Template",
      description: "Custom template",
      isBuiltin: false,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ]),
  templateGet: vi.fn().mockResolvedValue({
    meta: {
      id: "t1",
      name: "Backup Config",
      description: "Saves running config",
      isBuiltin: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    content: "enable\ncopy running-config startup-config\n",
    variables: [],
  }),
  templateCreate: vi.fn().mockResolvedValue("t3"),
  templateDelete: vi.fn().mockResolvedValue(undefined),
  templateExecute: vi.fn().mockResolvedValue("rendered output"),
}));

describe("TemplatePanel", () => {
  const mockOnClose = vi.fn();
  const mockOnSendToTerminal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <TemplatePanel isOpen={false} onClose={mockOnClose} />,
    );
    expect(screen.queryByTestId("template-panel")).not.toBeInTheDocument();
  });

  it("renders the template panel when isOpen is true", async () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );
    expect(screen.getByTestId("template-panel")).toBeInTheDocument();
    expect(screen.getByText("Command Templates")).toBeInTheDocument();
  });

  it("loads and displays template list", async () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Backup Config")).toBeInTheDocument();
      expect(screen.getByText("My Template")).toBeInTheDocument();
    });
  });

  it("shows built-in badge for built-in templates", async () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Built-in")).toBeInTheDocument();
    });
  });

  it("shows delete button only for non-builtin templates", async () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    await waitFor(() => {
      // t2 (non-builtin) should have delete button
      expect(screen.getByTestId("template-delete-t2")).toBeInTheDocument();
      // t1 (builtin) should NOT have delete button
      expect(screen.queryByTestId("template-delete-t1")).not.toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );
    fireEvent.click(screen.getByTestId("template-panel-close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("opens new template form when + New is clicked", () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    fireEvent.click(screen.getByTestId("template-panel-new"));
    expect(screen.getByTestId("template-panel-edit")).toBeInTheDocument();
    expect(screen.getByText("New Template")).toBeInTheDocument();
  });

  it("renders edit form with name, description, and content fields", () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    fireEvent.click(screen.getByTestId("template-panel-new"));

    expect(screen.getByTestId("template-edit-name")).toBeInTheDocument();
    expect(screen.getByTestId("template-edit-description")).toBeInTheDocument();
    expect(screen.getByTestId("template-edit-content")).toBeInTheDocument();
    expect(screen.getByTestId("template-edit-save")).toBeInTheDocument();
  });

  it("disables save button when name or content is empty", () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    fireEvent.click(screen.getByTestId("template-panel-new"));

    const saveBtn = screen.getByTestId("template-edit-save");
    expect(saveBtn).toBeDisabled();
  });

  it("navigates to execute view when template is selected", async () => {
    render(
      <TemplatePanel
        isOpen={true}
        onClose={mockOnClose}
        onSendToTerminal={mockOnSendToTerminal}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("template-item-t1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("template-item-t1"));

    await waitFor(() => {
      expect(screen.getByTestId("template-panel-execute")).toBeInTheDocument();
      expect(screen.getByTestId("template-execute-btn")).toBeInTheDocument();
    });
  });

  it("goes back to list when back button is clicked", async () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    fireEvent.click(screen.getByTestId("template-panel-new"));
    expect(screen.getByTestId("template-panel-edit")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("template-panel-back"));
    expect(screen.getByTestId("template-panel-list")).toBeInTheDocument();
  });

  it("calls onClose on Escape from list view", () => {
    render(
      <TemplatePanel isOpen={true} onClose={mockOnClose} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
