/**
 * Unit tests for useMenuEvents hook.
 *
 * Tags: [TDD], [AC-menu-dispatch], [AC-menu-panels]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMenuEvents, setMenuEventCallbacks } from "../utils/useMenuEvents";

// ─── Capture the event listener from @tauri-apps/api/event ────────

type ListenCallback = (event: { payload: { id: string } }) => void;
let capturedCallback: ListenCallback | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, callback: ListenCallback) => {
    capturedCallback = callback;
    return Promise.resolve(vi.fn()); // unlisten
  }),
}));

// ─── Store mocks ─────────────────────────────────────────────────

const mockAddTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockCloseAllTabs = vi.fn();
const mockSplitActivePane = vi.fn();
const mockToggleSearch = vi.fn();
const mockToggleLogging = vi.fn();
const mockActivateNextTab = vi.fn();
const mockActivatePreviousTab = vi.fn();
const mockToggleBroadcast = vi.fn();
const mockToggleToolbar = vi.fn();
const mockToggleShortcutsPanel = vi.fn();

vi.mock("../stores/tabStore", () => ({
  useTabStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        addTab: mockAddTab,
        removeTab: mockRemoveTab,
        closeAllTabs: mockCloseAllTabs,
        splitActivePane: mockSplitActivePane,
        toggleSearch: mockToggleSearch,
        toggleLogging: mockToggleLogging,
        activateNextTab: mockActivateNextTab,
        activatePreviousTab: mockActivatePreviousTab,
        tabs: [{ id: "tab-1" }],
        activeTabId: "tab-1",
      };
      return selector(state);
    }),
    {
      getState: () => ({
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1" }],
      }),
    },
  ),
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggle: mockToggleBroadcast,
    };
    return selector(state);
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggleToolbar: mockToggleToolbar,
      toggleShortcutsPanel: mockToggleShortcutsPanel,
    };
    return selector(state);
  }),
}));

/** Simulates a menu event from the Tauri backend. */
function emitMenuEvent(id: string) {
  if (capturedCallback) {
    capturedCallback({ payload: { id } });
  }
}

