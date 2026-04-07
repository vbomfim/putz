/**
 * ThemeEditor component — color picker for all 22 terminal colors.
 *
 * Allows users to:
 * - Select a built-in theme as starting point
 * - Edit individual colors with native color pickers
 * - See a live preview of the theme
 * - Save as a new custom theme or update an existing one
 *
 * @module ThemeEditor
 */
import { useState, useCallback, useMemo } from "react";
import type { ThemeColors, Theme } from "./themeTypes";
import { THEME_COLOR_FIELDS } from "./themeTypes";
import "./ThemeEditor.css";

/** Props for the ThemeEditor component. */
interface ThemeEditorProps {
  /** Available themes for the base theme selector. */
  themes: Theme[];
  /** The theme being edited (null for new theme). */
  editingTheme: Theme | null;
  /** Callback when the user saves the theme. */
  onSave: (name: string, colors: ThemeColors) => void;
  /** Callback to close the editor. */
  onCancel: () => void;
}

/** Strips alpha channel for the native color input (which only supports #RRGGBB). */
function toSixDigitHex(color: string): string {
  if (!color || !color.startsWith("#")) return "#000000";
  const hex = color.slice(1);
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (hex.length >= 6) {
    return `#${hex.slice(0, 6)}`;
  }
  return "#000000";
}

export function ThemeEditor({
  themes,
  editingTheme,
  onSave,
  onCancel,
}: ThemeEditorProps) {
  const [name, setName] = useState(editingTheme?.name || "");
  const [colors, setColors] = useState<ThemeColors>(
    editingTheme?.colors || themes[0]?.colors || getDefaultColors(),
  );

  const handleColorChange = useCallback(
    (key: keyof ThemeColors, value: string) => {
      setColors((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleBaseThemeChange = useCallback(
    (themeId: string) => {
      const theme = themes.find((t) => t.id === themeId);
      if (theme) {
        setColors({ ...theme.colors });
        if (!name) {
          setName("");
        }
      }
    },
    [themes, name],
  );

  const handleSave = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSave(trimmedName, colors);
  }, [name, colors, onSave]);

  const isValid = name.trim().length > 0;

  const colorGroups = useMemo(() => {
    const terminal = THEME_COLOR_FIELDS.filter(
      (f) => f.group === "terminal",
    );
    const ansi = THEME_COLOR_FIELDS.filter((f) => f.group === "ansi");
    const ansiBright = THEME_COLOR_FIELDS.filter(
      (f) => f.group === "ansi-bright",
    );
    return { terminal, ansi, ansiBright };
  }, []);

  return (
    <div className="theme-editor" data-testid="theme-editor">
      <h3 className="theme-editor-title">
        {editingTheme ? "Edit Theme" : "New Theme"}
      </h3>

      <div className="theme-editor-field">
        <label htmlFor="theme-name">Theme Name</label>
        <input
          id="theme-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Custom Theme"
          maxLength={200}
          data-testid="theme-name-input"
        />
      </div>

      {!editingTheme && (
        <div className="theme-editor-field">
          <label htmlFor="base-theme">Start from</label>
          <select
            id="base-theme"
            onChange={(e) => handleBaseThemeChange(e.target.value)}
            data-testid="base-theme-select"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Live Preview */}
      <div
        className="theme-editor-preview"
        style={{
          backgroundColor: colors.background,
          color: colors.foreground,
        }}
        data-testid="theme-preview"
      >
        <div className="preview-line">
          <span style={{ color: colors.green }}>user@host</span>
          <span style={{ color: colors.white }}>:</span>
          <span style={{ color: colors.blue }}>~/project</span>
          <span style={{ color: colors.white }}>$ </span>
          <span style={{ color: colors.foreground }}>ls -la</span>
        </div>
        <div className="preview-line">
          <span style={{ color: colors.yellow }}>drwxr-xr-x</span>
          <span style={{ color: colors.foreground }}> 5 user group </span>
          <span style={{ color: colors.cyan }}>src/</span>
        </div>
        <div className="preview-line">
          <span style={{ color: colors.red }}>-rw-r--r--</span>
          <span style={{ color: colors.foreground }}> 1 user group </span>
          <span style={{ color: colors.magenta }}>README.md</span>
        </div>
        <div
          className="preview-cursor"
          style={{
            backgroundColor: colors.cursor,
            color: colors.cursorAccent,
          }}
        >
          █
        </div>
      </div>

      {/* Color Groups */}
      <div className="theme-editor-colors">
        <fieldset className="color-group">
          <legend>Terminal Colors</legend>
          {colorGroups.terminal.map(({ key, label }) => (
            <div className="color-field" key={key}>
              <label htmlFor={`color-${key}`}>{label}</label>
              <div className="color-input-wrapper">
                <input
                  id={`color-${key}`}
                  type="color"
                  value={toSixDigitHex(colors[key])}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  data-testid={`color-${key}`}
                />
                <input
                  type="text"
                  value={colors[key]}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="color-text-input"
                  aria-label={`${label} hex value`}
                />
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset className="color-group">
          <legend>ANSI Colors</legend>
          {colorGroups.ansi.map(({ key, label }) => (
            <div className="color-field" key={key}>
              <label htmlFor={`color-${key}`}>{label}</label>
              <div className="color-input-wrapper">
                <input
                  id={`color-${key}`}
                  type="color"
                  value={toSixDigitHex(colors[key])}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  data-testid={`color-${key}`}
                />
                <input
                  type="text"
                  value={colors[key]}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="color-text-input"
                  aria-label={`${label} hex value`}
                />
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset className="color-group">
          <legend>Bright ANSI Colors</legend>
          {colorGroups.ansiBright.map(({ key, label }) => (
            <div className="color-field" key={key}>
              <label htmlFor={`color-${key}`}>{label}</label>
              <div className="color-input-wrapper">
                <input
                  id={`color-${key}`}
                  type="color"
                  value={toSixDigitHex(colors[key])}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  data-testid={`color-${key}`}
                />
                <input
                  type="text"
                  value={colors[key]}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="color-text-input"
                  aria-label={`${label} hex value`}
                />
              </div>
            </div>
          ))}
        </fieldset>
      </div>

      <div className="theme-editor-actions">
        <button
          type="button"
          onClick={onCancel}
          className="btn-cancel"
          data-testid="theme-cancel-btn"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="btn-save"
          disabled={!isValid}
          data-testid="theme-save-btn"
        >
          {editingTheme ? "Update Theme" : "Save Theme"}
        </button>
      </div>
    </div>
  );
}

/** Fallback default colors if no themes are loaded. */
function getDefaultColors(): ThemeColors {
  return {
    foreground: "#e0e0e0",
    background: "#1a1a2e",
    cursor: "#e0e0e0",
    cursorAccent: "#1a1a2e",
    selectionBackground: "#0f346080",
    selectionForeground: "",
    black: "#1a1a2e",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#e0e0e0",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  };
}
