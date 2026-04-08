/**
 * Unit tests for keyboard shortcuts hook.
 *
 * Tags: [TDD], [AC-4], [AC-5], [AC-6]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../components/TabBar/useKeyboardShortcuts";

const mockAddTerminalTab = vi.fn();
const mockAddBrowserTab = vi.fn();
const mockCloseTab = vi.fn();
const mockNextTab = vi.fn();
const mockPrevTab = vi.fn();
const mockSplitRegion = vi.fn();
const mockToggleSearch = vi.fn();
const mockToggleLogging = vi.fn();
const mockToggleBroadcast = vi.fn();
const mockToggleShortcutsPanel = vi.fn();

const mockLayoutState = {
  focusedRegionId: "region-1",
  regions: {
    "region-1": {
      id: "region-1",
      tabs: [{ id: "tab-1", type: "terminal" as const, title: "Terminal", sessionId: "s-1", isSearchOpen: false }],
      activeTabId: "tab-1",
    },
  },
  addTerminalTab: mockAddTerminalTab,
  addBrowserTab: mockAddBrowserTab,
  closeTab: mockCloseTab,
  nextTab: mockNextTab,
  prevTab: mockPrevTab,
  splitRegion: mockSplitRegion,
  toggleSearch: mockToggleSearch,
  toggleLogging: mockToggleLogging,
};

vi.mock("../stores/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(mockLayoutState)),
    { getState: () => mockLayoutState },
  ),
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = { toggle: mockToggleBroadcast };
    return selector(state);
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = { toggleShortcutsPanel: mockToggleShortcutsPanel };
    return selector(state);
  }),
}));

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function simulateKeyDown(key: string, options: Partial<KeyboardEvent> = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    window.dispatchEvent(event);
  }

  it("registers keyboard event listener on mount", () => {
    const spy = vi.spyOn(window, "addEventListener");
    renderHook(() => useKeyboardShortcuts());
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("removes keyboard event listener on unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    unmount();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("Ctrl+T creates a new tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("t", { ctrlKey: true });
    expect(mockAddTerminalTab).toHaveBeenCalledTimes(1);
  });

  it("Meta+T creates a new tab (macOS)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("t", { metaKey: true });
    expect(mockAddTerminalTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+W closes active tab in focused region", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("w", { ctrlKey: true, shiftKey: true });
    expect(mockCloseTab).toHaveBeenCalledWith("region-1", "tab-1");
  });

  it("Ctrl+W does NOT close active tab (reserved for shell)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("w", { ctrlKey: true });
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Tab cycles to next tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("Tab", { ctrlKey: true });
    expect(mockNextTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+Tab cycles to previous tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("Tab", { ctrlKey: true, shiftKey: true });
    expect(mockPrevTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+E splits region vertically", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("e", { ctrlKey: true, shiftKey: true });
    expect(mockSplitRegion).toHaveBeenCalledWith("vertical");
  });

  it("Ctrl+D does NOT trigger split (reserved for shell EOF)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { ctrlKey: true });
    expect(mockSplitRegion).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+D splits region horizontally", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { ctrlKey: true, shiftKey: true });
    expect(mockSplitRegion).toHaveBeenCalledWith("horizontal");
  });

  it("ignores shortcuts without modifier keys", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("t");
    expect(mockAddTerminalTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+? opens keyboard shortcuts panel", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("?", { ctrlKey: true, shiftKey: true });
    expect(mockToggleShortcutsPanel).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+B opens new browser tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("b", { ctrlKey: true, shiftKey: true });
    expect(mockAddBrowserTab).toHaveBeenCalledWith(undefined, "");
  });
});
