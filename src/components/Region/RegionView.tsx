/**
 * RegionView — Renders a single region with its tab bar and content.
 *
 * Displays a compact tab bar at the top and the active tab's content below.
 * Terminal tabs render TerminalView; editor tabs render EditorTab (Monaco editor).
 * Shows a subtle focus indicator when this region has keyboard focus.
 *
 * @module RegionView
 */
import { useCallback, useEffect } from "react";
import { TerminalView } from "../Terminal";
import { EditorTab } from "../Scripting/EditorTab";
import { DiffEditorTab } from "../Scripting/DiffEditorTab";
import { SearchReplaceTab } from "../Scripting/SearchReplaceTab";
import { SettingsTab } from "../Settings/SettingsTab";
import { BookmarksPanel } from "../BookmarksPanel";
import { MarkdownTab } from "../Markdown/MarkdownTab";
import { CsvTab } from "../Csv/CsvTab";
import { DrawioEditor } from "../DrawioEditor";
import { GitGraph } from "../GitGraph";
import { Radio } from "../Radio";
import { RegionTabBar } from "./RegionTabBar";
import { useLayoutStore } from "../../stores/layoutStore";
import { VALID_TAB_TYPES } from "../../utils/migratePersistence";
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
 * - Content: active tab's terminal or editor
 * - Focused border indicator (2px left accent border)
 */
export function RegionView({ region, isFocused }: RegionViewProps) {
  const setFocusedRegion = useLayoutStore((s) => s.setFocusedRegion);
  const isSearchOpen = useLayoutStore((s) => s.isSearchOpen);
  const closeSearch = useLayoutStore((s) => s.closeSearch);
  const renameTab = useLayoutStore((s) => s.renameTab);
  const closeTab = useLayoutStore((s) => s.closeTab);

  const handleFocus = useCallback(() => {
    setFocusedRegion(region.id);
  }, [region.id, setFocusedRegion]);

  // Memoized title-change handler. The inline arrow at the call site
  // still allocates per tab per render, but the underlying handler is
  // stable across renders (CR MEDIUM #6). A full fix would require
  // TerminalView to accept tabId as a prop.
  const handleTitleChange = useCallback(
    (tabId: string, title: string) => {
      renameTab(region.id, tabId, title);
    },
    [region.id, renameTab],
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
          if (tab.type === "editor") {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
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
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
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
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <SearchReplaceTab
                  initialDirectory={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "settings") {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <SettingsTab />
              </div>
            );
          }
          if (tab.type === "bookmarks") {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <BookmarksPanel asTab />
              </div>
            );
          }
          if (tab.type === "markdown" && tab.editorFilePath) {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <MarkdownTab
                  filePath={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "csv" && tab.editorFilePath) {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <CsvTab
                  filePath={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "drawio" && tab.editorFilePath) {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <DrawioEditor
                  filePath={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                  isActive={isTabActive}
                />
              </div>
            );
          }
          if (tab.type === "git-graph" && tab.editorFilePath) {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <GitGraph
                  repoPath={tab.editorFilePath}
                  regionId={region.id}
                  tabId={tab.id}
                />
              </div>
            );
          }
          if (tab.type === "radio") {
            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <Radio />
              </div>
            );
          }
          // Defensive guard: if a persisted tab has an unknown/removed content
          // type that survived migration (e.g., "ssh", "vault"), render nothing
          // and warn in console. This protects against stale localStorage data
          // from v0.3.x upgrades without showing a misleading UI element.
          if (!VALID_TAB_TYPES.has(tab.type)) {
            console.warn(
              `[RegionView] Unknown tab type: ${tab.type} — likely persistence corruption`,
            );
            return null;
          }
          return (
            <div
              key={tab.id}
              style={{
                display: isTabActive ? "flex" : "none",
                flex: 1,
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {tab.pendingRestore != null ? (
                <RestoredTabPlaceholder
                  regionId={region.id}
                  tabId={tab.id}
                />
              ) : (
                <TerminalView
                  sessionId={tab.sessionId}
                  onTitleChange={(title) => handleTitleChange(tab.id, title)}
                  isSearchOpen={isTabActive && isFocused && isSearchOpen}
                  onSearchClose={closeSearch}
                  onExit={() => closeTab(region.id, tab.id)}
                />
              )}
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

/**
 * Renders a brief loading placeholder for a restored terminal tab and
 * triggers lazy `materializeRestoredTab` on mount. Once materialization
 * completes the tab no longer has `pendingRestore`, so RegionView
 * re-renders with the real `<TerminalView>` and this component unmounts.
 *
 * Materialization fires unconditionally on mount (regardless of whether
 * the tab is currently active) — every restored terminal needs a fresh
 * PTY because the snapshot's sessionId is dead after restart.
 */
function RestoredTabPlaceholder({
  regionId,
  tabId,
}: {
  regionId: string;
  tabId: string;
}) {
  const materialize = useLayoutStore((s) => s.materializeRestoredTab);

  useEffect(() => {
    // Trigger materialization on mount — the tab needs a PTY regardless
    // of whether it's the currently active tab.
    void materialize(regionId, tabId);
  }, [materialize, regionId, tabId]);

  return (
    <div
      className="region-view__restoring"
      role="status"
      aria-live="polite"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.6,
        fontSize: "0.85em",
      }}
    >
      Restoring terminal…
    </div>
  );
}
