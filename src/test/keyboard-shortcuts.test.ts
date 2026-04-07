/**
 * Unit tests for keyboard shortcuts hook.
 *
 * Tags: [TDD], [AC-4], [AC-5], [AC-6]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../components/TabBar/useKeyboardShortcuts";

const mockAddTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockActivateNextTab = vi.fn();
const mockActivatePreviousTab = vi.fn();
const mockActivateTabByIndex = vi.fn();
const mockSplitActivePane = vi.fn();
const mockToggleSearch = vi.fn();
const mockToggleLogging = vi.fn();
const mockToggleShortcutsPanel = vi.fn();
const mockToggleToolbar = vi.fn();

vi.mock("../stores/tabStore", () => ({
  useTabStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = {
        activeTabId: "tab-1",
        addTab: mockAddTab,
        removeTab: mockRemoveTab,
        activateNextTab: mockActivateNextTab,
        activatePreviousTab: mockActivatePreviousTab,
        activateTabByIndex: mockActivateTabByIndex,
        splitActivePane: mockSplitActivePane,
        toggleSearch: mockToggleSearch,
        toggleLogging: mockToggleLogging,
      };
      return selector(state);
    }),
    {
      getState: () => ({
        activeTabId: "tab-1",
        tabs: [
          { id: "tab-1", layout: { type: "leaf", terminalSessionId: "s-1" } },
        ],
        addTab: mockAddTab,
        removeTab: mockRemoveTab,
        activateNextTab: mockActivateNextTab,
        activatePreviousTab: mockActivatePreviousTab,
        activateTabByIndex: mockActivateTabByIndex,
        splitActivePane: mockSplitActivePane,
      }),
    },
  ),
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggle: vi.fn(),
    };
    return selector(state);
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggleShortcutsPanel: mockToggleShortcutsPanel,
      toggleToolbar: mockToggleToolbar,
    };
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
    expect(mockAddTab).toHaveBeenCalledTimes(1);
  });

  it("Meta+T creates a new tab (macOS)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("t", { metaKey: true });
    expect(mockAddTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+W closes active tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("w", { ctrlKey: true, shiftKey: true });
    expect(mockRemoveTab).toHaveBeenCalledWith("tab-1");
  });

  it("Ctrl+W does NOT close active tab (reserved for shell)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("w", { ctrlKey: true });
    expect(mockRemoveTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Tab cycles to next tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("Tab", { ctrlKey: true });
    expect(mockActivateNextTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+Tab cycles to previous tab", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("Tab", { ctrlKey: true, shiftKey: true });
    expect(mockActivatePreviousTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+1-9 activates tab by index", () => {
    renderHook(() => useKeyboardShortcuts());

    for (let i = 1; i <= 9; i++) {
      mockActivateTabByIndex.mockClear();
      simulateKeyDown(String(i), { ctrlKey: true });
      expect(mockActivateTabByIndex).toHaveBeenCalledWith(i - 1);
    }
  });

  it("Ctrl+Shift+E splits vertical", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("e", { ctrlKey: true, shiftKey: true });
    expect(mockSplitActivePane).toHaveBeenCalledWith("vertical");
  });

  it("Ctrl+D does NOT trigger split (reserved for shell EOF)", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { ctrlKey: true });
    expect(mockSplitActivePane).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+D splits horizontal", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { ctrlKey: true, shiftKey: true });
    expect(mockSplitActivePane).toHaveBeenCalledWith("horizontal");
  });

  it("ignores shortcuts without modifier keys", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("t");
    expect(mockAddTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+? opens keyboard shortcuts panel", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("?", { ctrlKey: true, shiftKey: true });
    expect(mockToggleShortcutsPanel).toHaveBeenCalledTimes(1);
  });
});
