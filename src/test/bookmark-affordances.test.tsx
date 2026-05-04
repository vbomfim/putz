/**
 * Unit tests for bookmark affordances (T4).
 *
 * Covers: bookmarkHelpers, Toast component, Cmd+D handler,
 * toolbar button, context menu items, menu events.
 *
 * Tags: [TDD], [AC-1] through [AC-11]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useCallback, useEffect } from "react";

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock cwdRegistry
const mockGetSessionCwd = vi.fn();
vi.mock("../components/Terminal/cwdRegistry", () => ({
  getSessionCwd: (...args: unknown[]) => mockGetSessionCwd(...args),
  clearSessionCwd: vi.fn(),
}));

// ─── layoutStore mock ────────────────────────────────────────────────

// F7/F8: Use snapshot/restore pattern — save original values in beforeEach,
// restore in afterEach so mutations don't leak across tests on assertion failure.
const DEFAULT_LAYOUT_STATE = {
  focusedRegionId: "region-1",
  regions: {
    "region-1": {
      id: "region-1",
      tabs: [
        {
          id: "tab-editor",
          type: "editor" as const,
          title: "config.ts",
          sessionId: "editor-1",
          editorFilePath: "/Users/me/config.ts",
        },
      ],
      activeTabId: "tab-editor",
      tabPosition: "top" as const,
    },
  },
  addTerminalTab: vi.fn(),
  closeTab: vi.fn(),
  nextTab: vi.fn(),
  prevTab: vi.fn(),
  splitRegion: vi.fn(),
  toggleSearch: vi.fn(),
  toggleLogging: vi.fn(),
  setFocusedRegion: vi.fn(),
};

// Deep-clone helper for plain objects (no functions — those are shared refs)
function cloneLayoutState() {
  return {
    ...DEFAULT_LAYOUT_STATE,
    regions: JSON.parse(JSON.stringify(DEFAULT_LAYOUT_STATE.regions)),
  };
}

let mockLayoutState = cloneLayoutState();

vi.mock("../stores/layoutStore", () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(mockLayoutState)),
    { getState: () => mockLayoutState },
  ),
  MAX_TITLE_LENGTH: 100,
}));

// ─── bookmarksStore mock ─────────────────────────────────────────────

// F7/F8: Reset via reassignment in beforeEach — avoids `.length = 0` gotcha
let mockBookmarks: Array<{ id: string; path: string; type: string }> = [];
const mockAddBookmark = vi.fn();

vi.mock("../stores/bookmarksStore", () => ({
  useBookmarksStore: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => {
      const state = { bookmarks: mockBookmarks, addBookmark: mockAddBookmark };
      return selector(state);
    }),
    {
      getState: () => ({
        bookmarks: mockBookmarks,
        addBookmark: mockAddBookmark,
      }),
    },
  ),
}));

vi.mock("../stores/broadcastStore", () => ({
  useBroadcastStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = { toggle: vi.fn() };
    return selector(state);
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      toggleShortcutsPanel: vi.fn(),
    };
    return selector(state);
  }),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────

import {
  getBookmarkableFromFocusedTab,
  getBookmarkableFromTab,
  getFocusedTerminalSessionId,
  isBookmarkActionAvailable,
  setAddBookmarkFromTabCallback,
} from "../utils/bookmarkHelpers";
import { stripBidiControls } from "../utils/sanitize";
import { useBookmarksStore } from "../stores/bookmarksStore";
import type { RegionTab } from "../types";
import { Toast, useToast } from "../components/Toast";

// ─── bookmarkHelpers tests ───────────────────────────────────────────

describe("getBookmarkableFromTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockLayoutState = cloneLayoutState();
  });

  function makeTab(overrides: Partial<RegionTab>): RegionTab {
    return {
      id: "tab-1",
      title: "Test",
      type: "terminal",
      sessionId: "s-1",
      ...overrides,
    };
  }

  it("returns file path for editor tab with editorFilePath", () => {
    const tab = makeTab({
      type: "editor",
      editorFilePath: "/Users/me/config.ts",
    });
    const result = getBookmarkableFromTab(tab);
    expect(result).toEqual({ path: "/Users/me/config.ts", type: "file" });
  });

  it("returns file path for CSV tab with editorFilePath", () => {
    const tab = makeTab({
      type: "csv",
      editorFilePath: "/data/report.csv",
    });
    const result = getBookmarkableFromTab(tab);
    expect(result).toEqual({ path: "/data/report.csv", type: "file" });
  });

  it("returns file path for markdown tab with editorFilePath", () => {
    const tab = makeTab({
      type: "markdown",
      editorFilePath: "/docs/README.md",
    });
    const result = getBookmarkableFromTab(tab);
    expect(result).toEqual({ path: "/docs/README.md", type: "file" });
  });

  it("returns CWD for terminal tab from cwdRegistry", () => {
    mockGetSessionCwd.mockReturnValue("/Users/me/dev");
    const tab = makeTab({ type: "terminal", sessionId: "sess-42" });
    const result = getBookmarkableFromTab(tab);
    expect(result).toEqual({ path: "/Users/me/dev", type: "folder" });
    expect(mockGetSessionCwd).toHaveBeenCalledWith("sess-42");
  });

  it("returns null for terminal tab with no CWD", () => {
    mockGetSessionCwd.mockReturnValue(undefined);
    const tab = makeTab({ type: "terminal", sessionId: "sess-42" });
    expect(getBookmarkableFromTab(tab)).toBeNull();
  });

  it("returns null for settings tab", () => {
    const tab = makeTab({ type: "settings" });
    expect(getBookmarkableFromTab(tab)).toBeNull();
  });

  it("returns null for diff tab", () => {
    const tab = makeTab({ type: "diff" });
    expect(getBookmarkableFromTab(tab)).toBeNull();
  });

  it("returns null for search tab", () => {
    const tab = makeTab({ type: "search" });
    expect(getBookmarkableFromTab(tab)).toBeNull();
  });

  it("returns null for editor tab without editorFilePath", () => {
    const tab = makeTab({ type: "editor", editorFilePath: undefined });
    expect(getBookmarkableFromTab(tab)).toBeNull();
  });
});

describe("getBookmarkableFromFocusedTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockLayoutState = cloneLayoutState();
  });

  it("returns file bookmark for focused editor tab", () => {
    const result = getBookmarkableFromFocusedTab();
    expect(result).toEqual({ path: "/Users/me/config.ts", type: "file" });
  });

  it("returns null when no focused region", () => {
    mockLayoutState.regions = {} as typeof mockLayoutState.regions;
    expect(getBookmarkableFromFocusedTab()).toBeNull();
  });

  it("returns null when focused region has no active tab", () => {
    mockLayoutState.regions["region-1"].activeTabId = "nonexistent";
    expect(getBookmarkableFromFocusedTab()).toBeNull();
  });
});

describe("getFocusedTerminalSessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockLayoutState = cloneLayoutState();
  });

  it("returns null when focused tab is not a terminal", () => {
    expect(getFocusedTerminalSessionId()).toBeNull();
  });

  it("returns sessionId when focused tab is a terminal", () => {
    mockLayoutState.regions["region-1"].tabs = [
      {
        id: "tab-term",
        type: "terminal" as const,
        title: "Terminal",
        sessionId: "pty-99",
      },
    ];
    mockLayoutState.regions["region-1"].activeTabId = "tab-term";

    expect(getFocusedTerminalSessionId()).toBe("pty-99");
  });
});

// ─── Toast component tests ───────────────────────────────────────────

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders toast text when message is provided", () => {
    render(<Toast message={{ key: 1, text: "Hello" }} />);
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("does not render when message is null", () => {
    const { container } = render(<Toast message={null} />);
    expect(container.querySelector(".toast")).toBeNull();
  });

  it("has role=status and aria-live=polite", () => {
    render(<Toast message={{ key: 1, text: "Test" }} />);
    const toast = screen.getByTestId("toast");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
  });

  it("auto-dismisses after timeout", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        message={{ key: 1, text: "Bye" }}
        duration={2000}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText("Bye")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("replaces previous toast when new message arrives", () => {
    const { rerender } = render(<Toast message={{ key: 1, text: "First" }} />);
    expect(screen.getByText("First")).toBeTruthy();

    rerender(<Toast message={{ key: 2, text: "Second" }} />);
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("uses default duration of 2000ms", () => {
    const onDismiss = vi.fn();
    render(
      <Toast message={{ key: 1, text: "Default" }} onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("useToast hook", () => {
  it("starts with null message", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current[0]).toBeNull();
  });

  it("showToast sets message with incrementing key", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current[1]("Hello");
    });
    expect(result.current[0]).toEqual({ key: 1, text: "Hello" });

    act(() => {
      result.current[1]("World");
    });
    expect(result.current[0]).toEqual({ key: 2, text: "World" });
  });

  it("dismissToast clears message", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current[1]("Hello");
    });
    expect(result.current[0]).not.toBeNull();

    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toBeNull();
  });
});

// ─── isBookmarkActionAvailable tests (H1) ────────────────────────────

describe("isBookmarkActionAvailable", () => {
  function makeTab(overrides: Partial<RegionTab>): RegionTab {
    return {
      id: "tab-1",
      title: "Test",
      type: "terminal",
      sessionId: "s-1",
      ...overrides,
    };
  }

  it("returns false for settings tab", () => {
    expect(isBookmarkActionAvailable(makeTab({ type: "settings" }))).toBe(
      false,
    );
  });

  it("returns false for diff tab", () => {
    expect(isBookmarkActionAvailable(makeTab({ type: "diff" }))).toBe(false);
  });

  it("returns false for search tab", () => {
    expect(isBookmarkActionAvailable(makeTab({ type: "search" }))).toBe(false);
  });

  it("returns true for editor tab with editorFilePath", () => {
    expect(
      isBookmarkActionAvailable(
        makeTab({ type: "editor", editorFilePath: "/a/b.ts" }),
      ),
    ).toBe(true);
  });

  it("returns false for editor tab without editorFilePath", () => {
    expect(
      isBookmarkActionAvailable(
        makeTab({ type: "editor", editorFilePath: undefined }),
      ),
    ).toBe(false);
  });

  it("returns true for CSV tab with editorFilePath", () => {
    expect(
      isBookmarkActionAvailable(
        makeTab({ type: "csv", editorFilePath: "/data.csv" }),
      ),
    ).toBe(true);
  });

  it("returns true for markdown tab with editorFilePath", () => {
    expect(
      isBookmarkActionAvailable(
        makeTab({ type: "markdown", editorFilePath: "/doc.md" }),
      ),
    ).toBe(true);
  });

  it("returns true for terminal tab WITH cached CWD", () => {
    mockGetSessionCwd.mockReturnValue("/some/dir");
    expect(isBookmarkActionAvailable(makeTab({ type: "terminal" }))).toBe(true);
  });

  it("returns true for terminal tab WITHOUT cached CWD (H1 semantics)", () => {
    // Key H1 test: terminal tabs are always available even without cached CWD
    // because the action handler resolves via async pty_cwd fallback.
    mockGetSessionCwd.mockReturnValue(undefined);
    expect(isBookmarkActionAvailable(makeTab({ type: "terminal" }))).toBe(true);
  });
});

// ─── F2: AC10 already-bookmarked dedup test ──────────────────────────

/**
 * Minimal test harness that replicates App.tsx's bookmark logic.
 * Uses the same pattern as App.tsx: executeAddBookmark + handleAddBookmark.
 * Avoids rendering the full App (which brings in Monaco, Router, etc.).
 */
