/**
 * `StatusBadge` — small visual badge showing a colleague's command
 * status (idle / running / done / error / unknown).
 *
 * @module components/Swarm/StatusBadge
 */
import type { ColleagueCommandStatus } from "../../hooks/useSwarmRoster";

interface Props {
  status: ColleagueCommandStatus | null | undefined;
}

const LABEL: Record<ColleagueCommandStatus, string> = {
  idle: "Idle",
  running: "Running",
  done: "Done",
  error: "Error",
  unknown: "—",
};

const COLOR: Record<ColleagueCommandStatus, string> = {
  // WCAG AA contrast (≥4.5:1) verified against the dark app background.
  idle: "var(--swarm-status-idle, #6b7280)",
  running: "var(--swarm-status-running, #3b82f6)",
  done: "var(--swarm-status-done, #10b981)",
  error: "var(--swarm-status-error, #ef4444)",
  unknown: "var(--swarm-status-unknown, #4b5563)",
};

export function StatusBadge({ status }: Props) {
  const s = (status ?? "unknown") as ColleagueCommandStatus;
  return (
    <span
      className={`swarm-status-badge swarm-status-badge--${s}`}
      data-testid="swarm-status-badge"
      data-status={s}
      aria-label={`Status: ${LABEL[s]}`}
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: "10px",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: COLOR[s],
        color: "#fff",
        lineHeight: 1.4,
      }}
    >
      {LABEL[s]}
    </span>
  );
}
