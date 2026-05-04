/**
 * `ColleagueRow` — sidebar row for one swarm colleague.
 *
 * Displays:
 *  - heartbeat dot (active/stale/dead)
 *  - name + truncated cwd (last 2 path segments)
 *  - status badge (idle/running/done/error)
 *  - 10-dot exit-code visualizer
 *
 * Click → focus the colleague's tab via the supplied `onFocus` callback.
 * Right-click → opens a context menu (host renders it; the row only
 * forwards the event with the colleague reference).
 *
 * @module components/Swarm/ColleagueRow
 */
import { useCallback } from "react";
import type { Colleague } from "../../hooks/useSwarmRoster";
import { heartbeatFor } from "../../hooks/useSwarmRoster";
import { StatusBadge } from "./StatusBadge";
import { ExitCodeDots } from "./ExitCodeDots";
import { HeartbeatIndicator } from "./HeartbeatIndicator";
import {
  useSwarmInboxStore,
  lastNotifyForTab,
} from "../../stores/swarmInboxStore";

interface Props {
  colleague: Colleague;
  /** Called with the colleague's `tab_id`. */
  onFocus: (tabId: string) => void;
  /** Called on right-click; host opens a context menu. */
  onContextMenu?: (e: React.MouseEvent, colleague: Colleague) => void;
  /** When true, render only the heartbeat dot + first letter of name. */
  collapsed?: boolean;
}

// F5: `truncateCwd` lives in `lib/swarm/formatters` so this component
// module exports ONLY React components (react-refresh / HMR).
import { truncateCwd } from "../../lib/swarm/formatters";

export function ColleagueRow({
  colleague,
  onFocus,
  onContextMenu,
  collapsed = false,
}: Props) {
  const heartbeat = heartbeatFor(colleague.status);
  // B1: most-recent notify for this colleague's tab — drives the
  // truncated last-message preview line.
  // @privacy Tier-2: only the truncated text is rendered; full body
  // stays in-store and is shown only in the inbox panel.
  const lastNotify = useSwarmInboxStore((s) =>
    lastNotifyForTab(s.entries, colleague.tab_id),
  );

  const handleClick = useCallback(() => {
    onFocus(colleague.tab_id);
  }, [colleague.tab_id, onFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onFocus(colleague.tab_id);
      }
    },
    [colleague.tab_id, onFocus],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (onContextMenu) {
        e.preventDefault();
        onContextMenu(e, colleague);
      }
    },
    [colleague, onContextMenu],
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className="swarm-colleague-row swarm-colleague-row--collapsed"
        data-testid="colleague-row"
        data-colleague-id={colleague.id}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        aria-label={`Focus ${colleague.name}`}
        title={colleague.name}
      >
        <HeartbeatIndicator heartbeat={heartbeat} />
        <span aria-hidden="true" className="swarm-colleague-row__initial">
          {colleague.name.slice(0, 1).toUpperCase()}
        </span>
      </button>
    );
  }

  return (
    <div
      className="swarm-colleague-row"
      data-testid="colleague-row"
      data-colleague-id={colleague.id}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      aria-label={`Focus ${colleague.name}`}
    >
      <div className="swarm-colleague-row__header">
        <HeartbeatIndicator heartbeat={heartbeat} />
        <span className="swarm-colleague-row__name">{colleague.name}</span>
        <StatusBadge status={colleague.command_status} />
      </div>
      {colleague.cwd && (
        <div
          className="swarm-colleague-row__cwd"
          data-testid="colleague-row-cwd"
          title={colleague.cwd}
        >
          {truncateCwd(colleague.cwd)}
        </div>
      )}
      {/* B1: last-notify preview (truncated). Hidden when there's no
          activity. The full message is available in the Cmd+J inbox. */}
      {lastNotify && (
        <div
          className={`swarm-colleague-row__last-notify${
            lastNotify.read ? " swarm-colleague-row__last-notify--read" : ""
          }`}
          data-testid="colleague-row-last-notify"
          title={lastNotify.message}
        >
          {lastNotify.message.length > 80
            ? lastNotify.message.slice(0, 79) + "…"
            : lastNotify.message}
        </div>
      )}
      <ExitCodeDots codes={colleague.last_ten_exit_codes} />
    </div>
  );
}
