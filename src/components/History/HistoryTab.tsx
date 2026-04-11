/**
 * HistoryTab — Command history as a tab.
 *
 * Search box at top, results below. Click a command to send it
 * to the active terminal. Fast and keyboard-driven.
 *
 * @module HistoryTab
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "../Vault/VaultTab.css";

interface CommandEntry {
  id: number;
  sessionName: string;
  host: string;
  command: string;
  timestamp: string;
  sessionId: string;
}

export function HistoryTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const entries = await invoke<CommandEntry[]>("history_search", {
        input: { query: q, limit: 200 },
      });
      setResults(entries);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Search on mount (show recent) and on query change (debounced)
  useEffect(() => {
    doSearch("");
  }, [doSearch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const sendToTerminal = useCallback((command: string) => {
    const state = useLayoutStore.getState();
    const sessionId = state.getActiveSessionId();
    if (!sessionId) { showToast("No active terminal"); return; }
    const region = state.getFocusedRegion();
    const activeTab = region?.tabs.find((t) => t.id === region.activeTabId);
    const bytes = Array.from(new TextEncoder().encode(command));
    const ipcCommand = activeTab?.status === "connected" ? "connection_write" : "pty_write";
    invoke(ipcCommand, { sessionId, data: bytes }).catch(() => {});
    showToast("Sent to terminal");
  }, [showToast]);

  const handleClear = useCallback(async () => {
    try {
      await invoke("history_clear");
      setResults([]);
      showToast("History cleared");
    } catch {
      showToast("Failed to clear");
    }
  }, [showToast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && results.length > 0) {
      sendToTerminal(results[0].command);
    }
  }, [results, sendToTerminal]);

  return (
    <div className="vault-tab">
      {toast && <div className="vault-tab__toast">{toast}</div>}

      <div className="vault-tab__header">
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>📜 History</span>
        <input
          ref={searchRef}
          className="vault-tab__filter"
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands… (Enter to send first result)"
          autoFocus
        />
        <button
          className="vault-tab__add-btn"
          style={{ background: "transparent", border: "1px solid var(--hover-bg)", color: "var(--text-secondary)", fontSize: 11 }}
          onClick={handleClear}
          title="Clear all history"
        >
          🗑
        </button>
      </div>

      <div className="vault-tab__list">
        {loading && results.length === 0 && (
          <div className="vault-tab__empty">Searching…</div>
        )}
        {results.map((entry) => (
          <div
            key={entry.id}
            className="vault-tab__item"
            onClick={() => sendToTerminal(entry.command)}
            style={{ cursor: "pointer" }}
          >
            <div className="vault-tab__item-info" style={{ flex: 1 }}>
              <span className="vault-tab__item-name" style={{ fontFamily: "monospace" }}>
                {entry.command}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {entry.host && (
                <span className="vault-tab__item-badge">{entry.host}</span>
              )}
              <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                {new Date(entry.timestamp).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        ))}
        {!loading && results.length === 0 && (
          <div className="vault-tab__empty">
            {query ? "No matching commands" : "No command history yet"}
          </div>
        )}
      </div>
    </div>
  );
}
