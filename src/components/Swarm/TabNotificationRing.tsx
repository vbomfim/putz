/**
 * `TabNotificationRing` — small badge that overlays a tab to indicate
 * unread swarm notifications (T4 / FR-013).
 *
 * The ring color reflects the highest-severity unread entry and the
 * count is rendered when ≤ 99, "99+" beyond.
 *
 * Severity → color:
 *  - urgent  → red
 *  - normal  → blue
 *  - ambient → gray
 *
 * Returns `null` when there are no unread entries — no DOM noise.
 *
 * @module components/Swarm/TabNotificationRing
 */
import {
  useSwarmInboxStore,
  unreadCountForTab,
  highestSeverityForTab,
  type NotifySeverity,
} from "../../stores/swarmInboxStore";

interface Props {
  tabId: string;
}

const COLOR: Record<NotifySeverity, string> = {
  urgent: "var(--swarm-ring-urgent, #ef4444)",
  normal: "var(--swarm-ring-normal, #3b82f6)",
  ambient: "var(--swarm-ring-ambient, #6b7280)",
};

const LABEL: Record<NotifySeverity, string> = {
  urgent: "urgent",
  normal: "normal",
  ambient: "ambient",
};

export function TabNotificationRing({ tabId }: Props) {
  const entries = useSwarmInboxStore((s) => s.entries);
  const count = unreadCountForTab(entries, tabId);
  const severity: NotifySeverity | null = highestSeverityForTab(entries, tabId);
  if (count === 0 || severity === null) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      className={`swarm-tab-ring swarm-tab-ring--${severity}`}
      data-testid="swarm-tab-ring"
      data-tab-id={tabId}
      data-severity={severity}
      data-count={count}
      role="status"
      aria-label={`${count} unread ${LABEL[severity]} notification${
        count === 1 ? "" : "s"
      }`}
      title={`${count} unread (${LABEL[severity]})`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "16px",
        height: "16px",
        padding: "0 4px",
        marginLeft: "6px",
        borderRadius: "8px",
        background: COLOR[severity],
        color: "#fff",
        fontSize: "10px",
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {display}
    </span>
  );
}
