/**
 * HistoryPanel — Ctrl+R search overlay for cross-session command history.
 *
 * Opens as a floating panel when Ctrl+R is pressed.
 * Provides real-time search with results from the SQLite history database.
 * Clicking a result inserts the command text.
 *
 * @module HistoryPanel
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { historySearch } from "./historyApi";
import type { CommandEntry } from "./types";
import "./History.css";

interface HistoryPanelProps {
  /** Whether the panel is visible. */
  isOpen: boolean;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called when the user selects a command from history. */
  onSelect: (command: string) => void;
  /** Optional session ID to filter results. */
  sessionId?: string;
}

/** Debounce delay in milliseconds for search input. */
const SEARCH_DEBOUNCE_MS = 200;

/** Maximum results to display. */
const MAX_DISPLAY_RESULTS = 50;

export function HistoryPanel({
  isOpen,
  onClose,
  onSelect,
  sessionId,
}: HistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setError(null);
      // Small delay to let the panel render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  const performSearch = useCallback(
    (searchQuery: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!searchQuery.trim()) {
        setResults([]);
        setSelectedIndex(0);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setIsSearching(true);
        setError(null);
        try {
          const entries = await historySearch({
            query: searchQuery,
            sessionId,
            limit: MAX_DISPLAY_RESULTS,
          });
          setResults(entries);
          setSelectedIndex(0);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Search failed";
          setError(message);
          setResults([]);
        } finally {
          setIsSearching(false);
        }
      }, SEARCH_DEBOUNCE_MS);
    },
    [sessionId],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      performSearch(value);
    },
    [performSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelect(results[selectedIndex].command);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onSelect, onClose],
  );

  const handleResultClick = useCallback(
    (command: string) => {
      onSelect(command);
      onClose();
    },
    [onSelect, onClose],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="history-panel-overlay"
      data-testid="history-panel"
      onClick={onClose}
    >
      <div
        className="history-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command history search"
      >
        <div className="history-panel-header">
          <span className="history-panel-icon">🔍</span>
          <input
            ref={inputRef}
            className="history-panel-input"
            type="text"
            placeholder="Search command history… (Ctrl+R)"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            data-testid="history-search-input"
            aria-label="Search command history"
          />
          <button
            className="history-panel-close"
            onClick={onClose}
            type="button"
            aria-label="Close history panel"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="history-panel-error" data-testid="history-error">
            {error}
          </div>
        )}

        {isSearching && (
          <div className="history-panel-status">Searching…</div>
        )}

        {results.length > 0 && (
          <ul
            className="history-panel-results"
            data-testid="history-results"
            role="listbox"
          >
            {results.map((entry, index) => (
              <li
                key={entry.id}
                className={`history-panel-result ${index === selectedIndex ? "history-panel-result--selected" : ""}`}
                onClick={() => handleResultClick(entry.command)}
                role="option"
                aria-selected={index === selectedIndex}
                data-testid={`history-result-${index}`}
              >
                <span className="history-result-command">{entry.command}</span>
                <span className="history-result-meta">
                  {entry.host && (
                    <span className="history-result-host">{entry.host}</span>
                  )}
                  <span className="history-result-session">
                    {entry.sessionName}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {!isSearching && query.trim() && results.length === 0 && !error && (
          <div className="history-panel-empty" data-testid="history-empty">
            No matching commands found
          </div>
        )}
      </div>
    </div>
  );
}
