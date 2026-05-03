/**
 * OSC (Operating System Command) parser for terminal protocol support.
 *
 * Consumes the PTY output stream via xterm.js's parser hook chain and emits
 * typed events. Handled OSC codes:
 *  - OSC 7   — cwd notification (`file://hostname/path`)
 *  - OSC 133 — shell integration / command boundaries (A/B/C/D + P;putz=1)
 *  - OSC 1337 — iTerm2 CurrentDir
 *
 * All other codes are ignored.
 *
 * Design:
 *  - Per-instance state via `createOscParser()` factory (same pattern as
 *    `createPasteGuard()` from S1).
 *  - 8 KB per-payload size cap — payloads exceeding this are rejected with a
 *    console warning.
 *  - UTF-8 validation via `decodeURIComponent` (throws on malformed sequences).
 *  - Path length cap of 4096 bytes for cwd paths.
 *  - OSC 133 handshake gating — A/B/C/D markers are only emitted after the
 *    session has received a `P;putz=1` handshake, preventing spoofing via
 *    `cat malicious.txt`.
 *
 * @module oscParser
 * @see https://github.com/vbomfim/putz/issues/100
 * @see https://github.com/vbomfim/putz/issues/102
 * @see specs/modern-terminal-protocols/spec.md
 */
import type { Terminal, IDisposable } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

/** Reusable encoder — TextEncoder is stateless, no need to allocate per call. */
const utf8Encoder = new TextEncoder();

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

// ---------------------------------------------------------------------------
// OSC 133 event types
// ---------------------------------------------------------------------------

/** Semantic markers emitted by OSC 133 shell integration. */
export type Osc133Marker =
  | "prompt-start"
  | "command-start"
  | "output-start"
  | "command-end"
  | "handshake";

/**
 * Cursor position at the moment an OSC sequence was processed.
 *
 * Row is stored as an **absolute** buffer offset (`baseY + cursorY`),
 * not the viewport-relative `cursorY` alone, so gutter dots survive
 * scrollback growth.
 *
 * @security Cell position is derived from xterm.js cursor state, which is
 * influenced by ALL terminal output (including CSI cursor-movement sequences
 * from the PTY). It is trustworthy for display purposes (where to draw the
 * gutter dot) but should not be used for any security-sensitive decisions
 * (e.g., "this OSC was emitted from row N").
 */
export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/**
 * Event emitted when an OSC 133 sequence is parsed.
 *
 * The `cell` field records the cursor position at the moment the OSC handler
 * fires — this is critical for S5's gutter rendering, which needs to know
 * exactly which terminal row each command block occupies.
 */
export interface Osc133Event {
  readonly kind: "osc-133";
  readonly sessionId: string;
  readonly marker: Osc133Marker;
  /** Only present for command-end with an exit code (0–255). */
  readonly exitCode?: number;
  /** Cursor position when this OSC arrived. */
  readonly cell: CellPosition;
}

/** All OSC event types emitted by the parser. */
export type OscEvent = OscCwdEvent | Osc133Event;

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

  const raw = match[1];

  // UTF-8 validation: decodeURIComponent validates percent-encoded sequences
  // and is a no-op for plain non-percent chars. Symmetric with OSC 7's defense.
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // Malformed percent encoding or invalid UTF-8 — reject
    return null;
  }

  // Path length cap (after decoding, same as OSC 7)
  if (byteLength(path) > MAX_CWD_PATH_BYTES) return null;

  return path;
}

// ---------------------------------------------------------------------------
// OSC 133 parsing
// ---------------------------------------------------------------------------

/**
 * Parsed result from an OSC 133 payload (internal, before session/cell enrichment).
 */
interface Osc133ParsedPayload {
  marker: Osc133Marker;
  exitCode?: number;
}

