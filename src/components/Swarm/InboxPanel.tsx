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
  type NotifySeverity,
} from "../../stores/swarmInboxStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onFocusTab: (tabId: string) => void;
  /** Test seam: override "now" for deterministic relative-time strings. */
  nowMs?: number;
}

const SEVERITY_COLOR: Record<NotifySeverity, string> = {
  urgent: "var(--swarm-ring-urgent, #ef4444)",
  normal: "var(--swarm-ring-normal, #3b82f6)",
  ambient: "var(--swarm-ring-ambient, #6b7280)",
};

/**
 * Render an absolute timestamp as "Xs/Xm/Xh/Xd ago".
 * Any future timestamp clamps to "just now" — clock skew across hosts
 * is not a UI bug.
 */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
  const delta = Math.max(0, nowMs - timestampMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function InboxPanel({ open, onClose, onFocusTab, nowMs }: Props) {
  const allEntries = useSwarmInboxStore((s) => s.entries);
  const markAllRead = useSwarmInboxStore((s) => s.markAllRead);
  const markAllReadForTab = useSwarmInboxStore((s) => s.markAllReadForTab);
  const dialogRef = useRef<HTMLDivElement | null>(null);

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
        zIndex: 1000,
      }}
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
        style={{
          width: "min(560px, 90vw)",
          maxHeight: "70vh",
          background: "var(--bg-primary, #1a1a1a)",
          color: "var(--text-primary, #e1e4e8)",
          borderRadius: "8px",
          border: "1px solid var(--border-color, #2a2a2a)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        <header
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border-color, #2a2a2a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
            Inbox
          </h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              data-testid="inbox-mark-all-read"
              onClick={() => markAllRead()}
              disabled={groups.length === 0}
              style={{
                background: "transparent",
                color: "inherit",
                border: "1px solid var(--border-color, #2a2a2a)",
                borderRadius: "3px",
                fontSize: "11px",
                padding: "3px 8px",
                cursor: groups.length === 0 ? "default" : "pointer",
                opacity: groups.length === 0 ? 0.5 : 1,
              }}
            >
              Mark all read
            </button>
            <button
              type="button"
              data-testid="inbox-close"
              onClick={onClose}
              aria-label="Close inbox"
              style={{
                background: "transparent",
                color: "inherit",
                border: "1px solid var(--border-color, #2a2a2a)",
                borderRadius: "3px",
                fontSize: "11px",
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          {groups.length === 0 ? (
            <div
              data-testid="inbox-empty"
              style={{
                padding: "32px 14px",
                textAlign: "center",
                opacity: 0.65,
                fontSize: "13px",
              }}
            >
              No notifications yet. Use <code>swarm_notify</code> from a
              colleague to send one.
            </div>
          ) : (
            groups.map((group) => (
              <section
                key={group.colleagueId}
                data-testid={`inbox-group-${group.colleagueId}`}
                style={{ padding: "4px 0" }}
              >
                <div
                  style={{
                    padding: "4px 14px",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    opacity: 0.7,
                    fontWeight: 600,
                  }}
                >
                  {group.colleagueId} ({group.entries.length})
                </div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-testid="inbox-entry"
                    data-entry-id={entry.id}
                    data-read={entry.read ? "true" : "false"}
                    onClick={() => handleRowClick(entry)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 14px",
                      background: entry.read
                        ? "transparent"
                        : "var(--bg-secondary, #15171a)",
                      color: "inherit",
                      border: "none",
                      borderLeft: `3px solid ${SEVERITY_COLOR[entry.severity]}`,
                      cursor: "pointer",
                      display: "block",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: entry.read ? 400 : 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: "1 1 auto",
                          minWidth: 0,
                        }}
                      >
                        {entry.message}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          opacity: 0.6,
                          flexShrink: 0,
                        }}
                      >
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