function BookmarkTestHarness() {
  const [toastMessage, showToast] = useToast();

  const executeAddBookmark = useCallback(
    (path: string, type: "file" | "folder") => {
      const name = path.split("/").pop() ?? path;
      const bookmarks = useBookmarksStore.getState().bookmarks;
      const alreadyExists = bookmarks.some(
        (b: { path: string }) => b.path === path,
      );
      if (alreadyExists) {
        showToast(`Already bookmarked: ${name}`);
        return;
      }
      useBookmarksStore.getState().addBookmark(path, type);
      showToast(`⭐ Bookmarked: ${name}`);
    },
    [showToast],
  );

  const handleAddBookmark = useCallback(() => {
    const bookmarkable = getBookmarkableFromFocusedTab();
    if (bookmarkable) {
      executeAddBookmark(bookmarkable.path, bookmarkable.type);
      return;
    }
    const sessionId = getFocusedTerminalSessionId();
    if (sessionId) {
      mockInvoke("pty_cwd", { sessionId })
        .then((cwd: string) => {
          executeAddBookmark(cwd, "folder");
        })
        .catch(() => {
          showToast("Cannot determine current directory");
        });
    }
  }, [executeAddBookmark, showToast]);

  // Wire context menu callback
  useEffect(() => {
    setAddBookmarkFromTabCallback((tab: RegionTab) => {
      const bookmarkable = getBookmarkableFromTab(tab);
      if (bookmarkable) {
        executeAddBookmark(bookmarkable.path, bookmarkable.type);
        return;
      }
      if (tab.type === "terminal") {
        mockInvoke("pty_cwd", { sessionId: tab.sessionId })
          .then((cwd: string) => {
            executeAddBookmark(cwd, "folder");
          })
          .catch(() => {
            showToast("Cannot determine current directory");
          });
      }
    });
    return () => setAddBookmarkFromTabCallback(null);
  }, [executeAddBookmark, showToast]);

  return (
    <>
      <button data-testid="trigger-bookmark" onClick={handleAddBookmark}>
        Add Bookmark
      </button>
      <Toast key={toastMessage?.key} message={toastMessage} duration={5000} />
    </>
  );
}

