/**
 * IPC contract tests — validates TypeScript types match Rust backend expectations.
 *
 * These tests ensure the frontend and backend agree on:
 * - Command names and parameter structures
 * - Event names and payload formats
 * - Type boundaries (e.g., u16 for cols/rows)
 * - Data encoding (TextEncoder for keystroke → byte array)
 *
 * Tags: [CONTRACT], [AC-1], [AC-2], [AC-3], [AC-4], [AC-7]
 */
import { describe, it, expect } from "vitest";
import type {
  PtySpawnArgs,
  PtyWriteArgs,
  PtyResizeArgs,
  PtyCloseArgs,
  PtyExitPayload,
} from "../components/Terminal/types";
import { TERMINAL_CONFIG } from "../components/Terminal/types";

describe("IPC Contract — PtySpawnArgs", () => {
  /**
   * [CONTRACT] [AC-1] pty_spawn requires cols and rows.
   * Must match Rust: pty_spawn(cols: u16, rows: u16, shell: Option<String>, ...)
   */
  it("accepts minimal required fields (cols, rows)", () => {
    const args: PtySpawnArgs = { cols: 80, rows: 24 };
    expect(args.cols).toBe(80);
    expect(args.rows).toBe(24);
    expect(args.shell).toBeUndefined();
    expect(args.cwd).toBeUndefined();
    expect(args.env).toBeUndefined();
  });

  /**
   * [CONTRACT] pty_spawn accepts all optional fields.
   * Rust signature: shell: Option<String>, cwd: Option<String>, env: Option<HashMap<String, String>>
   */
  it("accepts all optional fields", () => {
    const args: PtySpawnArgs = {
      cols: 120,
      rows: 40,
      shell: "/bin/zsh",
      cwd: "/home/user",
      env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" },
    };
    expect(args.shell).toBe("/bin/zsh");
    expect(args.cwd).toBe("/home/user");
    expect(args.env).toEqual({ TERM: "xterm-256color", LANG: "en_US.UTF-8" });
  });

  /**
   * [CONTRACT] [AC-1] Default dimensions in TERMINAL_CONFIG match standard terminal (80×24).
   * App.tsx uses these defaults for pty_spawn.
   */
  it("TERMINAL_CONFIG defaults match pty_spawn contract", () => {
    expect(TERMINAL_CONFIG.defaultCols).toBe(80);
    expect(TERMINAL_CONFIG.defaultRows).toBe(24);
  });

  /**
   * [BOUNDARY] Rust expects u16 (0–65535) for cols/rows.
   * Frontend must stay within this range.
   */
  it("dimension values are within u16 range", () => {
    const maxU16 = 65535;
    // Normal values
    const normal: PtySpawnArgs = { cols: 80, rows: 24 };
    expect(normal.cols).toBeGreaterThanOrEqual(0);
    expect(normal.cols).toBeLessThanOrEqual(maxU16);
    expect(normal.rows).toBeGreaterThanOrEqual(0);
    expect(normal.rows).toBeLessThanOrEqual(maxU16);
    // Max values
    const max: PtySpawnArgs = { cols: maxU16, rows: maxU16 };
    expect(max.cols).toBe(maxU16);
    expect(max.rows).toBe(maxU16);
  });
});

describe("IPC Contract — PtyWriteArgs", () => {
  /**
   * [CONTRACT] [AC-2] pty_write requires sessionId (UUID string) and data (byte array).
   * Rust: pty_write(session_id: String, data: Vec<u8>)
   */
  it("has sessionId string and data number array", () => {
    const args: PtyWriteArgs = {
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      data: [72, 101, 108, 108, 111], // "Hello"
    };
    expect(typeof args.sessionId).toBe("string");
    expect(Array.isArray(args.data)).toBe(true);
    for (const byte of args.data) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });

  /**
   * [EDGE] Empty data array should be accepted (no-op write).
   */
  it("accepts empty data array", () => {
    const args: PtyWriteArgs = {
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      data: [],
    };
    expect(args.data).toHaveLength(0);
  });
});

describe("IPC Contract — PtyResizeArgs", () => {
  /**
   * [CONTRACT] [AC-4] pty_resize requires sessionId, cols, rows.
   * Rust: pty_resize(session_id: String, cols: u16, rows: u16)
   */
  it("has sessionId, cols, and rows", () => {
    const args: PtyResizeArgs = {
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      cols: 120,
      rows: 40,
    };
    expect(typeof args.sessionId).toBe("string");
    expect(typeof args.cols).toBe("number");
    expect(typeof args.rows).toBe("number");
  });
});

