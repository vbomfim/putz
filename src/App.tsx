/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a region-based terminal interface with:
 * - SessionSidebar on the left for session management
 * - RegionContainer for the window layout (regions with tab bars)
 * - ShortcutsPanel modal for keyboard shortcuts reference
 * - HistoryPanel (Ctrl+R) for cross-session command history search
 * - QuickConnect (Ctrl+K) for fast connection input
 * - Empty state with "New Terminal" prompt when no tabs exist
 * - Config Diff Viewer (Ctrl+Shift+K)
 * - Command Templates panel (Ctrl+Shift+T)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "./stores/layoutStore";
import { RegionContainer } from "./components/Region";
import { BroadcastBar } from "./components/BroadcastBar";
import { ShortcutsPanel } from "./components/Help";
import { SessionSidebar } from "./components/SessionManager";
import { UpdateChecker } from "./components/UpdateChecker";
import { useMenuEvents, setMenuEventCallbacks } from "./utils/useMenuEvents";
import { useKeyboardShortcuts } from "./components/TabBar/useKeyboardShortcuts";
import { HistoryPanel } from "./components/History";
import { QuickConnect } from "./components/QuickConnect";
import { CredentialReminder } from "./components/Vault/CredentialReminder";
import { CredentialManager } from "./components/Vault";
import { KeyManager } from "./components/Keys";
import { ConfigDiff } from "./components/ConfigDiff";
import { TemplatePanel } from "./components/Templates";
import { SFTPPanel } from "./components/SFTP";
import { PingDashboard } from "./components/Ping/PingDashboard";
import { InterfaceStatus } from "./components/InterfaceStatus/InterfaceStatus";
import { MacArpViewer } from "./components/MacArpViewer/MacArpViewer";
import { ScriptEditor } from "./components/Scripting";
import { ThemeEditor } from "./components/Terminal/ThemeEditor";
import { FontConfig } from "./components/Terminal/FontConfig";
import { WorkspaceBar } from "./components/Workspace";
import { useThemeStore } from "./stores/themeStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { Theme } from "./components/Terminal/themeTypes";
import type { SessionProfile } from "./components/SessionManager";
import type { ParsedConnection } from "./components/QuickConnect";
import "./components/SessionManager/SessionManager.css";
import "./styles/App.css";

function App() {
  const regions = useLayoutStore((s) => s.regions);
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const addBrowserTab = useLayoutStore((s) => s.addBrowserTab);
  const workspaceBarVisible = useSettingsStore((s) => s.workspaceBarVisible);
  const toggleWorkspaceBar = useSettingsStore((s) => s.toggleWorkspaceBar);
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
  const [sftpOpen, setSftpOpen] = useState(false);
  const [pingOpen, setPingOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [interfaceStatusOpen, setInterfaceStatusOpen] = useState(false);
  const [macArpOpen, setMacArpOpen] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);

  // Listen for native menu events from the Tauri backend
  useMenuEvents();

  // Register keyboard shortcuts (now uses layoutStore)
  useKeyboardShortcuts();

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
      onToggleSftp: () => setSftpOpen((prev) => !prev),
      onTogglePing: () => setPingOpen((prev) => !prev),
      onToggleScript: () => setScriptOpen((prev) => !prev),
      onToggleInterfaceStatus: () => setInterfaceStatusOpen((prev) => !prev),
      onToggleMacArp: () => setMacArpOpen((prev) => !prev),
      onNewBrowserTab: () => addBrowserTab(undefined, ""),
      onToggleWorkspaceBar: () => toggleWorkspaceBar(),
    });
    return () => setMenuEventCallbacks({});
  }, [addBrowserTab, toggleWorkspaceBar]);

  // Create the first tab on mount
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      addTerminalTab();
      return;
    }
    // Auto-create a tab if all regions are empty
    const allEmpty = Object.values(regions).every((r) => r.tabs.length === 0);
    if (allEmpty) {
      addTerminalTab();
    }
  }, [addTerminalTab, regions]);

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
    addTerminalTab();
  }, [addTerminalTab]);

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
    addTerminalTab();
  }, [addTerminalTab]);

  /** Called when a command is selected from the history panel. */
  const handleHistorySelect = useCallback((command: string) => {
    const state = useLayoutStore.getState();
    const sessionId = state.getActiveSessionId();
    if (!sessionId) return;
    const bytes = Array.from(new TextEncoder().encode(command));
    // Determine if the active tab is a connected session
    const region = state.getFocusedRegion();
    const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
    const cmd = activeTab?.status === "connected" ? "connection_write" : "pty_write";
    invoke(cmd, { sessionId, data: bytes }).catch(() => {});
    setHistoryOpen(false);
  }, []);

  /** Called when a connection is submitted from the quick connect bar. */
  const handleQuickConnect = useCallback((connection: ParsedConnection) => {
    // Check if this is a browser URL (http:// or https://)
    if (connection.protocol === "ssh" && connection.host.startsWith("http")) {
      const url = connection.host.includes("://")
        ? connection.host
        : `https://${connection.host}`;
      addBrowserTab(undefined, url);
      return;
    }
    // Future: open a connection with the parsed details.
    addTerminalTab();
  }, [addTerminalTab, addBrowserTab]);

  // Empty state — all regions are empty
  const allRegionsEmpty = Object.values(regions).every((r) => r.tabs.length === 0);
  if (allRegionsEmpty && hasInitialized.current) {
    return (
      <div className="app-shell" data-testid="app-root">
        {workspaceBarVisible && <WorkspaceBar />}
        <main className="app-container">
          <UpdateChecker />
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
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      {workspaceBarVisible && <WorkspaceBar />}
      <main className="app-container">
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
            onMouseDown={(e) => e.preventDefault()}
            type="button"
            aria-label="Open session manager"
            data-testid="sidebar-toggle"
            title="Toggle Session Manager (Ctrl+B)"
            tabIndex={-1}
          >
            ▶
          </button>
        )}
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
        <RegionContainer />
      </div>
      <ConfigDiff
        isOpen={configDiffOpen}
        onClose={() => setConfigDiffOpen(false)}
      />
      <TemplatePanel
        isOpen={templatePanelOpen}
        onClose={() => setTemplatePanelOpen(false)}
        onSendToTerminal={(text) => {
          const state = useLayoutStore.getState();
          const sessionId = state.getActiveSessionId();
          if (!sessionId) { console.error("No active session"); return; }
          const region = state.getFocusedRegion();
          const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
          const bytes = Array.from(new TextEncoder().encode(text + "\n"));
          const command = activeTab?.status === "connected" ? "connection_write" : "pty_write";
          console.log("[template-send]", command, sessionId, text.substring(0, 50));
          invoke(command, { sessionId, data: bytes }).catch((err) => {
            console.error("[template-send] failed:", err);
          });
        }}
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
      {/* Font Config overlay */}
      {fontConfigOpen && (
        <FontConfigOverlay onClose={() => setFontConfigOpen(false)} />
      )}

      {/* Theme Selector + Editor overlay */}
      {themeEditorOpen && (
        <ThemeOverlay 
          themes={availableThemes}
          onClose={() => setThemeEditorOpen(false)} 
        />
      )}

      {/* SFTP Panel */}
      {sftpOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSftpOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setSftpOpen(false)}>✕</button><SFTPPanel connectionId="" onClose={() => setSftpOpen(false)} /></div>
        </div>
      )}

      {/* Ping Dashboard */}
      {pingOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPingOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setPingOpen(false)}>✕</button><PingDashboard /></div>
        </div>
      )}

      {/* Interface Status */}
      {interfaceStatusOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setInterfaceStatusOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setInterfaceStatusOpen(false)}>✕</button><InterfaceStatus /></div>
        </div>
      )}

      {/* MAC/ARP Viewer */}
      {macArpOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setMacArpOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setMacArpOpen(false)}>✕</button><MacArpViewer /></div>
        </div>
      )}

      {/* Script Editor */}
      {scriptOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setScriptOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setScriptOpen(false)}>✕</button><ScriptEditor onSave={() => setScriptOpen(false)} onRun={() => {}} onStop={() => {}} onRecordStart={() => {}} onRecordStop={() => {}} /></div>
        </div>
      )}
    </main>
    </div>
  );
}

