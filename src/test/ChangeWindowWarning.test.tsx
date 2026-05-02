/**
 * ChangeWindowWarning component tests.
 *
 * Tests the warning modal that appears when a dangerous command is
 * detected outside a maintenance window.
 *
 * Tags: [AC-1], [TDD]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeWindowWarning } from "../components/Compliance/ChangeWindowWarning";

describe("ChangeWindowWarning", () => {
  const defaultProps = {
    command: "write memory",
    reason: "No active maintenance window. Current time: Monday 10:30",
    onProceed: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders the warning with command and reason", () => {
    render(<ChangeWindowWarning {...defaultProps} />);
    expect(screen.getByText(/write memory/)).toBeInTheDocument();
    expect(
      screen.getByText(/No active maintenance window/),
    ).toBeInTheDocument();
  });

  it("renders Proceed Anyway and Cancel buttons", () => {
    render(<ChangeWindowWarning {...defaultProps} />);
    expect(screen.getByText("Proceed Anyway")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onProceed when Proceed Anyway is clicked", () => {
    const onProceed = vi.fn();
    render(<ChangeWindowWarning {...defaultProps} onProceed={onProceed} />);
    fireEvent.click(screen.getByText("Proceed Anyway"));
    expect(onProceed).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<ChangeWindowWarning {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Escape key is pressed", () => {
    const onCancel = vi.fn();
    render(<ChangeWindowWarning {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("has alertdialog role for accessibility", () => {
    render(<ChangeWindowWarning {...defaultProps} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("has aria-labelledby for accessibility", () => {
    render(<ChangeWindowWarning {...defaultProps} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "cw-warning-title");
  });
});
