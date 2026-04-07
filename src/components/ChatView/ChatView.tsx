/**
 * ChatView — Expect-style structured session log.
 *
 * Alternative view for terminal sessions that displays I/O as
 * structured command/response pairs with timestamps, collapsible
 * sections, and in-log search.
 *
 * @module ChatView
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatEntry } from "./types";
import "./ChatView.css";

/** Props for the ChatView component. */
interface ChatViewProps {
  /** Whether the chat view is visible. */
  isOpen: boolean;
  /** Callback to close the chat view. */
  onClose: () => void;
  /** Session ID for terminal I/O association. */
  sessionId?: string;
  /** Callback to send a command to the terminal. */
  onSendCommand?: (command: string) => void;
}

/** Generates a unique ID for chat entries. */
function generateEntryId(): string {
  return crypto.randomUUID();
}

/** Formats a timestamp for display in the chat log. */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ChatView({ isOpen, onClose, onSendCommand }: ChatViewProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  /** Scrolls the log to the bottom when new entries are added. */
  useEffect(() => {
    if (logEndRef.current && typeof logEndRef.current.scrollIntoView === "function") {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries]);

  /** Focus the input when view opens. */
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  /** Sends a command and logs it as a chat entry. */
  const handleSendCommand = useCallback(() => {
    const trimmed = commandInput.trim();
    if (!trimmed) return;

    const entry: ChatEntry = {
      id: generateEntryId(),
      timestamp: new Date().toISOString(),
      command: trimmed,
      response: "",
      isCollapsed: false,
    };

    setEntries((prev) => [...prev, entry]);
    setCommandInput("");
    onSendCommand?.(trimmed);
  }, [commandInput, onSendCommand]);

  /** Handles Enter key in the command input. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSendCommand();
      }
    },
    [handleSendCommand],
  );

  /** Toggles the collapsed state of a chat entry. */
  const toggleCollapse = useCallback((entryId: string) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId
          ? { ...entry, isCollapsed: !entry.isCollapsed }
          : entry,
      ),
    );
  }, []);

  /** Collapses all entries. */
  const collapseAll = useCallback(() => {
    setEntries((prev) => prev.map((entry) => ({ ...entry, isCollapsed: true })));
  }, []);

  /** Expands all entries. */
  const expandAll = useCallback(() => {
    setEntries((prev) =>
      prev.map((entry) => ({ ...entry, isCollapsed: false })),
    );
  }, []);

  /** Clears the chat log. */
  const handleClear = useCallback(() => {
    setEntries([]);
  }, []);

  /** Toggles in-log search. */
  const toggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => !prev);
    if (isSearchOpen) {
      setSearchQuery("");
    }
  }, [isSearchOpen]);

  /** Filters entries based on search query. */
  const filteredEntries = searchQuery
    ? entries.filter(
        (entry) =>
          entry.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
          entry.response.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : entries;

  /** Close on Escape key. */
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="chat-view" data-testid="chat-view">
      <div className="chat-view__header">
        <h2>Session Chat Log</h2>
        <div className="chat-view__controls">
          <button
            className="chat-view__btn"
            onClick={toggleSearch}
            type="button"
            data-testid="chat-view-search-toggle"
            title="Search (Ctrl+F)"
          >
            🔍
          </button>
          <button
            className="chat-view__btn"
            onClick={collapseAll}
            type="button"
            title="Collapse all"
            data-testid="chat-view-collapse-all"
          >
            ▲
          </button>
          <button
            className="chat-view__btn"
            onClick={expandAll}
            type="button"
            title="Expand all"
            data-testid="chat-view-expand-all"
          >
            ▼
          </button>
          <button
            className="chat-view__btn"
            onClick={handleClear}
            type="button"
            data-testid="chat-view-clear"
          >
            Clear
          </button>
          <button
            className="chat-view__close"
            onClick={onClose}
            type="button"
            aria-label="Close chat view"
            data-testid="chat-view-close"
          >
            ✕
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="chat-view__search" data-testid="chat-view-search">
          <input
            className="chat-view__search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search commands and responses..."
            data-testid="chat-view-search-input"
          />
          <span className="chat-view__search-count">
            {filteredEntries.length} / {entries.length}
          </span>
        </div>
      )}

      <div className="chat-view__log" data-testid="chat-view-log">
        {filteredEntries.length === 0 && (
          <div className="chat-view__empty">
            {entries.length === 0
              ? "No commands sent yet. Type a command below."
              : "No matching entries found."}
          </div>
        )}

        {filteredEntries.map((entry) => (
          <div
            key={entry.id}
            className="chat-view__entry"
            data-testid={`chat-entry-${entry.id}`}
          >
            <div
              className="chat-view__entry-header"
              onClick={() => toggleCollapse(entry.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleCollapse(entry.id);
                }
              }}
            >
              <span className="chat-view__collapse-icon">
                {entry.isCollapsed ? "▶" : "▼"}
              </span>
              <span className="chat-view__timestamp">
                [{formatTimestamp(entry.timestamp)}]
              </span>
              <span className="chat-view__direction chat-view__direction--sent">
                →
              </span>
              <span className="chat-view__command">{entry.command}</span>
            </div>

            {!entry.isCollapsed && entry.response && (
              <div className="chat-view__response">
                <span className="chat-view__timestamp">
                  [{formatTimestamp(entry.timestamp)}]
                </span>
                <span className="chat-view__direction chat-view__direction--received">
                  ←
                </span>
                <pre className="chat-view__response-text">{entry.response}</pre>
              </div>
            )}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <div className="chat-view__input-bar">
        <span className="chat-view__prompt">$</span>
        <input
          ref={inputRef}
          className="chat-view__input"
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          spellCheck={false}
          data-testid="chat-view-input"
        />
        <button
          className="chat-view__send-btn"
          onClick={handleSendCommand}
          type="button"
          disabled={!commandInput.trim()}
          data-testid="chat-view-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}
