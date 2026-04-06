/**
 * TerminalView — React component wrapping xterm.js for terminal display.
 *
 * Renders a full-viewport terminal connected to a PTY session via Tauri IPC.
 * Handles loading, error, and process-exited states.
 *
 * Props:
 * - sessionId: UUID v4 identifying the PTY session
 * - onTitleChange: callback for shell title escape sequences
 * - onRestart: callback to restart a closed session
 */
import { useTerminal } from "./useTerminal";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalViewProps {
  /** UUID v4 session identifier from pty_spawn. */
  sessionId: string;
  /** Callback when the terminal title changes (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Callback to restart the terminal after the process exits. */
  onRestart?: () => void;
}

/** Terminal emulator view connected to a PTY backend session. */
export function TerminalView({
  sessionId,
  onTitleChange,
  onRestart,
}: TerminalViewProps) {
  const { terminalRef, isReady, error, hasExited } = useTerminal({
    sessionId,
    onTitleChange,
  });

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
    <div className="terminal-wrapper" data-testid="terminal-wrapper">
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
      {hasExited && onRestart && (
        <div className="terminal-exit-overlay" data-testid="terminal-exit-overlay">
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
