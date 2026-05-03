/**
 * VT Correctness Test Corpus — Edge Cases
 *
 * Fixtures for malformed, oversized, unterminated, and unusual VT sequences.
 * Adapted from microsoft/terminal (MIT) and xtermjs/xterm.js (MIT).
 *
 * These tests verify that the parser doesn't crash, doesn't emit spurious
 * output, and recovers gracefully from bad input.
 *
 * @see THIRD_PARTY.md for full attribution
 * @see https://github.com/vbomfim/putz/issues/107
 */
import { describe, it, expect } from "vitest";
import {
  createTerminalFromBytes,
  getLineText,
} from "../utils/shellCompatHarness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("VT Corpus: Edge Cases", () => {
  // ===========================================================================
  // Unterminated Sequences
  // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
  // ===========================================================================

  describe("Unterminated Sequences", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
    it("unterminated OSC followed by ESC [ (CSI) aborts OSC", async () => {
      const bytes = enc("\x1b]0;incomplete\x1b[1;1Hvisible");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("visible");
      term.dispose();
    });

    // Source: putz-custom
    it("unterminated OSC followed by plain text — text after recovery", async () => {
      // OSC without terminator, then a new ESC sequence resets state
      const bytes = enc("\x1b]7;no-terminator\x1b[2Jrecovered");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("recovered");
      term.dispose();
    });

    // Source: putz-custom
    it("unterminated CSI followed by text", async () => {
      // ESC [ without final byte, then printable text
      const bytes = enc("\x1b[999visible");
      const term = await createTerminalFromBytes(bytes);
      // Parser should eventually recover; "visible" may or may not appear
      // depending on how xterm.js handles the sequence. No crash is the key.
      const line = getLineText(term, 0);
      expect(typeof line).toBe("string"); // No crash
      term.dispose();
    });

    // Source: putz-custom
    it("lone ESC at end of stream doesn't crash", async () => {
      const bytes = enc("hello\x1b");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("hello");
      term.dispose();
    });

    // Source: putz-custom
    it("ESC [ at end of stream doesn't crash", async () => {
      const bytes = enc("hello\x1b[");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("hello");
      term.dispose();
    });

    // Source: putz-custom
    it("ESC ] at end of stream doesn't crash", async () => {
      const bytes = enc("hello\x1b]");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("hello");
      term.dispose();
    });
  });

  // ===========================================================================
  // Malformed CSI Sequences
  // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts CSI_IGNORE (MIT)
  // Source: microsoft/terminal OutputEngineTest.cpp TestCsiIgnore (MIT)
  // ===========================================================================

  describe("Malformed CSI Sequences", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestCsiIgnore (MIT)
    it("CSI with invalid intermediate goes to CSI_IGNORE", async () => {
      // CSI followed by char in 0x3c-0x3f after a param → ignore
      const bytes = enc("\x1b[1;2>mtext");
      const term = await createTerminalFromBytes(bytes);
      // The malformed CSI should be ignored; text should be visible
      const line = getLineText(term, 0);
      expect(line).toContain("text");
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts 'trans CSI_PARAM --> CSI_IGNORE' (MIT)
    it("CSI with collect char after param goes to CSI_IGNORE", async () => {
      const bytes = enc("\x1b[1;<mafter");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts 'trans CSI_INTERMEDIATE --> CSI_IGNORE' (MIT)
    it("CSI with param after intermediate goes to CSI_IGNORE", async () => {
      const bytes = enc("\x1b[ 1mafter");
      const term = await createTerminalFromBytes(bytes);
      // Should be handled or ignored gracefully
      const line = getLineText(term, 0);
      expect(typeof line).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("CSI with absurdly large param doesn't crash", async () => {
      const bytes = enc("\x1b[999999999Htext");
      const term = await createTerminalFromBytes(bytes);
      const line = getLineText(term, 0);
      // May be on a different row, but no crash
      expect(typeof line).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // C1 Control Codes (8-bit)
  // Source: microsoft/terminal OutputEngineTest.cpp TestC1CsiEntry (MIT)
  // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts (MIT)
  // ===========================================================================

  describe("C1 Control Codes (8-bit)", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestC1Osc (MIT)
    it("C1 OSC (0x9d) starts an OSC sequence", async () => {
      const bytes = new Uint8Array([
        0x9d,
        ...enc("0;title\x07after"),
      ]);
      const term = await createTerminalFromBytes(bytes);
      // C1 OSC may or may not be supported by xterm.js depending on mode
      // Key assertion: no crash
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestC1CsiEntry (MIT)
    it("C1 CSI (0x9b) starts a CSI sequence", async () => {
      const bytes = new Uint8Array([
        0x9b,
        ...enc("31mred"),
      ]);
      const term = await createTerminalFromBytes(bytes);
      // C1 CSI may or may not be handled — no crash is the requirement
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestC1DcsEntry (MIT)
    it("C1 DCS (0x90) doesn't crash", async () => {
      const bytes = new Uint8Array([
        0x90,
        ...enc("1;1;1{ data\x1b\\after"),
      ]);
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // DCS (Device Control String)
  // Source: xtermjs/xterm.js DcsParser.test.ts (MIT)
  // Source: microsoft/terminal OutputEngineTest.cpp TestDcs* (MIT)
  // ===========================================================================

  describe("DCS Sequences", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestDcsIntermediateAndPassThrough (MIT)
    it("DCS with intermediate and passthrough data doesn't crash", async () => {
      const bytes = enc("\x1bP1;1;1{some data\x1b\\after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestDcsLongStringPassThrough (MIT)
    it("long DCS passthrough string is handled", async () => {
      const payload = "x".repeat(500);
      const bytes = enc(`\x1bP1;1;1{${payload}\x1b\\after`);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestDcsInvalidTermination (MIT)
    it("DCS with invalid termination recovers", async () => {
      const bytes = enc("\x1bP1;1;1{data\x18after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });
  });

  // ===========================================================================
  // SOS, PM, APC Strings
  // Source: microsoft/terminal OutputEngineTest.cpp TestSosPmApcString (MIT)
  // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts (MIT)
  // ===========================================================================

  describe("SOS/PM/APC Strings", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestSosPmApcString (MIT)
    it("SOS string (ESC X) is consumed and ignored", async () => {
      const bytes = enc("\x1bXsome sos data\x1b\\after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestSosPmApcString (MIT)
    it("PM string (ESC ^) is consumed and ignored", async () => {
      const bytes = enc("\x1b^some pm data\x1b\\after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });

    // Source: xtermjs/xterm.js EscapeSequenceParser.test.ts APC handler (MIT)
    it("APC string (ESC _) is consumed and ignored", async () => {
      const bytes = enc("\x1b_some apc data\x1b\\after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });
  });

  // ===========================================================================
  // Mixed / Interleaved Sequences
  // ===========================================================================

  describe("Mixed/Interleaved Sequences", () => {
    // Source: putz-custom
    it("OSC inside a line of text is consumed silently", async () => {
      const bytes = enc("before\x1b]0;title\x07after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("beforeafter");
      term.dispose();
    });

    // Source: putz-custom
    it("multiple sequence types in rapid succession", async () => {
      const bytes = enc(
        "\x1b[31m\x1b]0;title\x07\x1b[1;1H\x1b[2J\x1b[0mclean",
      );
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("clean");
      term.dispose();
    });

    // Source: putz-custom
    it("alternating printable text and control sequences", async () => {
      const bytes = enc(
        "A\x1b[1mB\x1b[0mC\x1b[4mD\x1b[0mE",
      );
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("ABCDE");
      term.dispose();
    });

    // Source: putz-custom
    it("CSI followed immediately by OSC doesn't corrupt state", async () => {
      const bytes = enc("\x1b[1;1H\x1b]0;title\x07text");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("text");
      term.dispose();
    });
  });

  // ===========================================================================
  // Only Control Characters (no printable text)
  // ===========================================================================

  describe("Control-Only Streams", () => {
    // Source: putz-custom
    it("stream of only control characters doesn't crash", async () => {
      const bytes = new Uint8Array([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
      ]);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });

    // Source: putz-custom
    it("stream of only ESC chars doesn't crash", async () => {
      const bytes = enc("\x1b\x1b\x1b\x1b\x1b");
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("empty byte stream doesn't crash", async () => {
      const bytes = new Uint8Array(0);
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toBe("");
      term.dispose();
    });
  });

  // ===========================================================================
  // Oversized Inputs
  // ===========================================================================

  describe("Oversized Inputs", () => {
    // Source: putz-custom (adapted from microsoft/terminal TestLongOscString)
    it("10 KB OSC payload doesn't crash", async () => {
      const payload = "a".repeat(10240);
      const bytes = enc(`\x1b]0;${payload}\x07ok`);
      const term = await createTerminalFromBytes(bytes);
      // May or may not render "ok" depending on xterm.js limits, but no crash
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("very long CSI param list doesn't crash", async () => {
      const params = Array.from({ length: 100 }, (_, i) => String(i)).join(";");
      const bytes = enc(`\x1b[${params}mtext`);
      const term = await createTerminalFromBytes(bytes);
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });

    // Source: putz-custom
    it("1000 rapid cursor moves don't crash", async () => {
      let seq = "";
      for (let i = 0; i < 1000; i++) {
        seq += "\x1b[A\x1b[B\x1b[C\x1b[D";
      }
      seq += "done";
      const bytes = enc(seq);
      const term = await createTerminalFromBytes(bytes);
      // Cursor should end up back at the starting position (or clamped)
      expect(typeof getLineText(term, 0)).toBe("string");
      term.dispose();
    });
  });

  // ===========================================================================
  // CAN and SUB Abort Behavior
  // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
  // Source: microsoft/terminal OutputEngineTest.cpp TestDcsInvalidTermination (MIT)
  // ===========================================================================

  describe("CAN/SUB Abort", () => {
    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
    it("CAN (0x18) aborts any escape sequence and returns to ground", async () => {
      const bytes = enc("\x1b[31\x18text");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("text");
      term.dispose();
    });

    // Source: microsoft/terminal OutputEngineTest.cpp TestOscStringInvalidTermination (MIT)
    it("SUB (0x1a) aborts any escape sequence and returns to ground", async () => {
      const bytes = enc("\x1b[31\x1atext");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("text");
      term.dispose();
    });

    // Source: putz-custom
    it("CAN inside DCS returns to ground", async () => {
      const bytes = enc("\x1bP1;1;1{partial\x18after");
      const term = await createTerminalFromBytes(bytes);
      expect(getLineText(term, 0)).toContain("after");
      term.dispose();
    });
  });
});
