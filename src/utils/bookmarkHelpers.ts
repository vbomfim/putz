/**
 * Bookmark helpers — determines what is bookmarkable from a tab.
 *
 * Pure logic shared by all four "Add Bookmark" affordances:
 * keyboard shortcut, toolbar button, context menu, native menu.
 *
 * @module bookmarkHelpers
 */
import { useLayoutStore } from "../stores/layoutStore";
import { getSessionCwd } from "../components/Terminal/cwdRegistry";
import type { RegionTab } from "../types";

// ─── Types ───────────────────────────────────────────────────────────

/** Result of determining what to bookmark. */
export interface BookmarkableItem {
  /** Absolute filesystem path. */
  path: string;
  /** Whether the path is a file or directory. */
  type: "file" | "folder";
}

// ─── Tab-type classification ─────────────────────────────────────────

/** Tab types that are never bookmarkable. */
const NON_BOOKMARKABLE_TYPES = new Set([
  "settings",
  "diff",
  "search",
]);

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Determines whether the "Add Bookmark" UI action should be offered for a tab.
 *
 * This is the **availability predicate** — it answers "should the toolbar button
 * be enabled / context menu item be visible?" It is intentionally more permissive
 * than `getBookmarkableFromTab` for terminal tabs: it returns `true` even when
 * the CWD is not yet cached in `cwdRegistry`, because the action handler in
 * App.tsx has an async `pty_cwd` fallback that can resolve CWD at invocation time.
 *
 * Use `isBookmarkActionAvailable` for UI gating (enabled/disabled, show/hide).
 * Use `getBookmarkableFromTab` for synchronously resolving *what* to bookmark.
 *
 * @param tab - The RegionTab to inspect.
 * @returns true if the bookmark action should be offered to the user.
 */
export function isBookmarkActionAvailable(tab: RegionTab): boolean {
  // Never bookmarkable tab types
  if (NON_BOOKMARKABLE_TYPES.has(tab.type)) {
    return false;
  }

  // Editor/CSV/Markdown — bookmarkable only if a file path is set
  if (tab.type === "editor" || tab.type === "csv" || tab.type === "markdown") {
    return !!tab.editorFilePath;
  }

  // Terminal — always available (action handler resolves CWD via pty_cwd fallback)
  if (tab.type === "terminal") {
    return true;
  }

  return false;
}

/**
 * Determines what to bookmark from a specific tab (synchronous resolution).
 *
 * This is the **resolution function** — it answers "what would the bookmark be?"
 * Returns null when the bookmark target cannot be determined synchronously
 * (e.g., terminal tab without cached CWD). The caller is responsible for
 * async fallback (see App.tsx `executeAddBookmark` → `pty_cwd`).
 *
 * Use `getBookmarkableFromTab` for resolving the bookmark path/type.
 * Use `isBookmarkActionAvailable` for UI gating (enabled/disabled, show/hide).
 *
 * - Editor/CSV/Markdown tabs → file bookmark (if `editorFilePath` present)
 * - Terminal tabs → folder bookmark (CWD from cwdRegistry)
 * - Settings/History/Template/Diff/Search → null
 *
 * @param tab - The RegionTab to inspect.
 * @returns BookmarkableItem or null if nothing is bookmarkable.
 */
export function getBookmarkableFromTab(
  tab: RegionTab,
): BookmarkableItem | null {
  if (NON_BOOKMARKABLE_TYPES.has(tab.type)) {
    return null;
  }

  // Editor, CSV, Markdown tabs — bookmark the file path
  if (tab.type === "editor" || tab.type === "csv" || tab.type === "markdown") {
    if (tab.editorFilePath) {
      return { path: tab.editorFilePath, type: "file" };
    }
    return null;
  }

  // Terminal tabs — bookmark the current working directory
  if (tab.type === "terminal") {
    const cwd = getSessionCwd(tab.sessionId);
    if (cwd) {
      return { path: cwd, type: "folder" };
    }
    return null;
  }

  return null;
}

/**
 * Determines what to bookmark based on the currently focused tab.
 *
 * Reads the focused region and active tab from `layoutStore`,
 * then delegates to `getBookmarkableFromTab`.
 *
 * @returns BookmarkableItem or null if nothing is bookmarkable.
 */
export function getBookmarkableFromFocusedTab(): BookmarkableItem | null {
  const state = useLayoutStore.getState();
  const region = state.regions[state.focusedRegionId];
  if (!region) return null;

  const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
  if (!activeTab) return null;

  return getBookmarkableFromTab(activeTab);
}

/**
 * Returns the focused terminal's session ID, or null if the focused
 * tab is not a terminal. Used for async pty_cwd fallback.
 */
export function getFocusedTerminalSessionId(): string | null {
  const state = useLayoutStore.getState();
  const region = state.regions[state.focusedRegionId];
  if (!region) return null;

  const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return null;

  return activeTab.sessionId;
}

// ─── Module-level callback for context menu bookmark ─────────────────
//
// Avoids prop-drilling through RegionContainer → RegionView → RegionTabBar.
// Same pattern as useMenuEvents.ts's module-level callbacks.

type AddBookmarkFromTabCallback = (tab: RegionTab) => void;
let addBookmarkFromTabCallback: AddBookmarkFromTabCallback | null = null;

/** Set by App.tsx to wire context menu → add bookmark logic. */
export function setAddBookmarkFromTabCallback(
  cb: AddBookmarkFromTabCallback | null,
): void {
  addBookmarkFromTabCallback = cb;
}

/** Called by RegionTabBar context menu. */
export function handleAddBookmarkFromTab(tab: RegionTab): void {
  addBookmarkFromTabCallback?.(tab);
}
