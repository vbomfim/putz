/**
 * RegionContainer — Layout renderer using portals for stable RegionViews.
 *
 * The key insight: RegionViews are rendered into persistent portal target divs
 * that get DOM-moved between Allotment panes. Moving a DOM node doesn't trigger
 * React unmount, so terminals survive splits with their scrollback intact.
 *
 * Architecture:
 * 1. Each region has a persistent HTMLDivElement (portal target)
 * 2. RegionViews render via createPortal into their target div
 * 3. LayoutTree renders Allotment with PaneSlot components
 * 4. PaneSlot moves the portal target div into the Allotment pane via appendChild
 * 5. On split: Allotment tree changes, portal target is moved, RegionView stays mounted
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { RegionView } from "./RegionView";
import { useLayoutStore } from "../../stores/layoutStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { LayoutNode } from "../../types";
import { MIN_REGION_SIZE_PX } from "../../types";
import "./Region.css";

// ─── Persistent portal targets ──────────────────────────────────────
// Each region gets a div that lives for the lifetime of the region.
// React portals render into these divs. DOM-moving them between
// Allotment panes doesn't cause React to unmount the portal content.
const portalTargets = new Map<string, HTMLDivElement>();

function getPortalTarget(regionId: string): HTMLDivElement {
  let el = portalTargets.get(regionId);
  if (!el) {
    el = document.createElement("div");
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.overflow = "hidden";
    el.dataset.regionPortal = regionId;
    portalTargets.set(regionId, el);
  }
  return el;
}

export function cleanupPortalTarget(regionId: string): void {
  const el = portalTargets.get(regionId);
  if (el) {
    el.remove();
    portalTargets.delete(regionId);
  }
}

// ─── PaneSlot ────────────────────────────────────────────────────────
// Mounts the portal target div into the Allotment pane via DOM appendChild.
function PaneSlot({ regionId }: { regionId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    const target = getPortalTarget(regionId);
    slot.appendChild(target);

    // Staggered resize events after portal target is moved into the pane.
    // The DOM may not have settled dimensions immediately after appendChild,
    // so fire multiple resize events to ensure terminals refit correctly.
    const timers = [
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50),
      setTimeout(() => window.dispatchEvent(new Event("resize")), 200),
      setTimeout(() => window.dispatchEvent(new Event("resize")), 500),
    ];

    // Watch the SLOT size — when Allotment resizes panes (drag divider),
    // fire resize so terminals refit to the new dimensions
    const observer = new ResizeObserver(() => {
      window.dispatchEvent(new Event("resize"));
    });
    observer.observe(slot);

    return () => {
      observer.disconnect();
      for (const t of timers) clearTimeout(t);
    };
  }, [regionId]);
  return <div ref={ref} style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }} />;
}

// ─── LayoutTree ──────────────────────────────────────────────────────
// Renders only the Allotment structure with PaneSlot placeholders.
// Does NOT render RegionViews — those are portaled separately.
function LayoutTree({ node }: { node: LayoutNode }) {
  const handleSizeChange = useCallback(() => {}, []);

  if (node.type === "region") {
    return <PaneSlot regionId={node.regionId} />;
  }

  const isVertical = node.direction === "horizontal";
  return (
    <Allotment
      vertical={isVertical}
      minSize={MIN_REGION_SIZE_PX}
      onChange={handleSizeChange}
    >
      <Allotment.Pane preferredSize={`${node.ratio * 100}%`}>
        <LayoutTree node={node.children[0]} />
      </Allotment.Pane>
      <Allotment.Pane>
        <LayoutTree node={node.children[1]} />
      </Allotment.Pane>
    </Allotment>
  );
}

// ─── RegionContainer ─────────────────────────────────────────────────
export function RegionContainer() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeLayout = useLayoutStore((s) => s.layout);
  const activeRegions = useLayoutStore((s) => s.regions);
  const activeFocusedRegionId = useLayoutStore((s) => s.focusedRegionId);

  // Force re-render when portal targets are created (first mount of new regions)
  const [, bump] = useState(0);
  useEffect(() => { bump((n) => n + 1); }, [activeRegions]);

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
            {/* Allotment tree with PaneSlot placeholders */}
            <LayoutTree node={layout} />

            {/* Stable RegionViews portaled into their persistent target divs */}
            {Object.values(regions).map((region) =>
              createPortal(
                <RegionView
                  region={region}
                  isFocused={region.id === focused}
                />,
                getPortalTarget(region.id),
                region.id,
              ),
            )}
          </div>
        );
      })}
    </>
  );
}
