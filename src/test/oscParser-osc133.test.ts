/**
 * Unit tests for OSC 133 parsing and handshake gating in oscParser.
 *
 * Tests cover:
 *  - parseOsc133Payload: each marker (A/B/C/D/D;N/P;putz=1)
 *  - parseOsc133Payload: malformed/oversized payloads return null
 *  - Handshake gating: A/B/C/D before handshake → no event emitted
 *  - Handshake gating: A/B/C/D after handshake → events emitted
 *  - Multiple handshakes → idempotent
 *  - Cell position captured at OSC arrival time
 *  - Full A→B→C→D cycle through the parser
 *
 * @see https://github.com/vbomfim/putz/issues/102
 */
import { describe, it, expect } from "vitest";
import {
  parseOsc133Payload,
  createOscParser,
  MAX_OSC_PAYLOAD_BYTES,
} from "../lib/terminal/oscParser";
import type { OscEvent, Osc133Event } from "../lib/terminal/oscParser";
import { createMockTerminal } from "./utils/mockTerminal";

// ---------------------------------------------------------------------------
// Helper: filter only OSC 133 events from an array
// ---------------------------------------------------------------------------

function osc133Events(events: OscEvent[]): Osc133Event[] {
  return events.filter((e): e is Osc133Event => e.kind === "osc-133");
}

// ---------------------------------------------------------------------------
// parseOsc133Payload — unit tests
// ---------------------------------------------------------------------------

