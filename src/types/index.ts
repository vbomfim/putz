/**
 * Application-wide type definitions for Putz terminal emulator.
 *
 * Shared types for tabs, panes, and layout management.
 */

/** Status of a terminal tab connection. */
export type TabStatus = "connected" | "disconnected" | "connecting" | "local";

/** Content type rendered inside a tab. */
export type TabContentType = "terminal" | "browser" | "editor" | "diff" | "search" | "vault" | "history" | "templates" | "settings" | "markdown" | "csv";

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
  /** Connection status of the tab. */
  status: TabStatus;
  /** Timestamp (ms since epoch) when this tab was created. */
  createdAt: number;
  /** Session ID of the last focused pane in this tab. */
  focusedSessionId?: string;
  /** Content type — terminal (default) or browser. */
  contentType?: TabContentType;
  /** URL for browser tabs (only when contentType is "browser"). */
  browserUrl?: string;
}

/** Maximum allowed depth for nested splits. */
export const MAX_SPLIT_DEPTH = 4;

/** Minimum pane size in pixels. */
export const MIN_PANE_SIZE_PX = 200;

/** Prefix for browser tab session IDs (used to distinguish from PTY sessions). */
export const BROWSER_SESSION_PREFIX = "browser-";

// ─── Region-based Layout Types ───────────────────────────────────────

/** A tab within a region — terminal, browser, or editor. */
export interface RegionTab {
  /** Unique tab identifier (UUID v4). */
  id: string;
  /** Display title shown in the region tab bar. */
  title: string;
  /** Content type for this tab. */
  type: TabContentType;
  /** PTY session ID, browser session ID, or editor instance ID. */
  sessionId: string;
  /** URL for browser tabs (only when type is "browser"). */
  browserUrl?: string;
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
  /** Connection status of the tab. */
  status: TabStatus;
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
