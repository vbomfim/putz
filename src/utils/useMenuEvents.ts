/**
 * useMenuEvents — Listens for native Tauri menu events and dispatches actions.
 *
 * The Rust backend emits `menu-event` events with a payload containing
 * the menu item ID. This hook maps those IDs to the appropriate
 * store actions.
 *
 * @module useMenuEvents
 */
import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLayoutStore } from "../stores/layoutStore";
import { useBroadcastStore } from "../stores/broadcastStore";
import { useSettingsStore } from "../stores/settingsStore";

/** Payload shape emitted by the Rust menu event handler. */
interface MenuEventPayload {
  id: string;
}

/** Callback type for panel toggles managed by App.tsx state. */
export interface MenuEventCallbacks {
  onToggleVault?: () => void;
  onToggleKeyManager?: () => void;
  onToggleThemeEditor?: () => void;
  onToggleFontConfig?: () => void;
  onToggleTemplates?: () => void;
  onToggleHistory?: () => void;
  onTogglePing?: () => void;
  onToggleScript?: () => void;
  onOpenSettings?: () => void;
  onNewBrowserTab?: () => void;
  onToggleWorkspaceBar?: () => void;
  onToggleBookmarksBar?: () => void;
  onAddBookmark?: () => void;
  onToggleBookmarksPanel?: () => void;
}

// Module-level callbacks — set by App.tsx via setMenuEventCallbacks
let menuCallbacks: MenuEventCallbacks = {};

/** Registers callbacks for menu events that need to toggle App-level state. */
export function setMenuEventCallbacks(callbacks: MenuEventCallbacks): void {
  menuCallbacks = callbacks;
}

/**
 * Checks whether the active tab is a local terminal.
 * Returns true if there's no active tab or its status is "local".
 */
function isActiveTabLocal(): boolean {
  const { regions, focusedRegionId } = useLayoutStore.getState();
  const region = regions[focusedRegionId];
  if (!region) return true;
  const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
  return !activeTab || activeTab.status === "local";
}

/**
 * Maps a menu event ID string to the corresponding store action.
 *
 * Returns a dispatch function that is called when a menu event arrives.
 */
export function useMenuEvents(): void {
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const splitRegion = useLayoutStore((s) => s.splitRegion);
  const nextTab = useLayoutStore((s) => s.nextTab);
  const prevTab = useLayoutStore((s) => s.prevTab);

  const toggleBroadcast = useBroadcastStore((s) => s.toggle);

  const toggleShortcutsPanel = useSettingsStore((s) => s.toggleShortcutsPanel);

  const handleMenuEvent = useCallback(
    (id: string) => {
      switch (id) {
        // ─── File ──────────────────────────────────────────
        case "menu-new-terminal":
          addTerminalTab();
          break;
        case "menu-new-browser-tab":
          menuCallbacks.onNewBrowserTab?.();
          break;
        case "menu-close-tab": {
          const ls2 = useLayoutStore.getState(); const r2 = ls2.regions[ls2.focusedRegionId]; if (r2 && r2.activeTabId) closeTab(r2.id, r2.activeTabId);
          const ls = useLayoutStore.getState(); const r = ls.regions[ls.focusedRegionId]; if (r && r.activeTabId) closeTab(r.id, r.activeTabId);
          break;
        }
        case "menu-close-all-tabs":
          
          break;
        case "menu-exit":
          // Close the main window — Tauri shuts down when the last window closes.
          // The on_window_event close-requested handler in lib.rs runs first
          // and tears down PTY sessions cleanly.
          getCurrentWindow().close().catch(() => {
            // Fallback: ask the app to exit if window.close fails for any reason
            import("@tauri-apps/plugin-process").then((m) => m.exit(0)).catch(() => {});
          });
          break;

        // ─── Edit ──────────────────────────────────────────
        case "menu-find":
          // Dispatch to whatever is active — terminal search or Monaco find
          window.dispatchEvent(new CustomEvent("putz-find"));
          break;

        case "menu-preferences":
          menuCallbacks.onOpenSettings?.();
          break;

        // ─── View ──────────────────────────────────────────
        case "menu-toggle-sidebar": {
          const toggleBtn = document.querySelector<HTMLButtonElement>(
            '[data-testid="sidebar-toggle"]',
          );
          if (toggleBtn) toggleBtn.click();
          break;
        }
        case "menu-split-vertical":
          splitRegion("vertical");
          break;
        case "menu-split-horizontal":
          splitRegion("horizontal");
          break;
        case "menu-split-vertical-browser":
          splitRegion("vertical");
          break;
        case "menu-split-horizontal-browser":
          splitRegion("horizontal");
          break;
        case "menu-toggle-highlighting":
          // Placeholder — future highlighting toggle
          break;
        case "menu-toggle-broadcast": {
          ;
          toggleBroadcast(
            Object.keys(useLayoutStore.getState().regions),
            useLayoutStore.getState().focusedRegionId,
          );
          break;
        }
        case "menu-toggle-workspace-bar":
          menuCallbacks.onToggleWorkspaceBar?.();
          break;
        case "menu-toggle-bookmarks-bar":
          menuCallbacks.onToggleBookmarksBar?.();
          break;
        case "menu-add-bookmark":
          menuCallbacks.onAddBookmark?.();
          break;
        case "menu-manage-bookmarks":
          menuCallbacks.onToggleBookmarksPanel?.();
          break;

        // ─── Session ───────────────────────────────────────
        case "menu-connect":
        case "menu-disconnect":
        case "menu-reconnect":
          if (isActiveTabLocal()) {
            console.warn(
              `[menuEvents] ${id} ignored — active tab is a local terminal`,
            );
          } else {
            // Future: implement actual connect/disconnect/reconnect
            console.debug(`[menuEvents] ${id} — remote session action`);
          }
          break;

        case "menu-credential-vault":
          menuCallbacks.onToggleVault?.();
          break;

        case "menu-ssh-key-manager":
          menuCallbacks.onToggleKeyManager?.();
          break;

        case "menu-theme-editor":
          menuCallbacks.onToggleThemeEditor?.();
          break;

        case "menu-font-config":
          menuCallbacks.onToggleFontConfig?.();
          break;

        case "menu-command-templates":
          menuCallbacks.onToggleTemplates?.();
          break;

        case "menu-command-history":
          menuCallbacks.onToggleHistory?.();
          break;

        case "menu-ping-dashboard":
          menuCallbacks.onTogglePing?.();
          break;

        case "menu-script-editor":
          menuCallbacks.onToggleScript?.();
          break;

        case "menu-start-logging":
        case "menu-stop-logging":
          
          break;

        // ─── Window ────────────────────────────────────────
        case "menu-next-tab":
          nextTab();
          break;
        case "menu-previous-tab":
          prevTab();
          break;

        // ─── Help ──────────────────────────────────────────
        case "menu-keyboard-shortcuts":
          toggleShortcutsPanel();
          break;

        default:
          // Unknown menu event — log for debugging
          console.debug(`[menuEvents] Unhandled menu event: ${id}`);
          break;
      }
    },
    [
      addTerminalTab,
      closeTab,
      
      splitRegion,
      
      
      
      toggleBroadcast,
      toggleShortcutsPanel,
      nextTab,
      prevTab,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<MenuEventPayload>("menu-event", (event) => {
      handleMenuEvent(event.payload.id);
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleMenuEvent]);
}
