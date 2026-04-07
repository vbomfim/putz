/**
 * Application-wide type definitions for Putz terminal emulator.
 *
 * Shared types for tabs, panes, and layout management.
 */

/** Status of a terminal tab connection. */
export type TabStatus = "connected" | "disconnected" | "connecting" | "local";

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
}

/** Maximum allowed depth for nested splits. */
export const MAX_SPLIT_DEPTH = 4;

/** Minimum pane size in pixels. */
export const MIN_PANE_SIZE_PX = 200;
