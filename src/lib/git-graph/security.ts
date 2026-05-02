/**
 * Security utilities for HTML rendering.
 * [SECURITY] Escape user-controlled strings before DOM insertion.
 */

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a string for use in an HTML attribute value. */
export function escapeAttr(str: string): string {
  return escapeHtml(str);
}

/**
 * Sanitize a file status string for use as a CSS class name.
 * Only allows known status values; defaults to 'modified'.
 */
export function sanitizeStatusClass(status: string): string {
  const allowed = [
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "untracked",
  ];
  return allowed.includes(status) ? status : "modified";
}
