/**
 * `SwarmSidebar` — collapsible sidebar listing swarm colleagues
 * (T4 / FR-018).
 *
 * Position controlled by Settings (`swarmSidebarPosition`):
 *  - `left` (default), `right`, `hidden`.
 *
 * Collapse mode controlled by Settings (`swarmSidebarCollapsed`).
 *
 * Right-click on a row → host context menu (Send notify… /
 * Disconnect colleague / Copy colleague ID). The sidebar handles the
 * Copy action inline (clipboard) and forwards the rest as callbacks
 * supplied by the host.
 *
 * @module components/Swarm/SwarmSidebar
 */
import { useCallback, useState } from "react";
import { useSwarmRoster, type Colleague } from "../../hooks/useSwarmRoster";
import { ColleagueRow } from "./ColleagueRow";

export type SidebarPosition = "left" | "right" | "hidden";

interface Props {
  /** Sidebar position; "hidden" causes the component to render nothing. */
  position?: SidebarPosition;
  /** Render in icon-only narrow mode. */
  collapsed?: boolean;
  /** Toggle collapsed state — host persists. */
  onToggleCollapsed?: () => void;
  /** Called when a colleague row is activated. */
  onFocusTab: (tabId: string) => void;
  /** Send a notify message to a colleague (right-click "Send notify…"). */
  onSendNotify?: (colleague: Colleague, message: string) => void;
  /** Disconnect a colleague (right-click "Disconnect colleague"). */
  onDisconnect?: (colleague: Colleague) => void;
  /** Test seam — supply a roster directly instead of fetching. */
  rosterOverride?: ReadonlyArray<Colleague>;
}

interface ContextMenuState {
  colleague: Colleague;
  x: number;
  y: number;
  /** UI mode: "menu" → list, "notify-input" → text field. */
  mode: "menu" | "notify-input";
  notifyText: string;
}

/** Cap on the right-click "Send notify…" inline message. Mirrors the
 *  Rust coordinator's MAX_MESSAGE_LEN (4096) but caps at a UI-friendly
 *  500 chars — operators don't paste novels into the inline field. */
const MAX_INLINE_NOTIFY_LEN = 500;

export function SwarmSidebar({
  position = "left",
  collapsed = false,
  onToggleCollapsed,
  onFocusTab,
  onSendNotify,
  onDisconnect,
  rosterOverride,
}: Props) {
  const fetched = useSwarmRoster();
  const roster = rosterOverride ?? fetched;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, colleague: Colleague) => {
      setMenu({
        colleague,
        x: e.clientX,
        y: e.clientY,
        mode: "menu",
        notifyText: "",
      });
    },
    [],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const copyId = useCallback((id: string) => {
    // Fire-and-forget. clipboard may be unavailable in some sandboxes;
    // failure is non-fatal — user can re-attempt.
    void navigator.clipboard?.writeText(id).catch(() => undefined);
  }, []);

  if (position === "hidden") return null;

  const width = collapsed ? "44px" : "240px";

  return (
    <aside
      className={`swarm-sidebar swarm-sidebar--${position} swarm-sidebar--${
        collapsed ? "collapsed" : "expanded"
      }`}
      data-testid="swarm-sidebar"
      data-position={position}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Swarm colleagues"
      style={{
        width,
        flex: `0 0 ${width}`,
        borderRight:
          position === "left" ? "1px solid var(--border-color, #2a2a2a)" : undefined,
        borderLeft:
          position === "right" ? "1px solid var(--border-color, #2a2a2a)" : undefined,
        background: "var(--bg-secondary, #15171a)",
        color: "var(--text-primary, #e1e4e8)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <header
        className="swarm-sidebar__header"
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border-color, #2a2a2a)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "6px",
        }}
      >
        {!collapsed && (
          <span style={{ fontSize: "12px", fontWeight: 600 }}>
            Swarm ({roster.length})
          </span>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            className="swarm-sidebar__collapse"
            data-testid="swarm-sidebar-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              background: "transparent",
              color: "inherit",
              border: "1px solid var(--border-color, #2a2a2a)",
              borderRadius: "3px",
              fontSize: "11px",
              padding: "1px 6px",
              cursor: "pointer",
            }}
          >
            {collapsed ? "›" : "‹"}
          </button>
        )}
      </header>

      <div
        className="swarm-sidebar__list"
        role="list"
        style={{ flex: 1, overflowY: "auto" }}
      >
        {roster.length === 0 ? (
          <div
            className="swarm-sidebar__empty"
            data-testid="swarm-sidebar-empty"
            style={{
              padding: "16px 10px",
              fontSize: "12px",
              opacity: 0.65,
              lineHeight: 1.4,
            }}
          >
            {collapsed
              ? "—"
              : "No colleagues. Open a Putz tab and run a Copilot CLI extension to register one."}
          </div>
        ) : (
          roster.map((c) => (
            <div role="listitem" key={c.id}>
              <ColleagueRow
                colleague={c}
                onFocus={onFocusTab}
                onContextMenu={handleContextMenu}
                collapsed={collapsed}
              />
            </div>
          ))
        )}
      </div>

      {menu && (
        <ColleagueContextMenu
          state={menu}
          onClose={closeMenu}
          onCopyId={copyId}
          onSendNotify={(msg) => {
            onSendNotify?.(menu.colleague, msg);
            closeMenu();
          }}
          onDisconnect={() => {
            onDisconnect?.(menu.colleague);
            closeMenu();
          }}
          onUpdateText={(t) =>
            setMenu((m) =>
              m ? { ...m, notifyText: t.slice(0, MAX_INLINE_NOTIFY_LEN) } : m,
            )
          }
          onEnterNotifyMode={() =>
            setMenu((m) => (m ? { ...m, mode: "notify-input" } : m))
          }
        />
      )}
    </aside>
  );
}

