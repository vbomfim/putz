/**
 * Application shell — entry point for the Putz terminal emulator.
 *
 * Renders a region-based terminal interface with:
 * - RegionContainer for the window layout (regions with tab bars)
 * - ShortcutsPanel modal for keyboard shortcuts reference
 * - Empty state with "New Terminal" prompt when no tabs exist
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLayoutStore } from "./stores/layoutStore";
import { useBookmarksStore } from "./stores/bookmarksStore";
import {
  dispatchBookmarkClick,
  extractBasename,
} from "./utils/bookmarkDispatch";
import { stripBidiControls } from "./utils/sanitize";
import {
  getBookmarkableFromFocusedTab,
  getBookmarkableFromTab,
  getFocusedTerminalSessionId,
  setAddBookmarkFromTabCallback,
} from "./utils/bookmarkHelpers";
import { getSessionCwd } from "./components/Terminal/cwdRegistry";
import { RegionContainer } from "./components/Region";
import { BroadcastBar } from "./components/BroadcastBar";
import { PathBar } from "./components/PathBar";
import { ShortcutsPanel } from "./components/Help";

import { useMenuEvents, setMenuEventCallbacks } from "./utils/useMenuEvents";
import {
  useKeyboardShortcuts,
  setKeyboardShortcutCallbacks,
} from "./components/TabBar/useKeyboardShortcuts";
import { Toast, useToast } from "./components/Toast";

import { ThemeEditor } from "./components/Terminal/ThemeEditor";
import { FontConfig } from "./components/Terminal/FontConfig";
import { WorkspaceBar } from "./components/Workspace";
import { BookmarksBar } from "./components/BookmarksBar";
import { useThemeStore } from "./stores/themeStore";
import { useSettingsStore } from "./stores/settingsStore";
import {
  SwarmSidebar,
  InboxPanel,
  SpawnPalette,
} from "./components/Swarm";
import { useSwarmShortcuts } from "./hooks/useSwarmShortcuts";
import { useSwarmNotifyListener } from "./hooks/useSwarmNotifyListener";
import { useSwarmAmbientProducer } from "./hooks/useSwarmAmbientProducer";
import { useSwarmInboxStore } from "./stores/swarmInboxStore";
import type { Theme } from "./components/Terminal/themeTypes";
import type { RegionTab } from "./types";
import "./styles/App.css";

// ─── Display helpers ─────────────────────────────────────────────────

/** Strips bidi control characters and returns basename for safe toast display. */
function safeBasename(path: string): string {
  return stripBidiControls(extractBasename(path));
}

