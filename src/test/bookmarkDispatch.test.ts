/**
 * Unit tests for bookmark click dispatch.
 *
 * Tags: [TDD], [AC1-AC10], [shell-escape], [path-exists], [terminal-focus]
 *
 * Covers: file dispatch, folder dispatch, shell escaping, FS existence
 * checks, terminal focus detection, and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Monaco-editor mock — prevents jsdom crash on module load ────────
// layoutStore transitively imports RegionContainer → EditorTab → monaco.
// jsdom lacks document.queryCommandSupported which monaco needs at load.
vi.mock("monaco-editor", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({}));

// ─── Tauri IPC mock ──────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ─── Tauri event mock (required by layoutStore) ──────────────────────

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// ─── Import after mocks ──────────────────────────────────────────────

import {
  dispatchBookmarkClick,
  escapeShellPath,
  buildCdCommand,
  extractBasename,
} from "../utils/bookmarkDispatch";
import { useLayoutStore } from "../stores/layoutStore";
import type { BookmarkItem } from "../stores/bookmarksStore";

// ─── Test Helpers ────────────────────────────────────────────────────

/** Creates a BookmarkItem with sensible defaults. */
function makeBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: "bk-test-1",
    name: "test-file.ts",
    path: "/Users/me/project/test-file.ts",
    type: "file",
    folderId: null,
    sortIndex: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Resets layoutStore to a clean state with one region and no tabs. */
function resetStore(): void {
  const regionId = "test-region-1";
  useLayoutStore.setState({
    layout: { type: "region" as const, regionId },
    regions: {
      [regionId]: {
        id: regionId,
        tabs: [],
        activeTabId: "",
        tabPosition: "top" as const,
      },
    },
    focusedRegionId: regionId,
    isSearchOpen: false,
    loggingSessions: new Set<string>(),
    tabCounter: 0,
  });
}

/**
 * Adds a terminal tab to the focused region in the store.
 * Directly sets state without invoking Tauri spawn.
 */
function addTerminalTabToStore(sessionId: string): void {
  const state = useLayoutStore.getState();
  const regionId = state.focusedRegionId;
  const tabId = `tab-${sessionId}`;
  useLayoutStore.setState({
    regions: {
      ...state.regions,
      [regionId]: {
        ...state.regions[regionId],
        tabs: [
          ...state.regions[regionId].tabs,
          {
            id: tabId,
            title: "Terminal 1",
            type: "terminal",
            sessionId,
            status: "local",
          },
        ],
        activeTabId: tabId,
      },
    },
  });
}

/**
 * Adds an editor tab to the focused region in the store.
 * Directly sets state without invoking Tauri spawn.
 */
function addEditorTabToStore(filePath: string): void {
  const state = useLayoutStore.getState();
  const regionId = state.focusedRegionId;
  const tabId = `tab-editor-${filePath}`;
  useLayoutStore.setState({
    regions: {
      ...state.regions,
      [regionId]: {
        ...state.regions[regionId],
        tabs: [
          ...state.regions[regionId].tabs,
          {
            id: tabId,
            title: filePath.split("/").pop() || filePath,
            type: "editor",
            sessionId: `editor-${tabId}`,
            editorFilePath: filePath,
            status: "local",
          },
        ],
        activeTabId: tabId,
      },
    },
  });
}

/**
 * Configures mockInvoke so file_mtime resolves for paths in `existingPaths`
 * and rejects for all others. Other commands (pty_write) resolve.
 */
function setupPathExistence(existingPaths: string[]): void {
  mockInvoke.mockImplementation(
    (command: string, args?: Record<string, unknown>) => {
      if (command === "file_mtime") {
        const path = (args as { path: string }).path;
        if (existingPaths.includes(path)) {
          return Promise.resolve(1700000000000);
        }
        return Promise.reject(new Error(`Failed to stat ${path}: No such file`));
      }
      // pty_write, pty_spawn, etc. — resolve by default
      return Promise.resolve();
    },
  );
}

