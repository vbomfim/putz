/**
 * WaypointPanel — floating panel for managing canvas bookmarks / named views.
 *
 * Provides a scrollable list of saved camera waypoints, each with an
 * editable label, jump-to button, and delete button. Bottom controls
 * include "Save Current View", prev/next navigation, and a counter.
 *
 * Toggled from a toolbar button (MapPin icon). Follows the same panel
 * pattern as StencilPalette: fixed position, inline styles, lucide icons.
 *
 * [CLEAN-CODE] [CUSTOM]
 *
 * @module
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useCanvasStore, useCanvasStoreApi } from "../../engine";
import type { CameraWaypoint } from "../../engine";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Navigation,
  Trash2,
  GripVertical,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────

/** Panel width in pixels. */
const PANEL_WIDTH = 220;

/** Icon size in pixels. */
const ICON_SIZE = 14;

/** Button size in pixels. */
const BUTTON_SIZE = 28;

// ── Props ──────────────────────────────────────────────────

/** Props for WaypointPanel. */
export interface WaypointPanelProps {
  /** Whether the panel is visible. */
  isOpen: boolean;
}

// ── Component ──────────────────────────────────────────────

/**
 * WaypointPanel — scrollable panel with waypoint list + navigation controls.
 *
 * Each waypoint shows an editable label, a "jump" button, and a "delete" button.
 * Bottom bar provides "Save Current View", prev/next arrows, and a counter.
 */
export function WaypointPanel({ isOpen }: WaypointPanelProps) {
  const storeApi = useCanvasStoreApi();
  const waypoints = useCanvasStore((s) => s.waypoints);
  const presentationIndex = useCanvasStore((s) => s.presentationIndex);

  /** Currently dragged waypoint index (-1 = not dragging). */
  const [dragIndex, setDragIndex] = useState(-1);
  /** Current drop target index (-1 = none). */
  const [dropTargetIndex, setDropTargetIndex] = useState(-1);

  const handleAddWaypoint = useCallback(() => {
    storeApi.getState().addWaypoint();
  }, [storeApi]);

  const handleJump = useCallback(
    (index: number) => {
      storeApi.getState().goToWaypoint(index);
    },
    [storeApi],
  );

  const handleRemove = useCallback(
    (index: number) => {
      storeApi.getState().removeWaypoint(index);
    },
    [storeApi],
  );

  const handleRename = useCallback(
    (index: number, label: string) => {
      storeApi.getState().updateWaypoint(index, { label });
    },
    [storeApi],
  );

  const handlePrev = useCallback(() => {
    storeApi.getState().prevWaypoint();
  }, [storeApi]);

  const handleNext = useCallback(() => {
    storeApi.getState().nextWaypoint();
  }, [storeApi]);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDropTargetIndex(index);
  }, []);

  const handleDrop = useCallback(
    (toIndex: number) => {
      if (dragIndex >= 0 && dragIndex !== toIndex) {
        storeApi.getState().reorderWaypoints(dragIndex, toIndex);
      }
      setDragIndex(-1);
      setDropTargetIndex(-1);
    },
    [dragIndex, storeApi],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(-1);
    setDropTargetIndex(-1);
  }, []);

  if (!isOpen) return null;

  const displayIndex = presentationIndex >= 0 ? presentationIndex + 1 : 0;

  return (
    <div
      data-testid="waypoint-panel"
      role="navigation"
      aria-label="Waypoints"
      style={{
        position: "absolute",
        left: 60,
        top: "50%",
        transform: "translateY(-50%)",
        width: PANEL_WIDTH,
        maxHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-toolbar, #ffffff)",
        borderRadius: 10,
        boxShadow: "0 4px 16px var(--shadow, rgba(0, 0, 0, 0.15))",
        border: "1px solid var(--border, #e0e0e0)",
        zIndex: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderBottom: "1px solid var(--border, #e0e0e0)",
          flexShrink: 0,
        }}
      >
        <Navigation size={14} style={{ color: "var(--text-primary, #333)" }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-primary, #333333)",
            flex: 1,
          }}
        >
          Waypoints
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#999",
            fontWeight: 400,
          }}
        >
          {waypoints.length}
        </span>
      </div>

      {/* Scrollable waypoint list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 6px",
        }}
      >
        {waypoints.length === 0 ? (
          <div
            style={{
              padding: "16px 8px",
              textAlign: "center",
              fontSize: 11,
              color: "#999",
              lineHeight: 1.4,
            }}
          >
            No waypoints yet.
            <br />
            Save your current view to get started.
          </div>
        ) : (
          waypoints.map((wp, index) => (
            <WaypointItem
              key={`wp-${index}`}
              waypoint={wp}
              index={index}
              isActive={index === presentationIndex}
              isDragging={index === dragIndex}
              isDropTarget={index === dropTargetIndex && index !== dragIndex}
              onJump={handleJump}
              onRemove={handleRemove}
              onRename={handleRename}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>

      {/* Bottom controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "6px 6px",
          borderTop: "1px solid var(--border, #e0e0e0)",
          flexShrink: 0,
        }}
      >
        {/* Save Current View */}
        <button
          type="button"
          data-testid="waypoint-add"
          aria-label="Save current view"
          title="Save current view"
          onClick={handleAddWaypoint}
          style={controlButtonStyle}
        >
          <Plus size={ICON_SIZE} />
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Prev */}
        <button
          type="button"
          data-testid="waypoint-prev"
          aria-label="Previous waypoint"
          title="Previous (←)"
          onClick={handlePrev}
          disabled={waypoints.length === 0}
          style={{
            ...controlButtonStyle,
            opacity: waypoints.length === 0 ? 0.3 : 1,
          }}
        >
          <ChevronLeft size={ICON_SIZE} />
        </button>

        {/* Counter */}
        <span
          data-testid="waypoint-counter"
          style={{
            minWidth: 36,
            textAlign: "center",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--text-primary, #333333)",
            userSelect: "none",
          }}
        >
          {waypoints.length > 0 ? `${displayIndex} / ${waypoints.length}` : "0"}
        </span>

        {/* Next */}
        <button
          type="button"
          data-testid="waypoint-next"
          aria-label="Next waypoint"
          title="Next (→)"
          onClick={handleNext}
          disabled={waypoints.length === 0}
          style={{
            ...controlButtonStyle,
            opacity: waypoints.length === 0 ? 0.3 : 1,
          }}
        >
          <ChevronRight size={ICON_SIZE} />
        </button>
      </div>
    </div>
  );
}

