/**
 * SessionSearch component tests.
 *
 * Tags: [AC-3], [TDD]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SessionSearch } from "../components/SessionManager/SessionSearch";

describe("SessionSearch", () => {
  let onSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSearch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders search input with placeholder", () => {
    render(<SessionSearch onSearch={onSearch} />);
    const input = screen.getByTestId("session-search-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Search sessions…");
  });

  it("renders custom placeholder", () => {
    render(
      <SessionSearch onSearch={onSearch} placeholder="Find sessions..." />,
    );
    const input = screen.getByTestId("session-search-input");
    expect(input).toHaveAttribute("placeholder", "Find sessions...");
  });

  it("has accessible label", () => {
    render(<SessionSearch onSearch={onSearch} />);
    const input = screen.getByLabelText("Search sessions");
    expect(input).toBeInTheDocument();
  });

  it("debounces search calls", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");
    fireEvent.change(input, { target: { value: "test" } });

    // Before debounce fires
    expect(onSearch).not.toHaveBeenCalled();

    // After debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearch).toHaveBeenCalledWith("test");
  });

  it("shows clear button when text is present", () => {
    render(<SessionSearch onSearch={onSearch} />);

    // No clear button initially
    expect(
      screen.queryByTestId("session-search-clear"),
    ).not.toBeInTheDocument();

    const input = screen.getByTestId("session-search-input");
    fireEvent.change(input, { target: { value: "query" } });

    // Clear button appears
    expect(screen.getByTestId("session-search-clear")).toBeInTheDocument();
  });

  it("clears search on clear button click", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");
    fireEvent.change(input, { target: { value: "query" } });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const clearBtn = screen.getByTestId("session-search-clear");
    fireEvent.click(clearBtn);

    expect(onSearch).toHaveBeenCalledWith("");
    expect(input).toHaveValue("");
  });

  it("clears search on Escape key", () => {
    render(<SessionSearch onSearch={onSearch} />);

    const input = screen.getByTestId("session-search-input");
    fireEvent.change(input, { target: { value: "query" } });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSearch).toHaveBeenCalledWith("");
  });
});
