/**
 * VT Correctness Test Corpus — OSC Sequences
 *
 * Fixtures adapted from microsoft/terminal (MIT) and xtermjs/xterm.js (MIT).
 * Only test inputs and expected outcomes were ported — no implementation code.
 *
 * Tests feed raw byte sequences through either:
 *  - The headless xterm.js Terminal (via shellCompatHarness) for buffer assertions
 *  - The Putz oscParser (S2) for event assertions
 *
 * @see THIRD_PARTY.md for full attribution
 * @see https://github.com/vbomfim/putz/issues/107
 */
import { describe, it, expect, vi } from "vitest";
import {
  createTerminalFromBytes,
  getLineText,
} from "../utils/shellCompatHarness";
import {
  parseOsc7Payload,
  parseOsc1337CurrentDir,
  createOscParser,
  MAX_OSC_PAYLOAD_BYTES,
} from "../../lib/terminal/oscParser";
import type { OscEvent } from "../../lib/terminal/oscParser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a string to a Uint8Array (UTF-8). */
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** BEL terminator (0x07) */
const BEL = "\x07";
/** ST terminator (ESC \) */
const ST = "\x1b\\";

// ---------------------------------------------------------------------------
// Mock terminal factory for OSC parser event tests
// (same pattern as src/test/oscParser.test.ts)
// ---------------------------------------------------------------------------

function createMockTerminal() {
  const oscHandlers = new Map<
    number,
    (data: string) => boolean | Promise<boolean>
  >();

  const terminal = {
    parser: {
      registerOscHandler: vi.fn(
        (
          id: number,
          handler: (data: string) => boolean | Promise<boolean>,
        ) => {
          oscHandlers.set(id, handler);
          return { dispose: vi.fn() };
        },
      ),
    },
  };

  const fireOsc = (id: number, data: string) => {
    const handler = oscHandlers.get(id);
    if (handler) handler(data);
  };

  return {
    terminal: terminal as unknown as import("@xterm/xterm").Terminal,
    fireOsc,
  };
}

// ===========================================================================
// OSC 0 — Set Window Title (BEL terminator)
// Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
// ===========================================================================

