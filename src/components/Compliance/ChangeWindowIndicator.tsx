/**
 * ChangeWindowIndicator — green/red lock icon showing whether a
 * change window is currently active.
 *
 * Polls the backend periodically to check window status.
 * Green lock = within a change window (safe to make changes).
 * Red lock = outside all change windows (dangerous commands will warn).
 *
 * @module ChangeWindowIndicator
 */
import { useState, useEffect, useCallback } from "react";
import { changeWindowActive } from "./complianceApi";
import "./Compliance.css";

/** Polling interval for change window status (ms). */
const POLL_INTERVAL_MS = 60_000;

/** Lock icon indicator for the tab bar. */
export function ChangeWindowIndicator() {
  const [isActive, setIsActive] = useState<boolean | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const active = await changeWindowActive();
      setIsActive(active);
    } catch {
      // Backend not available — hide indicator
      setIsActive(null);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkStatus]);

  if (isActive === null) return null;

  return (
    <span
      className={`change-window-indicator ${isActive ? "change-window-indicator--active" : "change-window-indicator--inactive"}`}
      title={
        isActive
          ? "Within change window — changes allowed"
          : "Outside change window — dangerous commands will warn"
      }
      aria-label={isActive ? "Change window active" : "Change window inactive"}
      data-testid="change-window-indicator"
    >
      {isActive ? "🔓" : "🔒"}
    </span>
  );
}
