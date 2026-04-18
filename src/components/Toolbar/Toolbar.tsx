/**
 * Toolbar — Toggleable horizontal icon bar for quick-access actions.
 *
 * Rendered below the TabBar. Groups buttons into logical sections:
 * Connection | Layout | Terminal | Tools | Settings.
 *
 * Each button dispatches actions via existing Zustand stores or
 * optional callback props passed from App.tsx for panel toggles.
 * Visibility is controlled by the settingsStore.
 *
 * @module Toolbar
 */
import { useCallback, useMemo } from "react";
import { useTabStore } from "../../stores/tabStore";
import { useBroadcastStore } from "../../stores/broadcastStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLayoutStore } from "../../stores/layoutStore";
import {
  isBookmarkActionAvailable,
} from "../../utils/bookmarkHelpers";
import "./Toolbar.css";

/** Callback props for actions that toggle App-level panel state. */
export interface ToolbarProps {
  onOpenSftp?: () => void;
  onOpenPing?: () => void;
  onOpenHistory?: () => void;
  onOpenTemplates?: () => void;
  onOpenScript?: () => void;
  onOpenThemeEditor?: () => void;
  onOpenFontConfig?: () => void;
  onOpenConfigDiff?: () => void;
  onOpenVault?: () => void;
  onOpenKeyManager?: () => void;
  /** Add bookmark for the currently focused tab. */
  onAddBookmark?: () => void;
}

/** Props for individual toolbar buttons. */
interface ToolbarButtonProps {
  /** Icon (Unicode symbol or text). */
  icon: string;
  /** Tooltip text shown on hover. */
  tooltip: string;
  /** Click handler. */
  onClick: () => void;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** Optional test ID. */
  testId?: string;
}

