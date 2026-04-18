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
import { useBookmarksStore } from "./stores/bookmarksStore";
import { dispatchBookmarkClick, extractBasename } from "./utils/bookmarkDispatch";
import { stripBidiControls } from "./utils/sanitize";
import {
  getBookmarkableFromFocusedTab,
  getBookmarkableFromTab,
  getFocusedTerminalSessionId,
  setAddBookmarkFromTabCallback,
} from "./utils/bookmarkHelpers";
import { RegionContainer } from "./components/Region";
import { BroadcastBar } from "./components/BroadcastBar";
import { ShortcutsPanel } from "./components/Help";
import { SessionSidebar } from "./components/SessionManager";

import { useMenuEvents, setMenuEventCallbacks } from "./utils/useMenuEvents";
import {
  useKeyboardShortcuts,
  setKeyboardShortcutCallbacks,
} from "./components/TabBar/useKeyboardShortcuts";
import { QuickConnect } from "./components/QuickConnect";
import { CredentialReminder } from "./components/Vault/CredentialReminder";
import { PingDashboard } from "./components/Ping/PingDashboard";
import { Toast, useToast } from "./components/Toast";
import { BookmarksPanel } from "./components/BookmarksPanel";

import { ThemeEditor } from "./components/Terminal/ThemeEditor";
import { FontConfig } from "./components/Terminal/FontConfig";
import { WorkspaceBar } from "./components/Workspace";
import { BookmarksBar } from "./components/BookmarksBar";
import { useThemeStore } from "./stores/themeStore";
import { useSettingsStore } from "./stores/settingsStore";
import type { Theme } from "./components/Terminal/themeTypes";
import type { SessionProfile } from "./components/SessionManager";
import type { ParsedConnection } from "./components/QuickConnect";
import type { RegionTab } from "./types";
import "./components/SessionManager/SessionManager.css";
import "./styles/App.css";

// ─── Display helpers ─────────────────────────────────────────────────

/** Strips bidi control characters and returns basename for safe toast display. */
function safeBasename(path: string): string {
  return stripBidiControls(extractBasename(path));
}

