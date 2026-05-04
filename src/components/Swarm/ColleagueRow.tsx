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

interface Props {
  colleague: Colleague;
  /** Called with the colleague's `tab_id`. */
  onFocus: (tabId: string) => void;
  /** Called on right-click; host opens a context menu. */
  onContextMenu?: (e: React.MouseEvent, colleague: Colleague) => void;
  /** When true, render only the heartbeat dot + first letter of name. */
  collapsed?: boolean;
}

/**
 * Truncate a cwd to its last `n` path segments, prefixed with `…/`.
 *
 * @privacy Tier-2 — cwd is a quasi-identifier; truncation is for UI
 * brevity, not for redaction. The full cwd is still in the data model.
 */
export function truncateCwd(cwd: string | null | undefined, n = 2): string {
  if (!cwd) return "";
  // Normalize Windows backslashes for splitting.
  const norm = cwd.replace(/\\/g, "/");
  const segs = norm.split("/").filter((s) => s.length > 0);
  if (segs.length <= n) return cwd;
  return "…/" + segs.slice(-n).join("/");
}

export function ColleagueRow({
  colleague,
  onFocus,
  onContextMenu,
  collapsed = false,
}: Props) {
  const heartbeat = heartbeatFor(colleague.status);

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
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          width: "100%",
          padding: "8px 4px",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <HeartbeatIndicator heartbeat={heartbeat} />
        <span aria-hidden="true" style={{ fontSize: "12px", fontWeight: 600 }}>
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
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px 10px",
        cursor: "pointer",
        borderRadius: "4px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          minWidth: 0,
        }}
      >
        <HeartbeatIndicator heartbeat={heartbeat} />
        <span
          className="swarm-colleague-row__name"
          style={{
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          {colleague.name}
        </span>
        <StatusBadge status={colleague.command_status} />
      </div>
      {colleague.cwd && (
        <div
          className="swarm-colleague-row__cwd"
          data-testid="colleague-row-cwd"
          style={{
            fontSize: "11px",
            opacity: 0.75,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "monospace",
          }}
          title={colleague.cwd}
        >
          {truncateCwd(colleague.cwd)}
        </div>
      )}
      <ExitCodeDots codes={colleague.last_ten_exit_codes} />
    </div>
  );
}
