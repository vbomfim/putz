/**
 * Pure UI formatters for swarm components.
 *
 * F5: extracted out of `InboxPanel.tsx` and `ColleagueRow.tsx` so
 * those component modules export ONLY React components — required for
 * Vite/React-Refresh to work reliably (mixing non-component exports
 * disables fast-refresh on the file).
 *
 * @privacy Tier-2 — `truncateCwd` operates on user-authored cwd
 * strings. Truncation is purely a UI concern; the full cwd is still
 * carried in the data model. Formatters here MUST NOT log their
 * inputs.
 *
 * @module lib/swarm/formatters
 */

/**
 * Render an absolute timestamp as "Xs/Xm/Xh/Xd ago".
 *
 * Any future timestamp clamps to "just now" — clock skew across hosts
 * is not a UI bug.
 */
export function formatRelativeTime(
  timestampMs: number,
  nowMs: number,
): string {
  const delta = Math.max(0, nowMs - timestampMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Compress a long `cwd` string to "…/last/two" form for sidebar
 * display. Default keeps the last 2 path segments.
 *
 * @privacy Tier-2 — cwd is a quasi-identifier; this truncation is for
 * UI brevity only, not for redaction.
 */
export function truncateCwd(
  cwd: string | null | undefined,
  n = 2,
): string {
  if (!cwd) return "";
  // Normalize Windows backslashes for splitting.
  const norm = cwd.replace(/\\/g, "/");
  const segs = norm.split("/").filter((s) => s.length > 0);
  if (segs.length <= n) return cwd;
  return "…/" + segs.slice(-n).join("/");
}
