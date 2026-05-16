/**
 * `InboxPanel` — modal Cmd+J inbox grouped by colleague (T4 / FR-014).
 *
 * Behavior:
 *  - role="dialog", aria-modal="true"
 *  - ESC closes
 *  - "Mark all read" button
 *  - rows display severity, message, "N min ago", colleague name
 *  - clicking a row focuses the colleague's tab and marks the
 *    associated entries read
 *  - tier-2 PII: messages are user-authored — never logged
 *
 * @module components/Swarm/InboxPanel
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useSwarmInboxStore,
  getEntriesByColleague,
  type NotifyEntry,
} from "../../stores/swarmInboxStore";
// F5: `formatRelativeTime` lives in `lib/swarm/formatters` so this
// component module exports ONLY React components — required for
// react-refresh / HMR stability.
import { formatRelativeTime } from "../../lib/swarm/formatters";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface Props {
  open: boolean;
  onClose: () => void;
  onFocusTab: (tabId: string) => void;
  /** Test seam: override "now" for deterministic relative-time strings. */
  nowMs?: number;
}

// D2: WCAG AA-compliant severity tints (≥4.5:1 vs white text on these
// accent backgrounds in the InboxPanel rows). Documentation only —
// applied via `.swarm-inbox-entry--${severity}` in `Swarm.css`.
//   urgent  → var(--swarm-ring-urgent,  #b91c1c)
//   normal  → var(--swarm-ring-normal,  #1d4ed8)
//   ambient → var(--swarm-ring-ambient, #6b7280)

export function InboxPanel({ open, onClose, onFocusTab, nowMs }: Props) {
  const allEntries = useSwarmInboxStore((s) => s.entries);
  const markAllRead = useSwarmInboxStore((s) => s.markAllRead);
  const markAllReadForTab = useSwarmInboxStore((s) => s.markAllReadForTab);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // D1: trap Tab focus inside the dialog while it is open
  // (WAI-ARIA APG modal pattern).
  useFocusTrap(dialogRef, open);

  // ESC closes — registered while open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Move focus into the dialog when it opens (a11y).
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  const now = nowMs ?? Date.now();

  const groups = useMemo(() => getEntriesByColleague(allEntries), [allEntries]);

  const handleRowClick = useCallback(
    (entry: NotifyEntry) => {
      markAllReadForTab(entry.tabId);
      onFocusTab(entry.tabId);
    },
    [markAllReadForTab, onFocusTab],
  );

  if (!open) return null;

  return (
    <div
      className="swarm-inbox-overlay"
      data-testid="swarm-inbox-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="swarm-inbox-panel"
        data-testid="swarm-inbox-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Swarm inbox"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="swarm-inbox-panel__header">
          <h2 className="swarm-inbox-panel__title">Inbox</h2>
          <div className="swarm-inbox-panel__actions">
            <button
              type="button"
              className="swarm-inbox-panel__btn"
              data-testid="inbox-mark-all-read"
              onClick={() => markAllRead()}
              disabled={groups.length === 0}
            >
              Mark all read
            </button>
            <button
              type="button"
              className="swarm-inbox-panel__btn"
              data-testid="inbox-close"
              onClick={onClose}
              aria-label="Close inbox"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="swarm-inbox-panel__body">
          {groups.length === 0 ? (
            <div className="swarm-inbox-panel__empty" data-testid="inbox-empty">
              No notifications yet. Use <code>swarm_notify</code> from a
              colleague to send one.
            </div>
          ) : (
            groups.map((group) => (
              <section
                key={group.colleagueId}
                className="swarm-inbox-group"
                data-testid={`inbox-group-${group.colleagueId}`}
              >
                <div className="swarm-inbox-group__header">
                  {group.colleagueId} ({group.entries.length})
                </div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`swarm-inbox-entry swarm-inbox-entry--${entry.severity}${
                      entry.read ? "" : " swarm-inbox-entry--unread"
                    }`}
                    data-testid="inbox-entry"
                    data-entry-id={entry.id}
                    data-read={entry.read ? "true" : "false"}
                    onClick={() => handleRowClick(entry)}
                  >
                    <div className="swarm-inbox-entry__row">
                      <span className="swarm-inbox-entry__message">
                        {entry.message}
                      </span>
                      <span className="swarm-inbox-entry__time">
                        {formatRelativeTime(entry.timestampMs, now)}
                      </span>
                    </div>
                  </button>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
