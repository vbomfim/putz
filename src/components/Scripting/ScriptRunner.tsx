/**
 * ScriptRunner — output log panel for script execution.
 *
 * Shows real-time log output from a running script with
 * status indicator, elapsed time, and stop button.
 *
 * @module ScriptRunner
 */
import { useEffect, useRef } from "react";
import type { ScriptLogEntry, ScriptStatus } from "./types";

interface ScriptRunnerProps {
  /** Current run status. */
  status: ScriptStatus;
  /** Log entries from the script execution. */
  logEntries: ScriptLogEntry[];
  /** Callback to stop the running script. */
  onStop?: () => void;
  /** Callback to clear the log and close. */
  onClear?: () => void;
  /** ISO 8601 timestamp when the run started. */
  startedAt?: string;
  /** Error message if the script failed. */
  error?: string | null;
}

/**
 * Script execution output panel.
 */
export function ScriptRunner({
  status,
  logEntries,
  onStop,
  onClear,
  startedAt,
  error,
}: ScriptRunnerProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries (scrollIntoView may not exist in jsdom)
  useEffect(() => {
    if (logEndRef.current && typeof logEndRef.current.scrollIntoView === "function") {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logEntries]);

  const isActive = status === "running" || status === "pending";

  /** Returns a CSS class for the status badge. */
  const statusClass = (): string => {
    switch (status) {
      case "running":
        return "script-runner__status--running";
      case "completed":
        return "script-runner__status--completed";
      case "failed":
        return "script-runner__status--failed";
      case "stopped":
        return "script-runner__status--stopped";
      default:
        return "";
    }
  };

  /** Returns a human-readable status label. */
  const statusLabel = (): string => {
    switch (status) {
      case "pending":
        return "Pending…";
      case "running":
        return "Running…";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "stopped":
        return "Stopped";
      default:
        return status;
    }
  };

  /** Returns a CSS class for a log level. */
  const logLevelClass = (level: string): string => {
    switch (level) {
      case "error":
        return "script-log--error";
      case "warn":
        return "script-log--warn";
      case "output":
        return "script-log--output";
      default:
        return "script-log--info";
    }
  };

  return (
    <div
      className="script-runner"
      data-testid="script-runner"
      role="log"
      aria-label="Script execution output"
    >
      {/* Status bar */}
      <div className="script-runner__header">
        <span
          className={`script-runner__status ${statusClass()}`}
          data-testid="script-runner-status"
        >
          {statusLabel()}
        </span>

        {startedAt && (
          <span className="script-runner__started">
            Started: {new Date(startedAt).toLocaleTimeString()}
          </span>
        )}

        <div className="script-runner__controls">
          {isActive && onStop && (
            <button
              type="button"
              className="script-runner__stop-btn"
              onClick={onStop}
              data-testid="script-runner-stop"
              aria-label="Stop script"
            >
              ⏹ Stop
            </button>
          )}
          {!isActive && onClear && (
            <button
              type="button"
              className="script-runner__clear-btn"
              onClick={onClear}
              data-testid="script-runner-clear"
              aria-label="Clear output"
            >
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div className="script-runner__entries" data-testid="script-runner-entries">
        {logEntries.length === 0 && isActive && (
          <div className="script-runner__waiting">
            Waiting for output…
          </div>
        )}

        {logEntries.map((entry, idx) => (
          <div
            key={idx}
            className={`script-log__entry ${logLevelClass(entry.level)}`}
          >
            <span className="script-log__time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="script-log__level">[{entry.level}]</span>
            <span className="script-log__message">{entry.message}</span>
          </div>
        ))}

        {error && (
          <div className="script-log__entry script-log--error" data-testid="script-runner-error">
            <span className="script-log__message">Error: {error}</span>
          </div>
        )}

        <div ref={logEndRef} />
      </div>
    </div>
  );
}
