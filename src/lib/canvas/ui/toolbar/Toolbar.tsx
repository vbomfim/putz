/**
 * Toolbar — vertical tool selection bar on the left side of the canvas.
 *
 * Renders icon buttons for each drawing tool. Clicking a tool sets
 * `activeTool` in the canvas store. The active tool is visually
 * highlighted with a blue background.
 *
 * Uses lucide-react for icons.
 *
 * @module
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useCanvasStore } from '../../engine';
import type { ToolType } from '../../engine';
import type { ExpressionStyle } from '../../protocol';
import {
  MousePointer2,
  Square,
  Circle,
  Diamond,
  ArrowRight,
  Pencil,
  Type,
  StickyNote,
  Group,
  Ungroup,
  Trash2,
  LayoutGrid,
  MapPin,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Tool definition for rendering toolbar buttons. */
interface ToolDefinition {
  type: ToolType;
  icon: LucideIcon;
  label: string;
}

/** Ordered list of tools displayed in the toolbar. */
const TOOLS: ToolDefinition[] = [
  { type: 'select', icon: MousePointer2, label: 'Select (V)' },
  { type: 'rectangle', icon: Square, label: 'Rectangle (R)' },
  { type: 'ellipse', icon: Circle, label: 'Ellipse (O)' },
  { type: 'diamond', icon: Diamond, label: 'Diamond (D)' },
  { type: 'arrow', icon: ArrowRight, label: 'Arrow (A)' },
  { type: 'freehand', icon: Pencil, label: 'Pen (P)' },
  { type: 'text', icon: Type, label: 'Text (T)' },
  { type: 'sticky-note', icon: StickyNote, label: 'Sticky Note (N)' },
];

/** Toolbar button size in pixels. */
const BUTTON_SIZE = 36;

/** Icon size in pixels. */
const ICON_SIZE = 18;

/** Props for the Toolbar component. */
export interface ToolbarProps {
  /** Callback to toggle the stencil palette panel. */
  onToggleStencilPalette?: () => void;
  /** Whether the stencil palette panel is currently open. */
  isStencilPaletteOpen?: boolean;
  /** Callback to toggle the waypoint panel. */
  onToggleWaypointPanel?: () => void;
  /** Whether the waypoint panel is currently open. */
  isWaypointPanelOpen?: boolean;
}

