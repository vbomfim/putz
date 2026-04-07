/**
 * SearchBar — Search overlay for terminal scrollback.
 *
 * Renders at the top of the terminal container with:
 * - Text input for search term
 * - Case-sensitive toggle
 * - Regex toggle
 * - Match status display
 * - Prev/Next navigation buttons
 * - Close button
 *
 * Keyboard shortcuts:
 * - Enter / F3: Next match
 * - Shift+Enter / Shift+F3: Previous match
 * - Escape: Close search bar
 *
 * @module SearchBar
 */
import { useEffect, useRef, useState, useCallback } from "react";
import "./SearchBar.css";

interface SearchBarProps {
  /** Called when the search term changes or next match is requested. */
  onSearch: (term: string) => void;
  /** Called to navigate to the previous match. */
  onSearchPrevious: (term: string) => void;
  /** Called to close the search bar. */
  onClose: () => void;
  /** Called when case-sensitive toggle is clicked. */
  onCaseSensitiveToggle: () => void;
  /** Called when regex toggle is clicked. */
  onRegexToggle: () => void;
  /** Whether the current search has any results. */
  hasResults: boolean;
  /** Whether case-sensitive search is active. */
  caseSensitive: boolean;
  /** Whether regex search is active. */
  useRegex: boolean;
}

/** Search overlay component for terminal scrollback. */
export function SearchBar({
  onSearch,
  onSearchPrevious,
  onClose,
  onCaseSensitiveToggle,
  onRegexToggle,
  hasResults,
  caseSensitive,
  useRegex,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchTerm(value);
      if (value) {
        onSearch(value);
      }
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Enter" || e.key === "F3") {
        e.preventDefault();
        if (searchTerm) {
          if (e.shiftKey) {
            onSearchPrevious(searchTerm);
          } else {
            onSearch(searchTerm);
          }
        }
        return;
      }
    },
    [searchTerm, onSearch, onSearchPrevious, onClose],
  );

  const handleNextClick = useCallback(() => {
    if (searchTerm) {
      onSearch(searchTerm);
    }
  }, [searchTerm, onSearch]);

  const handlePrevClick = useCallback(() => {
    if (searchTerm) {
      onSearchPrevious(searchTerm);
    }
  }, [searchTerm, onSearchPrevious]);

  const statusText = searchTerm
    ? hasResults
      ? "Match found"
      : "No results"
    : "";

  return (
    <div className="search-bar" data-testid="search-bar">
      <input
        ref={inputRef}
        type="text"
        className="search-bar__input"
        data-testid="search-input"
        placeholder="Search…"
        value={searchTerm}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        aria-label="Search terminal"
      />

      <span className="search-bar__status" data-testid="search-status">
        {statusText}
      </span>

      <button
        className={`search-bar__toggle ${caseSensitive ? "active" : ""}`}
        data-testid="search-case-toggle"
        onClick={onCaseSensitiveToggle}
        type="button"
        title="Case Sensitive"
        aria-label="Toggle case sensitive"
        aria-pressed={caseSensitive}
      >
        Aa
      </button>

      <button
        className={`search-bar__toggle ${useRegex ? "active" : ""}`}
        data-testid="search-regex-toggle"
        onClick={onRegexToggle}
        type="button"
        title="Regular Expression"
        aria-label="Toggle regex"
        aria-pressed={useRegex}
      >
        .*
      </button>

      <button
        className="search-bar__nav"
        data-testid="search-prev"
        onClick={handlePrevClick}
        type="button"
        title="Previous Match (Shift+Enter)"
        aria-label="Previous match"
      >
        ▲
      </button>

      <button
        className="search-bar__nav"
        data-testid="search-next"
        onClick={handleNextClick}
        type="button"
        title="Next Match (Enter)"
        aria-label="Next match"
      >
        ▼
      </button>

      <button
        className="search-bar__close"
        data-testid="search-close"
        onClick={onClose}
        type="button"
        title="Close (Escape)"
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  );
}