function App() {
  const regions = useLayoutStore((s) => s.regions);
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const addEditorTab = useLayoutStore((s) => s.addEditorTab);
  const addSettingsTab = useLayoutStore((s) => s.addSettingsTab);
  const addBookmarksTab = useLayoutStore((s) => s.addBookmarksTab);
  const workspaceBarVisible = useSettingsStore((s) => s.workspaceBarVisible);
  const toggleWorkspaceBar = useSettingsStore((s) => s.toggleWorkspaceBar);
  const bookmarksBarVisible = useSettingsStore((s) => s.bookmarksBarVisible);
  const toggleBookmarksBar = useSettingsStore((s) => s.toggleBookmarksBar);
  const swarmEnabled = useSettingsStore((s) => s.swarmEnabled);
  const swarmSidebarPosition = useSettingsStore(
    (s) => s.swarmSidebarPosition,
  );
  const swarmSidebarCollapsed = useSettingsStore(
    (s) => s.swarmSidebarCollapsed,
  );
  const toggleSwarmSidebarCollapsed = useSettingsStore(
    (s) => s.toggleSwarmSidebarCollapsed,
  );
  const hasInitialized = useRef(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [fontConfigOpen, setFontConfigOpen] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);
  const [toastMessage, showToast, dismissToast] = useToast();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Swarm: keyboard shortcuts (Cmd+J inbox, Cmd+K palette).
  // D3: gated by `swarmEnabled` so the user can opt out and let
  // xterm receive Ctrl+J / Ctrl+K natively.
  useSwarmShortcuts(
    {
      onToggleInbox: useCallback(() => setInboxOpen((v) => !v), []),
      onTogglePalette: useCallback(() => setPaletteOpen((v) => !v), []),
    },
    { enabled: swarmEnabled },
  );

  // Swarm: subscribe to swarm://notify events.
  useSwarmNotifyListener();

  // B3: bump per-tab ambient counter when swarm-registered, unfocused
  // tabs emit PTY output. Throttled at one bump per
  // `SWARM_AMBIENT_THROTTLE_MS` per tab (see hook). Gated by
  // `swarmEnabled` so opt-out users don't pay the listener cost.
  useSwarmAmbientProducer(swarmEnabled);

  // Focus-tab callback used by inbox + sidebar rows. Resolves the
  // tab id within the layout store and switches the active tab in the
  // first matching region. Also clears that tab's unread inbox count.
  // F9: Send-notify callback. Calls the backend `swarm_send_notify`
  // command, which sanitizes the message and emits a `swarm://notify`
  // event to the local UI. The local inbox listener (already mounted
  // via `useSwarmNotifyListener`) appends it; the sidebar/inbox light
  // up identically to a peer-originated notify.
  //
  // Fire-and-forget on success; surface failures via a toast so the
  // user knows their message didn't go through.
  const onSendNotifyToColleague = useCallback(
    (colleague: { tab_id: string; name: string }, message: string) => {
      void invoke<void>("swarm_send_notify", {
        targetColleagueId: colleague.tab_id,
        message,
      }).catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        showToast(`Notify failed: ${m}`);
      });
    },
    [showToast],
  );

  const focusSwarmTab = useCallback((tabId: string) => {
    const state = useLayoutStore.getState();
    for (const [regionId, region] of Object.entries(state.regions)) {
      if (region.tabs.some((t) => t.id === tabId)) {
        // B2: mark-read is now handled centrally by the subscription
        // below, which fires whenever ANY code path activates a tab.
        // We still call it here for synchronous UX in tests that don't
        // wait for the subscription microtask.
        useSwarmInboxStore.getState().markAllReadForTab(tabId);
        // D4: `activateTab(regionId, tabId)` is the canonical store
        // action. The previous code looked for a non-existent
        // `setActiveTab` via unsafe cast and silently no-op'd —
        // focusing a tab from the inbox/sidebar never actually moved
        // the active tab. Fixed.
        state.activateTab(regionId, tabId);
        return;
      }
    }
  }, []);

  // B2: any time a region's `activeTabId` changes (clicked tab, ⌘1-9
  // shortcut, programmatic activate from anywhere), mark that tab's
  // notify entries read AND clear its ambient counter. This is the
  // canonical subscription: focusSwarmTab is one path; user clicks +
  // keyboard shortcuts are others. Subscribing once means every path
  // benefits without per-call wiring.
  useEffect(() => {
    let prev: Record<string, string | null> = {};
    const snap = useLayoutStore.getState().regions;
    for (const [rid, region] of Object.entries(snap)) {
      prev[rid] = region.activeTabId ?? null;
    }
    const unsubscribe = useLayoutStore.subscribe((state) => {
      const next: Record<string, string | null> = {};
      for (const [rid, region] of Object.entries(state.regions)) {
        next[rid] = region.activeTabId ?? null;
        if (next[rid] && next[rid] !== prev[rid]) {
          const tabId = next[rid] as string;
          // Mark read + clear ambient counter for the newly-focused tab.
          useSwarmInboxStore.getState().clearAmbient(tabId);
        }
      }
      prev = next;
    });
    return unsubscribe;
  }, []);

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
      onToggleBookmarksPanel: () => addBookmarksTab(),
    });
    return () => setKeyboardShortcutCallbacks({});
  }, [handleAddBookmark, addBookmarksTab]);

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
        useThemeStore.getState().setThemes(
          themes.map((t) => ({
            id: t.id,
            name: t.name,
            isBuiltin: t.isBuiltin,
          })),
        );
      })
      .catch((err) => {
        console.warn("[App] Failed to load themes:", err);
      });
  }, [themeEditorOpen]);

  // Wire menu event callbacks for panel toggles
  useEffect(() => {
    setMenuEventCallbacks({
      onToggleThemeEditor: () => setThemeEditorOpen((prev) => !prev),
      onToggleFontConfig: () => setFontConfigOpen((prev) => !prev),
      onToggleScript: () => addEditorTab(),
      onOpenSettings: () => addSettingsTab(),
      onToggleWorkspaceBar: () => toggleWorkspaceBar(),
      onToggleBookmarksBar: () => toggleBookmarksBar(),
      onAddBookmark: handleAddBookmark,
      onToggleBookmarksPanel: () => addBookmarksTab(),
    });
    return () => setMenuEventCallbacks({});
  }, [
    addEditorTab,
    addSettingsTab,
    addBookmarksTab,
    toggleWorkspaceBar,
    toggleBookmarksBar,
    handleAddBookmark,
  ]);

  // Create the first tab on mount only
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;

      // Boot sequence — order matters:
      //   1. swarm_set_enabled FIRST so the backend coordinator binds
      //      the socket and flips `enabled=true` BEFORE any pty_spawn
      //      runs. Otherwise the auto-spawned first tab races against
      //      the swarm boot and inherits empty PUTZ_SWARM_PATH.
      //   2. theme_list (independent — can fire in parallel)
      //   3. addTerminalTab (depends on swarm being ready for env injection)
      const swarmEnabled = useSettingsStore.getState().swarmEnabled;
      const swarmReady = invoke("swarm_set_enabled", {
        enabled: swarmEnabled,
      }).catch((err: unknown) => {
        console.warn("[App] swarm boot sync failed:", err);
      });

      // Load and apply active theme on startup (independent — fire in parallel)
      invoke<Theme[]>("theme_list")
        .then((themes) => {
          const activeId = useThemeStore.getState().activeThemeId;
          const active = themes.find((t) => t.id === activeId) || themes[0];
          if (active) {
            useThemeStore.getState().setActiveTheme(active.id, active.colors);
          }
          setAvailableThemes(themes);
          useThemeStore.getState().setThemes(
            themes.map((t) => ({
              id: t.id,
              name: t.name,
              isBuiltin: t.isBuiltin,
            })),
          );
        })
        .catch(() => {});

      // Spawn the first tab AFTER swarm boot completes, so PUTZ_SWARM_PATH
      // is already injectable when pty_spawn runs.
      const allEmpty = Object.values(regions).every((r) => r.tabs.length === 0);
      if (allEmpty) {
        void swarmReady.then(() => addTerminalTab());
      }
    }
  }, [addTerminalTab, regions]);

  // Swarm event listeners — handle spawn-tab requests from the broker.
  // T4 / FR-019, FR-020: the wire payload (emitted by the Rust
  // `swarm_spawn_from_recipe` / `swarm_spawn_colleague` commands)
  // carries the resolved recipe along with a stable `tab_id` so the
  // swarm coordinator can route notify/control frames to the new
  // colleague. We forward those into `addTerminalTab` so the new tab
  // launches the recipe executable directly (NOT a login shell).
  useEffect(() => {
    const unlistenSpawn = listen<{
      name: string;
      env: Record<string, string>;
      command: string;
      args: string[];
      cwd?: string | null;
      title?: string;
      tab_id: string;
      colleague_id: string;
    }>("swarm://spawn-tab", (event) => {
      // H3: never log the env (may carry tokens or @privacy Tier-2
      // recipe-supplied values). Log just the colleague id.
      console.info(
        "[App] swarm://spawn-tab event received, colleague:",
        event.payload.colleague_id,
      );
      const p = event.payload;
      void useLayoutStore.getState().addTerminalTab(undefined, {
        shell: p.command,
        args: p.args,
        cwd: p.cwd ?? undefined,
        env: p.env,
        title: p.title ?? p.name,
        tabId: p.tab_id,
      });
    });

    return () => {
      unlistenSpawn.then((fn) => fn());
    };
  }, []);

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

  // Empty state — all regions are empty
  // Note: don't render empty state here — RegionContainer handles all workspaces.
  // Switching to an empty workspace shouldn't unmount other workspace terminals.

  return (
    <div className="app-shell" data-testid="app-root">
      {workspaceBarVisible && <WorkspaceBar />}
      <main className="app-container">
        {/* BookmarksBar — positioned below toolbar, above region tree. */}
        {bookmarksBarVisible && (
          <BookmarksBar
            onBookmarkClick={(bookmark) => {
              void dispatchBookmarkClick(bookmark);
            }}
          />
        )}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {swarmEnabled && swarmSidebarPosition === "left" && (
            <SwarmSidebar
              position="left"
              collapsed={swarmSidebarCollapsed}
              onToggleCollapsed={toggleSwarmSidebarCollapsed}
              onFocusTab={focusSwarmTab}
              onSendNotify={onSendNotifyToColleague}
            />
          )}
          <div className="app-content">
            <RegionContainer />
          </div>
          {swarmEnabled && swarmSidebarPosition === "right" && (
            <SwarmSidebar
              position="right"
              collapsed={swarmSidebarCollapsed}
              onToggleCollapsed={toggleSwarmSidebarCollapsed}
              onFocusTab={focusSwarmTab}
              onSendNotify={onSendNotifyToColleague}
            />
          )}
        </div>
        <PathBar />
        <BroadcastBar />
        <ShortcutsPanel />

        {/* Swarm modals — Cmd+J inbox + Cmd+K spawn palette */}
        <InboxPanel
          open={inboxOpen}
          onClose={() => setInboxOpen(false)}
          onFocusTab={(tabId) => {
            focusSwarmTab(tabId);
            setInboxOpen(false);
          }}
        />
        <SpawnPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          workspaceRoot={(() => {
            // A1 (FR-019): the recipe loader needs the workspace root
            // (`.putz/spawn.json` lives there). Resolve from the active
            // terminal tab's tracked cwd. If no terminal is active or
            // its cwd isn't yet known, returning null is safe — the
            // palette still opens but loads no recipes; the built-in
            // "Spawn: gh copilot" entry remains available.
            const sessionId = getFocusedTerminalSessionId();
            return sessionId ? getSessionCwd(sessionId) ?? null : null;
          })()}
          invoke={invoke}
          onSpawnError={(_, msg) => showToast(`Spawn failed: ${msg}`)}
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

        {/* Toast notification — auto-dismiss, bottom-right */}
        <Toast
          key={toastMessage?.key}
          message={toastMessage}
          duration={2000}
          onDismiss={dismissToast}
        />
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
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Font Settings"
    >
      <div className="modal-panel">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <FontConfig settings={fontSettings} onChange={setFontSettings} />
      </div>
    </div>
  );
}