/** Encodes a string to the same byte array format that dispatch sends to pty_write. */
function encodeToBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("bookmarkDispatch", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockInvoke.mockReset();
    resetStore();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ─── extractBasename ─────────────────────────────────────────────

  describe("extractBasename", () => {
    it("extracts basename from Unix path", () => {
      expect(extractBasename("/Users/me/project/config.ts")).toBe("config.ts");
    });

    it("extracts basename from Windows path", () => {
      expect(extractBasename("C:\\Users\\me\\project\\config.ts")).toBe(
        "config.ts",
      );
    });

    it("handles mixed separators (cross-platform edge)", () => {
      expect(extractBasename("/Users/me\\project/config.ts")).toBe("config.ts");
    });

    it("returns the string itself when no separator present", () => {
      expect(extractBasename("config.ts")).toBe("config.ts");
    });

    it("handles trailing separator", () => {
      expect(extractBasename("/Users/me/project/")).toBe("");
    });
  });

  // ─── escapeShellPath ─────────────────────────────────────────────

  describe("escapeShellPath", () => {
    it("returns clean path unchanged", () => {
      expect(escapeShellPath("/clean/path")).toBe("/clean/path");
    });

    it("escapes double quotes", () => {
      expect(escapeShellPath('/path/with"quote')).toBe('/path/with\\"quote');
    });

    it("escapes dollar signs", () => {
      expect(escapeShellPath("/path/with$dollar")).toBe("/path/with\\$dollar");
    });

    it("escapes backticks", () => {
      expect(escapeShellPath("/path/with`tick")).toBe("/path/with\\`tick");
    });

    it("escapes backslashes", () => {
      expect(escapeShellPath("/path/with\\back")).toBe("/path/with\\\\back");
    });

    it("escapes backslash before dollar to prevent double-escape (ordering test)", () => {
      // Input: path contains literal \$ (backslash then dollar)
      // Backslash must be escaped first: \ → \\
      // Then dollar: $ → \$
      // Result: \\$ → \\\\\\$  (four chars: \\, \\, \\, $)
      const input = "/path/with\\$both";
      const result = escapeShellPath(input);
      // Expected: backslash → \\, dollar → \$, combined: \\\\ then \$
      expect(result).toBe("/path/with\\\\\\$both");
    });

    it("handles all special characters together", () => {
      const input = '/a"b$c`d\\e';
      const result = escapeShellPath(input);
      expect(result).toBe('/a\\"b\\$c\\`d\\\\e');
    });

    // ── M-Sec1: control character stripping (defense-in-depth) ──────

    it("M-Sec1: strips newline from input", () => {
      expect(escapeShellPath("/path/with\ninjection")).toBe("/path/withinjection");
    });

    it("M-Sec1: strips carriage return from input", () => {
      expect(escapeShellPath("/path/with\rinjection")).toBe("/path/withinjection");
    });

    it("M-Sec1: strips null byte from input", () => {
      expect(escapeShellPath("/path/with\x00null")).toBe("/path/withnull");
    });

    it("M-Sec1: strips bell character from input", () => {
      expect(escapeShellPath("/path/with\x07bell")).toBe("/path/withbell");
    });

    it("M-Sec1: strips ESC from input", () => {
      expect(escapeShellPath("/path/with\x1bescape")).toBe("/path/withescape");
    });

    it("M-Sec1: strips DEL from input", () => {
      expect(escapeShellPath("/path/with\x7fdel")).toBe("/path/withdel");
    });

    it("M-Sec1: strips mixed control chars", () => {
      expect(escapeShellPath("foo\nbar\rbaz")).toBe("foobarbaz");
    });
  });

  // ─── buildCdCommand ──────────────────────────────────────────────

  describe("buildCdCommand", () => {
    it("wraps path in double quotes with trailing newline", () => {
      expect(buildCdCommand("/clean/path")).toBe('cd "/clean/path"\n');
    });

    it("escapes special characters in the path", () => {
      expect(buildCdCommand("/path/with$dollar")).toBe(
        'cd "/path/with\\$dollar"\n',
      );
    });

    it("handles spaces in path", () => {
      expect(buildCdCommand("/path/with spaces")).toBe(
        'cd "/path/with spaces"\n',
      );
    });

    it.each([
      {
        label: "embedded newline in path",
        inputPath: "/evil\n/rm -rf /",
      },
      {
        label: "embedded carriage return + newline",
        inputPath: "/evil\r\ninjection",
      },
      {
        label: "null byte and newline combo",
        inputPath: "/evil\x00\npath",
      },
    ])(
      "M-Sec1 adversarial: $label produces no embedded 0x0A in cd command",
      ({ inputPath }) => {
        const cmd = buildCdCommand(inputPath);
        const bytes = Array.from(new TextEncoder().encode(cmd));
        // The only 0x0A should be the trailing newline (last byte)
        const innerBytes = bytes.slice(0, -1);
        expect(innerBytes).not.toContain(0x0a);
        // The last byte IS the intended trailing newline
        expect(bytes[bytes.length - 1]).toBe(0x0a);
      },
    );
  });

  // ─── AC1: File bookmark → opens in editor ─────────────────────────

  describe("file dispatch", () => {
    it("AC1: calls addEditorTab when file bookmark is clicked and file exists", async () => {
      const bookmark = makeBookmark({
        path: "/Users/me/config.ts",
        type: "file",
      });
      setupPathExistence(["/Users/me/config.ts"]);
      const addEditorTabSpy = vi.spyOn(
        useLayoutStore.getState(),
        "addEditorTab",
      );

      await dispatchBookmarkClick(bookmark);

      expect(addEditorTabSpy).toHaveBeenCalledWith(
        "test-region-1",
        "/Users/me/config.ts",
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("AC8: shows warning and does NOT open editor when file does not exist", async () => {
      const bookmark = makeBookmark({
        name: "deleted-file.ts",
        path: "/Users/me/deleted-file.ts",
        type: "file",
      });
      setupPathExistence([]); // no paths exist

      const addEditorTabSpy = vi.spyOn(
        useLayoutStore.getState(),
        "addEditorTab",
      );

      await dispatchBookmarkClick(bookmark);

      expect(addEditorTabSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] File not found: deleted-file.ts",
      );
    });

    it("H1: uses captured regionId when focus changes during pathExists await", async () => {
      const bookmark = makeBookmark({
        path: "/Users/me/config.ts",
        type: "file",
      });

      // Deferred promise — lets us simulate state change mid-await
      let resolveExists!: (value: number) => void;
      mockInvoke.mockImplementation((command: string) => {
        if (command === "file_mtime") {
          return new Promise((resolve) => { resolveExists = resolve; });
        }
        return Promise.resolve();
      });

      const addEditorTabSpy = vi.spyOn(
        useLayoutStore.getState(),
        "addEditorTab",
      );

      // Start dispatch — blocks on pathExists
      const dispatchPromise = dispatchBookmarkClick(bookmark);

      // Simulate user switching focus to a different region mid-await
      const newRegionId = "test-region-2";
      const state = useLayoutStore.getState();
      useLayoutStore.setState({
        regions: {
          ...state.regions,
          [newRegionId]: {
            id: newRegionId,
            tabs: [],
            activeTabId: "",
            tabPosition: "top" as const,
          },
        },
        focusedRegionId: newRegionId,
      });

      // Now resolve pathExists — dispatch continues
      resolveExists(1700000000000);
      await dispatchPromise;

      // Must target the ORIGINAL region (R1), not the new one (R2)
      expect(addEditorTabSpy).toHaveBeenCalledWith(
        "test-region-1",
        "/Users/me/config.ts",
      );
    });

    it("AC9: calls addEditorTab even when file is already open (dedup handled internally)", async () => {
      const bookmark = makeBookmark({
        path: "/Users/me/config.ts",
        type: "file",
      });
      setupPathExistence(["/Users/me/config.ts"]);

      // Pre-open the file in the store
      addEditorTabToStore("/Users/me/config.ts");

      const addEditorTabSpy = vi.spyOn(
        useLayoutStore.getState(),
        "addEditorTab",
      );

      await dispatchBookmarkClick(bookmark);

      // addEditorTab is still called — it internally handles dedup
      expect(addEditorTabSpy).toHaveBeenCalledOnce();
      expect(addEditorTabSpy).toHaveBeenCalledWith(
        "test-region-1",
        "/Users/me/config.ts",
      );
    });
  });

  // ─── AC4-AC6: Folder bookmark → cd in terminal ────────────────────

  describe("folder dispatch", () => {
    it("AC4: sends cd command to focused terminal when folder exists", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      setupPathExistence(["/Users/me/projects"]);
      addTerminalTabToStore("pty-abc");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/projects"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-abc",
        data: expectedBytes,
      });
    });

    it("AC5: sends cd command with proper quoting for paths with spaces", async () => {
      const bookmark = makeBookmark({
        name: "My Projects",
        path: "/Users/me/My Projects",
        type: "folder",
      });
      setupPathExistence(["/Users/me/My Projects"]);
      addTerminalTabToStore("pty-xyz");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/My Projects"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-xyz",
        data: expectedBytes,
      });
    });

    it("AC6: escapes dollar signs in folder path", async () => {
      const path = "/Users/me/path/with$dollar";
      const bookmark = makeBookmark({ name: "with$dollar", path, type: "folder" });
      setupPathExistence([path]);
      addTerminalTabToStore("pty-1");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/path/with\\$dollar"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-1",
        data: expectedBytes,
      });
    });

    it("AC6: escapes double quotes in folder path", async () => {
      const path = '/Users/me/path/with"quote';
      const bookmark = makeBookmark({ name: 'with"quote', path, type: "folder" });
      setupPathExistence([path]);
      addTerminalTabToStore("pty-2");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/path/with\\"quote"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-2",
        data: expectedBytes,
      });
    });

    it("AC6: escapes backticks in folder path", async () => {
      const path = "/Users/me/path/with`tick";
      const bookmark = makeBookmark({ name: "with`tick", path, type: "folder" });
      setupPathExistence([path]);
      addTerminalTabToStore("pty-3");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/path/with\\`tick"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-3",
        data: expectedBytes,
      });
    });

    it("AC6: escapes backslashes in folder path", async () => {
      const path = "/Users/me/path/with\\back";
      const bookmark = makeBookmark({ name: "with\\back", path, type: "folder" });
      setupPathExistence([path]);
      addTerminalTabToStore("pty-4");

      await dispatchBookmarkClick(bookmark);

      const expectedBytes = encodeToBytes('cd "/Users/me/path/with\\\\back"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-4",
        data: expectedBytes,
      });
    });

    it("AC6: escapes backslash-then-dollar correctly (ordering proof)", async () => {
      // Path contains literal \$ — backslash must be escaped FIRST
      const path = "/Users/me/path/with\\$both";
      const bookmark = makeBookmark({ name: "with\\$both", path, type: "folder" });
      setupPathExistence([path]);
      addTerminalTabToStore("pty-5");

      await dispatchBookmarkClick(bookmark);

      // \\ escaped → \\\\, then $ escaped → \$, combined: \\\\\\$
      const expectedBytes = encodeToBytes('cd "/Users/me/path/with\\\\\\$both"\n');
      expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
        sessionId: "pty-5",
        data: expectedBytes,
      });
    });

    it("H1: uses captured sessionId when focus changes during pathExists await", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      addTerminalTabToStore("pty-T1");

      // Deferred promise — lets us simulate state change mid-await
      let resolveExists!: (value: number) => void;
      mockInvoke.mockImplementation((command: string) => {
        if (command === "file_mtime") {
          return new Promise((resolve) => { resolveExists = resolve; });
        }
        return Promise.resolve();
      });

      // Start dispatch — blocks on pathExists
      const dispatchPromise = dispatchBookmarkClick(bookmark);

      // Simulate user switching focus to a different terminal mid-await
      const newRegionId = "test-region-2";
      const state = useLayoutStore.getState();
      useLayoutStore.setState({
        regions: {
          ...state.regions,
          [newRegionId]: {
            id: newRegionId,
            tabs: [{
              id: "tab-pty-T2",
              title: "Terminal 2",
              type: "terminal" as const,
              sessionId: "pty-T2",
              status: "local" as const,
            }],
            activeTabId: "tab-pty-T2",
            tabPosition: "top" as const,
          },
        },
        focusedRegionId: newRegionId,
      });

      // Now resolve pathExists — dispatch continues
      resolveExists(1700000000000);
      await dispatchPromise;

      // Must target T1 (captured), not T2 (current)
      const ptyWriteCall = mockInvoke.mock.calls.find(
        (c) => c[0] === "pty_write",
      );
      expect(ptyWriteCall).toBeDefined();
      expect(ptyWriteCall![1].sessionId).toBe("pty-T1");
    });

    it("H1: bails before pathExists when no terminal focused at click time", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      setupPathExistence(["/Users/me/projects"]);
      // Store is reset — no terminal tabs

      await dispatchBookmarkClick(bookmark);

      // file_mtime should NOT be called (bail before FS check)
      const fileMtimeCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "file_mtime",
      );
      expect(fileMtimeCalls).toHaveLength(0);

      // pty_write should NOT be called
      const ptyWriteCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "pty_write",
      );
      expect(ptyWriteCalls).toHaveLength(0);

      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] No terminal focused — switch to a terminal tab first",
      );
    });

    it("AC10: shows warning and does NOT send cd when folder does not exist", async () => {
      const bookmark = makeBookmark({
        name: "deleted-folder",
        path: "/Users/me/deleted-folder",
        type: "folder",
      });
      setupPathExistence([]); // nothing exists
      addTerminalTabToStore("pty-abc");

      await dispatchBookmarkClick(bookmark);

      // pty_write should not be called (only file_mtime was called)
      const ptyWriteCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "pty_write",
      );
      expect(ptyWriteCalls).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] Folder not found: deleted-folder",
      );
    });

    it("AC7: shows warning when no terminal tab is focused (editor tab active)", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      setupPathExistence(["/Users/me/projects"]);

      // Add an editor tab (not terminal) as active
      addEditorTabToStore("/Users/me/some-file.ts");

      await dispatchBookmarkClick(bookmark);

      const ptyWriteCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "pty_write",
      );
      expect(ptyWriteCalls).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] No terminal focused — switch to a terminal tab first",
      );
    });

    it("AC7: shows warning when region has no tabs at all", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      setupPathExistence(["/Users/me/projects"]);
      // Store is reset — no tabs

      await dispatchBookmarkClick(bookmark);

      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] No terminal focused — switch to a terminal tab first",
      );
    });

    it("shows warning when pty_write IPC call fails", async () => {
      const bookmark = makeBookmark({
        name: "projects",
        path: "/Users/me/projects",
        type: "folder",
      });
      addTerminalTabToStore("pty-fail");

      mockInvoke.mockImplementation(
        (command: string) => {
          if (command === "file_mtime") return Promise.resolve(1700000000000);
          if (command === "pty_write") return Promise.reject(new Error("IPC error"));
          return Promise.resolve();
        },
      );

      await dispatchBookmarkClick(bookmark);

      expect(warnSpy).toHaveBeenCalledWith(
        "[bookmark] Failed to send command to terminal",
      );
    });
  });

  // ─── Parameterized shell escaping byte tests ───────────────────────

  describe("shell escaping — exact byte verification", () => {
    const cases: Array<{ label: string; inputPath: string; expectedCmd: string }> = [
      {
        label: "clean path",
        inputPath: "/clean/path",
        expectedCmd: 'cd "/clean/path"\n',
      },
      {
        label: "path with spaces",
        inputPath: "/path/with spaces",
        expectedCmd: 'cd "/path/with spaces"\n',
      },
      {
        label: "path with dollar sign",
        inputPath: "/path/with$dollar",
        expectedCmd: 'cd "/path/with\\$dollar"\n',
      },
      {
        label: "path with double quote",
        inputPath: '/path/with"quote',
        expectedCmd: 'cd "/path/with\\"quote"\n',
      },
      {
        label: "path with backtick",
        inputPath: "/path/with`tick",
        expectedCmd: 'cd "/path/with\\`tick"\n',
      },
      {
        label: "path with backslash",
        inputPath: "/path/with\\back",
        expectedCmd: 'cd "/path/with\\\\back"\n',
      },
      {
        label: "backslash-then-dollar ordering",
        inputPath: "/path/with\\$combo",
        expectedCmd: 'cd "/path/with\\\\\\$combo"\n',
      },
    ];

    it.each(cases)(
      "sends exact bytes for $label",
      async ({ inputPath, expectedCmd }) => {
        const bookmark = makeBookmark({
          name: "test-folder",
          path: inputPath,
          type: "folder",
        });
        setupPathExistence([inputPath]);
        addTerminalTabToStore("pty-escape-test");

        await dispatchBookmarkClick(bookmark);

        const expectedBytes = encodeToBytes(expectedCmd);
        expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
          sessionId: "pty-escape-test",
          data: expectedBytes,
        });
      },
    );
  });
});