// ── WaypointItem sub-component ─────────────────────────────

/** Props for WaypointItem. */
interface WaypointItemProps {
  waypoint: CameraWaypoint;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onJump: (index: number) => void;
  onRemove: (index: number) => void;
  onRename: (index: number, label: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
}

/**
 * Individual waypoint row with editable label, jump, and delete actions.
 *
 * Click the label to edit it inline. Click the row background to jump.
 * The active waypoint is highlighted with a blue left border.
 * Drag the grip handle to reorder waypoints within the list.
 */
function WaypointItem({
  waypoint,
  index,
  isActive,
  isDragging,
  isDropTarget,
  onJump,
  onRemove,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: WaypointItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(waypoint.label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleLabelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(waypoint.label ?? "");
      setIsEditing(true);
    },
    [waypoint.label],
  );

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== waypoint.label) {
      onRename(index, trimmed);
    }
    setIsEditing(false);
  }, [editValue, waypoint.label, onRename, index]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commitRename();
      } else if (e.key === "Escape") {
        setIsEditing(false);
      }
      // Stop propagation to prevent canvas keyboard shortcuts
      e.stopPropagation();
    },
    [commitRename],
  );

  return (
    <div
      data-testid={`waypoint-item-${index}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        // Use minimal drag image to avoid floating counter/button artifacts
        const ghost = document.createElement("div");
        ghost.textContent = waypoint.label || `View ${index + 1}`;
        ghost.style.cssText =
          "position:absolute;top:-999px;padding:4px 8px;background:#4A90D9;color:#fff;border-radius:4px;font-size:12px;font-family:system-ui";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => document.body.removeChild(ghost));
        onDragStart(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onJump(index)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 6px",
        borderRadius: 6,
        cursor: "pointer",
        borderLeft: isActive ? "3px solid #4A90D9" : "3px solid transparent",
        borderTop: isDropTarget ? "2px solid #4A90D9" : "2px solid transparent",
        backgroundColor: isActive ? "rgba(74, 144, 217, 0.08)" : "transparent",
        opacity: isDragging ? 0.4 : 1,
        transition: "background-color 0.1s, opacity 0.15s",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isDropTarget) {
          e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive && !isDropTarget) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      {/* Drag handle */}
      <span
        data-testid={`waypoint-drag-${index}`}
        style={{
          display: "flex",
          alignItems: "center",
          cursor: "grab",
          color: "#bbb",
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </span>
      {/* Label — click to edit, or show input when editing */}
      {isEditing ? (
        <input
          ref={inputRef}
          data-testid={`waypoint-label-input-${index}`}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            fontSize: 11,
            fontFamily: "inherit",
            padding: "2px 4px",
            border: "1px solid #4A90D9",
            borderRadius: 3,
            outline: "none",
            backgroundColor: "var(--bg-toolbar, #ffffff)",
            color: "var(--text-primary, #333333)",
            minWidth: 0,
          }}
        />
      ) : (
        <span
          data-testid={`waypoint-label-${index}`}
          onClick={handleLabelClick}
          title="Click to rename"
          style={{
            flex: 1,
            fontSize: 11,
            color: "var(--text-primary, #333333)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "text",
          }}
        >
          {waypoint.label ?? `Waypoint ${index + 1}`}
        </span>
      )}

      {/* Delete button */}
      <button
        type="button"
        data-testid={`waypoint-delete-${index}`}
        aria-label={`Delete ${waypoint.label ?? "waypoint"}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          backgroundColor: "transparent",
          color: "#999",
          transition: "color 0.1s, background-color 0.1s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#e03131";
          e.currentTarget.style.backgroundColor = "rgba(224, 49, 49, 0.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#999";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

/** Shared style for bottom control buttons. */
const controlButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  backgroundColor: "transparent",
  color: "var(--text-primary, #333333)",
  transition: "background-color 0.15s",
};
