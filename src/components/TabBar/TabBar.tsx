/**
 * TabBar — Horizontal tab strip for managing terminal tabs.
 *
 * Renders the tab list, add button, and context menu.
 * Supports drag-to-reorder via HTML5 drag and drop.
 *
 * Accessibility: role="tablist" on container, role="tab" on each tab.
 *
 * @module TabBar
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useTabStore } from "../../stores/tabStore";
import { Tab } from "./Tab";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import "./TabBar.css";

/** Context menu state. */
interface ContextMenu {
  x: number;
  y: number;
  tabId: string;
}

/** Tab bar component with tab management controls. */
export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const activateTab = useTabStore((s) => s.activateTab);
  const moveTab = useTabStore((s) => s.moveTab);
  const renameTab = useTabStore((s) => s.renameTab);
  const duplicateTab = useTabStore((s) => s.duplicateTab);
  const closeOtherTabs = useTabStore((s) => s.closeOtherTabs);
  const closeAllTabs = useTabStore((s) => s.closeAllTabs);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Register keyboard shortcuts
  useKeyboardShortcuts();

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

    // Use setTimeout to avoid the context menu click from immediately closing it
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      // Clamp position to keep context menu within viewport
      const menuWidth = 200;
      const menuHeight = 200;
      const x = Math.min(e.clientX, window.innerWidth - menuWidth);
      const y = Math.min(e.clientY, window.innerHeight - menuHeight);
      setContextMenu({ x, y, tabId });
    },
    [],
  );

  const handleDragStart = useCallback((index: number) => {
    setDragFromIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (toIndex: number) => {
      if (dragFromIndex !== null && dragFromIndex !== toIndex) {
        moveTab(dragFromIndex, toIndex);
        setDragFromIndex(toIndex);
      }
    },
    [dragFromIndex, moveTab],
  );

  const handleDragEnd = useCallback(() => {
    setDragFromIndex(null);
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { tabId } = contextMenu;
      setContextMenu(null);

      switch (action) {
        case "close":
          removeTab(tabId);
          break;
        case "closeOthers":
          closeOtherTabs(tabId);
          break;
        case "closeAll":
          closeAllTabs();
          break;
        case "duplicate":
          duplicateTab(tabId);
          break;
      }
    },
    [contextMenu, removeTab, closeOtherTabs, closeAllTabs, duplicateTab],
  );

  return (
    <div className="tabbar">
      <div className="tabbar__tabs" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            index={index}
            onActivate={activateTab}
            onClose={removeTab}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onContextMenu={handleContextMenu}
            onRename={renameTab}
          />
        ))}
      </div>

      <button
        className="tabbar__add"
        onClick={() => addTab()}
        aria-label="New tab"
        type="button"
        title="New Tab (Ctrl+T)"
      >
        +
      </button>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="tabbar__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
        >
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("close")}
            role="menuitem"
            type="button"
          >
            Close
          </button>
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("closeOthers")}
            role="menuitem"
            type="button"
          >
            Close Others
          </button>
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("closeAll")}
            role="menuitem"
            type="button"
          >
            Close All
          </button>
          <div className="tabbar__context-separator" />
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("duplicate")}
            role="menuitem"
            type="button"
          >
            Duplicate
          </button>
        </div>
      )}
    </div>
  );
}
