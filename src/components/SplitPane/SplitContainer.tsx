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
export function SplitContainer({ layout, tabId, isActive }: SplitContainerProps) {
  const unsplitPane = useTabStore((s) => s.unsplitPane);

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
      />
    </div>
  );
}

interface PaneRendererProps {
  node: PaneNode;
  tabId: string;
  onClosePane: (sessionId: string) => void;
}

/** Recursive renderer for PaneNode. */
function PaneRenderer({ node, tabId, onClosePane }: PaneRendererProps) {
  if (node.type === "leaf") {
    return (
      <TerminalView
        sessionId={node.terminalSessionId}
        onRestart={() => {
          // For now, close the pane on restart
          onClosePane(node.terminalSessionId);
        }}
      />
    );
  }

  // "horizontal" = top/bottom split → Allotment vertical={true}
  // "vertical" = left/right split → Allotment vertical={false}
  const isVertical = node.direction === "horizontal";

  return (
    <Allotment vertical={isVertical} minSize={MIN_PANE_SIZE_PX}>
      <Allotment.Pane preferredSize={`${node.ratio * 100}%`}>
        <PaneRenderer
          node={node.children[0]}
          tabId={tabId}
          onClosePane={onClosePane}
        />
      </Allotment.Pane>
      <Allotment.Pane>
        <PaneRenderer
          node={node.children[1]}
          tabId={tabId}
          onClosePane={onClosePane}
        />
      </Allotment.Pane>
    </Allotment>
  );
}
