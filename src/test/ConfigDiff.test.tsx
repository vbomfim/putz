/**
 * Unit tests for the ConfigDiff component.
 *
 * Tags: [TDD], [AC-4] Config Diff Viewer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfigDiff } from "../components/ConfigDiff/ConfigDiff";

// Mock clipboard API
const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: { writeText: mockClipboardWrite },
});

describe("ConfigDiff", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    render(<ConfigDiff isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByTestId("config-diff")).not.toBeInTheDocument();
  });

  it("renders the diff viewer when isOpen is true", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId("config-diff")).toBeInTheDocument();
    expect(screen.getByText("Config Diff Viewer")).toBeInTheDocument();
  });

  it("renders two text input panes", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId("config-diff-old")).toBeInTheDocument();
    expect(screen.getByTestId("config-diff-new")).toBeInTheDocument();
  });

  it("renders compare, export, clear, and close buttons", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId("config-diff-compare")).toBeInTheDocument();
    expect(screen.getByTestId("config-diff-export")).toBeInTheDocument();
    expect(screen.getByTestId("config-diff-clear")).toBeInTheDocument();
    expect(screen.getByTestId("config-diff-close")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId("config-diff-close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("computes and displays diff when Compare is clicked", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    const oldTextarea = screen.getByTestId("config-diff-old");
    const newTextarea = screen.getByTestId("config-diff-new");

    fireEvent.change(oldTextarea, {
      target: { value: "hostname R1\ninterface Gi0/0" },
    });
    fireEvent.change(newTextarea, {
      target: { value: "hostname R2\ninterface Gi0/0" },
    });

    fireEvent.click(screen.getByTestId("config-diff-compare"));

    // Should display the diff output
    expect(screen.getByTestId("config-diff-output")).toBeInTheDocument();
  });

  it("shows addition and deletion stats after compare", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("config-diff-old"), {
      target: { value: "old line" },
    });
    fireEvent.change(screen.getByTestId("config-diff-new"), {
      target: { value: "new line" },
    });

    fireEvent.click(screen.getByTestId("config-diff-compare"));

    expect(screen.getByText(/\+1 addition/)).toBeInTheDocument();
    expect(screen.getByText(/-1 deletion/)).toBeInTheDocument();
  });

  it("shows 'Configurations are identical' when texts match", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("config-diff-old"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("config-diff-new"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByTestId("config-diff-compare"));

    expect(screen.getByText("Configurations are identical")).toBeInTheDocument();
  });

  it("clears inputs and output when Clear is clicked", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    const oldTextarea = screen.getByTestId("config-diff-old") as HTMLTextAreaElement;
    fireEvent.change(oldTextarea, { target: { value: "some text" } });
    expect(oldTextarea.value).toBe("some text");

    fireEvent.click(screen.getByTestId("config-diff-clear"));
    expect(oldTextarea.value).toBe("");
  });

  it("exports diff to clipboard when Export is clicked", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("config-diff-old"), {
      target: { value: "old" },
    });
    fireEvent.change(screen.getByTestId("config-diff-new"), {
      target: { value: "new" },
    });

    fireEvent.click(screen.getByTestId("config-diff-compare"));
    fireEvent.click(screen.getByTestId("config-diff-export"));

    expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    const clipboardText = mockClipboardWrite.mock.calls[0][0];
    expect(clipboardText).toContain("- old");
    expect(clipboardText).toContain("+ new");
  });

  it("displays line numbers for diff lines", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId("config-diff-old"), {
      target: { value: "line1\nline2" },
    });
    fireEvent.change(screen.getByTestId("config-diff-new"), {
      target: { value: "line1\nchanged" },
    });

    fireEvent.click(screen.getByTestId("config-diff-compare"));

    // Should have diff lines rendered
    expect(screen.getByTestId("diff-line-0")).toBeInTheDocument();
  });

  it("disables export button when no diff is computed", () => {
    render(<ConfigDiff isOpen={true} onClose={mockOnClose} />);
    const exportBtn = screen.getByTestId("config-diff-export");
    expect(exportBtn).toBeDisabled();
  });
});