/** Single toolbar button with icon and tooltip. */
function ToolbarButton({ icon, tooltip, onClick, disabled = false, testId }: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar__button${disabled ? " toolbar__button--disabled" : ""}`}
      onClick={onClick}
      title={tooltip}
      type="button"
      aria-label={tooltip}
      data-testid={testId}
      disabled={disabled}
    >
      <span className="toolbar__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

/** Vertical separator between button groups. */
function ToolbarSeparator() {
  return <div className="toolbar__separator" role="separator" />;
}

/** Toolbar component — horizontal icon bar below the tab bar. */
export function Toolbar({
  onOpenSftp,
  onOpenPing,
  onOpenHistory,
  onOpenTemplates,
  onOpenScript,
  onOpenThemeEditor,
  onOpenFontConfig,
  onOpenConfigDiff,
  onOpenVault,
  onOpenKeyManager,
  onAddBookmark,
}: ToolbarProps = {}) {
  const toolbarVisible = useSettingsStore((s) => s.toolbarVisible);
  const toggleShortcutsPanel = useSettingsStore((s) => s.toggleShortcutsPanel);

  const addTab = useTabStore((s) => s.addTab);
  const splitActivePane = useTabStore((s) => s.splitActivePane);
  const toggleSearch = useTabStore((s) => s.toggleSearch);
  const toggleLogging = useTabStore((s) => s.toggleLogging);
  const toggleBroadcast = useBroadcastStore((s) => s.toggle);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  // ─── Bookmark: reactive bookmarkability from focused tab ─────────
  // Uses `isBookmarkActionAvailable` (the looser predicate) instead of
  // `getBookmarkableFromTab` so that terminal tabs without cached CWD
  // still show an enabled button — the action handler in App.tsx has
  // an async `pty_cwd` fallback to resolve CWD at invocation time.
  const regions = useLayoutStore((s) => s.regions);
  const focusedRegionId = useLayoutStore((s) => s.focusedRegionId);
  const isBookmarkable = useMemo(() => {
    const region = regions[focusedRegionId];
    if (!region) return false;
    const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
    if (!activeTab) return false;
    return isBookmarkActionAvailable(activeTab);
  }, [regions, focusedRegionId]);

  // Determine if active tab is a local terminal (no remote session)
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isLocalTab = !activeTab || activeTab.status === "local";

  // ─── Action Handlers ─────────────────────────────────────────────

  const handleSessionManager = useCallback(() => {
    // Trigger sidebar toggle via click on existing sidebar-toggle button
    const toggleBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-toggle"]',
    );
    if (toggleBtn) toggleBtn.click();
  }, []);

  const handleConnect = useCallback(() => {
    // Placeholder — future session connection
  }, []);

  const handleDisconnect = useCallback(() => {
    // Placeholder — future session disconnect
  }, []);

  const handleReconnect = useCallback(() => {
    // Placeholder — future session reconnect
  }, []);

  const handleNewTab = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleSplitVertical = useCallback(() => {
    splitActivePane("vertical");
  }, [splitActivePane]);

  const handleSplitHorizontal = useCallback(() => {
    // TODO: horizontal split should target the currently focused pane, not the
    // first leaf. This requires a `focusedPaneId` in the tab store — deferred
    // to a follow-up ticket.
    splitActivePane("horizontal");
  }, [splitActivePane]);

  const handlePaste = useCallback(() => {
    // Paste via clipboard API — dispatched to active terminal
    navigator.clipboard.readText().catch(() => {
      // Clipboard access denied — silent fail
    });
  }, []);

  const handleFind = useCallback(() => {
    toggleSearch();
  }, [toggleSearch]);

  const handleLog = useCallback(() => {
    toggleLogging();
  }, [toggleLogging]);

  const handleHighlight = useCallback(() => {
    // Placeholder — future highlight toggle
  }, []);

  const handleBroadcast = useCallback(() => {
    toggleBroadcast(
      tabs.map((t) => t.id),
      activeTabId,
    );
  }, [toggleBroadcast, tabs, activeTabId]);

  const handleSftp = useCallback(() => {
    onOpenSftp?.();
  }, [onOpenSftp]);

  const handlePing = useCallback(() => {
    onOpenPing?.();
  }, [onOpenPing]);

  const handleHistory = useCallback(() => {
    onOpenHistory?.();
  }, [onOpenHistory]);

  const handleTemplates = useCallback(() => {
    onOpenTemplates?.();
  }, [onOpenTemplates]);

  const handleScript = useCallback(() => {
    onOpenScript?.();
  }, [onOpenScript]);

  const handleThemeEditor = useCallback(() => {
    onOpenThemeEditor?.();
  }, [onOpenThemeEditor]);

  const handleFontConfig = useCallback(() => {
    onOpenFontConfig?.();
  }, [onOpenFontConfig]);

  const handleConfigDiff = useCallback(() => {
    onOpenConfigDiff?.();
  }, [onOpenConfigDiff]);

  const handleVault = useCallback(() => {
    onOpenVault?.();
  }, [onOpenVault]);

  const handleKeyManager = useCallback(() => {
    onOpenKeyManager?.();
  }, [onOpenKeyManager]);

  const handleBookmark = useCallback(() => {
    onAddBookmark?.();
  }, [onAddBookmark]);

  const handleShortcuts = useCallback(() => {
    toggleShortcutsPanel();
  }, [toggleShortcutsPanel]);

  if (!toolbarVisible) return null;

  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Quick actions"
      data-testid="toolbar"
    >
      {/* Connection group */}
      <ToolbarButton
        icon="📁"
        tooltip="Session Manager (Ctrl+B)"
        onClick={handleSessionManager}
        testId="toolbar-sessions"
      />
      <ToolbarButton
        icon="🔌"
        tooltip="Connect"
        onClick={handleConnect}
        testId="toolbar-connect"
        disabled={isLocalTab}
      />
      <ToolbarButton
        icon="❌"
        tooltip="Disconnect"
        onClick={handleDisconnect}
        testId="toolbar-disconnect"
        disabled={isLocalTab}
      />
      <ToolbarButton
        icon="🔄"
        tooltip="Reconnect"
        onClick={handleReconnect}
        testId="toolbar-reconnect"
        disabled={isLocalTab}
      />

      <ToolbarSeparator />

      {/* Layout group */}
      <ToolbarButton
        icon="➕"
        tooltip="New Tab (Ctrl+T)"
        onClick={handleNewTab}
        testId="toolbar-new-tab"
      />
      <ToolbarButton
        icon="✂️"
        tooltip="Split Vertical (Ctrl+Shift+E)"
        onClick={handleSplitVertical}
        testId="toolbar-split-v"
      />
      <ToolbarButton
        icon="📐"
        tooltip="Split Horizontal (Ctrl+Shift+D)"
        onClick={handleSplitHorizontal}
        testId="toolbar-split-h"
      />
      <ToolbarButton
        icon="★"
        tooltip="Bookmark current file (Cmd+D)"
        onClick={handleBookmark}
        testId="toolbar-bookmark"
        disabled={!isBookmarkable}
      />

      <ToolbarSeparator />

      {/* Terminal group */}
      <ToolbarButton
        icon="📋"
        tooltip="Paste (Ctrl+Shift+V)"
        onClick={handlePaste}
        testId="toolbar-paste"
      />
      <ToolbarButton
        icon="🔍"
        tooltip="Find (Ctrl+F)"
        onClick={handleFind}
        testId="toolbar-find"
      />
      <ToolbarButton
        icon="📝"
        tooltip="Toggle Logging (Ctrl+Shift+L)"
        onClick={handleLog}
        testId="toolbar-log"
      />
      <ToolbarButton
        icon="🎨"
        tooltip="Toggle Highlighting (Ctrl+Shift+H)"
        onClick={handleHighlight}
        testId="toolbar-highlight"
      />
      <ToolbarButton
        icon="📢"
        tooltip="Toggle Broadcast (Ctrl+Shift+A)"
        onClick={handleBroadcast}
        testId="toolbar-broadcast"
      />

      <ToolbarSeparator />

      {/* Tools group */}
      <ToolbarButton
        icon="📁"
        tooltip="SFTP File Transfer (Ctrl+Shift+F)"
        onClick={handleSftp}
        testId="toolbar-sftp"
      />
      <ToolbarButton
        icon="📊"
        tooltip="Ping Dashboard"
        onClick={handlePing}
        testId="toolbar-ping"
      />
      <ToolbarButton
        icon="📜"
        tooltip="Command History (Ctrl+R)"
        onClick={handleHistory}
        testId="toolbar-history"
      />
      <ToolbarButton
        icon="📋"
        tooltip="Command Templates (Ctrl+Shift+T)"
        onClick={handleTemplates}
        testId="toolbar-templates"
      />
      <ToolbarButton
        icon="🤖"
        tooltip="Script Editor"
        onClick={handleScript}
        testId="toolbar-script"
      />
      <ToolbarButton
        icon="🔑"
        tooltip="Credential Vault"
        onClick={handleVault}
        testId="toolbar-vault"
      />
      <ToolbarButton
        icon="🔐"
        tooltip="SSH Key Manager"
        onClick={handleKeyManager}
        testId="toolbar-key-manager"
      />
      <ToolbarButton
        icon="📊"
        tooltip="Config Diff Viewer (Ctrl+Shift+K)"
        onClick={handleConfigDiff}
        testId="toolbar-config-diff"
      />

      <ToolbarSeparator />

      {/* Settings group */}
      <ToolbarButton
        icon="🎨"
        tooltip="Color Theme"
        onClick={handleThemeEditor}
        testId="toolbar-theme-editor"
      />
      <ToolbarButton
        icon="🔤"
        tooltip="Font Settings"
        onClick={handleFontConfig}
        testId="toolbar-font-config"
      />
      <ToolbarButton
        icon="⌨️"
        tooltip="Keyboard Shortcuts"
        onClick={handleShortcuts}
        testId="toolbar-shortcuts"
      />
    </div>
  );
}