interface MenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onCopyId: (id: string) => void;
  onSendNotify: (message: string) => void;
  onDisconnect: () => void;
  onUpdateText: (text: string) => void;
  onEnterNotifyMode: () => void;
}

function ColleagueContextMenu({
  state,
  onClose,
  onCopyId,
  onSendNotify,
  onDisconnect,
  onUpdateText,
  onEnterNotifyMode,
}: MenuProps) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-testid="swarm-colleague-menu"
      role="menu"
      onClick={stop}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: state.y,
        left: state.x,
        background: "var(--bg-primary, #1a1a1a)",
        border: "1px solid var(--border-color, #2a2a2a)",
        borderRadius: "4px",
        padding: "4px",
        minWidth: "180px",
        zIndex: 1000,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {state.mode === "menu" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onEnterNotifyMode}
            data-testid="menu-send-notify"
            style={menuItemStyle}
          >
            Send notify…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onDisconnect}
            data-testid="menu-disconnect"
            style={menuItemStyle}
          >
            Disconnect colleague
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopyId(state.colleague.id);
              onClose();
            }}
            data-testid="menu-copy-id"
            style={menuItemStyle}
          >
            Copy colleague ID
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onClose}
            style={menuItemStyle}
          >
            Cancel
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = state.notifyText.trim();
            if (text) onSendNotify(text);
          }}
        >
          <label
            htmlFor="colleague-notify-input"
            style={{ fontSize: "11px", display: "block", marginBottom: "4px" }}
          >
            Notify {state.colleague.name}
          </label>
          <input
            id="colleague-notify-input"
            data-testid="menu-notify-input"
            value={state.notifyText}
            onChange={(e) => onUpdateText(e.target.value)}
            maxLength={MAX_INLINE_NOTIFY_LEN}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            style={{
              width: "100%",
              padding: "4px 6px",
              fontSize: "12px",
              background: "var(--bg-secondary, #15171a)",
              color: "var(--text-primary, #e1e4e8)",
              border: "1px solid var(--border-color, #2a2a2a)",
              borderRadius: "3px",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "4px",
              marginTop: "6px",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{ ...menuItemStyle, padding: "3px 8px", width: "auto" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="menu-notify-submit"
              style={{
                ...menuItemStyle,
                padding: "3px 8px",
                width: "auto",
                background: "var(--accent, #3b82f6)",
                color: "#fff",
              }}
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "5px 8px",
  background: "transparent",
  color: "inherit",
  border: "none",
  textAlign: "left",
  fontSize: "12px",
  cursor: "pointer",
  borderRadius: "3px",
};
