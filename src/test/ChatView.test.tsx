/**
 * Unit tests for the ChatView component.
 *
 * Tags: [TDD], [AC-5] Expect-Style Chat Window
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatView } from "../components/ChatView/ChatView";

describe("ChatView", () => {
  const mockOnClose = vi.fn();
  const mockOnSendCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <ChatView isOpen={false} onClose={mockOnClose} />,
    );
    expect(screen.queryByTestId("chat-view")).not.toBeInTheDocument();
  });

  it("renders the chat view when isOpen is true", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    expect(screen.getByTestId("chat-view")).toBeInTheDocument();
    expect(screen.getByText("Session Chat Log")).toBeInTheDocument();
  });

  it("renders command input and send button", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    expect(screen.getByTestId("chat-view-input")).toBeInTheDocument();
    expect(screen.getByTestId("chat-view-send")).toBeInTheDocument();
  });

  it("shows empty state when no commands sent", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    expect(
      screen.getByText("No commands sent yet. Type a command below."),
    ).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    fireEvent.click(screen.getByTestId("chat-view-close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("sends command when Enter is pressed", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "show version" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnSendCommand).toHaveBeenCalledWith("show version");
  });

  it("sends command when Send button is clicked", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "show ip route" } });
    fireEvent.click(screen.getByTestId("chat-view-send"));

    expect(mockOnSendCommand).toHaveBeenCalledWith("show ip route");
  });

  it("adds entry to chat log after sending", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "show version" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The command should appear in the chat log
    expect(screen.getByText("show version")).toBeInTheDocument();
    // The direction arrow should be visible
    expect(screen.getByText("→")).toBeInTheDocument();
  });

  it("clears input after sending", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "show version" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("");
  });

  it("does not send empty commands", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnSendCommand).not.toHaveBeenCalled();
  });

  it("disables send button when input is empty", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );
    const sendBtn = screen.getByTestId("chat-view-send");
    expect(sendBtn).toBeDisabled();
  });

  it("toggles search bar visibility", () => {
    render(
      <ChatView isOpen={true} onClose={mockOnClose} />,
    );

    expect(screen.queryByTestId("chat-view-search")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-view-search-toggle"));
    expect(screen.getByTestId("chat-view-search")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-view-search-toggle"));
    expect(screen.queryByTestId("chat-view-search")).not.toBeInTheDocument();
  });

  it("filters entries based on search query", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    // Send two commands
    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "show version" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "show ip route" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Open search and filter
    fireEvent.click(screen.getByTestId("chat-view-search-toggle"));
    const searchInput = screen.getByTestId("chat-view-search-input");
    fireEvent.change(searchInput, { target: { value: "version" } });

    // Should show "1 / 2"
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("clears all entries when Clear is clicked", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "show version" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("show version")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-view-clear"));

    expect(
      screen.getByText("No commands sent yet. Type a command below."),
    ).toBeInTheDocument();
  });

  it("collapses all entries", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "cmd1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Click collapse all — the collapse icon should change
    fireEvent.click(screen.getByTestId("chat-view-collapse-all"));

    // After collapsing, entries should show collapsed icon ▶
    const collapseIcons = screen.getAllByText("▶");
    expect(collapseIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("expands all entries after collapsing", () => {
    render(
      <ChatView
        isOpen={true}
        onClose={mockOnClose}
        onSendCommand={mockOnSendCommand}
      />,
    );

    const input = screen.getByTestId("chat-view-input");
    fireEvent.change(input, { target: { value: "cmd1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByTestId("chat-view-collapse-all"));
    fireEvent.click(screen.getByTestId("chat-view-expand-all"));

    // After expanding, should show expanded icon ▼ in the entry
    const expandIcons = screen.getAllByText("▼");
    expect(expandIcons.length).toBeGreaterThanOrEqual(1);
  });
});
