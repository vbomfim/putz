/**
 * Centralized paste helper for the terminal.
 *
 * Single source of truth for clipboard → PTY paste operations.
 * Handles:
 *  - Reading the clipboard
 *  - Sanitizing bracketed-paste escape markers from clipboard content
 *  - Delegating to xterm.js's `terminal.paste()` (which respects bracketed
 *    paste mode and emits `\x1b[200~`/`\x1b[201~` markers when enabled)
 *  - Per-instance deduplication guard using event-source identity to prevent
 *    double-paste when multiple event handlers fire for one user gesture
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
// Security: bracketed-paste marker sanitization (Fix 1)
// ---------------------------------------------------------------------------
// Defense against bracketed-paste-marker injection (CVE-class):
// If clipboard contains \x1b[201~, the shell sees a premature paste-end
// and treats following bytes as raw keystrokes (arbitrary command execution
// from a malicious clipboard). Strip both open and close markers.
// eslint-disable-next-line no-control-regex
export const STRIP_PASTE_MARKERS_RE = /\x1b\[20[01]~/g;

// ---------------------------------------------------------------------------
// Per-instance paste deduplication guard (Fix 2 + Fix 3)
// ---------------------------------------------------------------------------
// Each terminal gets its own PasteGuard via createPasteGuard().
// Uses event-source identity (event timestamp) as primary dedup signal,
// with content-based fallback for legacy callers without timestamps.

/** Guard window for content-based fallback dedup. */
const PASTE_GUARD_WINDOW_MS = 50;

/** Jitter tolerance for event timestamp matching. */
const TIMESTAMP_JITTER_MS = 5;

/**
 * Per-instance paste deduplication guard.
 * Create one per terminal via `createPasteGuard()`.
 */
export interface PasteGuard {
  /** Returns true if the paste should proceed; false if it's a duplicate. */
  shouldAllow(content: string, eventTimestamp?: number): boolean;
  /** Reset all guard state. Exported for testing. */
  reset(): void;
  /** Clean up timers and clear cached content (privacy hygiene). */
  dispose(): void;
}

/**
 * Factory for per-instance paste guards.
 *
 * Primary dedup: event timestamp identity — two handlers from a single
 * gesture share the same `MouseEvent.timeStamp` (or within ~5ms jitter).
 * Fallback dedup: content equality within a tight 50ms window for legacy
 * callers that don't pass timestamps.
 *
 * Privacy: cached clipboard content is cleared after the guard window
 * expires (Fix 5).
 */
export function createPasteGuard(): PasteGuard {
  let lastContent = "";
  let lastTime = 0;
  let lastTimestamp = 0;
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    shouldAllow(content: string, eventTimestamp?: number): boolean {
      const now = Date.now();

      // Primary: same gesture if eventTimestamp matches within jitter
      if (
        eventTimestamp != null &&
        lastTimestamp !== 0 &&
        Math.abs(eventTimestamp - lastTimestamp) < TIMESTAMP_JITTER_MS
      ) {
        return false;
      }

      // Safety net: same content arriving within the larger guard window
      // catches platform-specific double-dispatch where the two events
      // carry distinct timestamps too far apart for the jitter check
      // (observed on Windows WebView2: contextmenu fires twice ~10–40ms
      // apart for a single right-click). Runs regardless of whether
      // eventTimestamp was provided — accepting a same-content duplicate
      // ≤50ms after the previous paste is virtually always a duplicate
      // event, not user intent.
      if (content === lastContent && now - lastTime < PASTE_GUARD_WINDOW_MS) {
        return false;
      }

      // Allow — update state
      lastContent = content;
      lastTime = now;
      lastTimestamp = eventTimestamp ?? 0;

      // Privacy (Fix 5): clear cached clipboard content after guard window.
      // Only clear if no newer paste has replaced it (check via lastTime).
      if (cleanupTimer) clearTimeout(cleanupTimer);
      const tokenAtSchedule = lastTime;
      cleanupTimer = setTimeout(() => {
        if (lastTime === tokenAtSchedule) {
          lastContent = "";
        }
      }, PASTE_GUARD_WINDOW_MS);

      return true;
    },

    reset(): void {
      lastContent = "";
      lastTime = 0;
      lastTimestamp = 0;
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cleanupTimer = null;
    },

    dispose(): void {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cleanupTimer = null;
      lastContent = "";
      lastTime = 0;
      lastTimestamp = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Synchronous entry guard (Fix 6)
// ---------------------------------------------------------------------------
// Prevents TOCTOU race between concurrent `await readText()` calls.
// Module-level since it guards the async function entry, not per-instance state.
let pasteInFlight = false;

/**
 * Reset pasteInFlight flag. Exported only for testing.
 * @internal
 */
export function _resetPasteInFlight(): void {
  pasteInFlight = false;
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
 * This function is the ONLY clipboard paste entry point. All paste
 * triggers (contextmenu, Ctrl+V, Ctrl+Shift+V, Shift+Insert) call this.
 *
 * @param terminal - The xterm.js Terminal instance
 * @param guard - Per-instance PasteGuard for deduplication
 * @param eventTimestamp - The triggering event's timeStamp for gesture identity
 */
export async function pasteToTerminal(
  terminal: Terminal,
  guard: PasteGuard,
  eventTimestamp?: number,
): Promise<void> {
  // Synchronous entry guard (Fix 6): prevent concurrent clipboard reads
  if (pasteInFlight) return;
  pasteInFlight = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    // Deduplication via per-instance guard with event-source identity.
    if (!guard.shouldAllow(text, eventTimestamp)) return;
    // Security (Fix 1): strip bracketed-paste markers from clipboard content.
    const sanitized = text.replace(STRIP_PASTE_MARKERS_RE, "");
    // Delegate to xterm.js — it handles bracketed-paste wrapping.
    terminal.paste(sanitized);
  } catch (err: unknown) {
    // Fix 7: distinguish clipboard failure modes.
    // Permission denied or unsupported is a normal user-initiated outcome.
    // Other errors deserve debug visibility. NEVER log clipboard content.
    if (
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "NotFoundError")
    ) {
      return;
    }
    console.debug("[pasteToTerminal] unexpected clipboard error:", err);
  } finally {
    pasteInFlight = false;
  }
}
