/**
 * CommandGutter — renders per-command status dots beside the terminal.
 *
 * Subscribes to `useCommandBlockStore` for the current sessionId and
 * renders a colored dot for each command block at the correct vertical
 * position. Only visible when the session is handshaked (shell integration
 * active).
 *
 * Dot colors:
 *  - Green (success): exit code 0
 *  - Red (error): non-zero exit code
 *  - Blue (running): in-progress block (commandEnd === null)
 *  - Grey (unknown): command ended but no exit code reported
 *
 * @module CommandGutter
 * @see https://github.com/vbomfim/putz/issues/103
 * @see specs/modern-terminal-protocols/spec.md
 */
import { useCallback } from "react";
import { useCommandBlockStore } from "../../stores/commandBlockStore";
import type {
  CommandBlock,
  SessionBlockState,
} from "../../stores/commandBlockStore";
import "./CommandGutter.css";

// ---------------------------------------------------------------------------
// Stable empty defaults (same reference every render to avoid infinite loops)
// ---------------------------------------------------------------------------

const EMPTY_BLOCKS: CommandBlock[] = [];
const EMPTY_SESSION: SessionBlockState | undefined = undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandGutterProps {
  /** Session ID to display gutter for. */
  sessionId: string;
  /** Cell height in CSS pixels (from xterm.js dimensions). */
  cellHeight: number;
  /** First visible row in the viewport (absolute row index). */
  viewportTop: number;
  /** Number of visible rows in the viewport. */
  rows: number;
  /** Optional callback when a dot is right-clicked. */
  onDotContextMenu?: (block: CommandBlock, event: React.MouseEvent) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the display row for a block (commandStart preferred, promptStart fallback). */
function getBlockRow(block: CommandBlock): number | null {
  if (block.commandStart) return block.commandStart.row;
  if (block.promptStart) return block.promptStart.row;
  return null;
}

/** Determine the CSS class suffix for a block's status. */
function getStatusClass(block: CommandBlock): string {
  if (block.commandEnd === null) return "gutter-dot--running";
  if (block.exitCode === null) return "gutter-dot--unknown";
  if (block.exitCode === 0) return "gutter-dot--success";
  return "gutter-dot--error";
}

/** Determine the accessible label for a block's status. */
function getStatusLabel(block: CommandBlock): string {
  if (block.commandEnd === null) return "Running";
  if (block.exitCode === null) return "Unknown exit status";
  if (block.exitCode === 0) return "Success (exit 0)";
  return `Failed (exit ${block.exitCode})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Renders per-command status dots in a vertical gutter beside the terminal. */
export function CommandGutter({
  sessionId,
  cellHeight,
  viewportTop,
  rows,
  onDotContextMenu,
}: CommandGutterProps) {
  // Subscribe to the session object — single selector avoids multiple
  // subscriptions and the stable defaults prevent infinite re-render loops
  // when the session doesn't exist yet.
  const session = useCommandBlockStore(
    (state) => state.sessions.get(sessionId) ?? EMPTY_SESSION,
  );
  const blocks = session?.blocks ?? EMPTY_BLOCKS;
  const activeBlock = session?.activeBlock ?? null;
  const isHandshaked = session?.handshaked ?? false;

  const handleContextMenu = useCallback(
    (block: CommandBlock, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDotContextMenu?.(block, event);
    },
    [onDotContextMenu],
  );

  // Don't render anything for non-handshaked sessions
  if (!isHandshaked) return null;

  // Combine completed blocks + active block
  const allBlocks: CommandBlock[] = activeBlock
    ? [...blocks, activeBlock]
    : blocks;

  // Filter to visible blocks and compute positions
  const viewportBottom = viewportTop + rows;
  const visibleDots = allBlocks
    .map((block) => {
      const row = getBlockRow(block);
      if (row === null) return null;
      if (row < viewportTop || row >= viewportBottom) return null;
      const top = (row - viewportTop) * cellHeight;
      return { block, top };
    })
    .filter(
      (item): item is { block: CommandBlock; top: number } => item !== null,
    );

  return (
    <div className="command-gutter" data-testid="command-gutter">
      {visibleDots.map(({ block, top }) => (
        <div
          key={block.id}
          className={`gutter-dot ${getStatusClass(block)}`}
          data-testid="gutter-dot"
          style={{ top: `${top}px` }}
          title={getStatusLabel(block)}
          aria-label={getStatusLabel(block)}
          onContextMenu={(e) => handleContextMenu(block, e)}
        />
      ))}
    </div>
  );
}