describe("AC10: already-bookmarked dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockLayoutState = cloneLayoutState();
  });

  it("shows 'Already bookmarked' toast when duplicate is added", () => {
    // Pre-populate with an existing bookmark
    mockBookmarks = [{ id: "bk-1", path: "/abs/config.ts", type: "file" }];

    // Layout: editor tab focused with the same path
    mockLayoutState.regions["region-1"].tabs = [
      {
        id: "tab-editor",
        type: "editor" as const,
        title: "config.ts",
        sessionId: "e-1",
        editorFilePath: "/abs/config.ts",
      },
    ];
    mockLayoutState.regions["region-1"].activeTabId = "tab-editor";

    render(<BookmarkTestHarness />);

    act(() => {
      screen.getByTestId("trigger-bookmark").click();
    });

    expect(screen.getByText("Already bookmarked: config.ts")).toBeTruthy();
    expect(mockAddBookmark).not.toHaveBeenCalled();
  });

  it("shows '⭐ Bookmarked' toast and calls addBookmark for new path", () => {
    mockBookmarks = [];

    mockLayoutState.regions["region-1"].tabs = [
      {
        id: "tab-editor",
        type: "editor" as const,
        title: "foo.ts",
        sessionId: "e-2",
        editorFilePath: "/projects/foo.ts",
      },
    ];
    mockLayoutState.regions["region-1"].activeTabId = "tab-editor";

    render(<BookmarkTestHarness />);

    act(() => {
      screen.getByTestId("trigger-bookmark").click();
    });

    expect(screen.getByText("⭐ Bookmarked: foo.ts")).toBeTruthy();
    expect(mockAddBookmark).toHaveBeenCalledTimes(1);
    expect(mockAddBookmark).toHaveBeenCalledWith("/projects/foo.ts", "file");
  });
});

