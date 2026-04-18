/**
 * FloatingConnectorPanel — compact connector controls near the selected arrow.
 *
 * Positions itself near the midpoint of a selected arrow/line expression,
 * converting world coordinates to screen coordinates via the camera transform.
 * Contains compact dropdowns for routing mode, arrowheads, and edge properties.
 *
 * Shows in two modes:
 * 1. **Selection mode** — arrow/line selected → positions near its midpoint
 * 2. **Drawing mode** — arrow tool active → static position (bottom-center)
 *
 * The panel header is draggable — grab it to reposition the panel without
 * interfering with canvas pan/zoom. Drag offset resets when a different
 * arrow is selected. [CLEAN-CODE]
 *
 * @module
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCanvasStore, worldToScreen } from '../../engine';
import type { ArrowData, RoutingMode } from '../../protocol';

// ── Constants ──────────────────────────────────────────────

/** Offset from the arrow midpoint (screen pixels). */
const PANEL_OFFSET_X = 20;
const PANEL_OFFSET_Y = 120;

/** Approximate panel dimensions for viewport clamping. */
const PANEL_WIDTH = 200;
const PANEL_HEIGHT = 160;

/** Minimum margin from viewport edges. */
const VIEWPORT_MARGIN = 12;

// ── Connector option data ──────────────────────────────────

/** Routing mode options for arrows. */
const ROUTING_MODES: { value: RoutingMode; label: string; icon: string }[] = [
  { value: 'straight', label: 'Straight', icon: '─' },
  { value: 'orthogonal', label: 'Orthogonal', icon: '┌' },
  { value: 'curved', label: 'Curved', icon: '╭' },
  { value: 'elbow', label: 'Elbow', icon: '└' },
  { value: 'entityRelation', label: 'ER', icon: '╟' },
  { value: 'isometric', label: 'Isometric', icon: '◇' },
  { value: 'orthogonalCurved', label: 'Smooth', icon: '╮' },
];

/** Arrowhead types grouped by category. */
const ARROWHEAD_GROUPS = [
  {
    label: 'Standard',
    types: [
      { value: 'none', label: 'None' },
      { value: 'classic', label: '▶ Classic' },
      { value: 'open', label: '▷ Open' },
      { value: 'block', label: '■ Block' },
      { value: 'oval', label: '● Oval' },
      { value: 'diamond', label: '◆ Diamond' },
    ],
  },
  {
    label: 'ER Diagram',
    types: [
      { value: 'ERone', label: '│ One' },
      { value: 'ERmany', label: '❯ Many' },
      { value: 'ERmandOne', label: '║ Mand. One' },
      { value: 'ERoneToMany', label: '│❯ One→Many' },
      { value: 'ERzeroToOne', label: 'o│ Zero→One' },
      { value: 'ERzeroToMany', label: 'o❯ Zero→Many' },
    ],
  },
  {
    label: 'Other',
    types: [
      { value: 'openAsync', label: '⟩ Async' },
      { value: 'dash', label: '— Dash' },
      { value: 'cross', label: '✕ Cross' },
      { value: 'halfCircle', label: '◗ Half Circle' },
    ],
  },
] as const;

// ── Style constants ────────────────────────────────────────

const FLOATING_PANEL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--bg-panel, #ffffff)',
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  border: '1px solid var(--border, #e0e0e0)',
  padding: 8,
  zIndex: 50,
  width: PANEL_WIDTH,
  fontSize: 11,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  pointerEvents: 'auto',
};

const PANEL_HEADER_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-secondary, #555)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 6,
  cursor: 'grab',
  userSelect: 'none',
  padding: '2px 0',
};

const SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '3px 4px',
  borderRadius: 4,
  border: '1px solid var(--border, #ccc)',
  backgroundColor: 'var(--bg-panel, #fff)',
  color: 'var(--text-primary, #333)',
  fontSize: 10,
  cursor: 'pointer',
};

const COMPACT_SELECT_STYLE: React.CSSProperties = {
  ...SELECT_STYLE,
  padding: '2px 2px',
  fontSize: 10,
};

const INLINE_LABEL_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 9,
  fontWeight: 500,
  color: 'var(--text-secondary, #777)',
};

const CHECKBOX_LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  cursor: 'pointer',
  color: 'var(--text-primary, #333)',
};

// ── Helpers ────────────────────────────────────────────────

