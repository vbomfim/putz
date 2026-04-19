/**
 * Bookmark click dispatch — routes bookmark clicks to the correct action.
 *
 * - File bookmarks → open in editor (auto-routes CSV/TSV, Markdown via addEditorTab)
 * - Folder bookmarks → send `cd "<path>"` to focused terminal session
 *
 * Single-responsibility: routing only. Does NOT own file loading
 * (delegates to `addEditorTab`), does NOT own terminal I/O
 * (delegates to `pty_write`).
 *
 * @module bookmarkDispatch
 */
import { invoke } from "@tauri-apps/api/core";
import type { BookmarkItem } from "../stores/bookmarksStore";
import { useLayoutStore } from "../stores/layoutStore";
import { stripBidiControls } from "./sanitize";

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extracts the basename from a path, handling both `/` and `\` separators.
 * Does NOT use Node `path` module (Tauri webview — cross-platform).
 */
export function extractBasename(filePath: string): string {
  const lastSep = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  return lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;
}

/**
 * Strips bidi control characters from display text.
 * Prevents Trojan Source attacks in user-visible strings.
 */
function sanitizeForDisplay(text: string): string {
  return stripBidiControls(text);
}

/**
 * Escapes a filesystem path for safe use inside double-quoted shell strings.
 *
 * Order matters: backslash MUST be escaped first to avoid double-escaping
 * characters that were escaped in later steps.
 *
 * Escapes: `\` → `\\`, `"` → `\"`, `$` → `\$`, `` ` `` → `` \` ``
 */
export function escapeShellPath(path: string): string {
  return path
    // eslint-disable-next-line no-control-regex -- intentional: strip C0 control chars + DEL
    .replace(/[\x00-\x1f\x7f]/g, "")  // strip control chars (defense-in-depth)
    .replace(/\\/g, "\\\\")   // backslash first
    .replace(/"/g, '\\"')     // double quote
    .replace(/\$/g, "\\$")    // dollar sign
    .replace(/`/g, "\\`");    // backtick
}

/**
 * Builds a shell-safe `cd` command for a given directory path.
 * Always uses double quotes. Returns the command including trailing newline.
 */
export function buildCdCommand(dirPath: string): string {
  return `cd "${escapeShellPath(dirPath)}"\n`;
}

/**
 * Checks whether a filesystem path exists via Tauri IPC.
 * Uses the existing `file_mtime` command which calls `std::fs::metadata`
 * (works for both files and directories).
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await invoke<number>("file_mtime", { path });
    return true;
  } catch {
    return false;
  }
}

/**
 * Displays a bookmark-related warning message.
 * TODO(toast): Replace with a proper toast/notification system when available.
 * Currently logs to console.warn with a `[bookmark]` prefix.
 */
function showBookmarkWarning(message: string): void {
  console.warn(`[bookmark] ${message}`);
}

// ─── File Dispatch ───────────────────────────────────────────────────

/**
 * Handles click on a file bookmark: checks existence, then opens in editor.
 * `addEditorTab` handles CSV/Markdown routing and tab deduplication internally.
 */
async function dispatchFileBookmark(bookmark: BookmarkItem): Promise<void> {
  const focusedRegionId = useLayoutStore.getState().focusedRegionId;
  const exists = await pathExists(bookmark.path);
  if (!exists) {
    const basename = sanitizeForDisplay(extractBasename(bookmark.path));
    showBookmarkWarning(`File not found: ${basename}`);
    return;
  }
  useLayoutStore.getState().addEditorTab(focusedRegionId, bookmark.path);
}

// ─── Folder Dispatch ─────────────────────────────────────────────────

/**
 * Finds the terminal session ID from the focused region's active tab.
 * Returns the sessionId if the active tab is a terminal, or null otherwise.
 */
function getFocusedTerminalSessionId(): string | null {
  const state = useLayoutStore.getState();
  const region = state.regions[state.focusedRegionId];
  if (!region) return null;

  const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return null;

  return activeTab.sessionId;
}

/**
 * Handles click on a folder bookmark: checks existence, verifies a terminal
 * is focused, builds the `cd` command, and sends it to the PTY.
 */
async function dispatchFolderBookmark(bookmark: BookmarkItem): Promise<void> {
  const sessionId = getFocusedTerminalSessionId();
  if (!sessionId) {
    showBookmarkWarning(
      "No terminal focused — switch to a terminal tab first",
    );
    return;
  }

  const exists = await pathExists(bookmark.path);
  if (!exists) {
    const basename = sanitizeForDisplay(extractBasename(bookmark.path));
    showBookmarkWarning(`Folder not found: ${basename}`);
    return;
  }

  const command = buildCdCommand(bookmark.path);
  const encoded = new TextEncoder().encode(command);
  const data = Array.from(encoded);

  try {
    await invoke("pty_write", { sessionId, data });
    // Fire CWD update after shell processes the cd
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("putz-cwd-change", { detail: { sessionId, cwd: bookmark.path } }));
    }, 300);
  } catch {
    showBookmarkWarning("Failed to send command to terminal");
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Dispatches a bookmark click to the appropriate action.
 *
 * - File bookmarks → open in editor (auto-routes CSV/TSV, Markdown)
 * - Folder bookmarks → send `cd <path>` to focused terminal session
 *
 * @param bookmark - The bookmark item that was clicked
 */
export async function dispatchBookmarkClick(
  bookmark: BookmarkItem,
): Promise<void> {
  if (bookmark.type === "file") {
    await dispatchFileBookmark(bookmark);
  } else if (bookmark.type === "folder") {
    await dispatchFolderBookmark(bookmark);
  }
}
