/**
 * CommandBlockContextMenu — right-click context menu for command block dots.
 *
 * Shows actions for a specific command block:
 *  - Copy command: copies the command text from the buffer
 *  - Copy output: copies the output text from the buffer
 *  - Copy command + output: copies both separated by newline
 *  - Rerun command: disabled until commandText is captured (future ticket)
 *
 * @module CommandBlockContextMenu
 * @see https://github.com/vbomfim/putz/issues/103
 */
import { useEffect, useRef, useCallback } from "react";
import type { CommandBlock } from "../../stores/commandBlockStore";
import { extractRangeText, type GetBufferLine } from "./bufferUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandBlockContextMenuProps {
  /** The command block this menu is for. */
  block: CommandBlock;
  /** Screen position for the menu. */
  position: { x: number; y: number };
  /** Called to close the menu. */
  onClose: () => void;
  /** Function to get a buffer line by absolute row. */
  getBufferLine: GetBufferLine;
  /** Total buffer length (for in-progress blocks without commandEnd). */
  totalBufferLength: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Right-click context menu for a command block dot. */
export function CommandBlockContextMenu({
  block,
  position,
  onClose,
  getBufferLine,
  totalBufferLength,
}: CommandBlockContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the menu
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const copyCommand = useCallback(async () => {
    if (!block.commandStart) return;
    const endRow =
      block.outputStart?.row ??
      block.commandEnd?.row ??
      block.commandStart.row + 1;
    const text = extractRangeText(
      getBufferLine,
      block.commandStart.row,
      endRow,
    );
    await navigator.clipboard.writeText(text);
    onClose();
  }, [block, getBufferLine, onClose]);

  const copyOutput = useCallback(async () => {
    if (!block.outputStart) return;
    const endRow = block.commandEnd?.row ?? totalBufferLength;
    const text = extractRangeText(getBufferLine, block.outputStart.row, endRow);
    await navigator.clipboard.writeText(text);
    onClose();
  }, [block, getBufferLine, onClose, totalBufferLength]);

  const copyCommandAndOutput = useCallback(async () => {
    if (!block.commandStart) return;
    const endRow = block.commandEnd?.row ?? totalBufferLength;
    const text = extractRangeText(
      getBufferLine,
      block.commandStart.row,
      endRow,
    );
    await navigator.clipboard.writeText(text);
    onClose();
  }, [block, getBufferLine, onClose, totalBufferLength]);

  const canCopyCommand = block.commandStart !== null;
  const canCopyOutput = block.outputStart !== null;
  const canRerun = block.commandText !== "";

  return (
    <div
      ref={menuRef}
      className="command-block-context-menu"
      data-testid="command-block-context-menu"
      style={{
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <button
        className="context-menu-item"
        onClick={copyCommand}
        disabled={!canCopyCommand}
        type="button"
      >
        Copy command
      </button>
      <button
        className="context-menu-item"
        onClick={copyOutput}
        disabled={!canCopyOutput}
        type="button"
      >
        Copy output
      </button>
      <button
        className="context-menu-item"
        onClick={copyCommandAndOutput}
        disabled={!canCopyCommand}
        type="button"
      >
        Copy command + output
      </button>
      <div className="context-menu-separator" />
      <button
        className="context-menu-item"
        disabled={!canRerun}
        title={
          canRerun
            ? "Rerun this command"
            : "Unavailable — command text not captured"
        }
        type="button"
      >
        Rerun command
      </button>
    </div>
  );
}
