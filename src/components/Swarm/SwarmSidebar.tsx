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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSwarmRoster, type Colleague } from "../../hooks/useSwarmRoster";
import { ColleagueRow } from "./ColleagueRow";
import { useFocusTrap } from "../../hooks/useFocusTrap";

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
        // Width depends on `collapsed` — kept inline because it drives
        // the parent flex layout (`flex: 0 0 <width>`) and changes at
        // runtime. CSS class can't compute the matching `flex` shorthand.
        width: collapsed ? "44px" : "240px",
        flex: `0 0 ${collapsed ? "44px" : "240px"}`,
      }}
    >
      <header className="swarm-sidebar__header">
        {!collapsed && (
          <span className="swarm-sidebar__title">
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
          >
            {collapsed ? "›" : "‹"}
          </button>
        )}
      </header>

      <div className="swarm-sidebar__list" role="list">
        {roster.length === 0 ? (
          <div
            className="swarm-sidebar__empty"
            data-testid="swarm-sidebar-empty"
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  // D1: trap Tab focus inside the context menu while it is open
  // (WAI-ARIA APG menu pattern). Always-on while the menu is mounted.
  useFocusTrap(menuRef, true);
  // F1: viewport clamp — measure menu after mount and shift x/y so it
  // never spills off-screen. Initial position is the right-click
  // coordinates from `state.x`/`state.y`; we adjust via inline style.
  const [pos, setPos] = useState<{ x: number; y: number }>({
    x: state.x,
    y: state.y,
  });
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let x = state.x;
    let y = state.y;
    if (x + rect.width + margin > vw) x = Math.max(margin, vw - rect.width - margin);
    if (y + rect.height + margin > vh) y = Math.max(margin, vh - rect.height - margin);
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
    // intentionally only on mount + when source coords change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.x, state.y, state.mode]);

  // F1: ESC closes; outside-click closes. Both in capture phase so
  // they win against bubbling listeners on inner content.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  // F1: autoFocus first menu item (when in "menu" mode) for keyboard a11y.
  useEffect(() => {
    if (state.mode === "menu" && firstItemRef.current) {
      firstItemRef.current.focus();
    }
  }, [state.mode]);

  return (
    <div
      ref={menuRef}
      className="swarm-colleague-menu"
      data-testid="swarm-colleague-menu"
      role="menu"
      onClick={stop}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        // Dynamic position from runtime cursor coords + viewport clamp
        // (see useLayoutEffect above). Kept inline because values
        // come from state and would require per-render CSS variable
        // assignment otherwise.
        top: pos.y,
        left: pos.x,
      }}
    >
      {state.mode === "menu" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onEnterNotifyMode}
            data-testid="menu-send-notify"
            className="swarm-colleague-menu__item"
            ref={firstItemRef}
          >
            Send notify…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onDisconnect}
            data-testid="menu-disconnect"
            className="swarm-colleague-menu__item"
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
            className="swarm-colleague-menu__item"
          >
            Copy colleague ID
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onClose}
            className="swarm-colleague-menu__item"
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
            className="swarm-colleague-menu__notify-label"
          >
            Notify {state.colleague.name}
          </label>
          {/* F6: notify input handler.
              @privacy Tier-2 — `state.notifyText` is user-authored
              content forwarded to the peer's inbox verbatim. Capped at
              `MAX_INLINE_NOTIFY_LEN`. NEVER log this value. */}
          <input
            id="colleague-notify-input"
            data-testid="menu-notify-input"
            value={state.notifyText}
            onChange={(e) => onUpdateText(e.target.value)}
            maxLength={MAX_INLINE_NOTIFY_LEN}
            ref={(el) => el?.focus()}
            aria-describedby="colleague-notify-help"
            className="swarm-colleague-menu__notify-input"
          />
          {/* F6: helper text — sets expectation that delivery is
              immediate, in-memory only (PRI-001), so the user knows
              there's no retention story to worry about. */}
          <div
            id="colleague-notify-help"
            className="swarm-colleague-menu__notify-help"
          >
            Will appear in their inbox immediately. Not persisted —
            clears on app restart.
          </div>
          <div className="swarm-colleague-menu__notify-actions">
            <button
              type="button"
              onClick={onClose}
              className="swarm-colleague-menu__action"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="menu-notify-submit"
              className="swarm-colleague-menu__action swarm-colleague-menu__action--primary"
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
