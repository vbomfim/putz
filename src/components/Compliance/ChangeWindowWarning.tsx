/**
 * ChangeWindowWarning — modal dialog shown when a dangerous command
 * is attempted outside a maintenance window.
 *
 * Displays the blocked command and reason, with options to proceed
 * anyway or cancel.
 *
 * Accessibility: role="alertdialog", aria-modal, auto-focus on Cancel.
 *
 * @module ChangeWindowWarning
 */
import { useCallback, useEffect, useRef } from "react";
import "./Compliance.css";

interface ChangeWindowWarningProps {
  /** The command that was blocked. */
  command: string;
  /** Human-readable reason from the backend. */
  reason: string;
  /** Called when user clicks "Proceed Anyway". */
  onProceed: () => void;
  /** Called when user clicks "Cancel". */
  onCancel: () => void;
}

/** Warning modal for dangerous commands outside change windows. */
export function ChangeWindowWarning({
  command,
  reason,
  onProceed,
  onCancel,
}: ChangeWindowWarningProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Auto-focus Cancel button (safe default)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="change-window-warning-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cw-warning-title"
      aria-describedby="cw-warning-desc"
      onKeyDown={handleKeyDown}
      data-testid="change-window-warning"
    >
      <div className="change-window-warning">
        <div className="change-window-warning__header">
          <span className="change-window-warning__icon" aria-hidden="true">
            ⚠️
          </span>
          <h3 id="cw-warning-title" className="change-window-warning__title">
            Outside Change Window
          </h3>
        </div>

        <p id="cw-warning-desc" className="change-window-warning__reason">
          {reason}
        </p>

        <div className="change-window-warning__command">
          <code data-testid="change-window-command">{command}</code>
        </div>

        <div className="change-window-warning__actions">
          <button
            ref={cancelRef}
            className="change-window-warning__btn change-window-warning__btn--cancel"
            onClick={onCancel}
            data-testid="change-window-cancel"
            type="button"
          >
            Cancel
          </button>
          <button
            className="change-window-warning__btn change-window-warning__btn--proceed"
            onClick={onProceed}
            data-testid="change-window-proceed"
            type="button"
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