/** Calculate the visual midpoint of an arrow from its points array. */
function getArrowMidpoint(points: [number, number][]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0]![0], y: points[0]![1] };

  const midIdx = Math.floor(points.length / 2);
  const p1 = points[midIdx - 1] ?? points[0]!;
  const p2 = points[midIdx] ?? points[points.length - 1]!;

  return {
    x: (p1![0] + p2![0]) / 2,
    y: (p1![1] + p2![1]) / 2,
  };
}

/** Clamp a panel position so it stays within viewport bounds. */
function clampPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, viewportWidth - PANEL_WIDTH - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, viewportHeight - PANEL_HEIGHT - VIEWPORT_MARGIN)),
  };
}

/** Resolve arrowhead value to a normalized string type. */
function resolveArrowheadType(val: string | boolean | undefined): string {
  if (val === true) return 'classic';
  if (val === false || val === undefined) return 'none';
  if (val === 'triangle') return 'classic';
  return val;
}

// ── Component ──────────────────────────────────────────────

/**
 * Floating connector panel — compact controls positioned near the selected arrow.
 *
 * Renders routing mode, arrowhead, and edge property controls in a compact
 * floating panel that follows the selected arrow on the canvas.
 */
export function FloatingConnectorPanel() {
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const expressions = useCanvasStore((s) => s.expressions);
  const camera = useCanvasStore((s) => s.camera);
  const updateArrowData = useCanvasStore((s) => s.updateArrowData);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const defaultArrowStyle = useCanvasStore((s) => s.defaultArrowStyle);
  const setDefaultArrowStyle = useCanvasStore((s) => s.setDefaultArrowStyle);

  // ── Drag state (ephemeral — not persisted to canvas state) ──
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);
  const prevSelectedIdRef = useRef<string | undefined>(undefined);

  // Determine mode
  const isDrawingMode = selectedIds.size === 0 && activeTool === 'arrow';
  const firstSelectedId = selectedIds.size > 0 ? [...selectedIds][0]! : undefined;
  const firstExpr = firstSelectedId ? expressions[firstSelectedId] : undefined;
  const isArrowSelected = !isDrawingMode && firstExpr &&
    (firstExpr.kind === 'arrow' || firstExpr.kind === 'line');

  // Reset drag offset when a different arrow is selected [CLEAN-CODE]
  useEffect(() => {
    prevSelectedIdRef.current = firstSelectedId;
    setDragOffset(null);
  }, [firstSelectedId]);

  // ── Drag event handlers ──

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offsetX: dragOffset?.x ?? 0,
      offsetY: dragOffset?.y ?? 0,
    };
  }, [dragOffset]);

  useEffect(() => {
    if (!isDragging) return;

    function handleMouseMove(e: MouseEvent) {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setDragOffset({
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      });
    }

    function handleMouseUp() {
      setIsDragging(false);
      dragStartRef.current = null;
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Only show for arrow/line selection or arrow drawing mode
  if (!isArrowSelected && !isDrawingMode) return null;

  // Read arrow data
  const arrowData = isArrowSelected ? (firstExpr!.data as ArrowData) : null;

  // Current values (from expression or defaults)
  const currentRouting: RoutingMode = isArrowSelected
    ? (arrowData?.routing ?? 'straight')
    : defaultArrowStyle.routing;

  const startArrowheadType = isArrowSelected
    ? resolveArrowheadType(arrowData?.startArrowhead)
    : resolveArrowheadType(defaultArrowStyle.startArrowhead);

  const endArrowheadType = isArrowSelected
    ? resolveArrowheadType(arrowData?.endArrowhead)
    : resolveArrowheadType(defaultArrowStyle.endArrowhead);

  const currentCurved = isArrowSelected ? (arrowData?.curved ?? false) : false;
  const currentRounded = isArrowSelected ? (arrowData?.rounded ?? false) : false;

  // Calculate panel position
  let panelX: number;
  let panelY: number;

  if (isArrowSelected && arrowData?.points && arrowData.points.length >= 2) {
    // Position near arrow midpoint
    const midWorld = getArrowMidpoint(arrowData.points);
    const midScreen = worldToScreen(midWorld.x, midWorld.y, camera);
    panelX = midScreen.x + PANEL_OFFSET_X;
    panelY = midScreen.y + PANEL_OFFSET_Y;
  } else {
    // Drawing mode: static position near bottom-center
    panelX = (typeof window !== 'undefined' ? window.innerWidth : 1024) / 2 - PANEL_WIDTH / 2;
    panelY = (typeof window !== 'undefined' ? window.innerHeight : 768) - PANEL_HEIGHT - 60;
  }

  // Clamp to viewport
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

  // Apply drag offset before clamping [CLEAN-CODE]
  const finalX = panelX + (dragOffset?.x ?? 0);
  const finalY = panelY + (dragOffset?.y ?? 0);
  const clamped = clampPosition(finalX, finalY, viewportWidth, viewportHeight);

  // ── Event handlers ──

  function handleRoutingChange(mode: RoutingMode) {
    if (isDrawingMode) {
      setDefaultArrowStyle({ routing: mode });
    } else if (firstSelectedId) {
      updateArrowData(firstSelectedId, { routing: mode });
    }
  }

  function handleArrowheadChange(end: 'start' | 'end', type: string) {
    if (isDrawingMode) {
      if (end === 'start') {
        setDefaultArrowStyle({ startArrowhead: type as typeof defaultArrowStyle.startArrowhead });
      } else {
        setDefaultArrowStyle({ endArrowhead: type as typeof defaultArrowStyle.endArrowhead });
      }
    } else if (firstSelectedId) {
      updateArrowData(firstSelectedId, {
        [end === 'start' ? 'startArrowhead' : 'endArrowhead']: type,
      });
    }
  }

  function handleEdgeToggle(prop: 'curved' | 'rounded', value: boolean) {
    if (firstSelectedId && isArrowSelected) {
      updateArrowData(firstSelectedId, { [prop]: value });
    }
  }

  return (
    <div
      data-testid="floating-connector-panel"
      role="region"
      aria-label="Connector controls"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        ...FLOATING_PANEL_STYLE,
        position: 'absolute',
        left: `${clamped.x}px`,
        top: `${clamped.y}px`,
      }}
    >
      <p
        data-testid="connector-drag-handle"
        onMouseDown={handleDragStart}
        style={{
          ...PANEL_HEADER_STYLE,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        Connector
      </p>

      {/* Routing mode dropdown */}
      <select
        data-testid="routing-mode-select"
        value={currentRouting}
        onChange={(e) => handleRoutingChange(e.target.value as RoutingMode)}
        style={SELECT_STYLE}
        aria-label="Routing mode"
      >
        {ROUTING_MODES.map(({ value, label, icon }) => (
          <option key={value} value={value}>
            {icon} {label}
          </option>
        ))}
      </select>

      {/* Arrowheads — two selects side by side */}
      <div data-testid="arrowhead-row" style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={INLINE_LABEL_STYLE}>Start</p>
          <select
            data-testid="start-arrowhead-select"
            value={startArrowheadType}
            onChange={(e) => handleArrowheadChange('start', e.target.value)}
            style={COMPACT_SELECT_STYLE}
            aria-label="Start arrowhead"
          >
            {ARROWHEAD_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={INLINE_LABEL_STYLE}>End</p>
          <select
            data-testid="end-arrowhead-select"
            value={endArrowheadType}
            onChange={(e) => handleArrowheadChange('end', e.target.value)}
            style={COMPACT_SELECT_STYLE}
            aria-label="End arrowhead"
          >
            {ARROWHEAD_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Edge Properties — Smooth/Rounded only for orthogonal routing */}
      {isArrowSelected && (currentRouting === 'orthogonal' || currentRouting === 'orthogonalCurved') && (
        <div data-testid="edge-properties-row" style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <label style={CHECKBOX_LABEL_STYLE}>
            <input
              type="checkbox"
              checked={currentCurved}
              onChange={(e) => handleEdgeToggle('curved', e.target.checked)}
            />
            Smooth
          </label>
          <label style={CHECKBOX_LABEL_STYLE}>
            <input
              type="checkbox"
              checked={currentRounded}
              onChange={(e) => handleEdgeToggle('rounded', e.target.checked)}
            />
            Rounded
          </label>
        </div>
      )}
      {/* Spacing — shown for all non-straight routing modes (self-loops need it for loop size) */}
      {isArrowSelected && currentRouting && currentRouting !== 'straight' && (
        <div data-testid="spacing-row" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <label style={CHECKBOX_LABEL_STYLE}>
            Spacing
            <input
              type="number"
              min={0}
              max={9999}
              value={isArrowSelected ? (typeof arrowData?.jettySize === 'number' ? arrowData.jettySize : 20) : 20}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && isArrowSelected && firstExpr) {
                  updateArrowData(firstExpr.id, { jettySize: Math.max(0, val) });
                }
              }}
              style={{ width: 50, marginLeft: 4, padding: '2px 4px', fontSize: 12 }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