function App() {
  const regions = useLayoutStore((s) => s.regions);
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const addBrowserTab = useLayoutStore((s) => s.addBrowserTab);
  const addEditorTab = useLayoutStore((s) => s.addEditorTab);
  const addVaultTab = useLayoutStore((s) => s.addVaultTab);
  const addHistoryTab = useLayoutStore((s) => s.addHistoryTab);
  const addTemplateTab = useLayoutStore((s) => s.addTemplateTab);
  const addSettingsTab = useLayoutStore((s) => s.addSettingsTab);
  const workspaceBarVisible = useSettingsStore((s) => s.workspaceBarVisible);
  const toggleWorkspaceBar = useSettingsStore((s) => s.toggleWorkspaceBar);
  const bookmarksBarVisible = useSettingsStore((s) => s.bookmarksBarVisible);
  const toggleBookmarksBar = useSettingsStore((s) => s.toggleBookmarksBar);
  const hasInitialized = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [fontConfigOpen, setFontConfigOpen] = useState(false);
  const [pingOpen, setPingOpen] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);
  const [toastMessage, showToast, dismissToast] = useToast();
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);

  // ─── Bookmark: core "add bookmark" logic ─────────────────────────
  /**
   * Adds a bookmark for a given bookmarkable item.
   * Shows appropriate toast ("Bookmarked: X" or "Already bookmarked: X").
   */
  const executeAddBookmark = useCallback(
    (path: string, type: "file" | "folder") => {
      const name = safeBasename(path);
      const bookmarks = useBookmarksStore.getState().bookmarks;
      const alreadyExists = bookmarks.some((b) => b.path === path);
      if (alreadyExists) {
        showToast(`Already bookmarked: ${name}`);
        return;
      }
      useBookmarksStore.getState().addBookmark(path, type);
      showToast(`⭐ Bookmarked: ${name}`);
    },
    [showToast],
  );

  /**
   * "Add bookmark" for the currently focused tab.
   * Handles sync (editor) and async (terminal CWD fallback) paths.
   */
  const handleAddBookmark = useCallback(() => {
    const bookmarkable = getBookmarkableFromFocusedTab();
    if (bookmarkable) {
      executeAddBookmark(bookmarkable.path, bookmarkable.type);
      return;
    }
    // Async fallback: terminal without cached CWD → try pty_cwd
    const sessionId = getFocusedTerminalSessionId();
    if (sessionId) {
      invoke<string>("pty_cwd", { sessionId })
        .then((cwd) => {
          executeAddBookmark(cwd, "folder");
        })
        .catch(() => {
          showToast("Cannot determine current directory");
        });
      return;
    }
    // Not bookmarkable — no-op (toolbar button should be disabled)
  }, [executeAddBookmark, showToast]);

  /**
   * "Add bookmark" for a specific tab (used by context menu).
   * Handles sync (editor) and async (terminal CWD fallback) paths.
   */
  const handleAddBookmarkFromTab = useCallback(
    (tab: RegionTab) => {
      const bookmarkable = getBookmarkableFromTab(tab);
      if (bookmarkable) {
        executeAddBookmark(bookmarkable.path, bookmarkable.type);
        return;
      }
      // Async fallback for terminal tabs without cached CWD
      if (tab.type === "terminal") {
        invoke<string>("pty_cwd", { sessionId: tab.sessionId })
          .then((cwd) => {
            executeAddBookmark(cwd, "folder");
          })
          .catch(() => {
            showToast("Cannot determine current directory");
          });
      }
    },
    [executeAddBookmark, showToast],
  );

  // Listen for native menu events from the Tauri backend
  useMenuEvents();

  // Register keyboard shortcuts (now uses layoutStore)
  useKeyboardShortcuts();

  // Wire keyboard shortcut callback for Cmd+D → add bookmark
  useEffect(() => {
    setKeyboardShortcutCallbacks({
      onAddBookmark: handleAddBookmark,
      onToggleBookmarksPanel: () => setBookmarksPanelOpen((prev) => !prev),
    });
    return () => setKeyboardShortcutCallbacks({});
  }, [handleAddBookmark]);

  // Wire context menu bookmark callback (module-level, avoids prop drilling)
  useEffect(() => {
    setAddBookmarkFromTabCallback(handleAddBookmarkFromTab);
    return () => setAddBookmarkFromTabCallback(null);
  }, [handleAddBookmarkFromTab]);

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
      onToggleVault: () => addVaultTab(),
      onToggleKeyManager: () => addVaultTab(),
      onToggleThemeEditor: () => setThemeEditorOpen((prev) => !prev),
      onToggleFontConfig: () => setFontConfigOpen((prev) => !prev),
      onToggleTemplates: () => addTemplateTab(),
      onToggleHistory: () => addHistoryTab(),
      onTogglePing: () => setPingOpen((prev) => !prev),
      onToggleScript: () => addEditorTab(),
      onOpenSettings: () => addSettingsTab(),
      onNewBrowserTab: () => addBrowserTab(undefined, ""),
      onToggleWorkspaceBar: () => toggleWorkspaceBar(),
      onToggleBookmarksBar: () => toggleBookmarksBar(),
      onAddBookmark: handleAddBookmark,
      onToggleBookmarksPanel: () => setBookmarksPanelOpen((prev) => !prev),
    });
    return () => setMenuEventCallbacks({});
  }, [addBrowserTab, addEditorTab, addVaultTab, addHistoryTab, addTemplateTab, addSettingsTab, toggleWorkspaceBar, toggleBookmarksBar, handleAddBookmark]);

  // Create the first tab on mount only
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      const allEmpty = Object.values(regions).every((r) => r.tabs.length === 0);
      if (allEmpty) {
        addTerminalTab();
      }
      // Load and apply active theme on startup
      invoke<Theme[]>("theme_list").then((themes) => {
        const activeId = useThemeStore.getState().activeThemeId;
        const active = themes.find((t) => t.id === activeId) || themes[0];
        if (active) {
          useThemeStore.getState().setActiveTheme(active.id, active.colors);
        }
        setAvailableThemes(themes);
        useThemeStore.getState().setThemes(
          themes.map((t) => ({ id: t.id, name: t.name, isBuiltin: t.isBuiltin }))
        );
      }).catch(() => {});
    }
  }, [addTerminalTab, regions]);

  // Global keyboard shortcuts for History (Ctrl+R) and QuickConnect (Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();

      // Ctrl+R — Open command history tab
      if (key === "r" && !e.shiftKey) {
        e.preventDefault();
        addHistoryTab();
        setQuickConnectOpen(false);
        return;
      }

      // Ctrl+K — Toggle quick connect bar
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setQuickConnectOpen((prev) => !prev);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addHistoryTab]);

  // Global Escape key — close overlay panels
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
  }, [themeEditorOpen, fontConfigOpen]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  /** Global keyboard shortcut: Ctrl+Shift+T → Templates tab. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier || !e.shiftKey) return;
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        addTemplateTab();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTemplateTab]);

  /** Called when a session is opened from the sidebar. */
  const handleSessionOpen = useCallback((_session: SessionProfile) => {
    // Future: spawn a connection for this session profile.
    // For now, just open a new local terminal tab.
    addTerminalTab();
  }, [addTerminalTab]);

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
  // Note: don't render empty state here — RegionContainer handles all workspaces.
  // Switching to an empty workspace shouldn't unmount other workspace terminals.

  return (
    <div className="app-shell" data-testid="app-root">
      {workspaceBarVisible && <WorkspaceBar />}
      <main className="app-container">
        <CredentialReminder />
        {/* BookmarksBar — positioned below toolbar, above region tree. */}
        {bookmarksBarVisible && (
          <BookmarksBar
            onBookmarkClick={(bookmark) => {
              void dispatchBookmarkClick(bookmark);
            }}
          />
        )}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {sidebarOpen && (
            <SessionSidebar
              isOpen={sidebarOpen}
              onToggle={handleSidebarToggle}
              onSessionOpen={handleSessionOpen}
            />
          )}
          <div className="app-content">
            <RegionContainer />
          </div>
        </div>
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
      <QuickConnect
        isOpen={quickConnectOpen}
        onClose={() => setQuickConnectOpen(false)}
        onConnect={handleQuickConnect}
      />

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

      {/* Ping Dashboard */}
      {pingOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPingOpen(false); }} role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel--wide"><button className="modal-close" onClick={() => setPingOpen(false)}>✕</button><PingDashboard /></div>
        </div>
      )}

      {/* Bookmarks Manager panel — mount/unmount to avoid idle Zustand subscriptions */}
      {bookmarksPanelOpen && (
        <BookmarksPanel onClose={() => setBookmarksPanelOpen(false)} />
      )}

      {/* Toast notification — auto-dismiss, bottom-right */}
      <Toast key={toastMessage?.key} message={toastMessage} duration={2000} onDismiss={dismissToast} />
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
  const [localThemes, setLocalThemes] = useState(themes);
  
  const handleSelectTheme = (theme: Theme) => {
    setActiveTheme(theme.id, theme.colors);
  };
  
  if (editing) {
    return (
      <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Theme Editor">
        <div className="modal-panel modal-panel--wide">
          <button className="modal-close" onClick={() => setEditing(false)} aria-label="Back">←</button>
          <ThemeEditor
            themes={localThemes}
            editingTheme={null}
            onSave={async (name, colors) => {
              try {
                await invoke("theme_create", { input: { name, colors } });
                // Reload themes and apply the new one
                const updated = await invoke<Theme[]>("theme_list");
                setLocalThemes(updated);
                const created = updated.find((t) => t.name === name);
                if (created) setActiveTheme(created.id, created.colors);
              } catch (err) {
                console.error("Failed to save theme:", err);
              }
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }
  
  // Side panel — no dark overlay so user sees theme changes live
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "320px",
      background: "var(--bg-primary)", borderLeft: "1px solid var(--border-color)",
      zIndex: 300, display: "flex", flexDirection: "column",
      boxShadow: "-4px 0 20px rgba(0,0,0,0.3)",
      animation: "slide-in-right 0.15s ease-out",
    }} role="dialog" aria-label="Theme Selector">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: "1px solid var(--border-color)" }}>
        <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: "16px" }}>🎨 Color Themes</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-primary)", fontSize: "18px", cursor: "pointer" }} aria-label="Close">✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {localThemes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => handleSelectTheme(theme)}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 12px",
              border: theme.id === activeThemeId ? "2px solid var(--accent)" : "1px solid var(--border-color)",
              borderRadius: "6px",
              background: theme.colors.background,
              color: theme.colors.foreground,
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
      <div style={{ padding: "12px", borderTop: "1px solid var(--border-color)" }}>
        <button onClick={() => setEditing(true)} style={{ width: "100%", padding: "8px", background: "var(--accent)", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "13px" }}>
          + Create Custom Theme
        </button>
      </div>
    </div>
  );
}
