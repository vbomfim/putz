/**
 * Unit tests for keyboard shortcuts hook.
 *
 * Tags: [TDD], [AC-4], [AC-5], [AC-6]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useKeyboardShortcuts,
  setKeyboardShortcutCallbacks,
} from "../components/TabBar/useKeyboardShortcuts";

const mockAddTerminalTab = vi.fn();
const mockCloseTab = vi.fn();
const mockNextTab = vi.fn();
const mockPrevTab = vi.fn();
const mockSplitRegion = vi.fn();
const mockToggleSearch = vi.fn();
const mockToggleLogging = vi.fn();
const mockToggleBroadcast = vi.fn();
const mockToggleShortcutsPanel = vi.fn();
const mockAddBookmark = vi.fn();
const mockToggleBookmarksPanel = vi.fn();

const mockLayoutState = {
  focusedRegionId: "region-1",
  regions: {
    "region-1": {
      id: "region-1",
      tabs: [
        {
          id: "tab-1",
          type: "terminal" as const,
          title: "Terminal",
          sessionId: "s-1",
          isSearchOpen: false,
        },
      ],
      activeTabId: "tab-1",
    },
  },
  addTerminalTab: mockAddTerminalTab,
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
    setKeyboardShortcutCallbacks({
      onAddBookmark: mockAddBookmark,
      onToggleBookmarksPanel: mockToggleBookmarksPanel,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setKeyboardShortcutCallbacks({});
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

  it("Ctrl+D does NOT trigger split (reserved for bookmark when no xterm)", () => {
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

  // ─── Cmd+D / Ctrl+D — Add Bookmark ───────────────────────────────

  it("Ctrl+D triggers add-bookmark when no xterm focused [AC1]", () => {
    // jsdom's activeElement is <body> by default — no .xterm ancestor
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { ctrlKey: true });
    expect(mockAddBookmark).toHaveBeenCalledTimes(1);
  });

  // F6: Wrap xterm DOM fixture in try/finally so cleanup runs even on
  // assertion failure. Prevents leaked DOM elements between tests.
  it("Ctrl+D does NOT trigger add-bookmark when xterm focused [AC4]", () => {
    // Create a fake xterm container with a focused child
    const xtermDiv = document.createElement("div");
    xtermDiv.classList.add("xterm");
    const child = document.createElement("textarea");
    xtermDiv.appendChild(child);
    document.body.appendChild(xtermDiv);

    try {
      child.focus();

      renderHook(() => useKeyboardShortcuts());
      simulateKeyDown("d", { ctrlKey: true });

      expect(mockAddBookmark).not.toHaveBeenCalled();
    } finally {
      // Cleanup — runs even if assertions fail
      document.body.removeChild(xtermDiv);
    }
  });

  it("Meta+D (macOS) triggers add-bookmark when no xterm focused", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("d", { metaKey: true });
    expect(mockAddBookmark).toHaveBeenCalledTimes(1);
  });

  // ─── M-Sec2: xterm guard integration test ──────────────────────────
  //
  // Creates a real xterm-shaped DOM tree to verify isXtermFocused() guard.
  // This tests the actual DOM selector (.xterm + .xterm-helper-textarea)
  // used by xterm.js v5 to confirm the guard fires correctly.

  it("xterm guard fires when .xterm-helper-textarea inside .xterm is focused [M-Sec2]", () => {
    // Create a realistic xterm.js v5 DOM structure
    const xtermDiv = document.createElement("div");
    xtermDiv.classList.add("xterm");
    const helperTextarea = document.createElement("textarea");
    helperTextarea.classList.add("xterm-helper-textarea");
    xtermDiv.appendChild(helperTextarea);
    document.body.appendChild(xtermDiv);

    try {
      helperTextarea.focus();

      renderHook(() => useKeyboardShortcuts());
      simulateKeyDown("d", { ctrlKey: true });

      // Ctrl+D should NOT trigger bookmark — xterm guard blocks it
      expect(mockAddBookmark).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(xtermDiv);
    }
  });

  it("xterm guard does NOT fire when focus is outside .xterm [M-Sec2]", () => {
    // Regular input outside xterm — Ctrl+D should trigger bookmark
    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      input.focus();

      renderHook(() => useKeyboardShortcuts());
      simulateKeyDown("d", { ctrlKey: true });

      expect(mockAddBookmark).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(input);
    }
  });

  // ─── Cmd+Shift+O / Ctrl+Shift+O — Toggle Bookmarks Panel ────────

  it("Ctrl+Shift+O triggers toggle-bookmarks-panel when no xterm focused [H3]", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("o", { ctrlKey: true, shiftKey: true });
    expect(mockToggleBookmarksPanel).toHaveBeenCalledTimes(1);
  });

  it("Meta+Shift+O (macOS) triggers toggle-bookmarks-panel when no xterm focused [H3]", () => {
    renderHook(() => useKeyboardShortcuts());
    simulateKeyDown("o", { metaKey: true, shiftKey: true });
    expect(mockToggleBookmarksPanel).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+O fires toggle-bookmarks-panel even when xterm focused [H3]", () => {
    // Ctrl+Shift+O no longer uses xterm guard — Shift makes it unambiguous.
    const xtermDiv = document.createElement("div");
    xtermDiv.classList.add("xterm");
    const child = document.createElement("textarea");
    xtermDiv.appendChild(child);
    document.body.appendChild(xtermDiv);

    try {
      child.focus();

      renderHook(() => useKeyboardShortcuts());
      simulateKeyDown("o", { ctrlKey: true, shiftKey: true });

      expect(mockToggleBookmarksPanel).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(xtermDiv);
    }
  });
});
