/**
 * Tab — Individual tab component within the tab bar.
 *
 * Renders the tab title, status indicator, and close button.
 * Supports drag-to-reorder via HTML5 drag and drop.
 *
 * Accessibility: role="tab", aria-selected for active state.
 */
import { useState, useCallback, useRef } from "react";
import type { Tab as TabType } from "../../types";

interface TabProps {
  /** Tab data. */
  tab: TabType;
  /** Whether this tab is currently active. */
  isActive: boolean;
  /** Index of this tab in the tab list. */
  index: number;
  /** Called when the tab is clicked (to activate). */
  onActivate: (id: string) => void;
  /** Called when the close button is clicked. */
  onClose: (id: string) => void;
  /** Called when drag starts. */
  onDragStart: (index: number) => void;
  /** Called when another tab is dragged over this one. */
  onDragOver: (index: number) => void;
  /** Called when drag ends (to finalize reorder). */
  onDragEnd: () => void;
  /** Called on right-click (context menu). */
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
  /** Called to rename tab. */
  onRename: (id: string, title: string) => void;
}

/** Color mapping for tab status indicators. */
const STATUS_COLORS: Record<TabType["status"], string> = {
  connected: "#50fa7b",
  local: "#50fa7b",
  disconnected: "#ff5555",
  connecting: "#f1fa8c",
};

/** Individual tab in the tab bar. */
export function Tab({
  tab,
  isActive,
  index,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onDragEnd,
  onContextMenu,
  onRename,
}: TabProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isEditing) {
        onActivate(tab.id);
      }
    },
    [tab.id, onActivate, isEditing],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.id);
    },
    [tab.id, onClose],
  );

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
    setEditValue(tab.title);
    // Focus input after render
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

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      onDragStart(index);
    },
    [index, onDragStart],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDragOver(index);
    },
    [index, onDragOver],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, tab.id);
    },
    [tab.id, onContextMenu],
  );

  const className = [
    "tab",
    isActive ? "tab--active" : "",
    isHovered ? "tab--hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      draggable={!isEditing}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className="tab__status"
        data-testid="tab-status-indicator"
        style={{ backgroundColor: STATUS_COLORS[tab.status] }}
        aria-label={`Status: ${tab.status}`}
      />

      {isEditing ? (
        <input
          ref={inputRef}
          className="tab__title-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          aria-label="Tab title"
        />
      ) : (
        <span className="tab__title">{tab.title}</span>
      )}

      {(isHovered || isActive) && (
        <button
          className="tab__close"
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
