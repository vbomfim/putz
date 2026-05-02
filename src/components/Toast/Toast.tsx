/**
 * Toast — Minimal auto-dismiss notification component.
 *
 * Displays a brief text message that automatically disappears
 * after a timeout (default 2 seconds). Uses a "single replace"
 * pattern: each new toast supersedes the previous one.
 *
 * Accessibility: `role="status"` + `aria-live="polite"` for
 * screen reader announcement without interrupting the user.
 *
 * Design decision: single-replace (not queue/stack) for simplicity.
 * Each new toast immediately replaces the previous one. This avoids
 * stacking complexity and matches the expected UX for bookmark
 * confirmations (rapid Cmd+D presses → only latest toast visible).
 *
 * Also closes #74 (toast notification system).
 *
 * @module Toast
 */
import { useState, useEffect, useCallback, useRef } from "react";
import "./Toast.css";

// ─── Types ───────────────────────────────────────────────────────────

export interface ToastMessage {
  /** Unique key to force re-render on duplicate text. */
  key: number;
  /** Display text. */
  text: string;
}

export interface ToastProps {
  /** Current toast message, or null to hide. */
  message: ToastMessage | null;
  /** Auto-dismiss timeout in milliseconds (default 2000). */
  duration?: number;
  /** Called when the toast is dismissed (timeout or manual). */
  onDismiss?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────

/** Auto-dismiss toast notification. Bottom-right corner, CSS slide-in. */
export function Toast({
  message,
  duration = 2000,
  onDismiss,
}: ToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    // Show immediately, set dismiss timer
    setVisible(true);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, duration);

    return clearTimer;
  }, [message, duration, clearTimer, onDismiss]);

  if (!message || !visible) return null;

  return (
    <div className="toast" role="status" aria-live="polite" data-testid="toast">
      <span className="toast__text">{message.text}</span>
    </div>
  );
}