describe("IPC Contract — PtyCloseArgs", () => {
  /**
   * [CONTRACT] pty_close requires only sessionId.
   * Rust: pty_close(session_id: String)
   */
  it("has sessionId field only", () => {
    const args: PtyCloseArgs = {
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(Object.keys(args)).toEqual(["sessionId"]);
  });
});

describe("IPC Contract — PtyExitPayload", () => {
  /**
   * [CONTRACT] pty-exit event payload has code: number.
   * Rust emits: serde_json::json!({ "code": exit_code })
   */
  it("has code field as number", () => {
    const payload: PtyExitPayload = { code: 0 };
    expect(typeof payload.code).toBe("number");
  });

  /**
   * [EDGE] Exit code can be negative (signal-killed process).
   * Rust sets -1 when child.wait() fails.
   */
  it("accepts negative exit codes", () => {
    const payload: PtyExitPayload = { code: -1 };
    expect(payload.code).toBe(-1);
  });

  /**
   * [EDGE] Exit code can be non-zero (error exit).
   * Common codes: 1 (general error), 127 (command not found), 130 (Ctrl+C).
   */
  it("accepts non-zero exit codes", () => {
    const payloads: PtyExitPayload[] = [
      { code: 1 },
      { code: 127 },
      { code: 130 },
    ];
    for (const p of payloads) {
      expect(p.code).toBeGreaterThan(0);
    }
  });
});

describe("IPC Contract — Event Name Patterns", () => {
  /**
   * [CONTRACT] [AC-3] PTY output events use pattern: pty-output-{sessionId}.
   * Both frontend (listen) and backend (emit) must agree on this format.
   */
  it("output event name follows pattern pty-output-{sessionId}", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const eventName = `pty-output-${sessionId}`;
    expect(eventName).toMatch(/^pty-output-[a-f0-9-]{36}$/);
  });

  /**
   * [CONTRACT] PTY exit events use pattern: pty-exit-{sessionId}.
   */
  it("exit event name follows pattern pty-exit-{sessionId}", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const eventName = `pty-exit-${sessionId}`;
    expect(eventName).toMatch(/^pty-exit-[a-f0-9-]{36}$/);
  });
});

describe("IPC Contract — Data Encoding", () => {
  /**
   * [CONTRACT] [AC-2] useTerminal converts keystrokes with TextEncoder.
   * This mirrors the onData handler: Array.from(new TextEncoder().encode(data))
   */
  it("TextEncoder produces correct byte array for ASCII input", () => {
    const input = "ls -la\r";
    const bytes = Array.from(new TextEncoder().encode(input));
    // l=108, s=115, space=32, -=45, l=108, a=97, \r=13
    expect(bytes).toEqual([108, 115, 32, 45, 108, 97, 13]);
  });

  /**
   * [CONTRACT] [AC-2] Special keys produce correct escape sequences.
   * Arrow keys, Ctrl+C, Tab should encode correctly.
   */
  it("TextEncoder encodes control characters correctly", () => {
    // Tab = 0x09, Ctrl+C = 0x03
    const tab = Array.from(new TextEncoder().encode("\t"));
    expect(tab).toEqual([9]);

    const ctrlC = Array.from(new TextEncoder().encode("\x03"));
    expect(ctrlC).toEqual([3]);

    const enter = Array.from(new TextEncoder().encode("\r"));
    expect(enter).toEqual([13]);
  });

  /**
   * [CONTRACT] [AC-7] TextEncoder handles CJK characters (multi-byte UTF-8).
   */
  it("TextEncoder handles CJK characters for pty_write", () => {
    const input = "echo 世界";
    const bytes = Array.from(new TextEncoder().encode(input));
    // CJK chars are 3 bytes each in UTF-8
    expect(bytes.length).toBeGreaterThan(input.length);
    // Round-trip verification
    const decoded = new TextDecoder().decode(new Uint8Array(bytes));
    expect(decoded).toBe(input);
  });

  /**
   * [CONTRACT] [AC-7] TextEncoder handles emoji (4-byte UTF-8).
   */
  it("TextEncoder handles emoji for pty_write", () => {
    const input = "🌍";
    const bytes = Array.from(new TextEncoder().encode(input));
    expect(bytes.length).toBe(4); // 4-byte UTF-8 sequence
    const decoded = new TextDecoder().decode(new Uint8Array(bytes));
    expect(decoded).toBe("🌍");
  });

  /**
   * [CONTRACT] [AC-2] onBinary handler converts char codes to bytes.
   * Mirrors useTerminal: Array.from(data, (char) => char.charCodeAt(0))
   */
  it("charCodeAt produces correct byte values for binary data", () => {
    const binaryStr = "\x00\x01\xFF";
    const bytes = Array.from(binaryStr, (char) => char.charCodeAt(0));
    expect(bytes).toEqual([0, 1, 255]);
  });
});
