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

const mockAddTerminalTab = vi.fn();
const mockAddEditorTab = vi.fn();
const mockCloseTab = vi.fn();
const mockSplitRegion = vi.fn();
const mockNextTab = vi.fn();
const mockPrevTab = vi.fn();
const mockToggleBroadcast = vi.fn();
const mockToggleShortcutsPanel = vi.fn();

vi.mock("../stores/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        addTerminalTab: mockAddTerminalTab,
        addEditorTab: mockAddEditorTab,
        closeTab: mockCloseTab,
        splitRegion: mockSplitRegion,
        nextTab: mockNextTab,
        prevTab: mockPrevTab,
      };
      return selector(state);
    }),
    {
      getState: () => ({
        focusedRegionId: "region-1",
        regions: {
          "region-1": {
            id: "region-1",
            activeTabId: "tab-1",
            tabs: [
              {
                id: "tab-1",
                type: "terminal",
                sessionId: "s1",
              },
            ],
          },
        },
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
      toggleShortcutsPanel: mockToggleShortcutsPanel,
    };
    return selector(state);
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
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

  it("menu-new-terminal calls addTerminalTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-new-terminal");
    expect(mockAddTerminalTab).toHaveBeenCalledTimes(1);
  });

  it("menu-close-tab calls closeTab with focused region and active tab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-close-tab");
    expect(mockCloseTab).toHaveBeenCalledWith("region-1", "tab-1");
  });

  it("menu-close-all-tabs is handled without error", () => {
    renderHook(() => useMenuEvents());
    // menu-close-all-tabs is currently a no-op in the handler
    expect(() => emitMenuEvent("menu-close-all-tabs")).not.toThrow();
  });

  // ─── Edit menu ─────────────────────────────────────────────────

  it("menu-find dispatches putz-find custom event", () => {
    const handler = vi.fn();
    window.addEventListener("putz-find", handler);
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-find");
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("putz-find", handler);
  });

  // ─── View menu ─────────────────────────────────────────────────

  it("menu-toggle-bookmarks-bar calls onToggleBookmarksBar callback", () => {
    const onToggleBookmarksBar = vi.fn();
    setMenuEventCallbacks({ onToggleBookmarksBar });
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-toggle-bookmarks-bar");
    expect(onToggleBookmarksBar).toHaveBeenCalledTimes(1);
  });

  it("menu-split-vertical calls splitRegion('vertical')", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-split-vertical");
    expect(mockSplitRegion).toHaveBeenCalledWith("vertical");
  });

  it("menu-split-horizontal calls splitRegion('horizontal')", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-split-horizontal");
    expect(mockSplitRegion).toHaveBeenCalledWith("horizontal");
  });

  it("menu-toggle-broadcast calls toggle with region keys", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-toggle-broadcast");
    expect(mockToggleBroadcast).toHaveBeenCalledWith(["region-1"], "region-1");
  });

  // ─── Session menu ──────────────────────────────────────────────

  it("menu-start-logging is handled without error", () => {
    renderHook(() => useMenuEvents());
    // menu-start-logging is currently a no-op in the handler
    expect(() => emitMenuEvent("menu-start-logging")).not.toThrow();
  });

  // ─── Window menu ───────────────────────────────────────────────

  it("menu-next-tab calls nextTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-next-tab");
    expect(mockNextTab).toHaveBeenCalledTimes(1);
  });

  it("menu-previous-tab calls prevTab", () => {
    renderHook(() => useMenuEvents());
    emitMenuEvent("menu-previous-tab");
    expect(mockPrevTab).toHaveBeenCalledTimes(1);
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

  it("menu-config-diff is handled as unknown event without error", () => {
    renderHook(() => useMenuEvents());
    // menu-config-diff was removed from the handler
    expect(() => emitMenuEvent("menu-config-diff")).not.toThrow();
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

  it("menu-sftp is handled as unknown event without error", () => {
    renderHook(() => useMenuEvents());
    // menu-sftp was removed from the handler
    expect(() => emitMenuEvent("menu-sftp")).not.toThrow();
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
