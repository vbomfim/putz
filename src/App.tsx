/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a tabbed terminal interface with:
 * - SessionSidebar on the left for session management
 * - TabBar at the top for tab management
 * - SplitContainer for the active tab's pane layout
 * - Empty state with "New Terminal" prompt when no tabs exist
 * - Config Diff Viewer (Ctrl+Shift+K)
 * - Command Templates panel (Ctrl+Shift+T)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "./stores/tabStore";
import { useBroadcastStore } from "./stores/broadcastStore";
import { TabBar } from "./components/TabBar";
import { BroadcastBar } from "./components/BroadcastBar";
import { SplitContainer } from "./components/SplitPane";
import { SessionSidebar } from "./components/SessionManager";
import { UpdateChecker } from "./components/UpdateChecker";
import { CredentialReminder } from "./components/Vault/CredentialReminder";
import { ConfigDiff } from "./components/ConfigDiff";
import { TemplatePanel } from "./components/Templates";
import type { SessionProfile } from "./components/SessionManager";
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
  const [configDiffOpen, setConfigDiffOpen] = useState(false);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);

  // Create the first tab on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    addTab();
  }, [addTab]);

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

  // Empty state — all tabs closed
  if (tabs.length === 0 && hasInitialized.current) {
    return (
      <main className="app-container" data-testid="app-root">
        <UpdateChecker />
        <TabBar />
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
      <BroadcastBar />
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
    </main>
  );
}

export default App;
