/**
 * Application-wide type definitions for Putz terminal emulator.
 *
 * Shared types for tabs, panes, and layout management.
 */

/** Content type rendered inside a tab. */
export type TabContentType =
  | "terminal"
  | "editor"
  | "diff"
  | "search"
  | "settings"
  | "markdown"
  | "csv"
  | "bookmarks"
  | "drawio"
  | "git-graph"
  | "radio";

/**
 * Recursive tree structure representing a pane layout within a tab.
 *
 * A leaf node holds a single terminal session.
 * A split node divides the area into two children with a draggable ratio.
 */
export type PaneNode =
  | { type: "leaf"; terminalSessionId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: [PaneNode, PaneNode];
      ratio: number;
    };

/** A single terminal tab. */
export interface Tab {
  /** Unique identifier for this tab (UUID v4). */
  id: string;
  /** Display title shown in the tab bar. */
  title: string;
  /** Pane layout tree for this tab. */
  layout: PaneNode;
  /** Timestamp (ms since epoch) when this tab was created. */
  createdAt: number;
  /** Session ID of the last focused pane in this tab. */
  focusedSessionId?: string;
  /** Content type — terminal (default) or other typed tabs. */
  contentType?: TabContentType;
}

/** Maximum allowed depth for nested splits. */
export const MAX_SPLIT_DEPTH = 4;

/** Minimum pane size in pixels. */
export const MIN_PANE_SIZE_PX = 200;

// ─── Region-based Layout Types ───────────────────────────────────────

/** A tab within a region — terminal, editor, or other typed content. */
export interface RegionTab {
  /** Unique tab identifier (UUID v4). */
  id: string;
  /** Display title shown in the region tab bar. */
  title: string;
  /** Content type for this tab. */
  type: TabContentType;
  /** PTY session ID or editor instance ID. */
  sessionId: string;
  /** File path for editor tabs (only when type is "editor"). */
  editorFilePath?: string;
  /** Script ID for editor tabs editing saved scripts. */
  editorScriptId?: string;
  /** Left file path for diff tabs. */
  diffLeftPath?: string;
  /** Right file path for diff tabs. */
  diffRightPath?: string;
  /** Left content for diff tabs (if no path). */
  diffLeftContent?: string;
  /** Right content for diff tabs (if no path). */
  diffRightContent?: string;
  /**
   * Last known working directory for terminal tabs (T2 — schema v3).
   * Captured from `cwdRegistry` (OSC 7 / title parsing) at snapshot time.
   * Length-, NUL-, and type-checked at parse time. Path shape and
   * existence are NOT validated; spawn is attempted and falls through
   * to no-cwd on failure.
   */
  cwd?: string;
  /**
   * Restore-time placeholder marker (RUNTIME-ONLY — never persisted).
   *
   * Set by `restoreActiveWorkspace` on tabs rebuilt from a snapshot.
   * When the tab first becomes active, `materializeRestoredTab` calls
   * `pty_spawn` with the saved `cwd`, swaps in the new live sessionId,
   * and clears this field.
   *
   * Stripped from the persistence allowlist (see `migratePersistence`)
   * so it never round-trips through `localStorage`.
   */
  pendingRestore?: { cwd?: string };
}

/** Prefix for editor tab session IDs. */
export const EDITOR_SESSION_PREFIX = "editor-";

/** Position of the tab bar within a region. */
export type TabPosition = "top" | "bottom" | "left" | "right";

/** A region is a container with its own tab bar and tabs. */
export interface Region {
  /** Unique region identifier (UUID v4). */
  id: string;
  /** Tabs owned by this region. */
  tabs: RegionTab[];
  /** ID of the currently active tab in this region. */
  activeTabId: string;
  /** Position of the tab bar: "top" | "bottom" | "left" | "right". */
  tabPosition: TabPosition;
}

/**
 * Recursive tree structure representing the window layout.
 *
 * A region leaf holds a reference to a Region (by ID).
 * A split node divides the area into two children with a draggable ratio.
 */
export type LayoutNode =
  | { type: "region"; regionId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: [LayoutNode, LayoutNode];
      ratio: number;
    };

/** Minimum region pane size in pixels. */
export const MIN_REGION_SIZE_PX = 200;
