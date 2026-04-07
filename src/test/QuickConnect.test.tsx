/**
 * QuickConnect component tests.
 *
 * Tests rendering, input handling, preview display,
 * and connection submission for the quick connect bar.
 *
 * Tags: [TDD], [COMPONENT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickConnect } from "../components/QuickConnect/QuickConnect";

describe("QuickConnect", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConnect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when isOpen is true", () => {
    render(<QuickConnect {...defaultProps} />);
    expect(screen.getByTestId("quickconnect-panel")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(<QuickConnect {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("quickconnect-panel")).not.toBeInTheDocument();
  });

  it("renders input with placeholder", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", expect.stringContaining("ssh"));
  });

  it("renders Connect button", () => {
    render(<QuickConnect {...defaultProps} />);
    expect(screen.getByLabelText("Connect")).toBeInTheDocument();
  });

  it("calls onClose when overlay is clicked", () => {
    render(<QuickConnect {...defaultProps} />);
    fireEvent.click(screen.getByTestId("quickconnect-panel"));
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("shows preview when valid input is typed", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "ssh admin@10.0.0.1" } });

    const preview = screen.getByTestId("quickconnect-preview");
    expect(preview).toBeInTheDocument();
    expect(preview.textContent).toContain("SSH");
    expect(preview.textContent).toContain("admin");
    expect(preview.textContent).toContain("10.0.0.1");
  });

  it("shows no preview for empty input", () => {
    render(<QuickConnect {...defaultProps} />);
    expect(screen.queryByTestId("quickconnect-preview")).not.toBeInTheDocument();
  });

  it("calls onConnect with parsed connection on form submit", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "ssh admin@10.0.0.1" } });
    fireEvent.submit(input.closest("form")!);

    expect(defaultProps.onConnect).toHaveBeenCalledWith({
      protocol: "ssh",
      host: "10.0.0.1",
      username: "admin",
      port: undefined,
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onConnect with telnet connection", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "telnet 10.0.0.1 23" } });
    fireEvent.submit(input.closest("form")!);

    expect(defaultProps.onConnect).toHaveBeenCalledWith({
      protocol: "telnet",
      host: "10.0.0.1",
      username: undefined,
      port: 23,
    });
  });

  it("shows error for empty submit", () => {
    render(<QuickConnect {...defaultProps} />);
    const form = screen.getByTestId("quickconnect-input").closest("form")!;
    fireEvent.submit(form);

    expect(screen.getByTestId("quickconnect-error")).toBeInTheDocument();
    expect(defaultProps.onConnect).not.toHaveBeenCalled();
  });

  it("shows error for invalid connection format", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "ssh" } });
    fireEvent.submit(input.closest("form")!);

    expect(screen.getByTestId("quickconnect-error")).toBeInTheDocument();
    expect(defaultProps.onConnect).not.toHaveBeenCalled();
  });

  it("shows port preview for connection with port", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "ssh admin@10.0.0.1:2222" } });

    const preview = screen.getByTestId("quickconnect-preview");
    expect(preview.textContent).toContain("2222");
  });

  it("plain IP shows SSH preview", () => {
    render(<QuickConnect {...defaultProps} />);
    const input = screen.getByTestId("quickconnect-input");
    fireEvent.change(input, { target: { value: "10.0.0.1" } });

    const preview = screen.getByTestId("quickconnect-preview");
    expect(preview.textContent).toContain("SSH");
    expect(preview.textContent).toContain("10.0.0.1");
  });
});