// ─── F4: pty_cwd async fallback tests ────────────────────────────────

describe("pty_cwd async fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookmarks = [];
    mockLayoutState = cloneLayoutState();
  });

  it("resolves CWD via pty_cwd when cwdRegistry has no entry", async () => {
    // Terminal tab focused, cwdRegistry returns undefined
    mockGetSessionCwd.mockReturnValue(undefined);
    mockLayoutState.regions["region-1"].tabs = [
      {
        id: "tab-term",
        type: "terminal" as const,
        title: "Terminal",
        sessionId: "pty-42",
      },
    ];
    mockLayoutState.regions["region-1"].activeTabId = "tab-term";

    // pty_cwd resolves with a directory
    mockInvoke.mockResolvedValueOnce("/home/user/work");

    render(<BookmarkTestHarness />);

    await act(async () => {
      screen.getByTestId("trigger-bookmark").click();
      // Flush the promise
      await Promise.resolve();
    });

    expect(mockInvoke).toHaveBeenCalledWith("pty_cwd", { sessionId: "pty-42" });
    expect(mockAddBookmark).toHaveBeenCalledWith("/home/user/work", "folder");
    expect(screen.getByText("⭐ Bookmarked: work")).toBeTruthy();
  });

  it("shows error toast when pty_cwd rejects", async () => {
    mockGetSessionCwd.mockReturnValue(undefined);
    mockLayoutState.regions["region-1"].tabs = [
      {
        id: "tab-term",
        type: "terminal" as const,
        title: "Terminal",
        sessionId: "pty-99",
      },
    ];
    mockLayoutState.regions["region-1"].activeTabId = "tab-term";

    mockInvoke.mockRejectedValueOnce(new Error("PTY gone"));

    render(<BookmarkTestHarness />);

    await act(async () => {
      screen.getByTestId("trigger-bookmark").click();
      await Promise.resolve();
    });

    expect(mockAddBookmark).not.toHaveBeenCalled();
    expect(screen.getByText("Cannot determine current directory")).toBeTruthy();
  });
});

