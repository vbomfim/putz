/**
 * ThemeToggle — button to switch between light and dark themes.
 *
 * Reads the current theme from uiStore and toggles on click.
 * Applies the theme to the document via data-theme attribute.
 * Uses lucide-react Sun/Moon icons. [CLEAN-CODE]
 *
 * @module
 */

import { useEffect } from "react";
import { useUiStore, applyThemeToDocument } from "../../engine";
import { Sun, Moon } from "lucide-react";

/** Theme toggle button — renders sun (dark→light) or moon (light→dark). */
export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  // Apply theme to document whenever it changes
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Load persisted theme on mount
  useEffect(() => {
    useUiStore.getState().loadPersistedTheme();
  }, []);

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      data-theme={theme}
      onClick={toggleTheme}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        backgroundColor: "transparent",
        color: "var(--text-primary, #333333)",
        transition: "background-color 0.15s, color 0.15s",
      }}
    >
      <Icon size={18} />
    </button>
  );
}
