/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a tabbed terminal interface with:
 * - TabBar at the top for tab management
 * - SplitContainer for the active tab's pane layout
 * - Empty state with "New Terminal" prompt when no tabs exist
 *
 * On initial load, creates one tab with a local terminal.
 */
import { useCallback, useEffect, useRef } from "react";
import { useTabStore } from "./stores/tabStore";
import { TabBar } from "./components/TabBar";
import { SplitContainer } from "./components/SplitPane";
import "./styles/App.css";

function App() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const hasInitialized = useRef(false);

  // Create the first tab on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    addTab();
  }, [addTab]);

  const handleNewTerminal = useCallback(() => {
    addTab();
  }, [addTab]);

  // Empty state — all tabs closed
  if (tabs.length === 0 && hasInitialized.current) {
    return (
      <main className="app-container" data-testid="app-root">
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
      <TabBar />
      <div className="app-content">
        {tabs.map((tab) => (
          <SplitContainer
            key={tab.id}
            layout={tab.layout}
            tabId={tab.id}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>
    </main>
  );
}

export default App;
