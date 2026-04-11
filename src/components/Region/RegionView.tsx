/**
 * RegionView — Renders a single region with its tab bar and content.
 *
 * Displays a compact tab bar at the top and the active tab's content below.
 * Terminal tabs render TerminalView; browser tabs render BrowserView;
 * editor tabs render EditorTab (Monaco editor).
 * Shows a subtle focus indicator when this region has keyboard focus.
 *
 * @module RegionView
 */
import { useCallback } from "react";
import { TerminalView } from "../Terminal";
import { BrowserView } from "../Browser";
import { EditorTab } from "../Scripting/EditorTab";
import { DiffEditorTab } from "../Scripting/DiffEditorTab";
import { SearchReplaceTab } from "../Scripting/SearchReplaceTab";
import { VaultTab } from "../Vault/VaultTab";
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


  /** Map tab position to the CSS class that sets the correct flex-direction. */
  const positionClass: Record<string, string> = {
    top: "",
    bottom: "region-view--bottom-tabs",
    left: "region-view--left-tabs",
    right: "region-view--right-tabs",
  };
  const viewPositionClass = positionClass[region.tabPosition] || "";

  return (
    <div
      className={`region-view ${isFocused ? "region-view--focused" : ""} ${viewPositionClass}`}
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
        {region.tabs.map((tab) => {
          const isTabActive = tab.id === region.activeTabId;
          if (tab.type === "browser") {
            return (
              <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <BrowserView
                  browserId={tab.sessionId}
                  initialUrl={tab.browserUrl || ""}
                  isActive={isTabActive}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "editor") {
            return (
              <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <EditorTab
                  filePath={tab.editorFilePath}
                  scriptId={tab.editorScriptId}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "diff") {
            return (
              <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <DiffEditorTab
                  leftPath={tab.diffLeftPath}
                  rightPath={tab.diffRightPath}
                  leftContent={tab.diffLeftContent}
                  rightContent={tab.diffRightContent}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "search") {
            return (
              <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <SearchReplaceTab
                  initialDirectory={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "vault") {
            return (
              <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                <VaultTab />
              </div>
            );
          }
          return (
            <div key={tab.id} style={{ display: isTabActive ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              <TerminalView
                sessionId={tab.sessionId}
                onTitleChange={handleTitleChange}
                isSearchOpen={isTabActive && isFocused && isSearchOpen}
                onSearchClose={closeSearch}
              />
            </div>
          );
        })}
        {region.tabs.length === 0 && (
          <div className="region-view__empty">
            <p>No open tabs</p>
          </div>
        )}
      </div>
    </div>
  );
}
