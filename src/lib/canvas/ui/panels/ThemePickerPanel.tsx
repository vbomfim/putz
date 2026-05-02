/**
 * ThemePickerPanel — one-click professional color themes for canvas expressions.
 *
 * Displays a dropdown-style panel with theme previews (color swatches).
 * Supports applying themes to all expressions or only selected ones.
 * Uses the existing `applyTheme` store action.
 *
 * @module
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Palette } from "lucide-react";
import { useCanvasStore, THEME_PRESETS } from "../../engine";
import type { ThemePreset } from "../../engine";

// ── Inline style constants ─────────────────────────────────

const BUTTON_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  backgroundColor: "#ffffff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  color: "#333333",
  whiteSpace: "nowrap",
};

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  marginTop: 6,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 8,
  backgroundColor: "#ffffff",
  borderRadius: 10,
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
  border: "1px solid #e0e0e0",
  zIndex: 30,
  minWidth: 220,
  maxHeight: 360,
  overflowY: "auto",
  fontSize: 12,
};

const THEME_ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 6,
  cursor: "pointer",
  border: "1px solid transparent",
  backgroundColor: "transparent",
  width: "100%",
  textAlign: "left",
};

const SWATCH_CONTAINER_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 2,
  flexShrink: 0,
};

const SCOPE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 4,
  padding: "4px 8px 0",
  borderTop: "1px solid #eee",
  marginTop: 2,
};

const SCOPE_BUTTON_STYLE: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 8px",
  borderRadius: 4,
  cursor: "pointer",
  border: "1px solid #ddd",
  backgroundColor: "transparent",
  color: "#666",
};

// ── Color swatch component ─────────────────────────────────

function ThemeSwatch({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 3,
        backgroundColor: color,
        border: "1px solid rgba(0,0,0,0.15)",
      }}
    />
  );
}

// ── Theme item component ───────────────────────────────────

function ThemeItem({
  theme,
  onApply,
}: {
  theme: ThemePreset;
  onApply: (themeId: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="theme-item"
      data-theme-id={theme.id}
      style={THEME_ITEM_STYLE}
      title={theme.description}
      onClick={() => onApply(theme.id)}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#f5f5f5";
        e.currentTarget.style.borderColor = "#ddd";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <div style={SWATCH_CONTAINER_STYLE}>
        <ThemeSwatch color={theme.colors.primary} />
        <ThemeSwatch color={theme.colors.secondary} />
        <ThemeSwatch color={theme.colors.accent} />
        <ThemeSwatch color={theme.colors.stroke} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{theme.name}</div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>
          {theme.description}
        </div>
      </div>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────

/** Theme picker panel — one-click professional color themes. */
export function ThemePickerPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const panelRef = useRef<HTMLDivElement>(null);
  const applyTheme = useCanvasStore((s) => s.applyTheme);
  const selectedCount = useCanvasStore((s) => s.selectedIds.size);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleApply = useCallback(
    (themeId: string) => {
      applyTheme(themeId, scope);
      setIsOpen(false);
    },
    [applyTheme, scope],
  );

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="theme-picker-button"
        style={BUTTON_STYLE}
        title="Apply color theme"
        aria-label="Theme picker"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Palette size={16} />
        <span>Themes</span>
      </button>

      {isOpen && (
        <div
          data-testid="theme-picker-panel"
          style={PANEL_STYLE}
          role="menu"
          aria-label="Color themes"
        >
          <div
            style={{
              padding: "2px 8px 4px",
              fontWeight: 600,
              fontSize: 11,
              color: "#555",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Color Themes
          </div>

          {THEME_PRESETS.map((theme) => (
            <ThemeItem key={theme.id} theme={theme} onApply={handleApply} />
          ))}

          {/* Scope toggle — show only when expressions are selected */}
          {selectedCount > 0 && (
            <div style={SCOPE_ROW_STYLE}>
              <button
                type="button"
                data-testid="theme-scope-all"
                style={{
                  ...SCOPE_BUTTON_STYLE,
                  backgroundColor: scope === "all" ? "#e7f0fd" : "transparent",
                  fontWeight: scope === "all" ? 600 : 400,
                }}
                onClick={() => setScope("all")}
              >
                All
              </button>
              <button
                type="button"
                data-testid="theme-scope-selected"
                style={{
                  ...SCOPE_BUTTON_STYLE,
                  backgroundColor:
                    scope === "selected" ? "#e7f0fd" : "transparent",
                  fontWeight: scope === "selected" ? 600 : 400,
                }}
                onClick={() => setScope("selected")}
              >
                Selected ({selectedCount})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
