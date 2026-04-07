/**
 * SearchBar component tests.
 *
 * Tests rendering, keyboard interactions, and state management
 * for the terminal scrollback search overlay.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../components/Terminal/SearchBar";

describe("SearchBar", () => {
  const defaultProps = {
    onSearch: vi.fn(),
    onSearchPrevious: vi.fn(),
    onClose: vi.fn(),
    onCaseSensitiveToggle: vi.fn(),
    onRegexToggle: vi.fn(),
    hasResults: false,
    caseSensitive: false,
    useRegex: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders with placeholder text", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");
    expect(input).toHaveAttribute("placeholder", "Search…");
  });

  it("renders case-sensitive toggle button", () => {
    render(<SearchBar {...defaultProps} />);
    const btn = screen.getByTestId("search-case-toggle");
    expect(btn).toBeInTheDocument();
  });

  it("renders regex toggle button", () => {
    render(<SearchBar {...defaultProps} />);
    const btn = screen.getByTestId("search-regex-toggle");
    expect(btn).toBeInTheDocument();
  });

  it("renders prev/next buttons", () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByTestId("search-prev")).toBeInTheDocument();
    expect(screen.getByTestId("search-next")).toBeInTheDocument();
  });

  it("renders close button", () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByTestId("search-close")).toBeInTheDocument();
  });

  it("calls onSearch when typing", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    await user.type(input, "hello");
    expect(defaultProps.onSearch).toHaveBeenCalledWith("hello");
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const btn = screen.getByTestId("search-close");

    await user.click(btn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onSearch on Enter key (next match)", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    // Set a search term first
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(defaultProps.onSearch).toHaveBeenCalled();
  });

  it("calls onSearchPrevious on Shift+Enter", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(defaultProps.onSearchPrevious).toHaveBeenCalled();
  });

  it("calls onSearch on F3 key (next match)", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "F3" });
    expect(defaultProps.onSearch).toHaveBeenCalled();
  });

  it("calls onSearchPrevious on Shift+F3", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");

    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "F3", shiftKey: true });
    expect(defaultProps.onSearchPrevious).toHaveBeenCalled();
  });

  it("calls onCaseSensitiveToggle when case button clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const btn = screen.getByTestId("search-case-toggle");

    await user.click(btn);
    expect(defaultProps.onCaseSensitiveToggle).toHaveBeenCalledTimes(1);
  });

  it("calls onRegexToggle when regex button clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const btn = screen.getByTestId("search-regex-toggle");

    await user.click(btn);
    expect(defaultProps.onRegexToggle).toHaveBeenCalledTimes(1);
  });

  it("shows active state for case-sensitive toggle", () => {
    render(<SearchBar {...defaultProps} caseSensitive={true} />);
    const btn = screen.getByTestId("search-case-toggle");
    expect(btn.className).toContain("active");
  });

  it("shows active state for regex toggle", () => {
    render(<SearchBar {...defaultProps} useRegex={true} />);
    const btn = screen.getByTestId("search-regex-toggle");
    expect(btn.className).toContain("active");
  });

  it("shows 'No results' when search has no results and term exists", () => {
    render(<SearchBar {...defaultProps} hasResults={false} />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "nonexistent" } });

    const status = screen.getByTestId("search-status");
    expect(status.textContent).toContain("No results");
  });

  it("shows nothing when search term is empty", () => {
    render(<SearchBar {...defaultProps} />);
    const status = screen.getByTestId("search-status");
    expect(status.textContent).toBe("");
  });

  it("shows 'Match found' when results exist", () => {
    render(<SearchBar {...defaultProps} hasResults={true} />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "found" } });

    const status = screen.getByTestId("search-status");
    expect(status.textContent).toContain("Match found");
  });

  it("auto-focuses input on mount", () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");
    expect(document.activeElement).toBe(input);
  });

  it("calls onSearch with next nav when next button clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    const btn = screen.getByTestId("search-next");
    await user.click(btn);
    expect(defaultProps.onSearch).toHaveBeenCalled();
  });

  it("calls onSearchPrevious when prev button clicked", async () => {
    const user = userEvent.setup();
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    const btn = screen.getByTestId("search-prev");
    await user.click(btn);
    expect(defaultProps.onSearchPrevious).toHaveBeenCalled();
  });
});
