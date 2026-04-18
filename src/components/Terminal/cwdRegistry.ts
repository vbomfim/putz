/**
 * Per-session CWD registry.
 *
 * Many shells set the terminal title to the current working directory
 * (PowerShell, CMD with `prompt $p$g`, bash with PROMPT_COMMAND).
 * On Windows the backend cannot reliably read a child process's CWD
 * without NtQueryInformationProcess, so we mine the title escape
 * sequences and keep the latest CWD per session in this registry.
 *
 * Shells covered:
 *   PowerShell  →  "PS C:\\Users\\foo\\dev\\proj"
 *   CMD         →  "C:\\Users\\foo>"  or  "Administrator: C:\\Users\\foo"
 *   bash/zsh    →  "user@host:/home/foo"  or  "user@host: ~/dev/proj"
 *   zsh suffix  →  "/Users/foo/dev — zsh"
 */

const cwdBySession = new Map<string, string>();

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

export function setSessionCwdFromTitle(sessionId: string, title: string): void {
  const cwd = parseCwdFromTitle(title);
  if (cwd) cwdBySession.set(sessionId, cwd);
}

export function getSessionCwd(sessionId: string): string | undefined {
  return cwdBySession.get(sessionId);
}

export function clearSessionCwd(sessionId: string): void {
  cwdBySession.delete(sessionId);
}
