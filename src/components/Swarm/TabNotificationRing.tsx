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

// D2: WCAG AA-compliant fallbacks (≥4.5:1 vs white text). Documentation
// only — actual colors live in `.swarm-tab-ring--${severity}` in
// `Swarm.css`. See matching reasoning in `StatusBadge.tsx`.
//   urgent  → var(--swarm-ring-urgent,  #b91c1c)
//   normal  → var(--swarm-ring-normal,  #1d4ed8)
//   ambient → var(--swarm-ring-ambient, #6b7280)

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
    >
      {display}
    </span>
  );
}
