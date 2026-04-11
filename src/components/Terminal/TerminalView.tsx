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
 * - onBell: callback when a visual bell (\a) is received
 */
import { useCallback, useState } from "react";
import { useTerminal } from "./useTerminal";
import { useSearch } from "./useSearch";
import { SearchBar } from "./SearchBar";
import { TerminalBackground, type BackgroundEffect } from "./TerminalBackground";
import { ChangeWindowWarning } from "../Compliance/ChangeWindowWarning";
import { BELL_FLASH_CLASS, BELL_FLASH_DURATION_MS } from "./terminalPolish";
import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore } from "../../stores/themeStore";
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
  /** Optional ref to the tab element for visual bell flash. */
  tabElementId?: string;
  /** Whether change window enforcement is enabled. */
  changeWindowEnabled?: boolean;
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
  tabElementId,
  changeWindowEnabled = false,
}: TerminalViewProps) {
  const [hostname, setHostname] = useState("");
  const backgroundEffect = useSettingsStore((s) => s.backgroundEffect) as BackgroundEffect;
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const termColors = useThemeStore((s) => s.activeColors);
  const fgColor = (termColors as Record<string, string> | null)?.foreground || "#cdd6f4";

  // Extract hostname from terminal title (format: "user@hostname: path" or "hostname")
  const handleTitleChangeWithHostname = useCallback((title: string) => {
    onTitleChange?.(title);
    // Extract host: "user@router-1: ~" → "router-1", or "router-1" → "router-1"
    const atMatch = title.match(/@([^:@\s]+)/);
    if (atMatch) {
      setHostname(atMatch[1]);
    } else {
      const colonMatch = title.match(/^([^:\s]+)/);
      if (colonMatch && !colonMatch[1].includes("/")) {
        setHostname(colonMatch[1]);
      }
    }
  }, [onTitleChange]);
  // Fix 3: Visual bell — briefly flash the terminal wrapper
  const handleBell = useCallback(() => {
    // Flash the tab element if available, otherwise flash the terminal wrapper
    const targetId = tabElementId;
    if (targetId) {
      const tabEl = document.querySelector(`[data-tab-id="${targetId}"]`);
      if (tabEl) {
        tabEl.classList.add(BELL_FLASH_CLASS);
        setTimeout(() => tabEl.classList.remove(BELL_FLASH_CLASS), BELL_FLASH_DURATION_MS);
        return;
      }
    }
    // Fallback: flash the terminal wrapper
    const wrapper = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (wrapper) {
      wrapper.classList.add(BELL_FLASH_CLASS);
      setTimeout(() => wrapper.classList.remove(BELL_FLASH_CLASS), BELL_FLASH_DURATION_MS);
    }
  }, [tabElementId, sessionId]);

  const {
    terminalRef,
    isReady,
    error,
    hasExited,
    highlightEnabled,
    terminalInstance,
    changeWindowWarning,
    onChangeWindowProceed,
    onChangeWindowCancel,
  } =
    useTerminal({
      sessionId,
      onTitleChange: handleTitleChangeWithHostname,
      highlightSetId,
      onBell: handleBell,
      changeWindowEnabled,
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
      data-session-id={sessionId}
    >
      <TerminalBackground
        effect={backgroundEffect}
        opacity={backgroundOpacity}
        color={fgColor}
        hostname={hostname}
      />
      {searchOpen && (
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
      {changeWindowWarning.show && (
        <ChangeWindowWarning
          command={changeWindowWarning.command}
          reason={changeWindowWarning.reason}
          onProceed={onChangeWindowProceed}
          onCancel={onChangeWindowCancel}
        />
      )}
    </div>
  );
}
