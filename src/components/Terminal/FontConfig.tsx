/**
 * FontConfig component — font family, size, ligatures, and line height.
 *
 * Provides UI controls for terminal font configuration:
 * - Font family dropdown (common monospace fonts)
 * - Font size slider (8–32px)
 * - Ligature toggle
 * - Line height slider (1.0–2.0)
 *
 * @module FontConfig
 */
import { useCallback } from "react";
import type { FontSettings } from "./themeTypes";
import {
  MONOSPACE_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
} from "./themeTypes";
import "./FontConfig.css";

/** Props for the FontConfig component. */
interface FontConfigProps {
  /** Current font settings. */
  settings: FontSettings;
  /** Callback when any setting changes. */
  onChange: (settings: Partial<FontSettings>) => void;
}

export function FontConfig({ settings, onChange }: FontConfigProps) {
  const handleFamilyChange = useCallback(
    (value: string) => {
      onChange({ fontFamily: value });
    },
    [onChange],
  );

  const handleSizeChange = useCallback(
    (value: number) => {
      onChange({ fontSize: value });
    },
    [onChange],
  );

  const handleLigaturesChange = useCallback(
    (value: boolean) => {
      onChange({ ligatures: value });
    },
    [onChange],
  );

  const handleLineHeightChange = useCallback(
    (value: number) => {
      onChange({ lineHeight: value });
    },
    [onChange],
  );

  return (
    <div className="font-config" data-testid="font-config">
      <h3 className="font-config-title">Font Settings</h3>

      {/* Font Family */}
      <div className="font-config-field">
        <label htmlFor="font-family">Font Family</label>
        <select
          id="font-family"
          value={settings.fontFamily}
          onChange={(e) => handleFamilyChange(e.target.value)}
          data-testid="font-family-select"
        >
          {MONOSPACE_FONTS.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div className="font-config-field">
        <label htmlFor="font-size">
          Font Size: <strong>{settings.fontSize}px</strong>
        </label>
        <input
          id="font-size"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          value={settings.fontSize}
          onChange={(e) => handleSizeChange(Number(e.target.value))}
          data-testid="font-size-slider"
        />
        <div className="slider-labels">
          <span>{FONT_SIZE_MIN}px</span>
          <span>{FONT_SIZE_MAX}px</span>
        </div>
      </div>

      {/* Ligatures */}
      <div className="font-config-field font-config-checkbox">
        <label htmlFor="font-ligatures">
          <input
            id="font-ligatures"
            type="checkbox"
            checked={settings.ligatures}
            onChange={(e) => handleLigaturesChange(e.target.checked)}
            data-testid="font-ligatures-toggle"
          />
          <span>Enable Ligatures</span>
        </label>
        <span className="field-hint">
          Combines characters like {"->"} into →
        </span>
      </div>

      {/* Line Height */}
      <div className="font-config-field">
        <label htmlFor="line-height">
          Line Height: <strong>{settings.lineHeight.toFixed(1)}</strong>
        </label>
        <input
          id="line-height"
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => handleLineHeightChange(Number(e.target.value))}
          data-testid="line-height-slider"
        />
        <div className="slider-labels">
          <span>{LINE_HEIGHT_MIN}</span>
          <span>{LINE_HEIGHT_MAX}</span>
        </div>
      </div>

      {/* Preview */}
      <div
        className="font-config-preview"
        style={{
          fontFamily: settings.fontFamily,
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
          fontFeatureSettings: settings.ligatures
            ? '"liga" 1, "calt" 1'
            : '"liga" 0, "calt" 0',
        }}
        data-testid="font-preview"
      >
        <div>ABCDEfghij 0123456789</div>
        <div>{"=> -> !== === <> |>"}</div>
        <div>The quick brown fox jumps</div>
      </div>
    </div>
  );
}
