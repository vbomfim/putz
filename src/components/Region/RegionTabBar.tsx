/**
 * RegionTabBar — Mini tab bar for a single region.
 *
 * Displays tabs for one region with add (+) and close (×) buttons.
 * Supports right-click context menu for tab operations.
 *
 * Compact design (~30px height) to fit within each region.
 *
 * @module RegionTabBar
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useLayoutStore, MAX_TITLE_LENGTH } from "../../stores/layoutStore";
import type { RegionTab, TabPosition } from "../../types";

interface RegionTabBarProps {
  /** The region ID this tab bar belongs to. */
  regionId: string;
  /** Tabs to display. */
  tabs: RegionTab[];
  /** Currently active tab ID. */
  activeTabId: string;
  /** Whether this region is focused. */
  isFocused: boolean;
  /** Tab bar position: "top" (horizontal) or "side" (vertical). */
  tabPosition: TabPosition;
}

/** Context menu state. */
interface ContextMenu {
  x: number;
  y: number;
  tabId: string;
}

/** Individual tab in the region tab bar. */
function RegionTab({
  tab,
  isActive,
  regionId,
  onRename,
}: {
  tab: RegionTab;
  isActive: boolean;
  regionId: string;
  onRename: (tabId: string, title: string) => void;
}) {
  const activateTab = useLayoutStore((s) => s.activateTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const setFocusedRegion = useLayoutStore((s) => s.setFocusedRegion);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isEditing) {
        setFocusedRegion(regionId);
        activateTab(regionId, tab.id);
      }
    },
    [tab.id, regionId, activateTab, setFocusedRegion, isEditing],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(regionId, tab.id);
    },
    [tab.id, regionId, closeTab],
  );

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    setEditValue(tab.title);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [tab.title]);

  const handleRenameSubmit = useCallback(() => {
    setIsEditing(false);
    if (editValue.trim() && editValue.trim() !== tab.title) {
      onRename(tab.id, editValue.trim());
    }
  }, [editValue, tab.id, tab.title, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleRenameSubmit();
      } else if (e.key === "Escape") {
        setIsEditing(false);
        setEditValue(tab.title);
      }
    },
    [handleRenameSubmit, tab.title],
  );

  const className = [
    "region-tab",
    isActive ? "region-tab--active" : "",
    isHovered ? "region-tab--hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const icon = tab.type === "browser" ? "🌐" : "";

  return (
    <div
      className={className}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-tab-id={tab.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {icon && <span className="region-tab__icon">{icon}</span>}

      {isEditing ? (
        <input
          ref={inputRef}
          className="region-tab__title-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          maxLength={MAX_TITLE_LENGTH}
          aria-label="Tab title"
        />
      ) : (
        <span className="region-tab__title">{tab.title}</span>
      )}

      {(isHovered || isActive) && (
        <button
          className="region-tab__close"
          onClick={handleClose}
          aria-label="Close tab"
          type="button"
          tabIndex={-1}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Region tab bar component. */
export function RegionTabBar({
  regionId,
  tabs,
  activeTabId,
  isFocused,
  tabPosition,
}: RegionTabBarProps) {
  const addTerminalTab = useLayoutStore((s) => s.addTerminalTab);
  const addBrowserTab = useLayoutStore((s) => s.addBrowserTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const renameTab = useLayoutStore((s) => s.renameTab);
  const setFocusedRegion = useLayoutStore((s) => s.setFocusedRegion);
  const toggleTabPosition = useLayoutStore((s) => s.toggleTabPosition);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const tabEl = (e.target as HTMLElement).closest("[data-tab-id]");
      if (!tabEl) return;
      const tabId = tabEl.getAttribute("data-tab-id");
      if (!tabId) return;
      const menuWidth = 180;
      const menuHeight = 120;
      const x = Math.min(e.clientX, window.innerWidth - menuWidth);
      const y = Math.min(e.clientY, window.innerHeight - menuHeight);
      setContextMenu({ x, y, tabId });
    },
    [],
  );

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { tabId } = contextMenu;
      setContextMenu(null);

      switch (action) {
        case "close":
          closeTab(regionId, tabId);
          break;
        case "closeOthers":
          for (const tab of tabs) {
            if (tab.id !== tabId) {
              closeTab(regionId, tab.id);
            }
          }
          break;
        case "newBrowser":
          addBrowserTab(regionId, "");
          break;
        case "toggleTabPosition":
          toggleTabPosition(regionId);
          break;
      }
    },
    [contextMenu, regionId, tabs, closeTab, addBrowserTab, toggleTabPosition],
  );

  const handleAddClick = useCallback(() => {
    setFocusedRegion(regionId);
    addTerminalTab(regionId);
  }, [regionId, addTerminalTab, setFocusedRegion]);

  const handleRename = useCallback(
    (tabId: string, title: string) => {
      renameTab(regionId, tabId, title);
    },
    [regionId, renameTab],
  );

  const isSide = tabPosition === "side";
  const tabBarClass = [
    "region-tabbar",
    isFocused ? "region-tabbar--focused" : "",
    isSide ? "region-tabbar--side" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Only show tab bar when there are multiple tabs (single tab = cleaner look)
  // Actually — always show for discoverability and consistency
  return (
    <div
      className={tabBarClass}
      data-testid={`region-tabbar-${regionId}`}
      onContextMenu={handleContextMenu}
    >
      <div
        className="region-tabbar__tabs"
        role="tablist"
        aria-label="Region tabs"
      >
        {tabs.map((tab) => (
          <RegionTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            regionId={regionId}
            onRename={handleRename}
          />
        ))}
      </div>

      <button
        className="region-tabbar__add"
        onClick={handleAddClick}
        aria-label="New tab"
        type="button"
        title="New Tab (Ctrl+T)"
      >
        +
      </button>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="region-tabbar__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("close")}
            role="menuitem"
            type="button"
          >
            Close
          </button>
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("closeOthers")}
            role="menuitem"
            type="button"
          >
            Close Others
          </button>
          <div className="region-tabbar__context-separator" />
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("newBrowser")}
            role="menuitem"
            type="button"
          >
            New Browser Tab
          </button>
          <div className="region-tabbar__context-separator" />
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("toggleTabPosition")}
            role="menuitem"
            type="button"
          >
            {isSide ? "Tabs on Top" : "Tabs on Side"}
          </button>
        </div>
      )}
    </div>
  );
}
