/**
 * Pure decision helper for the terminal's newline-insertion key bindings
 * (Ctrl/Cmd+Enter, Shift+Enter, Alt+Enter).
 *
 * Extracted from `useTerminal.ts` so the branching logic can be unit-tested
 * without standing up an xterm.js instance. The custom key handler at
 * `useTerminal.ts` is the SINGLE owner of `attachCustomKeyEventHandler`
 * (xterm.js only supports one handler) — this helper just decides what to do.
 *
 * @module newlineShortcuts
 */

/**
 * Bytes sent to the PTY when a newline shortcut fires.
 *
 * ESC + CR (`0x1b 0x0d`) is what many modern shells (PowerShell 7, fish, zsh
 * with PSReadLine-equivalent line editors) interpret as "insert a newline at
 * the prompt without submitting the command line." Plain `0x0d` submits.
 */
export const META_ENTER_BYTES: readonly number[] = [0x1b, 0x0d];

/** Plain carriage return — submits the current command line. */
export const SUBMIT_BYTES: readonly number[] = [0x0d];

/** Per-shortcut on/off toggles. Persisted in the settings store. */
export interface NewlineShortcutSettings {
  /** Ctrl+Enter (and Cmd+Enter on macOS). */
  ctrlEnter: boolean;
  /** Shift+Enter. */
  shiftEnter: boolean;
  /** Alt+Enter. */
  altEnter: boolean;
}

/**
 * Outcome of evaluating a keydown event against the newline-shortcut rules.
 *
 * - `null` → not handled here; the caller should fall through to the rest of
 *   the key handler (and ultimately let xterm.js process the key normally).
 * - `{ consume: true, bytes }` → the caller MUST `event.preventDefault()`,
 *   write `bytes` to the PTY, and return `false` from the xterm handler so
 *   the event is consumed.
 */
export interface NewlineShortcutDecision {
  consume: true;
  bytes: readonly number[];
}

/**
 * Decide what to do with an Enter keydown given the user's newline-shortcut
 * preferences.
 *
 * Modifier rules:
 * - Ctrl-only OR Cmd-only (no Shift, no Alt) → governed by `ctrlEnter`.
 * - Shift-only (no Ctrl/Cmd, no Alt)          → governed by `shiftEnter`.
 * - Alt-only (no Ctrl/Cmd, no Shift)          → governed by `altEnter`. When
 *   disabled, we still intercept and submit plain `\r` so "off means off"
 *   (some shells would otherwise treat Alt+Enter as a newline insert).
 * - Any other combination (incl. plain Enter) → `null`.
 *
 * The Ctrl/Cmd merging follows the existing copy/paste pattern in
 * `useTerminal.ts` (`event.metaKey || event.ctrlKey`).
 *
 * @param event    The keyboard event from xterm's custom key handler.
 * @param settings The user's per-shortcut on/off preferences.
 * @returns A decision, or `null` to let other handlers run.
 */
export function decideNewlineShortcut(
  event: KeyboardEvent,
  settings: NewlineShortcutSettings,
): NewlineShortcutDecision | null {
  if (event.key !== "Enter") return null;

  const hasCtrlOrMeta = event.metaKey || event.ctrlKey;
  const hasShift = event.shiftKey;
  const hasAlt = event.altKey;

  // Ctrl/Cmd+Enter (no Shift, no Alt).
  if (hasCtrlOrMeta && !hasShift && !hasAlt) {
    if (settings.ctrlEnter) {
      return { consume: true, bytes: META_ENTER_BYTES };
    }
    return null;
  }

  // Shift+Enter (no Ctrl/Cmd, no Alt).
  if (hasShift && !hasCtrlOrMeta && !hasAlt) {
    if (settings.shiftEnter) {
      return { consume: true, bytes: META_ENTER_BYTES };
    }
    return null;
  }

  // Alt+Enter (no Ctrl/Cmd, no Shift).
  if (hasAlt && !hasCtrlOrMeta && !hasShift) {
    if (settings.altEnter) {
      return { consume: true, bytes: META_ENTER_BYTES };
    }
    // Disabled — actively intercept and submit plain CR.
    return { consume: true, bytes: SUBMIT_BYTES };
  }

  return null;
}