describe("useMenuEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
    setMenuEventCallbacks({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a listener for 'menu-event'", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    renderHook(() => useMenuEvents());
    expect(listen).toHaveBeenCalledWith("menu-event", expect.any(Function));
  });

  // ─── File menu ─────────────────────────────────────────────────

  it("menu-new-terminal calls addTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-new-terminal");
    expect(mockAddTab).toHaveBeenCalledTimes(1);
  });

  it("menu-close-tab calls removeTab with active tab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-close-tab");
    expect(mockRemoveTab).toHaveBeenCalledWith("tab-1");
  });

  it("menu-close-all-tabs calls closeAllTabs", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-close-all-tabs");
    expect(mockCloseAllTabs).toHaveBeenCalledTimes(1);
  });

  // ─── Edit menu ─────────────────────────────────────────────────

  it("menu-find calls toggleSearch", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-find");
    expect(mockToggleSearch).toHaveBeenCalledTimes(1);
  });

  // ─── View menu ─────────────────────────────────────────────────

  it("menu-toggle-toolbar calls toggleToolbar", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-toggle-toolbar");
    expect(mockToggleToolbar).toHaveBeenCalledTimes(1);
  });

  it("menu-toggle-bookmarks-bar calls onToggleBookmarksBar callback", () => {
    const onToggleBookmarksBar = vi.fn();
    setMenuEventCallbacks({ onToggleBookmarksBar });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-toggle-bookmarks-bar");
    expect(onToggleBookmarksBar).toHaveBeenCalledTimes(1);
  });

  it("menu-split-vertical calls splitActivePane('vertical')", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-split-vertical");
    expect(mockSplitActivePane).toHaveBeenCalledWith("vertical");
  });

  it("menu-split-horizontal calls splitActivePane('horizontal')", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-split-horizontal");
    expect(mockSplitActivePane).toHaveBeenCalledWith("horizontal");
  });

  it("menu-toggle-broadcast calls toggle with tab IDs", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-toggle-broadcast");
    expect(mockToggleBroadcast).toHaveBeenCalledWith(["tab-1"], "tab-1");
  });

  // ─── Session menu ──────────────────────────────────────────────

  it("menu-start-logging calls toggleLogging", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-start-logging");
    expect(mockToggleLogging).toHaveBeenCalledTimes(1);
  });

  // ─── Window menu ───────────────────────────────────────────────

  it("menu-next-tab calls activateNextTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-next-tab");
    expect(mockActivateNextTab).toHaveBeenCalledTimes(1);
  });

  it("menu-previous-tab calls activatePreviousTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-previous-tab");
    expect(mockActivatePreviousTab).toHaveBeenCalledTimes(1);
  });

  // ─── Help menu ─────────────────────────────────────────────────

  it("menu-keyboard-shortcuts calls toggleShortcutsPanel", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-keyboard-shortcuts");
    expect(mockToggleShortcutsPanel).toHaveBeenCalledTimes(1);
  });

  // ─── Panel toggle callbacks via setMenuEventCallbacks ──────────

  it("menu-theme-editor calls onToggleThemeEditor callback", () => {
    const onToggleThemeEditor = vi.fn();
    setMenuEventCallbacks({ onToggleThemeEditor });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-theme-editor");
    expect(onToggleThemeEditor).toHaveBeenCalledTimes(1);
  });

  it("menu-font-config calls onToggleFontConfig callback", () => {
    const onToggleFontConfig = vi.fn();
    setMenuEventCallbacks({ onToggleFontConfig });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-font-config");
    expect(onToggleFontConfig).toHaveBeenCalledTimes(1);
  });

  it("menu-config-diff calls onToggleConfigDiff callback", () => {
    const onToggleConfigDiff = vi.fn();
    setMenuEventCallbacks({ onToggleConfigDiff });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-config-diff");
    expect(onToggleConfigDiff).toHaveBeenCalledTimes(1);
  });

  it("menu-command-templates calls onToggleTemplates callback", () => {
    const onToggleTemplates = vi.fn();
    setMenuEventCallbacks({ onToggleTemplates });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-command-templates");
    expect(onToggleTemplates).toHaveBeenCalledTimes(1);
  });

  it("menu-command-history calls onToggleHistory callback", () => {
    const onToggleHistory = vi.fn();
    setMenuEventCallbacks({ onToggleHistory });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-command-history");
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
  });

  it("menu-sftp calls onToggleSftp callback", () => {
    const onToggleSftp = vi.fn();
    setMenuEventCallbacks({ onToggleSftp });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-sftp");
    expect(onToggleSftp).toHaveBeenCalledTimes(1);
  });

  it("menu-ping-dashboard calls onTogglePing callback", () => {
    const onTogglePing = vi.fn();
    setMenuEventCallbacks({ onTogglePing });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-ping-dashboard");
    expect(onTogglePing).toHaveBeenCalledTimes(1);
  });

  it("menu-script-editor calls onToggleScript callback", () => {
    const onToggleScript = vi.fn();
    setMenuEventCallbacks({ onToggleScript });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-script-editor");
    expect(onToggleScript).toHaveBeenCalledTimes(1);
  });

  it("menu-credential-vault calls onToggleVault callback", () => {
    const onToggleVault = vi.fn();
    setMenuEventCallbacks({ onToggleVault });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-credential-vault");
    expect(onToggleVault).toHaveBeenCalledTimes(1);
  });

  it("menu-ssh-key-manager calls onToggleKeyManager callback", () => {
    const onToggleKeyManager = vi.fn();
    setMenuEventCallbacks({ onToggleKeyManager });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-ssh-key-manager");
    expect(onToggleKeyManager).toHaveBeenCalledTimes(1);
  });

  it("menu-new-browser-tab calls onNewBrowserTab callback", () => {
    const onNewBrowserTab = vi.fn();
    setMenuEventCallbacks({ onNewBrowserTab });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-new-browser-tab");
    expect(onNewBrowserTab).toHaveBeenCalledTimes(1);
  });

  // ─── M2: Async unmount race — cancelled flag ────────────────────

  it("listener is cleaned up when unmounted before listen resolves", async () => {
    // Replace the listen mock to delay resolution
    const { listen } = await import("@tauri-apps/api/event");
    const mockUnlisten = vi.fn();
    let resolvePromise: ((fn: () => void) => void) | null = null;

    vi.mocked(listen).mockImplementation(() => {
      return new Promise<() => void>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const { unmount } = renderHook(() => useMenuEvents());

    // Unmount BEFORE promise resolves
    unmount();

    // Now resolve the promise — unlisten should be called immediately
    // (the cancelled flag causes `fn()` to be called to tear down)
    expect(resolvePromise).not.toBeNull();
    resolvePromise!(mockUnlisten);

    // The unlisten function should have been called because we unmounted
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  // ─── Unknown events ───────────────────────────────────────────

  it("unknown menu event does not throw", () => {
    renderHook(() => useMenuEvents());
    expect(() => emitMenuEvent("menu-unknown-action")).not.toThrow();
  });
});
