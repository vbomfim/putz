/**
 * Sanitize — Unicode bidi control character stripping.
 *
 * Prevents text-direction attacks (Trojan Source / CVE-2021-42574)
 * by removing Unicode bidi control characters from display strings.
 *
 * Single source of truth — all modules importing BIDI_CONTROL_RE
 * or sanitizeDisplayName should use this module instead.
 *
 * @module sanitize
 */

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Regex matching Unicode bidi control characters.
 *
 * Covers:
 * - U+200E LEFT-TO-RIGHT MARK
 * - U+200F RIGHT-TO-LEFT MARK
 * - U+061C ARABIC LETTER MARK
 * - U+2066 LEFT-TO-RIGHT ISOLATE
 * - U+2067 RIGHT-TO-LEFT ISOLATE
 * - U+2068 FIRST STRONG ISOLATE
 * - U+2069 POP DIRECTIONAL ISOLATE
 * - U+202A LEFT-TO-RIGHT EMBEDDING
 * - U+202B RIGHT-TO-LEFT EMBEDDING
 * - U+202C POP DIRECTIONAL FORMATTING
 * - U+202D LEFT-TO-RIGHT OVERRIDE
 * - U+202E RIGHT-TO-LEFT OVERRIDE
 */
export const BIDI_CONTROL_RE =
  /[\u200E\u200F\u061C\u2066-\u2069\u202A-\u202E]/g;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Strips Unicode bidi control characters from a string.
 *
 * Idempotent — calling on an already-clean string returns it unchanged.
 *
 * @param s - Input string, possibly containing bidi control characters.
 * @returns The string with all bidi control characters removed.
 */
export function stripBidiControls(s: string): string {
  return s.replace(BIDI_CONTROL_RE, "");
}
