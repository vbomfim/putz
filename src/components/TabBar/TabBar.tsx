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
import { ChangeWindowIndicator } from "../Compliance/ChangeWindowIndicator";
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
  const dragState = useRef<{ fromIndex: number; active: boolean } | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
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

  // Mouse-based tab reordering (HTML5 drag doesn't work in Tauri webviews)
  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    // Only left mouse button, ignore if right-click (context menu)
    if (e.button !== 0) return;
    dragState.current = { fromIndex: index, active: false };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current || !tabsContainerRef.current) return;
      dragState.current.active = true;
      
      // Find which tab element the mouse is over
      const tabElements = tabsContainerRef.current.querySelectorAll('[role="tab"]');
      for (let i = 0; i < tabElements.length; i++) {
        const rect = tabElements[i].getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          if (dragState.current.fromIndex !== i) {
            moveTab(dragState.current.fromIndex, i);
            dragState.current.fromIndex = i;
          }
          break;
        }
      }
    };

    const handleMouseUp = () => {
      dragState.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [moveTab]);

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
        case "moveLeft": {
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx > 0) moveTab(idx, idx - 1);
          break;
        }
        case "moveRight": {
          const idx = tabs.findIndex((t) => t.id === tabId);
          if (idx >= 0 && idx < tabs.length - 1) moveTab(idx, idx + 1);
          break;
        }
      }
    },
    [contextMenu, removeTab, closeOtherTabs, closeAllTabs, duplicateTab, tabs, moveTab],
  );

  return (
    <div className="tabbar">
      <div
        className="tabbar__tabs"
        role="tablist"
        aria-label="Terminal tabs"
        ref={tabsContainerRef}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            index={index}
            onActivate={activateTab}
            onClose={removeTab}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            onRename={renameTab}
          />
        ))}
      </div>

      <ChangeWindowIndicator />

      <button
        className="tabbar__add"
        onClick={() => addTab()}
        aria-label="New tab"
        type="button"
        title="New Tab (Ctrl+T)"
      >
        +
      </button>

      {contextMenu && (() => {
        const ctxIndex = tabs.findIndex((t) => t.id === contextMenu.tabId);
        return (
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
          <div className="tabbar__context-separator" />
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("moveLeft")}
            role="menuitem"
            type="button"
            disabled={ctxIndex <= 0}
          >
            Move Left
          </button>
          <button
            className="tabbar__context-item"
            onClick={() => handleContextAction("moveRight")}
            role="menuitem"
            type="button"
            disabled={ctxIndex < 0 || ctxIndex >= tabs.length - 1}
          >
            Move Right
          </button>
        </div>
        );
      })()}
    </div>
  );
}
