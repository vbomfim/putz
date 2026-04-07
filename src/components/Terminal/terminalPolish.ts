/**
 * Terminal UX polish constants and utilities.
 *
 * Shared constants for terminal polish features:
 * word separators, font size zoom, bell handling, reconnect.
 *
 * @module terminalPolish
 */
import { TERMINAL_CONFIG } from "./types";
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from "./themeTypes";

// Re-export for convenience — callers don't need to import from two places
export { FONT_SIZE_MIN, FONT_SIZE_MAX };

// ─── Fix 5: Word Separator ──────────────────────────────────────────

/**
 * Custom word separator for double-click selection.
 *
 * Excludes `.`, `/`, `-`, and `~` so that IPs (192.168.1.1),
 * file paths (/usr/local/bin), hostnames (my-host.example.com),
 * and home paths (~/.ssh) are selected as whole words.
 */
export const WORD_SEPARATOR = ' ()[]{}\'",;:!@#$%^&*+=|\\<>`';

// ─── Fix 7: Font Size Zoom ─────────────────────────────────────────

/** Default font size — matches TERMINAL_CONFIG. */
export const FONT_SIZE_DEFAULT = TERMINAL_CONFIG.fontSize;

/**
 * Clamps a font size value to the allowed range [FONT_SIZE_MIN, FONT_SIZE_MAX].
 */
export function clampFontSize(size: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
}

// ─── Fix 3: Bell Handling ───────────────────────────────────────────

/** CSS class applied to a tab during a visual bell flash. */
export const BELL_FLASH_CLASS = "tab--bell-flash";

/** Duration of the bell flash animation in milliseconds. */
export const BELL_FLASH_DURATION_MS = 300;

// ─── Fix 9: Reconnect on Wake ───────────────────────────────────────

/** Grace period (ms) after wake before checking connection health. */
export const WAKE_RECONNECT_GRACE_MS = 2000;