/**
 * Parse an OSC 133 payload string into a structured marker.
 *
 * Supported formats:
 *  - `"A"`           → prompt start
 *  - `"B"`           → command start
 *  - `"C"`           → output start
 *  - `"D"`           → command end (no exit code)
 *  - `"D;0"` – `"D;255"` → command end with exit code
 *  - `"P;putz=1"`    → putz handshake
 *
 * Returns null for any unrecognized or malformed payload.
 *
 * @param data - The OSC 133 payload (everything after `133;` up to ST/BEL)
 */
export function parseOsc133Payload(data: string): Osc133ParsedPayload | null {
  // Size cap — defensive half of MAX_OSC_PAYLOAD_BYTES for char-vs-byte safety
  if (data.length > MAX_OSC_PAYLOAD_BYTES / 2) return null;

  if (data === "A") return { marker: "prompt-start" };
  if (data === "B") return { marker: "command-start" };
  if (data === "C") return { marker: "output-start" };
  if (data === "D") return { marker: "command-end" };

  if (data.startsWith("D;")) {
    const exitStr = data.slice(2);
    // Strict: digits only, 1-3 chars (max 999, then range-checked to 0..255).
    // parseInt would accept trailing garbage ("10abc" → 10); reject explicitly.
    if (!/^\d{1,3}$/.test(exitStr)) {
      return null;
    }
    const exitCode = parseInt(exitStr, 10);
    if (Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255) {
      return { marker: "command-end", exitCode };
    }
    return null; // malformed exit code
  }

  if (data === "P;putz=1") return { marker: "handshake" };

  // Future-proof: other P; subparameters or unknown markers → ignore
  return null;
}

// ---------------------------------------------------------------------------
// Cell position helper
// ---------------------------------------------------------------------------

/**
 * Read the current cursor position from an xterm.js Terminal.
 * Must be called synchronously inside the OSC handler callback —
 * deferring would record a stale position.
 */
function getCurrentCell(terminal: Terminal): CellPosition {
  const buffer = terminal.buffer.active;
  return {
    // Absolute row = base of the active buffer + viewport-relative cursor row.
    // Required for S5 gutter to find the right row after scrollback grows.
    row: buffer.baseY + buffer.cursorY,
    col: buffer.cursorX,
  };
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
  let handshakeSeen = false; // OSC 133 trust gate

  const emit = (event: OscEvent): void => {
    if (disposed) return;
    for (const cb of listeners) {
      try {
        cb(event);
      } catch {
        // Listener threw — swallow to keep the parser loop stable for remaining listeners
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
            return false; // let xterm.js built-in OSC handler also process (e.g., for window-title side effects)
          },
        );
        disposables.push(handler);
      } catch {
        // xterm.js < 4.14 lacks registerOscHandler — degrade gracefully
      }

      // OSC 133 — shell integration / command boundaries
      // Handshake-gated: A/B/C/D events are only emitted after P;putz=1
      // has been received, preventing spoofing via `cat malicious.txt`.
      try {
        const handler = terminal.parser.registerOscHandler(
          133,
          (data: string) => {
            const parsed = parseOsc133Payload(data);
            if (!parsed) return false;

            const cell = getCurrentCell(terminal);

            if (parsed.marker === "handshake") {
              handshakeSeen = true;
              emit({
                kind: "osc-133",
                sessionId,
                marker: "handshake",
                cell,
              });
              return false;
            }

            // Trust gate: ignore A/B/C/D until handshake has been seen
            if (!handshakeSeen) return false;

            emit({
              kind: "osc-133",
              sessionId,
              marker: parsed.marker,
              exitCode: parsed.exitCode,
              cell,
            });
            return false;
          },
        );
        disposables.push(handler);
      } catch {
        // xterm.js < 4.14 lacks registerOscHandler — degrade gracefully
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
            return false; // let xterm.js built-in OSC handler also process (e.g., for window-title side effects)
          },
        );
        disposables.push(handler);
      } catch {
        // xterm.js < 4.14 lacks registerOscHandler — degrade gracefully
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
          // IDisposable.dispose() may throw if the terminal was already torn down — safe to ignore
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
  return utf8Encoder.encode(s).byteLength;
}