/** Theme selection + editor overlay */
function ThemeOverlay({
  themes,
  onClose,
}: {
  themes: Theme[];
  onClose: () => void;
}) {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const [editing, setEditing] = useState(false);
  const [localThemes, setLocalThemes] = useState(themes);

  const handleSelectTheme = (theme: Theme) => {
    setActiveTheme(theme.id, theme.colors);
  };

  if (editing) {
    return (
      <div
        className="modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Theme Editor"
      >
        <div className="modal-panel modal-panel--wide">
          <button
            className="modal-close"
            onClick={() => setEditing(false)}
            aria-label="Back"
          >
            ←
          </button>
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
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "320px",
        background: "var(--bg-primary)",
        borderLeft: "1px solid var(--border-color)",
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.3)",
        animation: "slide-in-right 0.15s ease-out",
      }}
      role="dialog"
      aria-label="Theme Selector"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <h3
          style={{ margin: 0, color: "var(--text-primary)", fontSize: "16px" }}
        >
          🎨 Color Themes
        </h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-primary)",
            fontSize: "18px",
            cursor: "pointer",
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {localThemes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => handleSelectTheme(theme)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              border:
                theme.id === activeThemeId
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border-color)",
              borderRadius: "6px",
              background: theme.colors.background,
              color: theme.colors.foreground,
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.1s",
            }}
          >
            <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
              {[
                theme.colors.red,
                theme.colors.green,
                theme.colors.blue,
                theme.colors.yellow,
                theme.colors.magenta,
                theme.colors.cyan,
              ].map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    background: c,
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontWeight: theme.id === activeThemeId ? "bold" : "normal",
                fontSize: "13px",
              }}
            >
              {theme.name}
            </span>
            {theme.id === activeThemeId && (
              <span
                style={{ marginLeft: "auto", fontSize: "11px", opacity: 0.6 }}
              >
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        style={{ padding: "12px", borderTop: "1px solid var(--border-color)" }}
      >
        <button
          onClick={() => setEditing(true)}
          style={{
            width: "100%",
            padding: "8px",
            background: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "13px",
          }}
        >
          + Create Custom Theme
        </button>
      </div>
    </div>
  );
}
