/**
 * `HeartbeatIndicator` — green / yellow / gray dot indicating a
 * colleague's heartbeat liveness.
 *
 * Bucket → color (WCAG AA on the dark theme):
 *  - active → green
 *  - stale  → yellow
 *  - dead   → gray
 *
 * @module components/Swarm/HeartbeatIndicator
 */
import type { Heartbeat } from "../../hooks/useSwarmRoster";

interface Props {
  heartbeat: Heartbeat;
}

// Documentation only — actual colors are applied by
// `.swarm-heartbeat--${heartbeat}` in `Swarm.css`. Kept inline so the
// design-token mapping is co-located with the `Heartbeat` enum.
//   active → var(--swarm-heart-active, #10b981)  + 4px glow
//   stale  → var(--swarm-heart-stale,  #f59e0b)
//   dead   → var(--swarm-heart-dead,   #6b7280)

const LABEL: Record<Heartbeat, string> = {
  active: "Active",
  stale: "Stale",
  dead: "Dead",
};

export function HeartbeatIndicator({ heartbeat }: Props) {
  return (
    <span
      className={`swarm-heartbeat swarm-heartbeat--${heartbeat}`}
      data-testid="swarm-heartbeat"
      data-heartbeat={heartbeat}
      role="img"
      aria-label={`Heartbeat: ${LABEL[heartbeat]}`}
      title={LABEL[heartbeat]}
    />
  );
}