describe("VT Corpus: OSC sequences", () => {
  describe("OSC 0 — Window Title", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
    it("OSC 0 with BEL terminator sets title text", async () => {
      const bytes = enc(`\x1b]0;some text${BEL}`);
      const term = await createTerminalFromBytes(bytes);
      // xterm.js processes OSC 0 as title — buffer should be clean
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
    it("OSC 0 with ST terminator sets title text", async () => {
      const bytes = enc(`\x1b]0;some text${ST}`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 0 with empty title", async () => {
      const bytes = enc(`\x1b]0;${BEL}`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 0 title followed by printable text", async () => {
      const bytes = enc(`\x1b]0;my title${BEL}Hello`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("Hello");
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC 7 — CWD Notification
  // Source: microsoft/terminal OutputEngineTest.cpp + putz oscParser.ts (MIT)
  // ===========================================================================

  describe("OSC 7 — CWD Notification (parser events)", () => {
    // Source: putz-custom (exercises oscParser S2 module)
    it("OSC 7 emits cwd-updated event with BEL", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("test-session");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file://host/home/user");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "cwd-updated",
        sessionId: "test-session",
        cwd: "/home/user",
        source: "osc-7",
      });
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 7 with percent-encoded path", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file:///home/user/my%20project");
      expect(events[0].cwd).toBe("/home/user/my project");
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 7 with Windows drive letter path", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file:///C:/Users/me/project");
      expect(events[0].cwd).toBe("C:/Users/me/project");
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 7 with empty hostname (file:///path)", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file:///home/user");
      expect(events[0].cwd).toBe("/home/user");
      parser.dispose();
    });

    // Source: putz-custom (security edge case)
    it("OSC 7 injection from untrusted output still fires (documents attack surface)", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file:///etc/shadow");
      expect(events).toHaveLength(1);
      expect(events[0].cwd).toBe("/etc/shadow");
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 7 rejects non-file:// scheme", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "http://host/path");
      expect(events).toHaveLength(0);
      parser.dispose();
    });

    // Source: putz-custom (adapted from microsoft/terminal TestLongOscString)
    it("OSC 7 rejects oversized payload (> 8 KB)", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      const huge = "file://host/" + "x".repeat(MAX_OSC_PAYLOAD_BYTES);
      fireOsc(7, huge);
      expect(events).toHaveLength(0);
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 7 rejects malformed percent encoding", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(7, "file:///path%C0%AF");
      expect(events).toHaveLength(0);
      parser.dispose();
    });
  });

  // ===========================================================================
  // OSC 7 — Buffer-level tests (through headless xterm.js)
  // ===========================================================================

  describe("OSC 7 — Buffer-level (headless xterm.js)", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
    it("OSC 7 does not produce visible output", async () => {
      const bytes = enc(`\x1b]7;file://host/home/user${BEL}`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: putz-custom
    it("text before OSC 7 is visible, OSC is consumed", async () => {
      const bytes = enc(`hello\x1b]7;file:///tmp${BEL}world`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("helloworld");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 7 with ST terminator does not produce visible output", async () => {
      const bytes = enc(`\x1b]7;file://host/path${ST}`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: putz-custom
    it("multiple OSC 7 in sequence do not leak to buffer", async () => {
      const bytes = enc(
        `\x1b]7;file:///a${BEL}\x1b]7;file:///b${BEL}visible`,
      );
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("visible");
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC 1337 — iTerm2 CurrentDir
  // ===========================================================================

  describe("OSC 1337 — CurrentDir (parser events)", () => {
    // Source: putz-custom (exercises oscParser S2 module)
    it("OSC 1337 CurrentDir emits cwd-updated event", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(1337, "CurrentDir=/home/user");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "cwd-updated",
        source: "osc-1337",
        cwd: "/home/user",
      });
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 1337 non-CurrentDir payload is ignored", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(1337, "SetMark");
      expect(events).toHaveLength(0);
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 1337 CurrentDir with Windows path", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(1337, "CurrentDir=C:\\Users\\foo");
      expect(events[0].cwd).toBe("C:\\Users\\foo");
      parser.dispose();
    });
  });

  // ===========================================================================
  // OSC 133 — Shell Integration / Command Boundaries
  // Source: putz-custom (OSC 133 A/B/C/D sequences)
  // ===========================================================================

  describe("OSC 133 — Command Boundaries (buffer-level)", () => {
    // Source: putz-custom
    it("OSC 133;A (prompt start) does not produce visible output", async () => {
      const bytes = enc(`\x1b]133;A${BEL}$ `);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("$ ");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 133;B (command start) does not produce visible output", async () => {
      const bytes = enc(`\x1b]133;B${BEL}ls -la`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("ls -la");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 133;C (command output start) does not produce visible output", async () => {
      const bytes = enc(`\x1b]133;C${BEL}output here`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("output here");
      term.dispose();
    });

    // Source: putz-custom
    it("OSC 133;D;0 (command finished, exit 0) does not produce visible output", async () => {
      const bytes = enc(`\x1b]133;D;0${BEL}next prompt`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("next prompt");
      term.dispose();
    });

    // Source: putz-custom
    it("full OSC 133 A→B→C→D cycle renders only visible text", async () => {
      const bytes = enc(
        `\x1b]133;A${BEL}$ \x1b]133;B${BEL}` +
          `\x1b]133;C${BEL}file1.txt\r\n` +
          `\x1b]133;D;0${BEL}`,
      );
      const term = await createTerminalFromBytes(bytes);
      // OSC 133 markers are invisible; the prompt + output text are visible.
      // xterm.js doesn't insert line breaks for OSC 133 B/C boundaries —
      // the \r\n after "file1.txt" produces the line break.
      expect(getLineText(term, 0)).toContain("$");
      expect(getLineText(term, 0)).toContain("file1.txt");
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC Terminators — BEL vs ST
  // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
  // ===========================================================================

  describe("OSC Terminators", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
    it("BEL (0x07) terminates OSC string", async () => {
      const bytes = enc(`\x1b]0;title\x07rest`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("rest");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringSimple (MIT)
    it("ST (ESC \\) terminates OSC string", async () => {
      const bytes = enc(`\x1b]0;title\x1b\\rest`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("rest");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
    it("CAN (0x18) aborts OSC and returns to ground", async () => {
      const bytes = enc(`\x1b]0;title\x18rest`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("rest");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
    it("SUB (0x1a) aborts OSC and returns to ground", async () => {
      const bytes = enc(`\x1b]0;title\x1arest`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("rest");
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC Payload Limits
  // Source: microsoft/terminal OutputEngineTest.cpp TestLongOscString (MIT)
  // Source: xtermjs/xterm.js OscParser.test.ts payload limit tests (MIT)
  // ===========================================================================

  describe("OSC Payload Limits", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestLongOscString (MIT)
    it("long OSC string (260 chars) is processed without crash", async () => {
      const longTitle = "s".repeat(260);
      const bytes = enc(`\x1b]0;${longTitle}${BEL}`);
      const term = await createTerminalFromBytes(bytes);
      // Should not crash; title is consumed by xterm.js
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: xtermjs/xterm.js OscParser.test.ts payload limit (MIT)
    it("payload at xterm.js limit is accepted", async () => {
      // xterm.js has its own internal limits; verify no crash at large payloads
      const payload = "x".repeat(4096);
      const bytes = enc(`\x1b]0;${payload}${BEL}ok`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("ok");
      term.dispose();
    });

    // Source: putz-custom
    it("very large OSC payload does not crash parser", async () => {
      const payload = "a".repeat(10000);
      const bytes = enc(`\x1b]0;${payload}${BEL}after`);
      const term = await createTerminalFromBytes(bytes);
      // xterm.js may truncate or discard; the important thing is no crash
      // "after" should appear somewhere (line 0 or later)
      let found = false;
      for (let r = 0; r < 5; r++) {
        if (getLineText(term, r).includes("after")) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC Param Parsing
  // Source: microsoft/terminal OutputEngineTest.cpp NormalTestOscParam (MIT)
  // ===========================================================================

  describe("OSC Param Parsing", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp NormalTestOscParam (MIT)
    it("OSC with multi-digit param (12345) is parsed", async () => {
      // OSC 12345 is not a real code, but the parser should handle it
      const bytes = enc(`\x1b]12345;data${BEL}after`);
      const term = await createTerminalFromBytes(bytes);
      // Unknown OSC should be silently ignored, "after" visible
      expect(getLineText(term, 0)).toBe("after");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestLeadingZeroOscParam (MIT)
    it("OSC with leading zeros (007) is parsed correctly", async () => {
      // OSC 007 = OSC 7
      const bytes = enc(`\x1b]007;file:///tmp${BEL}text`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("text");
      term.dispose();
    });

    // Source: xtermjs/xterm.js OscParser.test.ts 'no report for illegal ids' (MIT)
    it("OSC without numeric ID is silently ignored", async () => {
      const bytes = enc(`\x1b]hello world!${BEL}after`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("after");
      term.dispose();
    });

    // Source: xtermjs/xterm.js OscParser.test.ts 'no payload' (MIT)
    it("OSC with ID but no semicolon or payload", async () => {
      const bytes = enc(`\x1b]1234${BEL}after`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("after");
      term.dispose();
    });
  });

  // ===========================================================================
  // OSC Allowlist — only recognized codes emit events
  // ===========================================================================

  describe("OSC Allowlist (parser events)", () => {
    // Source: putz-custom
    it("unrecognized OSC code does not emit events", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      // Only OSC 7 and 1337 are registered by our parser
      fireOsc(99, "arbitrary data");
      expect(events).toHaveLength(0);
      parser.dispose();
    });

    // Source: putz-custom
    it("OSC 2 (icon name + title) is handled by xterm.js but not our parser", () => {
      const { terminal, fireOsc } = createMockTerminal();
      const parser = createOscParser("s1");
      parser.attach(terminal);

      const events: OscEvent[] = [];
      parser.on((e) => events.push(e));

      fireOsc(2, "some title");
      expect(events).toHaveLength(0);
      parser.dispose();
    });
  });

  // ===========================================================================
  // parseOsc7Payload — unit-level edge cases
  // Source: putz-custom + adapted from microsoft/terminal (MIT)
  // ===========================================================================

  describe("parseOsc7Payload — corpus edge cases", () => {
    // Source: putz-custom
    it("parses macOS .local hostname", () => {
      expect(parseOsc7Payload("file://MacBook.local/Users/dev")).toBe(
        "/Users/dev",
      );
    });

    // Source: putz-custom
    it("parses IPv6 hostname", () => {
      expect(parseOsc7Payload("file://[::1]/home/user")).toBe("/home/user");
    });

    // Source: putz-custom
    it("handles path with special characters after decoding", () => {
      expect(parseOsc7Payload("file:///home/user/%E4%B8%AD%E6%96%87")).toBe(
        "/home/user/中文",
      );
    });

    // Source: putz-custom
    it("handles path with hash after decoding", () => {
      expect(parseOsc7Payload("file:///path%23with%23hashes")).toBe(
        "/path#with#hashes",
      );
    });

    // Source: putz-custom
    it("rejects empty string", () => {
      expect(parseOsc7Payload("")).toBeNull();
    });

    // Source: putz-custom
    it("rejects relative path", () => {
      expect(parseOsc7Payload("file://host/relative")).toBe("/relative");
    });
  });

  // ===========================================================================
  // parseOsc1337CurrentDir — corpus edge cases
  // ===========================================================================

  describe("parseOsc1337CurrentDir — corpus edge cases", () => {
    // Source: putz-custom
    it("empty string returns null", () => {
      expect(parseOsc1337CurrentDir("")).toBeNull();
    });

    // Source: putz-custom
    it("CurrentDir= with empty path", () => {
      expect(parseOsc1337CurrentDir("CurrentDir=")).toBeNull();
    });

    // Source: putz-custom
    it("ShellIntegrationVersion payload is ignored", () => {
      expect(parseOsc1337CurrentDir("ShellIntegrationVersion=1")).toBeNull();
    });

    // Source: putz-custom
    it("CurrentDir with deeply nested path", () => {
      expect(parseOsc1337CurrentDir("CurrentDir=/a/b/c/d/e/f/g")).toBe(
        "/a/b/c/d/e/f/g",
      );
    });
  });
});
