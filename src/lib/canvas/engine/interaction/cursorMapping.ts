/**
 * Cursor mapping — pure function for tool-based cursor selection.
 *
 * Maps the active tool + hover state to the appropriate CSS cursor.
 * Complements getCursorForTarget in manipulationHelpers which handles
 * handle/body hover cursors. [CLEAN-CODE]
 *
 * @module
 */

import type { ToolType } from '../types/index';

/** Hover target type for cursor determination. */
export type HoverTarget = 'none' | 'body' | 'handle';

/**
 * Get the appropriate CSS cursor based on the active tool and hover state.
 *
 * Priority:
 * 1. Pan mode (space held) → 'grab'
 * 2. Select tool hovering shape → 'move'
 * 3. Drawing tools → 'crosshair'
 * 4. Text tool → 'text'
 * 5. Select tool, no hover → 'default'
 *
 * Handle-specific resize cursors are handled by manipulationHelpers
 * and take priority over this mapping in the Canvas component.
 */
export function getCursorForToolState(
  tool: ToolType,
  hoverTarget: HoverTarget,
  isPanMode: boolean,
): string {
  // Pan mode overrides everything
  if (isPanMode) {
    return 'grab';
  }

  // Text tool has its own cursor
  if (tool === 'text') {
    return 'text';
  }

  // Drawing tools (not select, not text) → crosshair
  if (tool !== 'select') {
    return 'crosshair';
  }

  // Select tool: cursor depends on what we're hovering
  if (hoverTarget === 'body') {
    return 'move';
  }

  return 'default';
}
