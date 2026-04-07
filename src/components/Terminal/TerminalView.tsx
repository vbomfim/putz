/**
 * TerminalView — React component wrapping xterm.js for terminal display.
 *
 * Renders a full-viewport terminal connected to a PTY session via Tauri IPC.
 * Handles loading, error, and process-exited states.
 * Includes an integrated search bar overlay (Ctrl+F).
 * Supports keyword highlighting with optional highlight set.
 *
 * Props:
 * - sessionId: UUID v4 identifying the PTY session
 * - onTitleChange: callback for shell title escape sequences
 * - onRestart: callback to restart a closed session
 * - isSearchOpen: whether the search bar should be visible
 * - onSearchClose: callback when search bar is closed
 * - highlightSetId: optional highlight set ID to apply
 */
import { useTerminal } from "./useTerminal";
import { useSearch } from "./useSearch";
import { SearchBar } from "./SearchBar";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalViewProps {
  /** UUID v4 session identifier from pty_spawn. */
  sessionId: string;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback to restart the terminal after the process exits. */
  onRestart?: () => void;
  /** Whether the search bar is open (controlled by parent). */
  isSearchOpen?: boolean;
  /** Callback to close the search bar. */
  onSearchClose?: () => void;
  /** Optional highlight set ID to apply for keyword highlighting. */
  highlightSetId?: string;
  /** Whether this terminal is a broadcast target (red border indicator). */
  isBroadcastTarget?: boolean;
}

/** Terminal emulator view connected to a PTY backend session. */
export function TerminalView({
  sessionId,
  onTitleChange,
  onRestart,
  isSearchOpen: externalSearchOpen,
  onSearchClose,
  highlightSetId,
  isBroadcastTarget,
}: TerminalViewProps) {
  const { terminalRef, isReady, error, hasExited, highlightEnabled, terminalInstance } =
    useTerminal({
      sessionId,
      onTitleChange,
      highlightSetId,
    });

  const search = useSearch({ terminal: terminalInstance });

  // Use external search state if provided, otherwise internal
  const searchOpen =
    externalSearchOpen !== undefined
      ? externalSearchOpen
      : search.isSearchOpen;

  const handleSearchClose = () => {
    search.closeSearch();
    onSearchClose?.();
  };

  if (error) {
    return (
      <div className="terminal-error" data-testid="terminal-error">
        <h2>Terminal Error</h2>
        <p>{error}</p>
        <p className="terminal-error-hint">
          Check that a shell is available on your system.
        </p>
        {onRestart && (
          <button
            className="terminal-restart-btn"
            onClick={onRestart}
            type="button"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`terminal-wrapper${isBroadcastTarget ? " terminal-wrapper--broadcast-target" : ""}`}
      data-testid="terminal-wrapper"
    >      {searchOpen && (
        <SearchBar
          onSearch={search.findNext}
          onSearchPrevious={search.findPrevious}
          onClose={handleSearchClose}
          onCaseSensitiveToggle={search.toggleCaseSensitive}
          onRegexToggle={search.toggleRegex}
          hasResults={search.hasResults}
          caseSensitive={search.caseSensitive}
          useRegex={search.useRegex}
        />
      )}
      {!isReady && (
        <div className="terminal-loading" data-testid="terminal-loading">
          <span>Starting terminal…</span>
        </div>
      )}
      <div
        ref={terminalRef}
        className="terminal-container"
        data-testid="terminal-container"
      />
      {highlightEnabled && (
        <div
          className="terminal-highlight-indicator"
          data-testid="highlight-indicator"
          title="Keyword highlighting active (Ctrl+Shift+H to toggle)"
        >
          HL
        </div>
      )}
      {hasExited && onRestart && (
        <div
          className="terminal-exit-overlay"
          data-testid="terminal-exit-overlay"
        >
          <button
            className="terminal-restart-btn"
            onClick={onRestart}
            type="button"
          >
            Restart Terminal
          </button>
        </div>
      )}
    </div>
  );
}
