/**
 * SessionSearch — search input with debounced filtering.
 *
 * Debounces input by 200ms and calls onSearch with the query string.
 * Shows a clear button when text is present.
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface SessionSearchProps {
  /** Called with the debounced search query. */
  onSearch: (query: string) => void;
  /** Placeholder text. */
  placeholder?: string;
}

/** Debounce delay in milliseconds. */
const DEBOUNCE_MS = 200;

export function SessionSearch({
  onSearch,
  placeholder = "Search sessions…",
}: SessionSearchProps) {
  const [value, setValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        onSearch(newValue);
      }, DEBOUNCE_MS);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setValue("");
    onSearch("");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, [onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="session-search" data-testid="session-search">
      <input
        type="text"
        className="session-search-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Search sessions"
        data-testid="session-search-input"
      />
      {value && (
        <button
          className="session-search-clear"
          onClick={handleClear}
          type="button"
          aria-label="Clear search"
          data-testid="session-search-clear"
        >
          ×
        </button>
      )}
    </div>
  );
}
