/**
 * RegionTabBar — Mini tab bar for a single region.
 *
 * Displays tabs for one region with add (+) and close (×) buttons.
 * Supports right-click context menu for tab operations.
 * Supports pointer-based drag and drop between regions (HTML5 DnD fails in Tauri).
 *
 * Compact design (~30px height) to fit within each region.
 *
 * @module RegionTabBar
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { useLayoutStore, MAX_TITLE_LENGTH } from "../../stores/layoutStore";
import type { RegionTab, TabPosition } from "../../types";

// ─── Global drag state (pointer-based, not HTML5 DnD) ─────────────
interface DragState {
  tabId: string;
  regionId: string;
  title: string;
  ghost: HTMLDivElement | null;
}
let activeDrag: DragState | null = null;

interface RegionTabBarProps {
  /** The region ID this tab bar belongs to. */
  regionId: string;
  /** Tabs to display. */
  tabs: RegionTab[];
  /** Currently active tab ID. */
  activeTabId: string;
  /** Whether this region is focused. */
  isFocused: boolean;
  /** Tab bar position: "top" | "bottom" | "left" | "right". */
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

  const icon = tab.type === "browser" ? "🌐" : tab.type === "editor" ? "📝" : tab.type === "diff" ? "📄" : "";

  // ─── Pointer-based drag ──────────────────────────────────
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing || e.button !== 0) return;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      isDragging.current = false;
    },
    [isEditing],
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (!isDragging.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        // Start drag
        isDragging.current = true;
        const ghost = document.createElement("div");
        ghost.className = "region-tab-drag-ghost";
        ghost.textContent = tab.title;
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        document.body.appendChild(ghost);
        activeDrag = { tabId: tab.id, regionId, title: tab.title, ghost };
      }
      if (isDragging.current && activeDrag?.ghost) {
        activeDrag.ghost.style.left = `${e.clientX}px`;
        activeDrag.ghost.style.top = `${e.clientY}px`;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (isDragging.current && activeDrag) {
        // Find the drop target — look for a region tab bar under the pointer
        activeDrag.ghost?.remove();
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const tabBar = target?.closest("[data-region-tabbar]") as HTMLElement | null;
        const dropTab = target?.closest("[data-tab-id]") as HTMLElement | null;

        if (tabBar) {
          const toRegionId = tabBar.getAttribute("data-region-tabbar") || "";
          let insertIndex: number | undefined;
          if (dropTab) {
            // Insert at the position of the drop target tab
            const dropTabId = dropTab.getAttribute("data-tab-id") || "";
            const { regions } = useLayoutStore.getState();
            const toRegion = regions[toRegionId];
            if (toRegion) {
              insertIndex = toRegion.tabs.findIndex((t) => t.id === dropTabId);
            }
          }
          useLayoutStore.getState().moveTab(activeDrag.regionId, activeDrag.tabId, toRegionId, insertIndex);
        }
        activeDrag = null;
      }
      dragStartPos.current = null;
      isDragging.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [tab.id, tab.title, regionId]);

  return (
    <div
      className={className}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-tab-id={tab.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ cursor: "grab" }}
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
  const setTabPosition = useLayoutStore((s) => s.setTabPosition);
  const splitRegion = useLayoutStore((s) => s.splitRegion);
  const splitTabToNew = useLayoutStore((s) => s.splitTabToNew);

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
        case "tabsTop":
          setTabPosition(regionId, "top");
          break;
        case "tabsBottom":
          setTabPosition(regionId, "bottom");
          break;
        case "tabsLeft":
          setTabPosition(regionId, "left");
          break;
        case "tabsRight":
          setTabPosition(regionId, "right");
          break;
        case "splitRight":
          splitTabToNew(regionId, contextMenu.tabId, "vertical", "after");
          break;
        case "splitLeft":
          splitTabToNew(regionId, contextMenu.tabId, "vertical", "before");
          break;
        case "splitDown":
          splitTabToNew(regionId, contextMenu.tabId, "horizontal", "after");
          break;
        case "splitUp":
          splitTabToNew(regionId, contextMenu.tabId, "horizontal", "before");
          break;
      }
    },
    [contextMenu, regionId, tabs, closeTab, addBrowserTab, setTabPosition, splitTabToNew],
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

  const isVertical = tabPosition === "left" || tabPosition === "right";
  const tabBarClass = [
    "region-tabbar",
    isFocused ? "region-tabbar--focused" : "",
    isVertical ? "region-tabbar--vertical" : "",
    tabPosition === "bottom" ? "region-tabbar--bottom" : "",
    tabPosition === "right" ? "region-tabbar--right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Only show tab bar when there are multiple tabs (single tab = cleaner look)
  // Actually — always show for discoverability and consistency
  return (
    <div
      className={tabBarClass}
      data-testid={`region-tabbar-${regionId}`}
      data-region-tabbar={regionId}
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

      {/* Right-aligned action icons — keep minimal */}
      <div className="region-tabbar__actions">
        <button
          className="region-tabbar__action"
          onClick={handleAddClick}
          aria-label="New Terminal"
          type="button"
          title="New Terminal"
        >
          ⌨
        </button>
        <button
          className="region-tabbar__action"
          onClick={() => { setFocusedRegion(regionId); splitRegion("vertical"); }}
          aria-label="Split Vertical"
          type="button"
          title="Split Vertical"
        >
          ◫
        </button>
        <button
          className="region-tabbar__action"
          onClick={() => { setFocusedRegion(regionId); splitRegion("horizontal"); }}
          aria-label="Split Horizontal"
          type="button"
          title="Split Horizontal"
        >
          ⬒
        </button>
      </div>

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
          <button className="region-tabbar__context-item" onClick={() => handleContextAction("splitRight")} role="menuitem" type="button">
            Split Right ◫
          </button>
          <button className="region-tabbar__context-item" onClick={() => handleContextAction("splitLeft")} role="menuitem" type="button">
            Split Left ◫
          </button>
          <button className="region-tabbar__context-item" onClick={() => handleContextAction("splitDown")} role="menuitem" type="button">
            Split Down ⬒
          </button>
          <button className="region-tabbar__context-item" onClick={() => handleContextAction("splitUp")} role="menuitem" type="button">
            Split Up ⬒
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
            onClick={() => handleContextAction("tabsTop")}
            role="menuitem"
            type="button"
          >
            {tabPosition === "top" ? "✓ " : ""}Tabs on Top
          </button>
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("tabsBottom")}
            role="menuitem"
            type="button"
          >
            {tabPosition === "bottom" ? "✓ " : ""}Tabs on Bottom
          </button>
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("tabsLeft")}
            role="menuitem"
            type="button"
          >
            {tabPosition === "left" ? "✓ " : ""}Tabs on Left
          </button>
          <button
            className="region-tabbar__context-item"
            onClick={() => handleContextAction("tabsRight")}
            role="menuitem"
            type="button"
          >
            {tabPosition === "right" ? "✓ " : ""}Tabs on Right
          </button>
        </div>
      )}
    </div>
  );
}