export default App;

/** Reactive Font Config overlay — reads from themeStore with hook */
function FontConfigOverlay({ onClose }: { onClose: () => void }) {
  const fontSettings = useThemeStore((s) => s.fontSettings);
  const setFontSettings = useThemeStore((s) => s.setFontSettings);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Font Settings">
      <div className="modal-panel">
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <FontConfig settings={fontSettings} onChange={setFontSettings} />
      </div>
    </div>
  );
}

/** Theme selection + editor overlay */
function ThemeOverlay({ themes, onClose }: { themes: Theme[]; onClose: () => void }) {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const [editing, setEditing] = useState(false);
  
  const handleSelectTheme = (theme: Theme) => {
    setActiveTheme(theme.id, theme.colors);
  };
  
  if (editing) {
    return (
      <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Theme Editor">
        <div className="modal-panel modal-panel--wide">
          <button className="modal-close" onClick={() => setEditing(false)} aria-label="Back">←</button>
          <ThemeEditor themes={themes} editingTheme={null} onSave={() => { setEditing(false); }} onCancel={() => setEditing(false)} />
        </div>
      </div>
    );
  }
  
  // Side panel — no dark overlay so user sees theme changes live
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "320px",
      background: "#1e1e2e", borderLeft: "1px solid #45475a",
      zIndex: 300, display: "flex", flexDirection: "column",
      boxShadow: "-4px 0 20px rgba(0,0,0,0.5)",
      animation: "slide-in-right 0.15s ease-out",
    }} role="dialog" aria-label="Theme Selector">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: "1px solid #45475a" }}>
        <h3 style={{ margin: 0, color: "#cdd6f4", fontSize: "16px" }}>🎨 Color Themes</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#cdd6f4", fontSize: "18px", cursor: "pointer" }} aria-label="Close">✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => handleSelectTheme(theme)}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 12px",
              border: theme.id === activeThemeId ? "2px solid #89b4fa" : "1px solid transparent",
              borderRadius: "6px",
              background: theme.colors.background || "#1e1e2e",
              color: theme.colors.foreground || "#cdd6f4",
              cursor: "pointer", textAlign: "left", transition: "border-color 0.1s",
            }}
          >
            <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
              {[theme.colors.red, theme.colors.green, theme.colors.blue, theme.colors.yellow, theme.colors.magenta, theme.colors.cyan].map((c, i) => (
                <div key={i} style={{ width: "12px", height: "12px", borderRadius: "50%", background: c }} />
              ))}
            </div>
            <span style={{ fontWeight: theme.id === activeThemeId ? "bold" : "normal", fontSize: "13px" }}>{theme.name}</span>
            {theme.id === activeThemeId && <span style={{ marginLeft: "auto", fontSize: "11px", opacity: 0.6 }}>✓</span>}
          </button>
        ))}
      </div>
      <div style={{ padding: "12px", borderTop: "1px solid #45475a" }}>
        <button onClick={() => setEditing(true)} style={{ width: "100%", padding: "8px", background: "#89b4fa", color: "#1e1e2e", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "13px" }}>
          + Create Custom Theme
        </button>
      </div>
    </div>
  );
}
