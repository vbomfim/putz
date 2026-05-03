/**
 * usePromptNavigation — Cmd+↑/↓ prompt jumping hook and navigation functions.
 *
 * Provides keyboard-driven navigation between command block boundaries.
 * Uses the commandBlockStore to find prompt rows and xterm.js to scroll
 * the terminal viewport.
 *
 * Navigation logic:
 *  - Cmd+↑ (macOS) / Ctrl+↑ (Linux/Windows): jump to previous prompt
 *  - Cmd+↓ (macOS) / Ctrl+↓ (Linux/Windows): jump to next prompt
 *
 * @module usePromptNavigation
 * @see https://github.com/vbomfim/putz/issues/103
 */
import { useCommandBlockStore } from "../../stores/commandBlockStore";
import type { CommandBlock } from "../../stores/commandBlockStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get all prompt rows for a session, sorted ascending.
 * Includes both completed blocks and the active (in-progress) block.
 */
function getPromptRows(sessionId: string): number[] {
  const session = useCommandBlockStore.getState().sessions.get(sessionId);
  if (!session) return [];

  const allBlocks: CommandBlock[] = session.activeBlock
    ? [...session.blocks, session.activeBlock]
    : session.blocks;

  const rows: number[] = [];
  for (const block of allBlocks) {
    const row = block.commandStart?.row ?? block.promptStart?.row;
    if (row !== undefined && row !== null) {
      rows.push(row);
    }
  }

  return rows.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Navigation functions (pure — return target row or null)
// ---------------------------------------------------------------------------

/**
 * Find the previous prompt row strictly before `currentRow`.
 *
 * @param sessionId - session to search
 * @param currentRow - current viewport top row
 * @returns target row or null if at first prompt
 */
export function navigateToPreviousPrompt(
  sessionId: string,
  currentRow: number,
): number | null {
  const rows = getPromptRows(sessionId);
  // Find the last row that is strictly less than currentRow
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i] < currentRow) return rows[i];
  }
  return null;
}

/**
 * Find the next prompt row strictly after `currentRow`.
 *
 * @param sessionId - session to search
 * @param currentRow - current viewport top row
 * @returns target row or null if at last prompt
 */
export function navigateToNextPrompt(
  sessionId: string,
  currentRow: number,
): number | null {
  const rows = getPromptRows(sessionId);
  // Find the first row that is strictly greater than currentRow
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] > currentRow) return rows[i];
  }
  return null;
}
