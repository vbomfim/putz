/**
 * Centralized paste helper for the terminal.
 *
 * Single source of truth for clipboard → PTY paste operations.
 * Handles:
 *  - Reading the clipboard
 *  - Delegating to xterm.js's `terminal.paste()` (which respects bracketed
 *    paste mode and emits `\x1b[200~`/`\x1b[201~` markers when enabled)
 *  - Deduplication guard to prevent double-paste when multiple event paths
 *    fire for the same user gesture (e.g., contextmenu + native paste event)
 *
 * Design decision: we rely on xterm.js's `terminal.paste()` rather than
 * writing directly to the PTY. This is intentional — xterm.js knows whether
 * the shell has enabled bracketed paste mode (DEC private mode 2004) and
 * wraps the pasted text accordingly. Writing raw bytes via `pty_write` would
 * bypass this and cause shells with bracketed paste enabled (zsh, fish,
 * PSReadLine) to mis-handle pasted content.
 *
 * @module pasteHelper
 * @see https://github.com/vbomfim/putz/issues/99
 */
import type { Terminal } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// Paste deduplication guard
// ---------------------------------------------------------------------------
// Prevents the same clipboard content from being pasted twice within a short
// window. This handles the class of bugs where two event paths (contextmenu +
// Ctrl+V, or contextmenu + native browser paste) fire for a single user
// gesture and both call pasteToTerminal().
//
// Guard window: 200ms — long enough to catch double-fires from the same
// gesture, short enough to allow intentional rapid re-pastes.

const PASTE_GUARD_WINDOW_MS = 200;

let lastPasteContent = "";
let lastPasteTime = 0;

/**
 * Check whether a paste with the given content should be allowed.
 * Returns true if the paste is fresh (different content or enough time elapsed).
 */
function shouldAllowPaste(content: string): boolean {
  const now = Date.now();
  if (
    content === lastPasteContent &&
    now - lastPasteTime < PASTE_GUARD_WINDOW_MS
  ) {
    return false;
  }
  lastPasteContent = content;
  lastPasteTime = now;
  return true;
}

/**
 * Reset the paste guard state. Exported only for testing.
 * @internal
 */
export function _resetPasteGuard(): void {
  lastPasteContent = "";
  lastPasteTime = 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads clipboard text and pastes it into the terminal via xterm.js's
 * `terminal.paste()` API.
 *
 * `terminal.paste()` internally:
 *  1. Checks `terminal.modes.bracketedPasteMode`
 *  2. If enabled, wraps the text with `\x1b[200~` and `\x1b[201~`
 *  3. Fires `onData` with the (possibly wrapped) text
 *  4. The `onData` handler in useTerminal.ts writes the bytes to the PTY
 *
 * This function is the ONLY paste entry point. All paste triggers
 * (contextmenu, Ctrl+V, Ctrl+Shift+V) must call this function.
 *
 * @param terminal - The xterm.js Terminal instance
 * @param _sessionId - The PTY session ID (reserved for future use)
 */
export async function pasteToTerminal(
  terminal: Terminal,
  _sessionId: string,
): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;

    // Deduplication: reject if this exact content was just pasted
    if (!shouldAllowPaste(text)) return;

    // Delegate to xterm.js — it handles bracketed paste markers
    terminal.paste(text);
  } catch {
    // Clipboard read failed — permission denied or empty. Silent no-op.
  }
}
