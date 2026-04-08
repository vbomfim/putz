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
import { useTabStore } from "../stores/tabStore";
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
  onToggleConfigDiff?: () => void;
  onToggleTemplates?: () => void;
  onToggleHistory?: () => void;
  onToggleSftp?: () => void;
  onTogglePing?: () => void;
  onToggleScript?: () => void;
  onToggleInterfaceStatus?: () => void;
  onToggleMacArp?: () => void;
  onNewBrowserTab?: () => void;
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
  const { activeTabId, tabs } = useTabStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  return !activeTab || activeTab.status === "local";
}

/**
 * Maps a menu event ID string to the corresponding store action.
 *
 * Returns a dispatch function that is called when a menu event arrives.
 */
export function useMenuEvents(): void {
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);
  const splitActivePane = useTabStore((s) => s.splitActivePane);
  const splitActivePaneWithBrowser = useTabStore((s) => s.splitActivePaneWithBrowser);
  const toggleSearch = useTabStore((s) => s.toggleSearch);
  const toggleLogging = useTabStore((s) => s.toggleLogging);
  const activateNextTab = useTabStore((s) => s.activateNextTab);
  const activatePreviousTab = useTabStore((s) => s.activatePreviousTab);

  const toggleBroadcast = useBroadcastStore((s) => s.toggle);

  const toggleToolbar = useSettingsStore((s) => s.toggleToolbar);
  const toggleShortcutsPanel = useSettingsStore((s) => s.toggleShortcutsPanel);

  const handleMenuEvent = useCallback(
    (id: string) => {
      switch (id) {
        // ─── File ──────────────────────────────────────────
        case "menu-new-terminal":
          addTab();
          break;
        case "menu-new-browser-tab":
          menuCallbacks.onNewBrowserTab?.();
          break;
        case "menu-close-tab": {
          const { activeTabId } = useTabStore.getState();
          if (activeTabId) removeTab(activeTabId);
          break;
        }
        case "menu-close-all-tabs":
          closeAllTabs();
          break;

        // ─── Edit ──────────────────────────────────────────
        case "menu-find":
          toggleSearch();
          break;

        // ─── View ──────────────────────────────────────────
        case "menu-toggle-sidebar": {
          const toggleBtn = document.querySelector<HTMLButtonElement>(
            '[data-testid="sidebar-toggle"]',
          );
          if (toggleBtn) toggleBtn.click();
          break;
        }
        case "menu-toggle-toolbar":
          toggleToolbar();
          break;
        case "menu-split-vertical":
          splitActivePane("vertical");
          break;
        case "menu-split-horizontal":
          splitActivePane("horizontal");
          break;
        case "menu-split-vertical-browser":
          splitActivePaneWithBrowser("vertical");
          break;
        case "menu-split-horizontal-browser":
          splitActivePaneWithBrowser("horizontal");
          break;
        case "menu-toggle-highlighting":
          // Placeholder — future highlighting toggle
          break;
        case "menu-toggle-broadcast": {
          const { tabs, activeTabId } = useTabStore.getState();
          toggleBroadcast(
            tabs.map((t) => t.id),
            activeTabId,
          );
          break;
        }

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

        case "menu-config-diff":
          menuCallbacks.onToggleConfigDiff?.();
          break;

        case "menu-command-templates":
          menuCallbacks.onToggleTemplates?.();
          break;

        case "menu-command-history":
          menuCallbacks.onToggleHistory?.();
          break;

        case "menu-sftp":
          menuCallbacks.onToggleSftp?.();
          break;

        case "menu-interface-status":
          menuCallbacks.onToggleInterfaceStatus?.();
          break;

        case "menu-mac-arp-viewer":
          menuCallbacks.onToggleMacArp?.();
          break;

        case "menu-ping-dashboard":
          menuCallbacks.onTogglePing?.();
          break;

        case "menu-script-editor":
        case "menu-run-script":
        case "menu-record-script":
          menuCallbacks.onToggleScript?.();
          break;

        case "menu-start-logging":
        case "menu-stop-logging":
          toggleLogging();
          break;

        // ─── Window ────────────────────────────────────────
        case "menu-next-tab":
          activateNextTab();
          break;
        case "menu-previous-tab":
          activatePreviousTab();
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
      addTab,
      removeTab,
      closeAllTabs,
      splitActivePane,
      splitActivePaneWithBrowser,
      toggleSearch,
      toggleLogging,
      toggleBroadcast,
      toggleToolbar,
      toggleShortcutsPanel,
      activateNextTab,
      activatePreviousTab,
    ],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<MenuEventPayload>("menu-event", (event) => {
      handleMenuEvent(event.payload.id);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [handleMenuEvent]);
}
