/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a tabbed terminal interface with:
 * - SessionSidebar on the left for session management
 * - TabBar at the top for tab management
 * - Toolbar (optional) for quick-access actions
 * - SplitContainer for the active tab's pane layout
 * - ShortcutsPanel modal for keyboard shortcuts reference
 * - HistoryPanel (Ctrl+R) for cross-session command history search
 * - QuickConnect (Ctrl+K) for fast connection input
 * - Empty state with "New Terminal" prompt when no tabs exist
 * - Config Diff Viewer (Ctrl+Shift+K)
 * - Command Templates panel (Ctrl+Shift+T)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "./stores/tabStore";
import { useBroadcastStore } from "./stores/broadcastStore";
import { TabBar } from "./components/TabBar";
import { BroadcastBar } from "./components/BroadcastBar";
import { Toolbar } from "./components/Toolbar";
import { ShortcutsPanel } from "./components/Help";
import { SplitContainer } from "./components/SplitPane";
import { SessionSidebar } from "./components/SessionManager";
import { UpdateChecker } from "./components/UpdateChecker";
import { useMenuEvents, setMenuEventCallbacks } from "./utils/useMenuEvents";
import { HistoryPanel } from "./components/History";
import { QuickConnect } from "./components/QuickConnect";
import { CredentialReminder } from "./components/Vault/CredentialReminder";
import { CredentialManager } from "./components/Vault";
import { KeyManager } from "./components/Keys";
import { ConfigDiff } from "./components/ConfigDiff";
import { TemplatePanel } from "./components/Templates";
import { ThemeEditor } from "./components/Terminal/ThemeEditor";
import { FontConfig } from "./components/Terminal/FontConfig";
import { useThemeStore } from "./stores/themeStore";
import type { Theme } from "./components/Terminal/themeTypes";
import type { SessionProfile } from "./components/SessionManager";
import type { ParsedConnection } from "./components/QuickConnect";
import "./components/SessionManager/SessionManager.css";
import "./styles/App.css";

