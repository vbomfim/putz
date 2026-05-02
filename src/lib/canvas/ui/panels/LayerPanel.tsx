/**
 * LayerPanel — floating panel for managing canvas layers.
 *
 * Provides a scrollable list of layers, each with a visibility toggle
 * (eye icon), lock toggle (lock icon), and active indicator. Bottom
 * controls include "+ Add Layer" button.
 *
 * Follows the same panel pattern as WaypointPanel: fixed position,
 * inline styles, lucide-react icons, CSS variables.
 *
 * [CLEAN-CODE] [CUSTOM]
 *
 * @module
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useCanvasStore, useCanvasStoreApi } from "../../engine";
import type { Layer } from "../../protocol";
import { Plus, Eye, EyeOff, Lock, Unlock, Trash2, Layers } from "lucide-react";

// ── Constants ──────────────────────────────────────────────

/** Panel width in pixels. */
const PANEL_WIDTH = 220;

/** Icon size in pixels. */
const ICON_SIZE = 14;

/** Button size in pixels. */
const BUTTON_SIZE = 28;

// ── Props ──────────────────────────────────────────────────

/** Props for LayerPanel. */
export interface LayerPanelProps {
  /** Whether the panel is visible. */
  isOpen: boolean;
}

// ── Component ──────────────────────────────────────────────

/**
 * LayerPanel — scrollable panel with layer list + add controls.
 *
 * Each layer shows a name, eye icon (visibility toggle), lock icon,
 * and a delete button. Click the layer name to set it as active.
 */
export function LayerPanel({ isOpen }: LayerPanelProps) {
  const storeApi = useCanvasStoreApi();
  const layers = useCanvasStore((s) => s.layers);
  const activeLayerId = useCanvasStore((s) => s.activeLayerId);

  const handleAddLayer = useCallback(() => {
    storeApi.getState().addLayer();
  }, [storeApi]);

  const handleSetActive = useCallback(
    (layerId: string) => {
      storeApi.getState().setActiveLayer(layerId);
    },
    [storeApi],
  );

  const handleToggleVisibility = useCallback(
    (layerId: string) => {
      storeApi.getState().toggleLayerVisibility(layerId);
    },
    [storeApi],
  );

  const handleToggleLock = useCallback(
    (layerId: string) => {
      storeApi.getState().toggleLayerLock(layerId);
    },
    [storeApi],
  );

  const handleRemove = useCallback(
    (layerId: string) => {
      storeApi.getState().removeLayer(layerId);
    },
    [storeApi],
  );

  const handleRename = useCallback(
    (layerId: string, name: string) => {
      storeApi.getState().renameLayer(layerId, name);
    },
    [storeApi],
  );

  if (!isOpen) return null;

  // Sort layers by order for display (lower order = further back = listed at bottom)
  const sortedLayers = [...layers].sort((a, b) => b.order - a.order);

  return (
    <div
      data-testid="layer-panel"
      role="navigation"
      aria-label="Layers"
      style={{
        position: "absolute",
        right: 12,
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
        <Layers size={14} style={{ color: "var(--text-primary, #333)" }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-primary, #333333)",
            flex: 1,
          }}
        >
          Layers
        </span>
        <span
          style={{
            fontSize: 10,
            color: "#999",
            fontWeight: 400,
          }}
        >
          {layers.length}
        </span>
      </div>

      {/* Scrollable layer list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 6px",
        }}
      >
        {sortedLayers.map((layer) => (
          <LayerItem
            key={layer.id}
            layer={layer}
            isActive={layer.id === activeLayerId}
            isDefault={layer.id === "default"}
            onSetActive={handleSetActive}
            onToggleVisibility={handleToggleVisibility}
            onToggleLock={handleToggleLock}
            onRemove={handleRemove}
            onRename={handleRename}
          />
        ))}
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
        <button
          type="button"
          data-testid="layer-add"
          aria-label="Add layer"
          title="Add layer"
          onClick={handleAddLayer}
          style={controlButtonStyle}
        >
          <Plus size={ICON_SIZE} />
        </button>
      </div>
    </div>
  );
}

// ── LayerItem sub-component ────────────────────────────────

/** Props for LayerItem. */
interface LayerItemProps {
  layer: Layer;
  isActive: boolean;
  isDefault: boolean;
  onSetActive: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onRemove: (layerId: string) => void;
  onRename: (layerId: string, name: string) => void;
}

/**
 * Individual layer row with visibility, lock, rename, and delete actions.
 *
 * Click the row to set as active. Click the eye icon to toggle visibility.
 * Click the lock icon to toggle lock. The active layer has a blue left border.
 */
function LayerItem({
  layer,
  isActive,
  isDefault,
  onSetActive,
  onToggleVisibility,
  onToggleLock,
  onRemove,
  onRename,
}: LayerItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleLabelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(layer.name);
      setIsEditing(true);
    },
    [layer.name],
  );

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== layer.name) {
      onRename(layer.id, trimmed);
    }
    setIsEditing(false);
  }, [editValue, layer.name, onRename, layer.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commitRename();
      } else if (e.key === "Escape") {
        setIsEditing(false);
      }
      e.stopPropagation();
    },
    [commitRename],
  );

  return (
    <div
      data-testid={`layer-item-${layer.id}`}
      onClick={() => onSetActive(layer.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 6px",
        borderRadius: 6,
        cursor: "pointer",
        borderLeft: isActive ? "3px solid #4A90D9" : "3px solid transparent",
        backgroundColor: isActive ? "rgba(74, 144, 217, 0.08)" : "transparent",
        opacity: layer.visible ? 1 : 0.5,
        transition: "background-color 0.1s, opacity 0.15s",
        marginBottom: 2,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      {/* Visibility toggle */}
      <button
        type="button"
        data-testid={`layer-visibility-${layer.id}`}
        aria-label={layer.visible ? "Hide layer" : "Show layer"}
        title={layer.visible ? "Hide layer" : "Show layer"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility(layer.id);
        }}
        style={iconButtonStyle}
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>

      {/* Lock toggle */}
      <button
        type="button"
        data-testid={`layer-lock-${layer.id}`}
        aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
        title={layer.locked ? "Unlock layer" : "Lock layer"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(layer.id);
        }}
        style={iconButtonStyle}
      >
        {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </button>

      {/* Layer name — click to edit */}
      {isEditing ? (
        <input
          ref={inputRef}
          data-testid={`layer-name-input-${layer.id}`}
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
          data-testid={`layer-name-${layer.id}`}
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
          {layer.name}
        </span>
      )}

      {/* Delete button (hidden for default layer) */}
      {!isDefault && (
        <button
          type="button"
          data-testid={`layer-delete-${layer.id}`}
          aria-label={`Delete ${layer.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(layer.id);
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
      )}
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

/** Shared style for icon toggle buttons. */
const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  border: "none",
  borderRadius: 3,
  cursor: "pointer",
  backgroundColor: "transparent",
  color: "#999",
  transition: "color 0.1s",
  flexShrink: 0,
  padding: 0,
};
