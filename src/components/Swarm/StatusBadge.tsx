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

// Documentation map of the design tokens / fallback hex values applied
// by the corresponding `.swarm-status-badge--${s}` class in `Swarm.css`.
// Kept inline so the WCAG-AA reasoning lives next to the values it
// describes; the component itself does not consume this map.
//   D2: WCAG AA contrast (≥4.5:1) for white text on these badge
//   backgrounds. The previous `#3b82f6` and `#ef4444` only hit
//   ~3.7:1 / ~4.0:1 against `#fff`. The darkened blue/red pass
//   ≥7:1 (AA-Large + AA-Normal) on white.
//   idle    → var(--swarm-status-idle,    #6b7280)
//   running → var(--swarm-status-running, #1d4ed8)
//   done    → var(--swarm-status-done,    #047857)
//   error   → var(--swarm-status-error,   #b91c1c)
//   unknown → var(--swarm-status-unknown, #4b5563)

export function StatusBadge({ status }: Props) {
  const s = (status ?? "unknown") as ColleagueCommandStatus;
  return (
    <span
      className={`swarm-status-badge swarm-status-badge--${s}`}
      data-testid="swarm-status-badge"
      data-status={s}
      aria-label={`Status: ${LABEL[s]}`}
    >
      {LABEL[s]}
    </span>
  );
}
