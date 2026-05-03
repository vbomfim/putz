/**
 * OSC (Operating System Command) parser for terminal protocol support.
 *
 * Consumes the PTY output stream via xterm.js's parser hook chain and emits
 * typed events. Only allowlisted OSC codes are handled — currently OSC 7
 * (cwd notification) and OSC 1337 (iTerm2 CurrentDir). All other codes are
 * ignored.
 *
 * Design:
 *  - Per-instance state via `createOscParser()` factory (same pattern as
 *    `createPasteGuard()` from S1).
 *  - 8 KB per-payload size cap — payloads exceeding this are rejected with a
 *    console warning.
 *  - UTF-8 validation via `decodeURIComponent` (throws on malformed sequences).
 *  - Path length cap of 4096 bytes for cwd paths.
 *
 * @module oscParser
 * @see https://github.com/vbomfim/putz/issues/100
 * @see specs/modern-terminal-protocols/spec.md
 */
import type { Terminal, IDisposable } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum OSC payload size in bytes. Payloads exceeding this are rejected. */
export const MAX_OSC_PAYLOAD_BYTES = 8192;

/** Maximum CWD path length in bytes after decoding. */
export const MAX_CWD_PATH_BYTES = 4096;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** Discriminated union of events emitted by the OSC parser. */
export interface OscCwdEvent {
  readonly kind: "cwd-updated";
  readonly sessionId: string;
  readonly cwd: string;
  readonly source: "osc-7" | "osc-1337";
}

/** All OSC event types (extensible for S4: OSC 133). */
export type OscEvent = OscCwdEvent;

/** Callback for OSC events. */
export type OscEventCallback = (event: OscEvent) => void;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Per-instance OSC parser that registers handlers with an xterm.js Terminal
 * and emits typed events for recognized OSC sequences.
 */
export interface OscParser {
  /** Register OSC handlers with the terminal's parser. */
  attach(terminal: Terminal): void;
  /** Subscribe to events. Returns an unsubscribe function. */
  on(callback: OscEventCallback): () => void;
  /** Clean up handlers and subscriptions. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// OSC 7 parsing
// ---------------------------------------------------------------------------

/**
 * Parse an OSC 7 payload: `file://hostname/percent-encoded/path`.
 * Returns the decoded absolute path, or null if invalid.
 *
 * Validation:
 *  - Rejects payloads > MAX_OSC_PAYLOAD_BYTES
 *  - Rejects paths > MAX_CWD_PATH_BYTES after decoding
 *  - Validates UTF-8 via decodeURIComponent (rejects malformed sequences)
 *  - Strips the `file://` prefix and hostname segment
 *  - On Windows, strips the leading slash before drive letter (e.g. /C:/ → C:/)
 *
 * @param data - The OSC 7 payload (everything after `7;` up to ST/BEL)
 * @returns Decoded absolute path, or null if the payload is invalid
 */
export function parseOsc7Payload(data: string): string | null {
  if (!data) return null;

  // Size cap: reject oversized payloads
  if (byteLength(data) > MAX_OSC_PAYLOAD_BYTES) return null;

  let s = data.trim();

  // Strip `file://` prefix
  if (s.startsWith("file://")) {
    s = s.slice("file://".length);
  } else {
    // Not a file:// URL — reject
    return null;
  }

  // After `file://`, format is `hostname/path` — drop hostname
  // (everything up to the first `/`)
  const slashIdx = s.indexOf("/");
  if (slashIdx < 0) return null;
  let path = s.slice(slashIdx);

  // UTF-8 validation + percent decoding (before drive-letter check,
  // since the colon and backslash may be percent-encoded)
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent encoding or invalid UTF-8 — reject
    return null;
  }

  // Windows: `/C:/Users/...` or `/C:\Users\...` → `C:/Users/...`
  if (/^\/[A-Za-z]:[\\/]/.test(path)) {
    path = path.slice(1);
  }

  // Path length cap after decoding
  if (byteLength(path) > MAX_CWD_PATH_BYTES) return null;

  // Final sanity: must be an absolute path
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) return null;

  return path;
}

// ---------------------------------------------------------------------------
// OSC 1337 parsing
// ---------------------------------------------------------------------------

/**
 * Parse an OSC 1337 `CurrentDir=` payload.
 * Returns the path, or null if the payload doesn't match.
 *
 * @param data - The OSC 1337 payload
 * @returns Decoded path, or null if not a CurrentDir payload
 */
export function parseOsc1337CurrentDir(data: string): string | null {
  if (!data) return null;

  // Size cap
  if (byteLength(data) > MAX_OSC_PAYLOAD_BYTES) return null;

  const match = data.match(/^CurrentDir=(.+)$/);
  if (!match) return null;

  const path = match[1];

  // Path length cap
  if (byteLength(path) > MAX_CWD_PATH_BYTES) return null;

  return path;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a per-instance OSC parser for a terminal session.
 *
 * Usage:
 * ```ts
 * const parser = createOscParser(sessionId);
 * parser.attach(terminal);
 * const unsub = parser.on((event) => {
 *   if (event.kind === 'cwd-updated') recordSessionCwd(...);
 * });
 * // On cleanup:
 * parser.dispose();
 * ```
 *
 * @param sessionId - The session UUID this parser instance is scoped to
 * @returns An OscParser instance
 */
export function createOscParser(sessionId: string): OscParser {
  const listeners = new Set<OscEventCallback>();
  const disposables: IDisposable[] = [];
  let disposed = false;

  const emit = (event: OscEvent): void => {
    if (disposed) return;
    for (const cb of listeners) {
      try {
        cb(event);
      } catch {
        // Listener errors must not break the parser
      }
    }
  };

  return {
    attach(terminal: Terminal): void {
      if (disposed) return;

      // OSC 7 — cwd notification: \e]7;file://hostname/path\a
      try {
        const handler = terminal.parser.registerOscHandler(
          7,
          (data: string) => {
            const cwd = parseOsc7Payload(data);
            if (cwd) {
              emit({
                kind: "cwd-updated",
                sessionId,
                cwd,
                source: "osc-7",
              });
            }
            return false; // let other handlers (if any) run
          },
        );
        disposables.push(handler);
      } catch {
        // Older xterm.js versions may not expose parser.registerOscHandler
      }

      // OSC 1337 — iTerm2 CurrentDir: \e]1337;CurrentDir=/path\a
      try {
        const handler = terminal.parser.registerOscHandler(
          1337,
          (data: string) => {
            const cwd = parseOsc1337CurrentDir(data);
            if (cwd) {
              emit({
                kind: "cwd-updated",
                sessionId,
                cwd,
                source: "osc-1337",
              });
            }
            return false;
          },
        );
        disposables.push(handler);
      } catch {
        // ignore
      }
    },

    on(callback: OscEventCallback): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          // ignore
        }
      }
      disposables.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the UTF-8 byte length of a string.
 * Uses TextEncoder for accuracy.
 */
function byteLength(s: string): number {
  // TextEncoder is available in all modern runtimes (browser + Node 16+)
  return new TextEncoder().encode(s).byteLength;
}
