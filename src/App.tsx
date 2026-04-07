import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalView, TERMINAL_CONFIG } from "./components/Terminal";
import { SessionSidebar } from "./components/SessionManager";
import type { SessionProfile } from "./components/SessionManager";
import "./components/SessionManager/SessionManager.css";
import "./styles/App.css";

/** Application shell — entry point for the Putz terminal emulator. */
function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /** Spawns a new PTY session and stores the session ID. */
  const spawnSession = useCallback(async () => {
    setError(null);
    setSessionId(null);

    try {
      const id = await invoke<string>("pty_spawn", {
        cols: TERMINAL_CONFIG.defaultCols,
        rows: TERMINAL_CONFIG.defaultRows,
      });
      setSessionId(id);
    } catch (err: unknown) {
      setError(`Failed to start terminal: ${String(err)}`);
    }
  }, []);

  // Spawn shell on first render
  useEffect(() => {
    spawnSession();
  }, [spawnSession]);

  const handleTitleChange = useCallback((title: string) => {
    document.title = title ? `${title} — Putz` : "Putz";
  }, []);

  const handleRestart = useCallback(() => {
    spawnSession();
  }, [spawnSession]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  /** Called when a session is opened from the sidebar. */
  const handleSessionOpen = useCallback((_session: SessionProfile) => {
    // Future: spawn a connection for this session profile.
    // For now, the terminal is already running a local shell.
  }, []);

  if (error) {
    return (
      <main className="app-container" data-testid="app-root">
        <div className="app-error" data-testid="app-error">
          <h2>Failed to Start Terminal</h2>
          <p>{error}</p>
          <button
            className="app-retry-btn"
            onClick={handleRestart}
            type="button"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="app-container" data-testid="app-root">
        <div className="app-loading" data-testid="app-loading">
          Starting terminal…
        </div>
      </main>
    );
  }

  return (
    <main className="app-container" data-testid="app-root">
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
      <TerminalView
        sessionId={sessionId}
        onTitleChange={handleTitleChange}
        onRestart={handleRestart}
      />
    </main>
  );
}

export default App;
