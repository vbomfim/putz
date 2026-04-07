/**
 * Edge case and boundary tests for the SearchBar component.
 *
 * Tests behaviors NOT covered by the Developer's unit tests:
 * - Empty search term handling
 * - Very long search terms
 * - Special/unicode characters in search
 * - Rapid typing
 * - Regex pattern edge cases
 * - Multiple toggle interactions
 * - Button state combinations
 *
 * Tags: [EDGE], [BOUNDARY], [AC-3], [AC-4], [AC-5]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../components/Terminal/SearchBar";

describe("SearchBar — Edge Cases & Boundaries", () => {
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

  // ── Empty term handling [EDGE] ──────────────────────────────────────

  describe("empty search term [EDGE]", () => {
    it("Enter with empty search term does not call onSearch", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.keyDown(input, { key: "Enter" });
      // onSearch is called during onChange, not on Enter with empty
      expect(defaultProps.onSearch).not.toHaveBeenCalled();
    });

    it("F3 with empty search term does not call onSearch", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.keyDown(input, { key: "F3" });
      expect(defaultProps.onSearch).not.toHaveBeenCalled();
    });

    it("Shift+Enter with empty term does not call onSearchPrevious", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(defaultProps.onSearchPrevious).not.toHaveBeenCalled();
    });

    it("Shift+F3 with empty term does not call onSearchPrevious", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.keyDown(input, { key: "F3", shiftKey: true });
      expect(defaultProps.onSearchPrevious).not.toHaveBeenCalled();
    });

    it("next button click with empty term does not call onSearch", async () => {
      const user = userEvent.setup();
      render(<SearchBar {...defaultProps} />);
      const btn = screen.getByTestId("search-next");

      await user.click(btn);
      expect(defaultProps.onSearch).not.toHaveBeenCalled();
    });

    it("prev button click with empty term does not call onSearchPrevious", async () => {
      const user = userEvent.setup();
      render(<SearchBar {...defaultProps} />);
      const btn = screen.getByTestId("search-prev");

      await user.click(btn);
      expect(defaultProps.onSearchPrevious).not.toHaveBeenCalled();
    });
  });

  // ── Boundary: long search term [BOUNDARY] ───────────────────────────

  describe("long search term [BOUNDARY]", () => {
    it("handles very long search term without crashing", async () => {
      const user = userEvent.setup();
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      const longTerm = "a".repeat(5000);
      await user.clear(input);
      fireEvent.change(input, { target: { value: longTerm } });

      // Should have called onSearch with the full string
      expect(defaultProps.onSearch).toHaveBeenCalledWith(longTerm);
    });
  });

  // ── Unicode and special characters [EDGE] ───────────────────────────

  describe("special characters in search [EDGE]", () => {
    it("handles unicode search terms", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.change(input, { target: { value: "こんにちは" } });
      expect(defaultProps.onSearch).toHaveBeenCalledWith("こんにちは");
    });

    it("handles emoji in search term", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.change(input, { target: { value: "🔍 search" } });
      expect(defaultProps.onSearch).toHaveBeenCalledWith("🔍 search");
    });

    it("handles regex metacharacters in search term (when regex is off)", () => {
      render(<SearchBar {...defaultProps} useRegex={false} />);
      const input = screen.getByTestId("search-input");

      const regexMeta = "192.168.1.1 [error]";
      fireEvent.change(input, { target: { value: regexMeta } });
      // Should pass the raw string — regex escaping is SearchAddon's job
      expect(defaultProps.onSearch).toHaveBeenCalledWith(regexMeta);
    });

    it("[AC-5] handles IP address regex pattern", () => {
      render(<SearchBar {...defaultProps} useRegex={true} />);
      const input = screen.getByTestId("search-input");

      const ipRegex = "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}";
      fireEvent.change(input, { target: { value: ipRegex } });
      expect(defaultProps.onSearch).toHaveBeenCalledWith(ipRegex);
    });
  });

  // ── Status display transitions [EDGE] ───────────────────────────────

  describe("status display transitions [EDGE]", () => {
    it("shows empty status → No results when typing with no results", () => {
      const { rerender } = render(<SearchBar {...defaultProps} />);
      const status = screen.getByTestId("search-status");
      expect(status.textContent).toBe("");

      const input = screen.getByTestId("search-input");
      fireEvent.change(input, { target: { value: "x" } });

      // hasResults is still false (controlled by parent)
      rerender(<SearchBar {...defaultProps} hasResults={false} />);
      expect(status.textContent).toContain("No results");
    });

    it("transitions from No results → Match found when results appear", () => {
      const { rerender } = render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");
      fireEvent.change(input, { target: { value: "hello" } });

      const status = screen.getByTestId("search-status");
      expect(status.textContent).toContain("No results");

      // Parent reports results found
      rerender(<SearchBar {...defaultProps} hasResults={true} />);
      // Re-enter the search term to trigger status update
      fireEvent.change(input, { target: { value: "hello" } });
      expect(status.textContent).toContain("Match found");
    });

    it("clears search term shows empty status again", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");
      const status = screen.getByTestId("search-status");

      fireEvent.change(input, { target: { value: "test" } });
      expect(status.textContent).not.toBe("");

      fireEvent.change(input, { target: { value: "" } });
      expect(status.textContent).toBe("");
    });
  });

  // ── Toggle button combinations [EDGE] ───────────────────────────────

  describe("toggle button state combinations [EDGE]", () => {
    it("both case-sensitive and regex can be active simultaneously", () => {
      render(
        <SearchBar {...defaultProps} caseSensitive={true} useRegex={true} />,
      );

      const caseBtn = screen.getByTestId("search-case-toggle");
      const regexBtn = screen.getByTestId("search-regex-toggle");

      expect(caseBtn.className).toContain("active");
      expect(regexBtn.className).toContain("active");
    });

    it("both toggles inactive by default", () => {
      render(
        <SearchBar {...defaultProps} caseSensitive={false} useRegex={false} />,
      );

      const caseBtn = screen.getByTestId("search-case-toggle");
      const regexBtn = screen.getByTestId("search-regex-toggle");

      expect(caseBtn.className).not.toContain("active");
      expect(regexBtn.className).not.toContain("active");
    });

    it("toggle buttons have correct aria-pressed state", () => {
      render(
        <SearchBar {...defaultProps} caseSensitive={true} useRegex={false} />,
      );

      const caseBtn = screen.getByTestId("search-case-toggle");
      const regexBtn = screen.getByTestId("search-regex-toggle");

      expect(caseBtn).toHaveAttribute("aria-pressed", "true");
      expect(regexBtn).toHaveAttribute("aria-pressed", "false");
    });
  });

  // ── Accessibility [AC-3] ────────────────────────────────────────────

  describe("accessibility [AC-3]", () => {
    it("all interactive elements have aria-labels", () => {
      render(<SearchBar {...defaultProps} />);

      expect(screen.getByTestId("search-input")).toHaveAttribute("aria-label");
      expect(screen.getByTestId("search-case-toggle")).toHaveAttribute(
        "aria-label",
      );
      expect(screen.getByTestId("search-regex-toggle")).toHaveAttribute(
        "aria-label",
      );
      expect(screen.getByTestId("search-prev")).toHaveAttribute("aria-label");
      expect(screen.getByTestId("search-next")).toHaveAttribute("aria-label");
      expect(screen.getByTestId("search-close")).toHaveAttribute("aria-label");
    });

    it("buttons have type='button' to prevent form submission", () => {
      render(<SearchBar {...defaultProps} />);

      const buttons = [
        screen.getByTestId("search-case-toggle"),
        screen.getByTestId("search-regex-toggle"),
        screen.getByTestId("search-prev"),
        screen.getByTestId("search-next"),
        screen.getByTestId("search-close"),
      ];

      for (const btn of buttons) {
        expect(btn).toHaveAttribute("type", "button");
      }
    });

    it("search input has descriptive placeholder", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");
      expect(input).toHaveAttribute("placeholder", "Search…");
    });
  });

  // ── Keyboard shortcuts not eaten by other handlers [EDGE] ───────────

  describe("keyboard isolation [EDGE]", () => {
    it("non-shortcut keys are not intercepted", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      // Regular keys should not trigger close or search
      fireEvent.keyDown(input, { key: "a" });
      fireEvent.keyDown(input, { key: "Tab" });
      fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(defaultProps.onClose).not.toHaveBeenCalled();
      // onSearch only called when the value changes via onChange
    });

    it("Escape works even when search term is present", () => {
      render(<SearchBar {...defaultProps} />);
      const input = screen.getByTestId("search-input");

      fireEvent.change(input, { target: { value: "important search" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });
});