function App() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const isBroadcastActive = useBroadcastStore((s) => s.isActive);
  const broadcastTargetIds = useBroadcastStore((s) => s.targetTabIds);
  const hasInitialized = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [configDiffOpen, setConfigDiffOpen] = useState(false);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [fontConfigOpen, setFontConfigOpen] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);

  // Listen for native menu events from the Tauri backend
  useMenuEvents();

  // Load available themes from the backend when the theme editor opens
  useEffect(() => {
    if (!themeEditorOpen) return;
    invoke<Theme[]>("theme_list")
      .then((themes) => {
        setAvailableThemes(themes);
        useThemeStore
          .getState()
          .setThemes(themes.map((t) => ({ id: t.id, name: t.name, isBuiltin: t.isBuiltin })));
      })
      .catch((err) => {
        console.warn("[App] Failed to load themes:", err);
      });
  }, [themeEditorOpen]);

  // Wire menu event callbacks for panel toggles
  useEffect(() => {
    setMenuEventCallbacks({
      onToggleVault: () => setVaultOpen((prev) => !prev),
      onToggleKeyManager: () => setKeyManagerOpen((prev) => !prev),
      onToggleThemeEditor: () => setThemeEditorOpen((prev) => !prev),
      onToggleFontConfig: () => setFontConfigOpen((prev) => !prev),
      onToggleConfigDiff: () => setConfigDiffOpen((prev) => !prev),
      onToggleTemplates: () => setTemplatePanelOpen((prev) => !prev),
      onToggleHistory: () => setHistoryOpen((prev) => !prev),
    });
    return () => setMenuEventCallbacks({});
  }, []);

  // Create the first tab on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    addTab();
  }, [addTab]);

  // Global keyboard shortcuts for History (Ctrl+R) and QuickConnect (Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();

      // Ctrl+R — Toggle command history search
      if (key === "r" && !e.shiftKey) {
        e.preventDefault();
        setHistoryOpen((prev) => !prev);
        setQuickConnectOpen(false);
        return;
      }

      // Ctrl+K — Toggle quick connect bar
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setQuickConnectOpen((prev) => !prev);
        setHistoryOpen(false);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Global Escape key — close vault/key-manager overlays
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (vaultOpen) {
        e.preventDefault();
        setVaultOpen(false);
        return;
      }
      if (keyManagerOpen) {
        e.preventDefault();
        setKeyManagerOpen(false);
        return;
      }
      if (themeEditorOpen) {
        e.preventDefault();
        setThemeEditorOpen(false);
        return;
      }
      if (fontConfigOpen) {
        e.preventDefault();
        setFontConfigOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [vaultOpen, keyManagerOpen, themeEditorOpen, fontConfigOpen]);

  const handleNewTerminal = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  /** Toggles the Config Diff Viewer overlay. */
  const handleToggleConfigDiff = useCallback(() => {
    setConfigDiffOpen((prev) => !prev);
  }, []);

  /** Toggles the Command Templates panel. */
  const handleToggleTemplates = useCallback(() => {
    setTemplatePanelOpen((prev) => !prev);
  }, []);

  /** Global keyboard shortcut for panels not managed by TabBar's hook. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier || !e.shiftKey) return;

      const key = e.key.toLowerCase();

      // Ctrl+Shift+K — Config Diff Viewer
      if (key === "k") {
        e.preventDefault();
        handleToggleConfigDiff();
        return;
      }

      // Ctrl+Shift+T — Command Templates
      if (key === "t") {
        e.preventDefault();
        handleToggleTemplates();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleToggleConfigDiff, handleToggleTemplates]);

  /** Called when a session is opened from the sidebar. */
  const handleSessionOpen = useCallback((_session: SessionProfile) => {
    // Future: spawn a connection for this session profile.
    // For now, just open a new local terminal tab.
    addTab();
  }, [addTab]);

  /** Called when a command is selected from the history panel. */
  const handleHistorySelect = useCallback((_command: string) => {
    // Future: insert the command into the active terminal's input.
    // For now, just close the panel — the terminal write integration
    // depends on exposing a write method from the active pane.
  }, []);

  /** Called when a connection is submitted from the quick connect bar. */
  const handleQuickConnect = useCallback((_connection: ParsedConnection) => {
    // Future: open a connection with the parsed details (protocol, host, port, username).
    // For now, just open a new local terminal tab as a placeholder.
    addTab();
  }, [addTab]);

  // Empty state — all tabs closed
  if (tabs.length === 0 && hasInitialized.current) {
    return (
      <main className="app-container" data-testid="app-root">
        <UpdateChecker />
        <TabBar />
        <Toolbar
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenTemplates={() => setTemplatePanelOpen(true)}
          onOpenConfigDiff={() => setConfigDiffOpen(true)}
          onOpenVault={() => setVaultOpen(true)}
          onOpenKeyManager={() => setKeyManagerOpen(true)}
          onOpenThemeEditor={() => setThemeEditorOpen(true)}
          onOpenFontConfig={() => setFontConfigOpen(true)}
        />
        <ShortcutsPanel />
        <HistoryPanel
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onSelect={handleHistorySelect}
        />
        <QuickConnect
          isOpen={quickConnectOpen}
          onClose={() => setQuickConnectOpen(false)}
          onConnect={handleQuickConnect}
        />
        <div className="app-empty-state" data-testid="app-empty-state">
          <p>No open terminals</p>
          <button
            className="app-new-terminal-btn"
            onClick={handleNewTerminal}
            type="button"
          >
            New Terminal
          </button>
          <p className="app-empty-hint">
            or press <kbd>Ctrl+T</kbd>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-container" data-testid="app-root">
      <UpdateChecker />
      <CredentialReminder />
      <SessionSidebar
        isOpen={sidebarOpen}
        onToggle={handleSidebarToggle}
        onSessionOpen={handleSessionOpen}
      />
      {!sidebarOpen && (
        <button
          className="sidebar-toggle"
          onClick={handleSidebarToggle}
          type="button"
          aria-label="Open session manager"
          data-testid="sidebar-toggle"
          title="Toggle Session Manager (Ctrl+B)"
        >
          ▶
        </button>
      )}
      <TabBar />
      <Toolbar
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenTemplates={() => setTemplatePanelOpen(true)}
        onOpenConfigDiff={() => setConfigDiffOpen(true)}
        onOpenVault={() => setVaultOpen(true)}
        onOpenKeyManager={() => setKeyManagerOpen(true)}
        onOpenThemeEditor={() => setThemeEditorOpen(true)}
        onOpenFontConfig={() => setFontConfigOpen(true)}
      />
      <BroadcastBar />
      <ShortcutsPanel />
      <HistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={handleHistorySelect}
      />
      <QuickConnect
        isOpen={quickConnectOpen}
        onClose={() => setQuickConnectOpen(false)}
        onConnect={handleQuickConnect}
      />
      <div className="app-content">
        {tabs.map((tab) => (
          <SplitContainer
            key={tab.id}
            layout={tab.layout}
            tabId={tab.id}
            isActive={tab.id === activeTabId}
            isBroadcastTarget={
              isBroadcastActive && broadcastTargetIds.has(tab.id)
            }
          />
        ))}
      </div>
      <ConfigDiff
        isOpen={configDiffOpen}
        onClose={() => setConfigDiffOpen(false)}
      />
      <TemplatePanel
        isOpen={templatePanelOpen}
        onClose={() => setTemplatePanelOpen(false)}
      />

      {/* Credential Vault overlay */}
      {vaultOpen && (
        <div
          className="modal-overlay"
          data-testid="vault-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVaultOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Credential Vault"
        >
          <div className="modal-panel" data-testid="vault-panel">
            <button
              className="modal-close"
              onClick={() => setVaultOpen(false)}
              aria-label="Close Credential Vault"
              data-testid="vault-close"
            >
              ✕
            </button>
            <CredentialManager />
          </div>
        </div>
      )}

      {/* SSH Key Manager overlay */}
      {keyManagerOpen && (
        <div
          className="modal-overlay"
          data-testid="key-manager-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setKeyManagerOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="SSH Key Manager"
        >
          <div className="modal-panel" data-testid="key-manager-panel">
            <button
              className="modal-close"
              onClick={() => setKeyManagerOpen(false)}
              aria-label="Close SSH Key Manager"
              data-testid="key-manager-close"
            >
              ✕
            </button>
            <KeyManager />
          </div>
        </div>
      )}

      {/* Theme Editor overlay */}
      {themeEditorOpen && (
        <div
          className="modal-overlay"
          data-testid="theme-editor-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setThemeEditorOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Theme Editor"
        >
          <div className="modal-panel modal-panel--wide" data-testid="theme-editor-panel">
            <button
              className="modal-close"
              onClick={() => setThemeEditorOpen(false)}
              aria-label="Close Theme Editor"
            >
              ✕
            </button>
            <ThemeEditor
              themes={availableThemes}
              editingTheme={null}
              onSave={() => setThemeEditorOpen(false)}
              onCancel={() => setThemeEditorOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Font Config overlay */}
      {fontConfigOpen && (
        <div
          className="modal-overlay"
          data-testid="font-config-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFontConfigOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Font Settings"
        >
          <div className="modal-panel" data-testid="font-config-panel">
            <button
              className="modal-close"
              onClick={() => setFontConfigOpen(false)}
              aria-label="Close Font Settings"
            >
              ✕
            </button>
            <FontConfig 
              settings={useThemeStore.getState().fontSettings}
              onChange={(s) => useThemeStore.getState().setFontSettings(s)}
            />
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
