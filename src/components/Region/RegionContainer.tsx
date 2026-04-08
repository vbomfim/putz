/**
 * RegionContainer — Recursive layout renderer for the region tree.
 *
 * Renders LayoutNode trees:
 * - Region leaf → RegionView with the region's tab bar + content
 * - Split node → Allotment with two recursive children
 *
 * Uses the `allotment` library for resizable split regions.
 *
 * @module RegionContainer
 */
import { useCallback } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { RegionView } from "./RegionView";
import { useLayoutStore } from "../../stores/layoutStore";
import type { LayoutNode } from "../../types";
import { MIN_REGION_SIZE_PX } from "../../types";
import "./Region.css";

/**
 * Top-level region container — renders the entire layout tree.
 */
export function RegionContainer() {
  const layout = useLayoutStore((s) => s.layout);
  const regions = useLayoutStore((s) => s.regions);
  const focusedRegionId = useLayoutStore((s) => s.focusedRegionId);

  return (
    <div className="region-container">
      <LayoutRenderer
        node={layout}
        regions={regions}
        focusedRegionId={focusedRegionId}
      />
    </div>
  );
}

interface LayoutRendererProps {
  node: LayoutNode;
  regions: Record<string, import("../../types").Region>;
  focusedRegionId: string;
}

/**
 * Recursive renderer for LayoutNode.
 *
 * - Region leaf: renders RegionView
 * - Split: renders Allotment with two children
 *
 * "horizontal" split = top/bottom → Allotment vertical={true}
 * "vertical" split = left/right → Allotment vertical={false}
 */
function LayoutRenderer({ node, regions, focusedRegionId }: LayoutRendererProps) {
  // Stable no-op callback for Allotment's onChange.
  const handleSizeChange = useCallback(() => {
    // No action needed — ResizeObserver in each terminal handles re-fitting
  }, []);

  if (node.type === "region") {
    const region = regions[node.regionId];
    if (!region) return null;

    return (
      <RegionView
        region={region}
        isFocused={node.regionId === focusedRegionId}
      />
    );
  }

  // "horizontal" = top/bottom split → Allotment vertical={true}
  // "vertical" = left/right split → Allotment vertical={false}
  const isVertical = node.direction === "horizontal";

  return (
    <Allotment
      vertical={isVertical}
      minSize={MIN_REGION_SIZE_PX}
      onChange={handleSizeChange}
    >
      <Allotment.Pane preferredSize={`${node.ratio * 100}%`}>
        <LayoutRenderer
          node={node.children[0]}
          regions={regions}
          focusedRegionId={focusedRegionId}
        />
      </Allotment.Pane>
      <Allotment.Pane>
        <LayoutRenderer
          node={node.children[1]}
          regions={regions}
          focusedRegionId={focusedRegionId}
        />
      </Allotment.Pane>
    </Allotment>
  );
}
