/**
 * RegionView — Renders a single region with its tab bar and content.
 *
 * Displays a compact tab bar at the top and the active tab's content below.
 * Terminal tabs render TerminalView; browser tabs render BrowserView.
 * Shows a subtle focus indicator when this region has keyboard focus.
 *
 * @module RegionView
 */
import { useCallback } from "react";
import { TerminalView } from "../Terminal";
import { BrowserView } from "../Browser";
import { RegionTabBar } from "./RegionTabBar";
import { useLayoutStore } from "../../stores/layoutStore";
import type { Region } from "../../types";

interface RegionViewProps {
  /** The region to render. */
  region: Region;
  /** Whether this region is currently focused. */
  isFocused: boolean;
}

/**
 * RegionView — a region with its own tab bar + active tab content.
 *
 * Each region is a self-contained container with:
 * - Top: mini tab bar (RegionTabBar)
 * - Content: active tab's terminal or browser
 * - Focused border indicator (2px left accent border)
 */
export function RegionView({ region, isFocused }: RegionViewProps) {
  const setFocusedRegion = useLayoutStore((s) => s.setFocusedRegion);
  const isSearchOpen = useLayoutStore((s) => s.isSearchOpen);
  const closeSearch = useLayoutStore((s) => s.closeSearch);
  const renameTab = useLayoutStore((s) => s.renameTab);

  const handleFocus = useCallback(() => {
    setFocusedRegion(region.id);
  }, [region.id, setFocusedRegion]);

  const handleTitleChange = useCallback(
    (title: string) => {
      const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
      if (activeTab) {
        renameTab(region.id, activeTab.id, title);
      }
    },
    [region.id, region.activeTabId, region.tabs, renameTab],
  );

  const activeTab = region.tabs.find((t) => t.id === region.activeTabId);
  const isSideTabs = region.tabPosition === "side";

  return (
    <div
      className={`region-view ${isFocused ? "region-view--focused" : ""} ${isSideTabs ? "region-view--side-tabs" : ""}`}
      data-testid={`region-${region.id}`}
      data-region-id={region.id}
      onClick={handleFocus}
      onFocus={handleFocus}
    >
      <RegionTabBar
        regionId={region.id}
        tabs={region.tabs}
        activeTabId={region.activeTabId}
        isFocused={isFocused}
        tabPosition={region.tabPosition}
      />

      <div className="region-view__content">
        {activeTab ? (
          activeTab.type === "browser" ? (
            <BrowserView
              browserId={activeTab.sessionId}
              initialUrl={activeTab.browserUrl || "about:blank"}
              isActive={isFocused}
            />
          ) : (
            <TerminalView
              sessionId={activeTab.sessionId}
              onTitleChange={handleTitleChange}
              isSearchOpen={isFocused && isSearchOpen}
              onSearchClose={closeSearch}
            />
          )
        ) : (
          <div className="region-view__empty">
            <p>No open tabs</p>
          </div>
        )}
      </div>
    </div>
  );
}
