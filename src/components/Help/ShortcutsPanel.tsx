/**
 * ShortcutsPanel — Modal showing all keyboard shortcuts.
 *
 * Displays shortcuts in a categorized table. Opened via
 * Help → Keyboard Shortcuts or Ctrl+Shift+?.
 * Closes on Escape key or clicking the backdrop.
 *
 * @module ShortcutsPanel
 */
import { useEffect, useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import "./ShortcutsPanel.css";

/** A single keyboard shortcut entry. */
interface ShortcutEntry {
  action: string;
  keys: string;
}

/** A group of shortcuts under a category heading. */
interface ShortcutCategory {
  category: string;
  shortcuts: ShortcutEntry[];
}

/** All keyboard shortcuts organized by category. */
export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    category: "Tabs",
    shortcuts: [
      { action: "New Terminal", keys: "Ctrl+T" },
      { action: "Close Tab", keys: "Ctrl+Shift+W" },
      { action: "Next Tab", keys: "Ctrl+Tab" },
      { action: "Previous Tab", keys: "Ctrl+Shift+Tab" },
      { action: "Go to Tab 1–9", keys: "Ctrl+1–9" },
    ],
  },
  {
    category: "Panes",
    shortcuts: [
      { action: "Split Vertical", keys: "Ctrl+Shift+E" },
      { action: "Split Horizontal", keys: "Ctrl+Shift+D" },
    ],
  },
  {
    category: "Terminal",
    shortcuts: [{ action: "New Terminal", keys: "Ctrl+N" }],
  },
  {
    category: "Terminal Input",
    shortcuts: [
      { action: "Insert newline (no submit)", keys: "Ctrl+Enter" },
      { action: "Insert newline (no submit)", keys: "Shift+Enter" },
      { action: "Insert newline (no submit)", keys: "Alt+Enter" },
    ],
  },
  {
    category: "Edit",
    shortcuts: [
      { action: "Copy", keys: "Ctrl+Shift+C" },
      { action: "Paste", keys: "Ctrl+Shift+V" },
      { action: "Find", keys: "Ctrl+F" },
      { action: "Preferences", keys: "Ctrl+," },
    ],
  },
  {
    category: "View",
    shortcuts: [
      { action: "Toggle Highlighting", keys: "Ctrl+Shift+H" },
      { action: "Toggle Broadcast", keys: "Ctrl+Shift+A" },
      { action: "Zoom In", keys: "Ctrl+=" },
      { action: "Zoom Out", keys: "Ctrl+-" },
      { action: "Reset Zoom", keys: "Ctrl+0" },
      { action: "Full Screen", keys: "F11" },
    ],
  },
  {
    category: "Window",
    shortcuts: [
      { action: "Pop Out Tab", keys: "Ctrl+Shift+P" },
      { action: "Next Tab", keys: "Ctrl+Tab" },
      { action: "Previous Tab", keys: "Ctrl+Shift+Tab" },
    ],
  },
  {
    category: "Help",
    shortcuts: [{ action: "Keyboard Shortcuts", keys: "Ctrl+Shift+?" }],
  },
];

/** ShortcutsPanel component — modal overlay with keyboard shortcuts. */
export function ShortcutsPanel() {
  const isOpen = useSettingsStore((s) => s.shortcutsPanelOpen);
  const close = useSettingsStore((s) => s.setShortcutsPanelOpen);

  const handleClose = useCallback(() => {
    close(false);
  }, [close]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="shortcuts-panel__backdrop"
      onClick={handleClose}
      data-testid="shortcuts-panel-backdrop"
      role="presentation"
    >
      <div
        className="shortcuts-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard Shortcuts"
        aria-modal="true"
        data-testid="shortcuts-panel"
      >
        <div className="shortcuts-panel__header">
          <h2 className="shortcuts-panel__title">Keyboard Shortcuts</h2>
          <button
            className="shortcuts-panel__close"
            onClick={handleClose}
            type="button"
            aria-label="Close shortcuts panel"
            data-testid="shortcuts-panel-close"
          >
            ✕
          </button>
        </div>

        <div className="shortcuts-panel__body">
          {SHORTCUT_CATEGORIES.map((cat) => (
            <div key={cat.category} className="shortcuts-panel__category">
              <h3 className="shortcuts-panel__category-title">
                {cat.category}
              </h3>
              <table className="shortcuts-panel__table">
                <tbody>
                  {cat.shortcuts.map((shortcut) => (
                    <tr key={`${shortcut.action}-${shortcut.keys}`} className="shortcuts-panel__row">
                      <td className="shortcuts-panel__action">
                        {shortcut.action}
                      </td>
                      <td className="shortcuts-panel__keys">
                        <kbd>{shortcut.keys}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="shortcuts-panel__footer">
          <p className="shortcuts-panel__note">
            On macOS, use ⌘ (Cmd) instead of Ctrl
          </p>
        </div>
      </div>
    </div>
  );
}
