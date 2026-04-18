/**
 * Per-session CWD registry.
 *
 * Many shells set the terminal title to the current working directory
 * (PowerShell, CMD with `prompt $p$g`, bash with PROMPT_COMMAND).
 * On Windows the backend cannot reliably read a child process's CWD
 * without NtQueryInformationProcess, so we mine the title escape
 * sequences and keep the CWD per session in this registry.
 *
 * We keep a HISTORY of cwd changes keyed to the buffer line where each
 * change happened (via xterm.js IMarker), so clicking on a filename
 * printed earlier (in a different directory) resolves against the cwd
 * that was active at that moment — not the current cwd.
 *
 * Shells covered:
 *   PowerShell  →  "PS C:\\Users\\foo\\dev\\proj"
 *   CMD         →  "C:\\Users\\foo>"  or  "Administrator: C:\\Users\\foo"
 *   bash/zsh    →  "user@host:/home/foo"  or  "user@host: ~/dev/proj"
 *   zsh suffix  →  "/Users/foo/dev — zsh"
 */

import type { IMarker } from "@xterm/xterm";

interface CwdEntry {
  /** Marker pinned to the buffer line where the cd happened.
   *  marker.line === -1 once the line is trimmed from scrollback. */
  marker: IMarker | null;
  /** Absolute line index at record time (fallback if no marker). */
  recordedLine: number;
  cwd: string;
}

/** Bound the per-session history to avoid unbounded growth on long sessions. */
const MAX_HISTORY_PER_SESSION = 500;

const historyBySession = new Map<string, CwdEntry[]>();

/**
 * Try to extract an absolute filesystem path from a terminal title.
 * Returns the CWD string if recognised, otherwise null.
 */
export function parseCwdFromTitle(title: string): string | null {
  if (!title) return null;

  // Windows absolute path: C:\Users\foo  or  C:/Users/foo
  // Anchored on a drive letter at start of string or after whitespace,
  // so we don't match the "p:" inside "laptop:/home/foo".
  const win = title.match(/(?:^|\s)([A-Za-z]:[\\/][^\s>"|*?<]+?)(?=[\s>"|]|$)/);
  if (win) return win[1].replace(/[\\/]+$/, "");

  // Unix path after "user@host:" — bash/zsh PROMPT_COMMAND default.
  const unixAfterHost = title.match(/@[^:]+:\s*([~/][^\s]*)/);
  if (unixAfterHost) return unixAfterHost[1];

  // Bare unix absolute path anywhere in the title (e.g. "/Users/foo/dev — zsh")
  const unix = title.match(/(\/[\w./~-]+)/);
  if (unix) return unix[1];

  return null;
}

/**
 * Record a cwd change for a session at the current buffer position.
 * `marker` should be created by `terminal.registerMarker()` at the time of
 * the title change so we can later resolve which line the change happened on.
 */
export function recordSessionCwd(
  sessionId: string,
  cwd: string,
  marker: IMarker | null,
  recordedLine: number,
): void {
  let history = historyBySession.get(sessionId);
  if (!history) {
    history = [];
    historyBySession.set(sessionId, history);
  }
  // Coalesce: if last entry has same cwd, don't add a duplicate
  const last = history[history.length - 1];
  if (last && last.cwd === cwd) return;
  history.push({ marker, recordedLine, cwd });

  // Prune dead markers and cap size
  if (history.length > MAX_HISTORY_PER_SESSION) {
    const live = history.filter((e) => !e.marker || e.marker.line >= 0);
    historyBySession.set(
      sessionId,
      live.slice(-MAX_HISTORY_PER_SESSION),
    );
  }
}

export function setSessionCwdFromTitle(
  sessionId: string,
  title: string,
  marker: IMarker | null = null,
  recordedLine: number = 0,
): void {
  const cwd = parseCwdFromTitle(title);
  if (cwd) recordSessionCwd(sessionId, cwd, marker, recordedLine);
}

/**
 * Latest known cwd for the session, or undefined if none recorded.
 */
export function getSessionCwd(sessionId: string): string | undefined {
  const history = historyBySession.get(sessionId);
  if (!history || history.length === 0) return undefined;
  return history[history.length - 1].cwd;
}

/**
 * The cwd that was active at the given buffer line. Used when resolving
 * relative file paths clicked in old scrollback — must NOT use the current
 * cwd, since the user may have `cd`'d elsewhere since the file was listed.
 *
 * Returns the most recent cwd whose marker is still alive AND whose line
 * is <= the clicked line. Falls back to the latest known cwd if no entry
 * matches (e.g. all earlier markers were trimmed from scrollback).
 */
export function getSessionCwdAtLine(
  sessionId: string,
  bufferLine: number,
): string | undefined {
  const history = historyBySession.get(sessionId);
  if (!history || history.length === 0) return undefined;

  // Walk backward; pick the most recent entry whose recorded line is at or
  // before the clicked line. Prefer live markers (their .line is current);
  // for dead markers, fall back to the line we recorded originally.
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const entryLine = entry.marker && entry.marker.line >= 0
      ? entry.marker.line
      : entry.recordedLine;
    if (entryLine <= bufferLine) return entry.cwd;
  }
  // Nothing matched — clicked line is older than any tracked cwd.
  // Return the oldest known cwd as a best-effort guess.
  return history[0].cwd;
}

export function clearSessionCwd(sessionId: string): void {
  const history = historyBySession.get(sessionId);
  if (history) {
    for (const entry of history) entry.marker?.dispose();
  }
  historyBySession.delete(sessionId);
}
