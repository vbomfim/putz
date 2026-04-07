/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a tabbed terminal interface with:
 * - SessionSidebar on the left for session management
 * - TabBar at the top for tab management
 * - SplitContainer for the active tab's pane layout
 * - HistoryPanel (Ctrl+R) for cross-session command history search
 * - QuickConnect (Ctrl+K) for fast connection input
 * - Empty state with "New Terminal" prompt when no tabs exist
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "./stores/tabStore";
import { useBroadcastStore } from "./stores/broadcastStore";
import { TabBar } from "./components/TabBar";
import { BroadcastBar } from "./components/BroadcastBar";
import { SplitContainer } from "./components/SplitPane";
import { SessionSidebar } from "./components/SessionManager";
import { UpdateChecker } from "./components/UpdateChecker";
import { HistoryPanel } from "./components/History";
import { QuickConnect } from "./components/QuickConnect";
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

  const handleNewTerminal = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

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
    </main>
  );
}

export default App;
