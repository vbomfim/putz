/**
 * ShortcutsHelpPanel — overlay displaying all keyboard shortcuts.
 *
 * Toggled via the `?` key. Dismissible with Escape or clicking outside.
 * Renders a modal overlay with a table of all available shortcuts.
 *
 * @module
 */

import React from 'react';

// ── Types ──────────────────────────────────────────────────

interface ShortcutsHelpPanelProps {
  /** Called when the panel should close (Escape, click outside, close button). */
  onClose: () => void;
}

// ── Shortcut data ──────────────────────────────────────────

interface ShortcutEntry {
  keys: string;
  description: string;
}

const TOOL_SHORTCUTS: ShortcutEntry[] = [
  { keys: 'V / 1', description: 'Select' },
  { keys: 'R / 2', description: 'Rectangle' },
  { keys: 'O / 3', description: 'Ellipse' },
  { keys: 'D / 4', description: 'Diamond' },
  { keys: 'L / 5', description: 'Line' },
  { keys: 'A / 6', description: 'Arrow' },
  { keys: 'P / 7', description: 'Freehand' },
  { keys: 'T / 8', description: 'Text' },
];

const ACTION_SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl+Z', description: 'Undo' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', description: 'Redo' },
  { keys: 'Ctrl+D', description: 'Duplicate selected' },
  { keys: 'Ctrl+A', description: 'Select All' },
  { keys: "Ctrl+'", description: 'Toggle grid' },
  { keys: 'Delete / Backspace', description: 'Delete selected' },
  { keys: 'Ctrl+Shift+\'', description: 'Toggle snap to grid' },
  { keys: 'Escape', description: 'Cancel / Deselect' },
  { keys: '?', description: 'Toggle this panel' },
];

// ── Component ──────────────────────────────────────────────

/**
 * Modal overlay showing all keyboard shortcuts in a categorized table.
 *
 * Dismissible by clicking the backdrop, pressing the close button,
 * or pressing Escape (handled by the parent hook).
 */
export function ShortcutsHelpPanel({ onClose }: ShortcutsHelpPanelProps) {
  return (
    <div
      data-testid="shortcuts-backdrop"
      onClick={onClose}
      style={styles.backdrop}
    >
      <div
        data-testid="shortcuts-panel"
        onClick={(e) => e.stopPropagation()}
        style={styles.panel}
      >
        <div style={styles.header}>
          <h2 style={styles.title}>Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="close"
            style={styles.closeButton}
          >
            ✕
          </button>
        </div>

        <div style={styles.content}>
          <ShortcutSection title="Tools" shortcuts={TOOL_SHORTCUTS} />
          <ShortcutSection title="Actions" shortcuts={ACTION_SHORTCUTS} />
          <p style={styles.note}>
            On Mac, use <strong>⌘ Cmd</strong> instead of <strong>Ctrl</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function ShortcutSection({
  title,
  shortcuts,
}: {
  title: string;
  shortcuts: ShortcutEntry[];
}) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Shortcut</th>
            <th style={styles.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((shortcut) => (
            <tr key={shortcut.keys}>
              <td style={styles.keyCell}>
                <kbd style={styles.kbd}>{shortcut.keys}</kbd>
              </td>
              <td style={styles.descCell}>{shortcut.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '480px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#1a1a1a',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#666',
    lineHeight: 1,
  },
  content: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    color: '#333',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '0 0 8px 0',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: '1px solid #eee',
    fontSize: '12px',
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase' as const,
  },
  keyCell: {
    padding: '6px 8px',
    borderBottom: '1px solid #f5f5f5',
    whiteSpace: 'nowrap' as const,
  },
  descCell: {
    padding: '6px 8px',
    borderBottom: '1px solid #f5f5f5',
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '3px',
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#333',
  },
  note: {
    fontSize: '12px',
    color: '#888',
    marginTop: '12px',
    fontStyle: 'italic',
  },
};