// ─── M-Sec1: stripBidiControls tests ─────────────────────────────────

describe("stripBidiControls", () => {
  it("strips U+200E LEFT-TO-RIGHT MARK", () => {
    expect(stripBidiControls("he\u200Ello")).toBe("hello");
  });

  it("strips U+200F RIGHT-TO-LEFT MARK", () => {
    expect(stripBidiControls("ab\u200Fcd")).toBe("abcd");
  });

  it("strips U+061C ARABIC LETTER MARK", () => {
    expect(stripBidiControls("te\u061Cst")).toBe("test");
  });

  it("strips U+2066 LEFT-TO-RIGHT ISOLATE", () => {
    expect(stripBidiControls("\u2066file.ts")).toBe("file.ts");
  });

  it("strips U+2067 RIGHT-TO-LEFT ISOLATE", () => {
    expect(stripBidiControls("file\u2067.ts")).toBe("file.ts");
  });

  it("strips U+2068 FIRST STRONG ISOLATE", () => {
    expect(stripBidiControls("fi\u2068le")).toBe("file");
  });

  it("strips U+2069 POP DIRECTIONAL ISOLATE", () => {
    expect(stripBidiControls("abc\u2069")).toBe("abc");
  });

  it("strips U+202A LEFT-TO-RIGHT EMBEDDING", () => {
    expect(stripBidiControls("\u202Apath")).toBe("path");
  });

  it("strips U+202B RIGHT-TO-LEFT EMBEDDING", () => {
    expect(stripBidiControls("p\u202Bath")).toBe("path");
  });

  it("strips U+202C POP DIRECTIONAL FORMATTING", () => {
    expect(stripBidiControls("end\u202C")).toBe("end");
  });

  it("strips U+202D LEFT-TO-RIGHT OVERRIDE", () => {
    expect(stripBidiControls("\u202Doverride")).toBe("override");
  });

  it("strips U+202E RIGHT-TO-LEFT OVERRIDE", () => {
    expect(stripBidiControls("txt\u202E")).toBe("txt");
  });

  it("strips multiple bidi characters from the same string", () => {
    expect(stripBidiControls("\u200Ea\u200Fb\u202Ec")).toBe("abc");
  });

  it("is idempotent — double-call produces same result", () => {
    const input = "\u200Ehello\u202E";
    const once = stripBidiControls(input);
    const twice = stripBidiControls(once);
    expect(once).toBe("hello");
    expect(twice).toBe("hello");
  });

  it("returns empty string unchanged", () => {
    expect(stripBidiControls("")).toBe("");
  });

  it("returns clean string unchanged (no-op)", () => {
    expect(stripBidiControls("clean-file.ts")).toBe("clean-file.ts");
  });
});

// ─── M-CR2: Toast key forces React remount for screen readers ────────

describe("Toast key remount for screen readers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("remounts the live region element when key changes (duplicate text)", () => {
    // Render Toast with key=1, capture the DOM node
    const { rerender } = render(
      <Toast
        key={1}
        message={{ key: 1, text: "Bookmarked" }}
        duration={5000}
      />,
    );
    const node1 = screen.getByTestId("toast");

    // Re-render with a new key but the SAME text — React should remount
    rerender(
      <Toast
        key={2}
        message={{ key: 2, text: "Bookmarked" }}
        duration={5000}
      />,
    );
    const node2 = screen.getByTestId("toast");

    // The DOM element should be a different node (remounted, not patched)
    expect(node1).not.toBe(node2);
  });
});
