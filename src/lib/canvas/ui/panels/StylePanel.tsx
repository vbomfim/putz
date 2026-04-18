/**
 * StylePanel — style controls for selected expressions and pre-draw defaults.
 *
 * Works in two modes:
 * 1. **Selection mode** — when expressions are selected, shows/edits their styles
 *    via `styleExpressions`.
 * 2. **Drawing mode** — when a drawing tool is active and nothing is selected,
 *    shows/edits `lastUsedStyle` so users can pick styles before drawing.
 *
 * Connector controls (routing, arrowheads, edge properties) are handled by
 * the FloatingConnectorPanel component, which positions near the selected arrow.
 *
 * @module
 */

import { useCanvasStore } from '../../engine';
import { DEFAULT_EXPRESSION_STYLE } from '../../protocol';
import type { ExpressionStyle } from '../../protocol';

// ── Color palette ──────────────────────────────────────────

/** Preset color palette — 8 expressive colors. */
const COLOR_PALETTE = [
  '#1e1e1e', // Black
  '#e03131', // Red
  '#1971c2', // Blue
  '#2f9e44', // Green
  '#f59f00', // Yellow
  '#e8590c', // Orange
  '#9c36b5', // Purple
  '#868e96', // Gray
  '#ffffff', // White
] as const;

/** Stroke width presets. */
const STROKE_WIDTHS = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Normal' },
  { value: 4, label: 'Thick' },
] as const;

/** Fill style options. */
const FILL_STYLES = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'hachure', label: 'Hachure' },
  { value: 'cross-hatch', label: 'Cross-hatch' },
] as const;

/** Stroke style options. */
const STROKE_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
] as const;

// ── Inline style constants ─────────────────────────────────

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  backgroundColor: '#ffffff',
  borderRadius: 10,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
  border: '1px solid #e0e0e0',
  zIndex: 20,
  width: 200,
  maxHeight: '80vh',
  overflowY: 'auto',
  fontSize: 12,
};

const SECTION_LABEL_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  color: '#555555',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const SWATCH_GRID_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const RADIO_GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
};

const SLIDER_STYLE: React.CSSProperties = {
  width: '100%',
  cursor: 'pointer',
};

/** Swatch button base style. */
function swatchStyle(
  color: string,
  isActive: boolean,
  isTransparent = false,
): React.CSSProperties {
  return {
    width: 20,
    height: 20,
    borderRadius: 4,
    border: isActive ? '2px solid #4A90D9' : '1px solid #cccccc',
    cursor: 'pointer',
    backgroundColor: isTransparent ? 'transparent' : color,
    backgroundImage: isTransparent
      ? 'repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%)'
      : undefined,
    backgroundSize: isTransparent ? '8px 8px' : undefined,
    padding: 0,
    outline: isActive ? '1px solid #4A90D9' : 'none',
    outlineOffset: 1,
  };
}

/** Radio button label style. */
function radioLabelStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #cccccc',
    cursor: 'pointer',
    backgroundColor: isActive ? '#e7f0fd' : 'transparent',
    fontSize: 11,
  };
}

// ── Component ──────────────────────────────────────────────