describe("parseOsc133Payload", () => {
  it("parses 'A' as prompt-start", () => {
    expect(parseOsc133Payload("A")).toEqual({ marker: "prompt-start" });
  });

  it("parses 'B' as command-start", () => {
    expect(parseOsc133Payload("B")).toEqual({ marker: "command-start" });
  });

  it("parses 'C' as output-start", () => {
    expect(parseOsc133Payload("C")).toEqual({ marker: "output-start" });
  });

  it("parses 'D' as command-end (no exit code)", () => {
    expect(parseOsc133Payload("D")).toEqual({ marker: "command-end" });
  });

  it("parses 'D;0' as command-end with exit code 0", () => {
    expect(parseOsc133Payload("D;0")).toEqual({
      marker: "command-end",
      exitCode: 0,
    });
  });

  it("parses 'D;1' as command-end with exit code 1", () => {
    expect(parseOsc133Payload("D;1")).toEqual({
      marker: "command-end",
      exitCode: 1,
    });
  });

  it("parses 'D;127' as command-end with exit code 127", () => {
    expect(parseOsc133Payload("D;127")).toEqual({
      marker: "command-end",
      exitCode: 127,
    });
  });

  it("parses 'D;255' as command-end with exit code 255", () => {
    expect(parseOsc133Payload("D;255")).toEqual({
      marker: "command-end",
      exitCode: 255,
    });
  });

  it("parses 'P;putz=1' as handshake", () => {
    expect(parseOsc133Payload("P;putz=1")).toEqual({ marker: "handshake" });
  });

  // --- Malformed payloads ---

  it("rejects 'D;abc' (non-numeric exit code)", () => {
    expect(parseOsc133Payload("D;abc")).toBeNull();
  });

  it("rejects 'D;-1' (negative exit code)", () => {
    expect(parseOsc133Payload("D;-1")).toBeNull();
  });

  it("rejects 'D;256' (exit code > 255)", () => {
    expect(parseOsc133Payload("D;256")).toBeNull();
  });

  it("rejects 'D;999' (exit code > 255)", () => {
    expect(parseOsc133Payload("D;999")).toBeNull();
  });

  it("rejects 'D;' (empty exit code)", () => {
    expect(parseOsc133Payload("D;")).toBeNull();
  });

  it("rejects 'D;3.14' (float — strict digits-only after fix)", () => {
    // Previously parseInt("3.14") truncated to 3; now strict regex rejects non-digit chars.
    expect(parseOsc133Payload("D;3.14")).toBeNull();
  });

  it("rejects 'D;10abc' (trailing garbage)", () => {
    expect(parseOsc133Payload("D;10abc")).toBeNull();
  });

  it("rejects 'D; 5' (leading space)", () => {
    expect(parseOsc133Payload("D; 5")).toBeNull();
  });

  it("rejects 'D;0x10' (hex prefix)", () => {
    expect(parseOsc133Payload("D;0x10")).toBeNull();
  });

  it("rejects 'D;1e2' (scientific notation)", () => {
    expect(parseOsc133Payload("D;1e2")).toBeNull();
  });

  it("rejects 'Z' (unknown marker)", () => {
    expect(parseOsc133Payload("Z")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseOsc133Payload("")).toBeNull();
  });

  it("rejects 'P;other=1' (unknown P subparameter)", () => {
    expect(parseOsc133Payload("P;other=1")).toBeNull();
  });

  it("rejects 'P;putz=2' (wrong handshake value)", () => {
    expect(parseOsc133Payload("P;putz=2")).toBeNull();
  });

  it("rejects oversized payload (> MAX_OSC_PAYLOAD_BYTES / 2 chars)", () => {
    const huge = "A" + "x".repeat(MAX_OSC_PAYLOAD_BYTES / 2);
    expect(parseOsc133Payload(huge)).toBeNull();
  });

  it("rejects 'AB' (multi-char marker)", () => {
    expect(parseOsc133Payload("AB")).toBeNull();
  });

  it("rejects lowercase 'a' (case-sensitive)", () => {
    expect(parseOsc133Payload("a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createOscParser — OSC 133 handler + handshake gating tests
// ---------------------------------------------------------------------------

describe("createOscParser — OSC 133 handshake gating", () => {
  it("emits handshake event for P;putz=1", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-133");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "P;putz=1");

    const osc133 = osc133Events(events);
    expect(osc133).toHaveLength(1);
    expect(osc133[0].marker).toBe("handshake");
    expect(osc133[0].sessionId).toBe("sess-133");

    parser.dispose();
  });

  it("blocks A/B/C/D events before handshake", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-no-hs");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "A");
    fireOsc(133, "B");
    fireOsc(133, "C");
    fireOsc(133, "D;0");

    // No events should be emitted — trust gate is closed
    expect(osc133Events(events)).toHaveLength(0);

    parser.dispose();
  });

  it("emits A/B/C/D events after handshake", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-hs");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Handshake first
    fireOsc(133, "P;putz=1");

    // Now markers should pass
    fireOsc(133, "A");
    fireOsc(133, "B");
    fireOsc(133, "C");
    fireOsc(133, "D;0");

    const osc133 = osc133Events(events);
    // handshake + A + B + C + D = 5 events
    expect(osc133).toHaveLength(5);
    expect(osc133[0].marker).toBe("handshake");
    expect(osc133[1].marker).toBe("prompt-start");
    expect(osc133[2].marker).toBe("command-start");
    expect(osc133[3].marker).toBe("output-start");
    expect(osc133[4].marker).toBe("command-end");
    expect(osc133[4].exitCode).toBe(0);

    parser.dispose();
  });

  it("multiple handshakes are idempotent", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-multi-hs");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "P;putz=1");
    fireOsc(133, "P;putz=1");
    fireOsc(133, "P;putz=1");

    // All three handshake events are emitted (idempotent — doesn't break)
    const osc133 = osc133Events(events);
    expect(osc133).toHaveLength(3);
    expect(osc133.every((e) => e.marker === "handshake")).toBe(true);

    // And markers still work after repeated handshakes
    fireOsc(133, "A");
    expect(osc133Events(events)).toHaveLength(4);

    parser.dispose();
  });

  it("spoofing attempt: A/B/C/D from unhandshaked session → no events", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-spoof");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Simulate `cat malicious.txt` containing OSC 133 markers
    fireOsc(133, "A");
    fireOsc(133, "B");
    fireOsc(133, "C");
    fireOsc(133, "D;0");

    expect(osc133Events(events)).toHaveLength(0);

    parser.dispose();
  });

  it("spoofing then handshake: only post-handshake events emitted", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-spoof-then-hs");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Spoofed (should be dropped)
    fireOsc(133, "A");
    fireOsc(133, "D;1");
    expect(osc133Events(events)).toHaveLength(0);

    // Now handshake
    fireOsc(133, "P;putz=1");
    expect(osc133Events(events)).toHaveLength(1);

    // Post-handshake (should emit)
    fireOsc(133, "A");
    fireOsc(133, "D;0");
    expect(osc133Events(events)).toHaveLength(3);

    parser.dispose();
  });
});

// ---------------------------------------------------------------------------
// createOscParser — OSC 133 cell position tests
// ---------------------------------------------------------------------------

