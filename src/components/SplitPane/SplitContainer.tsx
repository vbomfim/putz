/**
 * SplitContainer — Recursive layout renderer for pane trees.
 *
 * Renders PaneNode trees:
 * - Leaf nodes → TerminalView with the associated sessionId
 * - Split nodes → Allotment with two recursive children
 *
 * Uses the `allotment` library for resizable split panes.
 *
 * @module SplitContainer
 */
import { useCallback } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { TerminalView } from "../Terminal";
import { useTabStore } from "../../stores/tabStore";
import type { PaneNode } from "../../types";
import { MIN_PANE_SIZE_PX } from "../../types";
import "./SplitContainer.css";

interface SplitContainerProps {
  /** The pane layout tree to render. */
  layout: PaneNode;
  /** The tab ID that owns this layout (for resize actions). */
  tabId: string;
  /** Whether the parent tab is currently active (controls visibility). */
  isActive: boolean;
  /** Whether this tab is a broadcast target (red border indicator). */
  isBroadcastTarget?: boolean;
}

/**
 * Renders a PaneNode tree recursively.
 *
 * - Leaf: renders TerminalView
 * - Split: renders Allotment with two children
 *
 * "horizontal" split = top/bottom → Allotment vertical={true}
 * "vertical" split = left/right → Allotment vertical={false}
 */
export function SplitContainer({
  layout,
  tabId,
  isActive,
  isBroadcastTarget,
}: SplitContainerProps) {
  const unsplitPane = useTabStore((s) => s.unsplitPane);
  const isSearchOpen = useTabStore((s) => s.isSearchOpen);
  const closeSearch = useTabStore((s) => s.closeSearch);
  const renameTab = useTabStore((s) => s.renameTab);

  // Fix 4: Tab title from shell escape sequences — update tab store title
  const handleTitleChange = useCallback(
    (title: string) => {
      renameTab(tabId, title);
    },
    [tabId, renameTab],
  );

  return (
    <div
      className="split-container"
      style={{
        visibility: isActive ? "visible" : "hidden",
        position: isActive ? "relative" : "absolute",
        width: "100%",
        height: "100%",
      }}
    >
      <PaneRenderer
        node={layout}
        tabId={tabId}
        onClosePane={(sessionId) => unsplitPane(tabId, sessionId)}
        onTitleChange={handleTitleChange}
        isSearchOpen={isActive && isSearchOpen}
        onSearchClose={closeSearch}
        isBroadcastTarget={isBroadcastTarget}
      />
    </div>
  );
}

interface PaneRendererProps {
  node: PaneNode;
  tabId: string;
  onClosePane: (sessionId: string) => void;
  onTitleChange: (title: string) => void;
  isSearchOpen: boolean;
  onSearchClose: () => void;
  isBroadcastTarget?: boolean;
  /** Whether this pane is inside a split (shows close button). */
  isInsideSplit?: boolean;
}

/** Recursive renderer for PaneNode. */
function PaneRenderer({
  node,
  tabId,
  onClosePane,
  onTitleChange,
  isSearchOpen,
  onSearchClose,
  isBroadcastTarget,
  isInsideSplit = false,
}: PaneRendererProps) {
  // Stable no-op callback for Allotment's onChange.
  // The ResizeObserver in each terminal's useTerminal hook handles
  // actual re-fitting; this is required before the early return to
  // satisfy React's rules of hooks (hooks must be called unconditionally).
  const handleSizeChange = useCallback(() => {
    // No action needed — ResizeObserver picks up the new size.
  }, []);

  if (node.type === "leaf") {
    const terminalView = (
      <TerminalView
        sessionId={node.terminalSessionId}
        onTitleChange={onTitleChange}
        onRestart={() => {
          // For now, close the pane on restart
          onClosePane(node.terminalSessionId);
        }}
        isSearchOpen={isSearchOpen}
        onSearchClose={onSearchClose}
        isBroadcastTarget={isBroadcastTarget}
        tabElementId={tabId}
      />
    );

    if (!isInsideSplit) {
      return terminalView;
    }

    return (
      <div className="pane-leaf-wrapper">
        {terminalView}
        <button
          className="pane-close-btn"
          data-testid="pane-close-btn"
          aria-label="Close pane"
          type="button"
          onClick={() => onClosePane(node.terminalSessionId)}
        >
          ×
        </button>
      </div>
    );
  }

  // "horizontal" = top/bottom split → Allotment vertical={true}
  // "vertical" = left/right split → Allotment vertical={false}
  const isVertical = node.direction === "horizontal";

  return (
    <Allotment
      vertical={isVertical}
      minSize={MIN_PANE_SIZE_PX}
      onChange={handleSizeChange}
    >
      <Allotment.Pane preferredSize={`${node.ratio * 100}%`}>
        <PaneRenderer
          node={node.children[0]}
          tabId={tabId}
          onClosePane={onClosePane}
          onTitleChange={onTitleChange}
          isSearchOpen={isSearchOpen}
          onSearchClose={onSearchClose}
          isBroadcastTarget={isBroadcastTarget}
          isInsideSplit
        />
      </Allotment.Pane>
      <Allotment.Pane>
        <PaneRenderer
          node={node.children[1]}
          tabId={tabId}
          onClosePane={onClosePane}
          onTitleChange={onTitleChange}
          isSearchOpen={isSearchOpen}
          onSearchClose={onSearchClose}
          isBroadcastTarget={isBroadcastTarget}
          isInsideSplit
        />
      </Allotment.Pane>
    </Allotment>
  );
}