/** Style panel for editing selected expression styles or pre-draw defaults. */
export function StylePanel() {
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const expressions = useCanvasStore((s) => s.expressions);
  const styleExpressions = useCanvasStore((s) => s.styleExpressions);
  const activeTool = useCanvasStore((s) => s.activeTool);
  const lastUsedStyle = useCanvasStore((s) => s.lastUsedStyle);
  const setLastUsedStyle = useCanvasStore((s) => s.setLastUsedStyle);

  // Drawing mode: tool active + nothing selected → show lastUsedStyle
  const isDrawingMode = selectedIds.size === 0 && activeTool !== 'select';

  // Hide when Select tool active and nothing selected
  if (selectedIds.size === 0 && activeTool === 'select') return null;

  // Get the style of the first selected expression as reference
  const firstSelectedId = selectedIds.size > 0 ? [...selectedIds][0]! : undefined;
  const firstExpr = firstSelectedId ? expressions[firstSelectedId] : undefined;

  // In selection mode, bail if expression not found
  if (!isDrawingMode && !firstExpr) return null;

  const rawStyle = isDrawingMode ? lastUsedStyle : firstExpr!.style;
  // Merge with defaults so optional fields (fontFamily, fontSize) have values
  const currentStyle: ExpressionStyle = {
    ...DEFAULT_EXPRESSION_STYLE,
    ...rawStyle,
  };

  /** Apply a partial style — routes to correct handler per mode. */
  function applyStyle(style: Partial<ExpressionStyle>) {
    if (isDrawingMode) {
      setLastUsedStyle(style);
    } else {
      styleExpressions([...selectedIds], style);
    }
  }

  return (
    <div data-testid="style-panel" style={PANEL_STYLE} role="region" aria-label="Style panel">
      {/* ── Stroke Color ── */}
      <Section label="Stroke">
        <div style={SWATCH_GRID_STYLE}>
          {COLOR_PALETTE.map((color) => (
            <button
              key={`stroke-${color}`}
              type="button"
              data-testid="stroke-color-swatch"
              data-color={color}
              title={color}
              aria-label={`Stroke color ${color}`}
              aria-pressed={currentStyle.strokeColor === color}
              style={swatchStyle(color, currentStyle.strokeColor === color)}
              onClick={() => applyStyle({ strokeColor: color })}
            />
          ))}
        </div>
        <input
          type="color"
          data-testid="stroke-color-input"
          value={currentStyle.strokeColor}
          aria-label="Custom stroke color"
          onChange={(e) => applyStyle({ strokeColor: e.target.value })}
          style={{ width: '100%', height: 24, border: 'none', cursor: 'pointer', marginTop: 4 }}
        />
      </Section>

      {/* ── Fill Color ── */}
      <Section label="Fill">
        <div style={SWATCH_GRID_STYLE}>
          {/* Transparent option */}
          <button
            type="button"
            data-testid="fill-color-swatch"
            data-color="transparent"
            title="Transparent"
            aria-label="Fill color transparent"
            aria-pressed={currentStyle.backgroundColor === 'transparent'}
            style={swatchStyle('transparent', currentStyle.backgroundColor === 'transparent', true)}
            onClick={() => applyStyle({ backgroundColor: 'transparent' })}
          />
          {COLOR_PALETTE.map((color) => (
            <button
              key={`fill-${color}`}
              type="button"
              data-testid="fill-color-swatch"
              data-color={color}
              title={color}
              aria-label={`Fill color ${color}`}
              aria-pressed={currentStyle.backgroundColor === color}
              style={swatchStyle(color, currentStyle.backgroundColor === color)}
              onClick={() => applyStyle({ backgroundColor: color })}
            />
          ))}
        </div>
        <input
          type="color"
          data-testid="fill-color-input"
          value={currentStyle.backgroundColor === 'transparent' ? '#ffffff' : currentStyle.backgroundColor}
          aria-label="Custom fill color"
          onChange={(e) => applyStyle({ backgroundColor: e.target.value })}
          style={{ width: '100%', height: 24, border: 'none', cursor: 'pointer', marginTop: 4 }}
        />
      </Section>

      {/* ── Stroke Width ── */}
      <Section label="Stroke width">
        <div style={RADIO_GROUP_STYLE}>
          {STROKE_WIDTHS.map(({ value, label }) => (
            <label key={value} style={radioLabelStyle(currentStyle.strokeWidth === value)}>
              <input
                type="radio"
                name="strokeWidth"
                value={value}
                checked={currentStyle.strokeWidth === value}
                onChange={() => applyStyle({ strokeWidth: value })}
                style={{ display: 'none' }}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* ── Stroke Style ── */}
      <Section label="Stroke style">
        <div style={RADIO_GROUP_STYLE}>
          {STROKE_STYLES.map(({ value, label }) => (
            <label key={value} style={radioLabelStyle((currentStyle.strokeStyle ?? 'solid') === value)}>
              <input
                type="radio"
                name="strokeStyle"
                value={value}
                checked={(currentStyle.strokeStyle ?? 'solid') === value}
                onChange={() => applyStyle({ strokeStyle: value as ExpressionStyle['strokeStyle'] })}
                style={{ display: 'none' }}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* ── Fill Style ── */}
      <Section label="Fill style">
        <div style={RADIO_GROUP_STYLE}>
          {FILL_STYLES.map(({ value, label }) => (
            <label key={value} style={radioLabelStyle(currentStyle.fillStyle === value)}>
              <input
                type="radio"
                name="fillStyle"
                value={value}
                checked={currentStyle.fillStyle === value}
                onChange={() => applyStyle({ fillStyle: value as ExpressionStyle['fillStyle'] })}
                style={{ display: 'none' }}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      {/* ── Roughness ── */}
      <Section label={`Roughness: ${currentStyle.roughness}`}>
        <input
          type="range"
          data-testid="roughness-slider"
          min={0}
          max={3}
          step={0.5}
          value={currentStyle.roughness}
          aria-label="Roughness"
          onChange={(e) => applyStyle({ roughness: parseFloat(e.target.value) })}
          style={SLIDER_STYLE}
        />
      </Section>

      {/* ── Opacity ── */}
      <Section label={`Opacity: ${Math.round(currentStyle.opacity * 100)}%`}>
        <input
          type="range"
          data-testid="opacity-slider"
          min={0.1}
          max={1}
          step={0.1}
          value={currentStyle.opacity}
          aria-label="Opacity"
          onChange={(e) => applyStyle({ opacity: parseFloat(e.target.value) })}
          style={SLIDER_STYLE}
        />
      </Section>

      {/* ── Font Family ── */}
      <Section label="Font">
        <select
          value={currentStyle.fontFamily}
          onChange={(e) => applyStyle({ fontFamily: e.target.value })}
          style={{ width: '100%', padding: '4px', borderRadius: 4, border: '1px solid var(--border, #ccc)', backgroundColor: 'var(--bg-panel, #fff)', color: 'var(--text-primary, #333)' }}
        >
          <option value="Architects Daughter, cursive">✏️ Architects Daughter</option>
          <option value="Caveat, cursive">✏️ Caveat</option>
          <option value="Patrick Hand, cursive">✏️ Patrick Hand</option>
          <option value="Kalam, cursive">✏️ Kalam</option>
          <option value="sans-serif">Sans Serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
        </select>
      </Section>

      {/* ── Font Size ── */}
      <Section label={`Font Size: ${currentStyle.fontSize ?? 16}px`}>
        <input
          type="range"
          min={1}
          max={72}
          step={1}
          value={currentStyle.fontSize ?? 16}
          aria-label="Font size"
          onChange={(e) => applyStyle({ fontSize: parseInt(e.target.value) })}
          style={SLIDER_STYLE}
        />
      </Section>
    </div>
  );
}

// ── Internal sub-components ────────────────────────────────

/** Section wrapper with label. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={SECTION_LABEL_STYLE}>{label}</p>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}
