/**
 * HistoryPanel component tests.
 *
 * Tests rendering, keyboard interactions, search functionality,
 * and selection behavior for the command history overlay.
 *
 * Tags: [TDD], [COMPONENT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryPanel } from "../components/History/HistoryPanel";
import type { CommandEntry } from "../components/History/types";

// Mock the history API
vi.mock("../components/History/historyApi", () => ({
  historySearch: vi.fn(),
}));

import { historySearch } from "../components/History/historyApi";

const mockedHistorySearch = vi.mocked(historySearch);

describe("HistoryPanel", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
  };

  const mockResults: CommandEntry[] = [
    {
      id: 1,
      sessionName: "Lab Router",
      host: "10.0.0.1",
      command: "show ip interface brief",
      timestamp: "2024-01-15T10:30:00Z",
      sessionId: "sess-1",
    },
    {
      id: 2,
      sessionName: "Core Switch",
      host: "10.0.0.2",
      command: "show vlan brief",
      timestamp: "2024-01-15T10:31:00Z",
      sessionId: "sess-2",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockedHistorySearch.mockResolvedValue([]);
  });

  it("renders when isOpen is true", () => {
    render(<HistoryPanel {...defaultProps} />);
    expect(screen.getByTestId("history-panel")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(<HistoryPanel {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
  });

  it("renders search input with placeholder", () => {
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Search command history"),
    );
  });

  it("calls onClose when close button is clicked", () => {
    render(<HistoryPanel {...defaultProps} />);
    const closeBtn = screen.getByLabelText("Close history panel");
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay is clicked", () => {
    render(<HistoryPanel {...defaultProps} />);
    const overlay = screen.getByTestId("history-panel");
    fireEvent.click(overlay);
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("searches when user types in the input", async () => {
    mockedHistorySearch.mockResolvedValue(mockResults);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(mockedHistorySearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "show" }),
      );
    });
  });

  it("displays search results", async () => {
    mockedHistorySearch.mockResolvedValue(mockResults);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(screen.getByTestId("history-results")).toBeInTheDocument();
    });

    expect(screen.getByText("show ip interface brief")).toBeInTheDocument();
    expect(screen.getByText("show vlan brief")).toBeInTheDocument();
  });

  it("shows empty state when no results found", async () => {
    mockedHistorySearch.mockResolvedValue([]);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(mockedHistorySearch).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-empty")).toBeInTheDocument();
    });
  });

  it("calls onSelect and onClose when a result is clicked", async () => {
    mockedHistorySearch.mockResolvedValue(mockResults);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(screen.getByTestId("history-result-0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("history-result-0"));
    expect(defaultProps.onSelect).toHaveBeenCalledWith(
      "show ip interface brief",
    );
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onSelect on Enter with selected result", async () => {
    mockedHistorySearch.mockResolvedValue(mockResults);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(screen.getByTestId("history-result-0")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(defaultProps.onSelect).toHaveBeenCalledWith(
      "show ip interface brief",
    );
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("navigates results with arrow keys", async () => {
    mockedHistorySearch.mockResolvedValue(mockResults);
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(screen.getByTestId("history-result-0")).toBeInTheDocument();
    });

    // First item selected by default
    expect(screen.getByTestId("history-result-0")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Arrow down to second item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("history-result-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Arrow up back to first item
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByTestId("history-result-0")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows error state when search fails", async () => {
    mockedHistorySearch.mockRejectedValue(new Error("Database error"));
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "show" } });

    await waitFor(() => {
      expect(screen.getByTestId("history-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Database error")).toBeInTheDocument();
  });

  it("does not search for empty query", () => {
    render(<HistoryPanel {...defaultProps} />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "" } });
    expect(mockedHistorySearch).not.toHaveBeenCalled();
  });

  it("passes sessionId to search when provided", async () => {
    mockedHistorySearch.mockResolvedValue([]);
    render(<HistoryPanel {...defaultProps} sessionId="sess-1" />);
    const input = screen.getByTestId("history-search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(mockedHistorySearch).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-1" }),
      );
    });
  });
});
