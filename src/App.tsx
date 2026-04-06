import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalView, TERMINAL_CONFIG } from "./components/Terminal";
import "./styles/App.css";

/** Application shell — entry point for the Putz terminal emulator. */
function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <TerminalView
        sessionId={sessionId}
        onTitleChange={handleTitleChange}
        onRestart={handleRestart}
      />
    </main>
  );
}

export default App;