/** Toolbar component — renders a vertical bar on the left side. */
export function Toolbar({ onToggleStencilPalette, isStencilPaletteOpen, onToggleWaypointPanel, isWaypointPanelOpen }: ToolbarProps = {}) {
  const activeTool = useCanvasStore((s) => s.activeTool);
  const setActiveTool = useCanvasStore((s) => s.setActiveTool);
  const lastUsedStyle = useCanvasStore((s) => s.lastUsedStyle);

  const isTransparentFill = lastUsedStyle.backgroundColor === 'transparent';

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow]);

  const scroll = useCallback((dir: 'up' | 'down') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: dir === 'up' ? -BUTTON_SIZE * 2 : BUTTON_SIZE * 2, behavior: 'smooth' });
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      style={{
        position: 'absolute',
        left: 12,
        top: 12,
        bottom: 12,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100% - 24px)',
        padding: 6,
        backgroundColor: 'var(--bg-toolbar, #ffffff)',
        borderRadius: 10,
        boxShadow: '0 2px 8px var(--shadow, rgba(0, 0, 0, 0.12))',
        border: '1px solid var(--border, #e0e0e0)',
        zIndex: 20,
        width: BUTTON_SIZE + 12,
      }}
    >
      {/* Scroll-up arrow */}
      {canScrollUp && (
        <button
          type="button"
          aria-label="Scroll up"
          onClick={() => scroll('up')}
          style={scrollArrowStyle}
        >
          <ChevronUp size={14} />
        </button>
      )}

      {/* Scrollable tool area */}
      <div
        ref={scrollRef}
        onScroll={checkOverflow}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          scrollbarWidth: 'none',
        }}
      >
      {TOOLS.map((tool) => {
        const isActive = activeTool === tool.type;
        const Icon = tool.icon;

        return (
          <button
            key={tool.type}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={isActive}
            data-tool={tool.type}
            onClick={() => setActiveTool(tool.type)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              minHeight: BUTTON_SIZE,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: isActive ? '#4A90D9' : 'transparent',
              color: isActive ? '#ffffff' : 'var(--text-primary, #333333)',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            <Icon size={ICON_SIZE} />
          </button>
        );
      })}

      {/* Style indicator — shows current stroke/fill colors */}
      <div
        style={{
          width: '100%',
          height: 1,
          backgroundColor: '#e0e0e0',
          margin: '2px 0',
        }}
      />
      <StyleIndicator style={lastUsedStyle} isTransparentFill={isTransparentFill} />

      {/* Stencil palette toggle — shown when callback is provided */}
      {onToggleStencilPalette && (
        <>
          <div style={{ width: '100%', height: 1, backgroundColor: '#e0e0e0', margin: '2px 0' }} />
          <button
            type="button"
            title="Stencil Palette (I)"
            aria-label="Stencil Palette"
            aria-pressed={!!isStencilPaletteOpen}
            data-testid="stencil-palette-toggle"
            onClick={onToggleStencilPalette}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              minHeight: BUTTON_SIZE,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: isStencilPaletteOpen ? '#4A90D9' : 'transparent',
              color: isStencilPaletteOpen ? '#ffffff' : 'var(--text-primary, #333333)',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            <LayoutGrid size={ICON_SIZE} />
          </button>
        </>
      )}

      {/* Waypoint panel toggle — shown when callback is provided */}
      {onToggleWaypointPanel && (
        <button
          type="button"
          title="Waypoints (W)"
          aria-label="Waypoints"
          aria-pressed={!!isWaypointPanelOpen}
          data-testid="waypoint-panel-toggle"
          onClick={onToggleWaypointPanel}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            minHeight: BUTTON_SIZE,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: isWaypointPanelOpen ? '#4A90D9' : 'transparent',
            color: isWaypointPanelOpen ? '#ffffff' : 'var(--text-primary, #333333)',
            transition: 'background-color 0.15s, color 0.15s',
          }}
        >
          <MapPin size={ICON_SIZE} />
        </button>
      )}

      {/* Group/Ungroup buttons — shown when 2+ expressions selected */}
      <GroupActions />
      <SelectionActions />
      </div>

      {/* Scroll-down arrow */}
      {canScrollDown && (
        <button
          type="button"
          aria-label="Scroll down"
          onClick={() => scroll('down')}
          style={scrollArrowStyle}
        >
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}

const scrollArrowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: BUTTON_SIZE,
  height: 20,
  minHeight: 20,
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary, #888)',
};

/** Small swatch showing current stroke + fill colors. */
function StyleIndicator({
  style,
  isTransparentFill,
}: {
  style: ExpressionStyle;
  isTransparentFill: boolean;
}) {
  return (
    <div
      data-testid="style-indicator"
      data-transparent={isTransparentFill ? 'true' : 'false'}
      title={`Stroke: ${style.strokeColor} / Fill: ${style.backgroundColor}`}
      style={{
        width: BUTTON_SIZE - 8,
        height: BUTTON_SIZE - 8,
        borderRadius: 4,
        borderColor: style.strokeColor,
        borderWidth: 3,
        borderStyle: 'solid',
        backgroundColor: isTransparentFill ? 'transparent' : style.backgroundColor,
        backgroundImage: isTransparentFill
          ? 'repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%)'
          : undefined,
        backgroundSize: isTransparentFill ? '8px 8px' : undefined,
        margin: '0 auto',
        cursor: 'default',
      }}
    />
  );
}

