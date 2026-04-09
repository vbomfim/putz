/**
 * RegionContainer — Recursive layout renderer for the region tree.
 *
 * Renders ALL workspaces simultaneously — active one visible, inactive hidden.
 * This prevents terminal unmounting when switching workspaces.
 *
 * - Active workspace renders from layoutStore (live, interactive)
 * - Inactive workspaces render from savedLayout (frozen, display:none)
 * - Same region/tab IDs ensure React reuses components on switch
 */
import { useCallback } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { RegionView } from "./RegionView";
import { useLayoutStore } from "../../stores/layoutStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { LayoutNode, Region } from "../../types";
import { MIN_REGION_SIZE_PX } from "../../types";
import "./Region.css";

export function RegionContainer() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeLayout = useLayoutStore((s) => s.layout);
  const activeRegions = useLayoutStore((s) => s.regions);
  const activeFocusedRegionId = useLayoutStore((s) => s.focusedRegionId);

  return (
    <>
      {workspaces.map((ws) => {
        const isActive = ws.id === activeWorkspaceId;
        const layout = isActive ? activeLayout : ws.savedLayout?.layout;
        const regions = isActive ? activeRegions : ws.savedLayout?.regions;
        const focused = isActive ? activeFocusedRegionId : (ws.savedLayout?.focusedRegionId || "");

        if (!layout || !regions) return null;

        return (
          <div
            key={ws.id}
            className="region-container"
            style={{ display: isActive ? "flex" : "none" }}
          >
            <LayoutRenderer
              node={layout}
              regions={regions}
              focusedRegionId={focused}
            />
          </div>
        );
      })}
    </>
  );
}

interface LayoutRendererProps {
  node: LayoutNode;
  regions: Record<string, Region>;
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
