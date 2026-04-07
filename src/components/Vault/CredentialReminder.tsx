/**
 * CredentialReminder — notification bar for expiring credentials.
 *
 * Checks for credentials expiring within a configurable number of days
 * and displays a dismissable notification bar with an expandable list.
 * Each expiring credential has an "Update Now" button that opens the
 * credential editor.
 *
 * Checks on mount (startup) and can be re-checked on demand.
 *
 * @module CredentialReminder
 */
import { useState, useCallback, useEffect } from "react";
import type { CredentialMeta } from "../Vault/types";
import { vaultCheckExpiring } from "../Vault/vaultApi";
import "../Compliance/Compliance.css";

/** Default lookahead period in days. */
const DEFAULT_DAYS_AHEAD = 7;

interface CredentialReminderProps {
  /** Number of days to look ahead for expiring credentials. */
  daysAhead?: number;
  /** Called when user clicks "Update Now" on a credential. */
  onUpdateCredential?: (id: string) => void;
}

/** Notification bar for expiring credentials. */
export function CredentialReminder({
  daysAhead = DEFAULT_DAYS_AHEAD,
  onUpdateCredential,
}: CredentialReminderProps) {
  const [expiring, setExpiring] = useState<CredentialMeta[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const checkExpiring = useCallback(async () => {
    try {
      const list = await vaultCheckExpiring(daysAhead);
      setExpiring(list);
    } catch {
      // Backend not available — silently skip
      setExpiring([]);
    }
  }, [daysAhead]);

  // Check on mount (startup)
  useEffect(() => {
    checkExpiring();
  }, [checkExpiring]);

  // Don't render if dismissed or no expiring credentials
  if (dismissed || expiring.length === 0) return null;

  /** Formats an expiry date for display. */
  const formatExpiry = (dateStr?: string): string => {
    if (!dateStr) return "Unknown";
    try {
      const expires = new Date(dateStr);
      const now = new Date();
      const diffMs = expires.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return "Expired";
      if (diffDays === 1) return "Expires tomorrow";
      return `Expires in ${diffDays} days`;
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      <div
        className="credential-reminder"
        data-testid="credential-reminder"
        role="alert"
      >
        <span className="credential-reminder__icon" aria-hidden="true">
          🔑
        </span>
        <span className="credential-reminder__message">
          {expiring.length === 1
            ? "1 credential expires"
            : `${expiring.length} credentials expire`}{" "}
          within {daysAhead} days
        </span>
        <button
          className="credential-reminder__link"
          onClick={() => setExpanded(!expanded)}
          data-testid="credential-reminder-toggle"
          type="button"
        >
          {expanded ? "Hide" : "Show"}
        </button>
        <button
          className="credential-reminder__dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss reminder"
          data-testid="credential-reminder-dismiss"
          type="button"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div
          className="credential-reminder-list"
          data-testid="credential-reminder-list"
        >
          <ul className="credential-reminder-list__items">
            {expiring.map((cred) => (
              <li key={cred.id} className="credential-reminder-list__item">
                <span className="credential-reminder-list__name">
                  {cred.name}
                </span>
                <span className="credential-reminder-list__expires">
                  {formatExpiry(cred.expiresAt)}
                </span>
                {onUpdateCredential && (
                  <button
                    className="credential-reminder-list__update"
                    onClick={() => onUpdateCredential(cred.id)}
                    data-testid={`credential-reminder-update-${cred.id}`}
                    type="button"
                  >
                    Update Now
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