/** Group/Ungroup action buttons — visible when expressions are selected. */
function GroupActions() {
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const expressions = useCanvasStore((s) => s.expressions);
  const groupExpressions = useCanvasStore((s) => s.groupExpressions);
  const ungroupExpressions = useCanvasStore((s) => s.ungroupExpressions);

  if (selectedIds.size < 2) return null;

  // Check if selection can be ungrouped (all share same parentId)
  const selectedArray = Array.from(selectedIds);
  const firstParent = expressions[selectedArray[0]!]?.parentId;
  const canUngroup = firstParent && selectedArray.every(
    (id) => expressions[id]?.parentId === firstParent,
  );

  return (
    <>
      <div style={{ width: '100%', height: 1, backgroundColor: '#e0e0e0', margin: '2px 0' }} />
      <button
        type="button"
        title="Group (Ctrl+G)"
        aria-label="Group selected"
        onClick={() => groupExpressions(selectedArray)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: BUTTON_SIZE, height: BUTTON_SIZE,
          border: 'none', borderRadius: 6, cursor: 'pointer',
          backgroundColor: 'transparent',
          color: 'var(--text-primary, #333333)',
        }}
      >
        <Group size={ICON_SIZE} />
      </button>
      {canUngroup && (
        <button
          type="button"
          title="Ungroup (Ctrl+Shift+G)"
          aria-label="Ungroup selected"
          onClick={() => ungroupExpressions(firstParent)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: BUTTON_SIZE, height: BUTTON_SIZE,
            border: 'none', borderRadius: 6, cursor: 'pointer',
            backgroundColor: 'transparent',
            color: 'var(--text-primary, #333333)',
          }}
        >
          <Ungroup size={ICON_SIZE} />
        </button>
      )}
    </>
  );
}

/** Delete + Z-order buttons — visible when 1+ expressions selected. */
function SelectionActions() {
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const expressions = useCanvasStore((s) => s.expressions);
  const deleteExpressions = useCanvasStore((s) => s.deleteExpressions);
  const bringToFront = useCanvasStore((s) => s.bringToFront);
  const sendToBack = useCanvasStore((s) => s.sendToBack);
  const bringForward = useCanvasStore((s) => s.bringForward);
  const sendBackward = useCanvasStore((s) => s.sendBackward);

  if (selectedIds.size === 0) return null;

  const selectedArray = Array.from(selectedIds);

  const handleDelete = () => {
    const deletableIds = selectedArray.filter(
      (id) => !expressions[id]?.meta.locked,
    );
    if (deletableIds.length > 0) {
      deleteExpressions(deletableIds);
    }
  };

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: BUTTON_SIZE, height: BUTTON_SIZE,
    border: 'none', borderRadius: 6, cursor: 'pointer',
    backgroundColor: 'transparent',
    color: 'var(--text-primary, #333333)',
  };

  return (
    <>
      <div style={{ width: '100%', height: 1, backgroundColor: '#e0e0e0', margin: '2px 0' }} />
      <button type="button" title="Bring to Front (Ctrl+])" aria-label="Bring to front" onClick={() => bringToFront(selectedArray)} style={btnStyle}>
        <ArrowUpToLine size={ICON_SIZE} />
      </button>
      <button type="button" title="Bring Forward (Ctrl+↑)" aria-label="Bring forward" onClick={() => bringForward(selectedArray)} style={btnStyle}>
        <ArrowUp size={ICON_SIZE} />
      </button>
      <button type="button" title="Send Backward (Ctrl+↓)" aria-label="Send backward" onClick={() => sendBackward(selectedArray)} style={btnStyle}>
        <ArrowDown size={ICON_SIZE} />
      </button>
      <button type="button" title="Send to Back (Ctrl+[)" aria-label="Send to back" onClick={() => sendToBack(selectedArray)} style={btnStyle}>
        <ArrowDownToLine size={ICON_SIZE} />
      </button>
      <div style={{ width: '100%', height: 1, backgroundColor: '#e0e0e0', margin: '2px 0' }} />
      <button
        type="button"
        title="Delete (Del)"
        aria-label="Delete selected"
        onClick={handleDelete}
        style={{ ...btnStyle, color: '#e03131' }}
      >
        <Trash2 size={ICON_SIZE} />
      </button>
    </>
  );
}
