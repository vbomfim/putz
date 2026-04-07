/**
 * Unit tests for useMenuEvents hook.
 *
 * Tags: [TDD], [AC-menu-dispatch]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMenuEvents } from "../utils/useMenuEvents";

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

  // ─── Unknown events ───────────────────────────────────────────

  it("unknown menu event does not throw", () => {
    renderHook(() => useMenuEvents());
    expect(() => emitMenuEvent("menu-unknown-action")).not.toThrow();
  });
});