describe("createOscParser — OSC 133 cell position", () => {
  it("captures cursor position at OSC arrival time", () => {
    const { terminal, fireOsc, setCursor } = createMockTerminal();
    const parser = createOscParser("sess-cell");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Handshake at cursor (0, 0)
    setCursor(0, 0);
    fireOsc(133, "P;putz=1");

    // Prompt at cursor (5, 2)
    setCursor(5, 2);
    fireOsc(133, "A");

    // Command start at cursor (5, 10)
    setCursor(5, 10);
    fireOsc(133, "B");

    // Output at cursor (6, 0)
    setCursor(6, 0);
    fireOsc(133, "C");

    // Command end at cursor (15, 0)
    setCursor(15, 0);
    fireOsc(133, "D;0");

    const osc133 = osc133Events(events);
    expect(osc133).toHaveLength(5);

    expect(osc133[0].cell).toEqual({ row: 0, col: 0 }); // handshake
    expect(osc133[1].cell).toEqual({ row: 5, col: 2 }); // prompt-start
    expect(osc133[2].cell).toEqual({ row: 5, col: 10 }); // command-start
    expect(osc133[3].cell).toEqual({ row: 6, col: 0 }); // output-start
    expect(osc133[4].cell).toEqual({ row: 15, col: 0 }); // command-end

    parser.dispose();
  });

  it("handshake event also captures cell position", () => {
    const { terminal, fireOsc, setCursor } = createMockTerminal();
    const parser = createOscParser("sess-hs-cell");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    setCursor(3, 7);
    fireOsc(133, "P;putz=1");

    const osc133 = osc133Events(events);
    expect(osc133[0].cell).toEqual({ row: 3, col: 7 });

    parser.dispose();
  });

  it("captures absolute row (baseY + cursorY) when scrollback is non-zero", () => {
    const { terminal, fireOsc, setCursor, setBaseY } = createMockTerminal();
    const parser = createOscParser("sess-scrollback");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Handshake at origin
    setCursor(0, 0);
    fireOsc(133, "P;putz=1");

    // Simulate scrollback: 30 lines have scrolled past the viewport
    setBaseY(30);
    // Cursor is at viewport row 5, col 0 → absolute row = 30 + 5 = 35
    setCursor(5, 0);
    fireOsc(133, "A");

    const osc133 = osc133Events(events);
    expect(osc133[1].marker).toBe("prompt-start");
    // Must be absolute (35), NOT viewport-relative (5)
    expect(osc133[1].cell).toEqual({ row: 35, col: 0 });

    parser.dispose();
  });
});

describe("createOscParser — OSC 133 exit code handling", () => {
  it("D without exit code emits exitCode undefined", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-exit");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "P;putz=1");
    fireOsc(133, "D");

    const osc133 = osc133Events(events);
    expect(osc133[1].marker).toBe("command-end");
    expect(osc133[1].exitCode).toBeUndefined();

    parser.dispose();
  });

  it("D;127 emits exitCode 127 (command not found)", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-exit127");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "P;putz=1");
    fireOsc(133, "D;127");

    const osc133 = osc133Events(events);
    expect(osc133[1].exitCode).toBe(127);

    parser.dispose();
  });

  it("malformed D;abc does not emit any event", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-bad-exit");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(133, "P;putz=1");
    fireOsc(133, "D;abc");

    const osc133 = osc133Events(events);
    // Only handshake, no command-end
    expect(osc133).toHaveLength(1);

    parser.dispose();
  });
});

// ---------------------------------------------------------------------------
// createOscParser — OSC 133 does not interfere with CWD events
// ---------------------------------------------------------------------------

describe("createOscParser — OSC 133 + CWD coexistence", () => {
  it("OSC 7 cwd events still work alongside OSC 133", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-mixed");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(7, "file:///home/user");
    fireOsc(133, "P;putz=1");
    fireOsc(133, "A");

    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("cwd-updated");
    expect(events[1].kind).toBe("osc-133");
    expect(events[2].kind).toBe("osc-133");

    parser.dispose();
  });

  it("dispose stops both CWD and OSC 133 events", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("sess-dispose-all");
    parser.attach(terminal);

    const events: OscEvent[] = [];
    parser.on((e) => events.push(e));

    parser.dispose();

    fireOsc(7, "file:///tmp");
    fireOsc(133, "P;putz=1");

    expect(events).toHaveLength(0);
  });
});
