/**
 * MorphContextMenu — "View as..." context menu for morphing expressions.
 *
 * Renders a positioned context menu showing compatible morph targets
 * for the selected composite expression. Clicking a target triggers
 * the morph callback.
 *
 * Returns null if the expression has no valid morph targets.
 *
 * @module
 */

import { getMorphTargets } from '../../engine';
import type { VisualExpression, ExpressionKind } from '../../protocol';

/** Props for the MorphContextMenu component. */
export interface MorphContextMenuProps {
  /** The expression to show morph targets for. */
  expression: VisualExpression;
  /** Screen coordinates where the menu should appear. */
  position: { x: number; y: number };
  /** Callback when a morph target is selected. */
  onMorph: (expressionId: string, toKind: ExpressionKind) => void;
  /** Callback to close the menu. */
  onClose: () => void;
}

/** Human-readable display names for expression kinds. */
const KIND_LABELS: Record<string, string> = {
  'flowchart': 'Flowchart',
  'table': 'Table',
  'roadmap': 'Roadmap',
  'kanban': 'Kanban',
  'mind-map': 'Mind Map',
  'reasoning-chain': 'Reasoning Chain',
  'sequence-diagram': 'Sequence Diagram',
  'wireframe': 'Wireframe',
  'decision-tree': 'Decision Tree',
  'collaboration-diagram': 'Collaboration Diagram',
  'slide': 'Slide',
  'code-block': 'Code Block',
};

/** Get human-readable label for an expression kind. */
function getKindLabel(kind: ExpressionKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Context menu showing "View as..." morph targets.
 *
 * Renders a floating menu at the given position with compatible
 * morph targets. Returns null if no targets are available.
 */
export function MorphContextMenu({
  expression,
  position,
  onMorph,
  onClose,
}: MorphContextMenuProps) {
  const targets = getMorphTargets(expression.kind);

  if (targets.length === 0) {
    return null;
  }

  function handleClick(toKind: ExpressionKind): void {
    onMorph(expression.id, toKind);
    onClose();
  }

  return (
    <div
      data-testid="morph-menu"
      role="menu"
      aria-label="View as"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e0e0e0',
        padding: '4px 0',
        minWidth: 160,
        zIndex: 1000,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          borderBottom: '1px solid #eee',
        }}
      >
        View as...
      </div>

      {/* Morph target options */}
      {targets.map((targetKind) => (
        <button
          key={targetKind}
          type="button"
          role="menuitem"
          aria-label={`View as ${getKindLabel(targetKind)}`}
          onClick={() => handleClick(targetKind)}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 12px',
            border: 'none',
            backgroundColor: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: 14,
            color: '#333',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.backgroundColor = '#f0f4ff';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          {getKindLabel(targetKind)}
        </button>
      ))}
    </div>
  );
}
