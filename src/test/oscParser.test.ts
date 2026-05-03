/**
 * Unit tests for the OSC parser module.
 *
 * Tests cover:
 *  - OSC 7 payload parsing (hostname, empty host, percent-encoded, Windows paths)
 *  - OSC 1337 CurrentDir parsing
 *  - Size caps (8 KB payload, 4096 byte path)
 *  - UTF-8 validation (malformed percent encoding)
 *  - Allowlist behavior (only OSC 7 and OSC 1337 handled)
 *  - Factory lifecycle (attach, on, dispose)
 *
 * @see https://github.com/vbomfim/putz/issues/100
 */
import { describe, it, expect } from "vitest";
import {
  parseOsc7Payload,
  parseOsc1337CurrentDir,
  createOscParser,
  MAX_OSC_PAYLOAD_BYTES,
  MAX_CWD_PATH_BYTES,
} from "../lib/terminal/oscParser";
import { createMockTerminal } from "./utils/mockTerminal";

// ---------------------------------------------------------------------------
// parseOsc7Payload — unit tests
// ---------------------------------------------------------------------------

describe("parseOsc7Payload", () => {
  it("parses standard OSC 7 with hostname", () => {
    expect(parseOsc7Payload("file://host/Users/me/projects")).toBe(
      "/Users/me/projects",
    );
  });

  it("parses OSC 7 with empty hostname (file:///path)", () => {
    expect(parseOsc7Payload("file:///home/user")).toBe("/home/user");
  });

  it("parses OSC 7 with percent-encoded path (spaces)", () => {
    expect(parseOsc7Payload("file:///path%20with%20spaces")).toBe(
      "/path with spaces",
    );
  });

  it("parses OSC 7 with percent-encoded special chars", () => {
    expect(parseOsc7Payload("file:///path%23with%23hashes")).toBe(
      "/path#with#hashes",
    );
  });

  it("parses Windows-style path (drive letter)", () => {
    expect(parseOsc7Payload("file:///C:/Users/me")).toBe("C:/Users/me");
  });

  it("parses Windows path with backslashes after decoding", () => {
    expect(parseOsc7Payload("file:///C%3A%5CUsers%5Cme")).toBe("C:\\Users\\me");
  });

  it("rejects path > 4096 bytes", () => {
    const longPath = "/home/" + "a".repeat(MAX_CWD_PATH_BYTES);
    expect(parseOsc7Payload(`file://host${longPath}`)).toBeNull();
  });

  it("rejects payload > 8 KB", () => {
    const hugePayload = "file://host/" + "a".repeat(MAX_OSC_PAYLOAD_BYTES);
    expect(parseOsc7Payload(hugePayload)).toBeNull();
  });

  it("rejects malformed percent encoding (non-UTF-8)", () => {
    // %C0%AF is an overlong encoding of '/' — invalid UTF-8
    expect(parseOsc7Payload("file:///path%C0%AF")).toBeNull();
  });

  it("rejects empty payload", () => {
    expect(parseOsc7Payload("")).toBeNull();
  });

  it("rejects payload without file:// prefix", () => {
    expect(parseOsc7Payload("http://host/path")).toBeNull();
  });

  it("rejects file:// without a path slash", () => {
    expect(parseOsc7Payload("file://hostnoslash")).toBeNull();
  });

  it("handles hostname with dots (macOS .local)", () => {
    expect(parseOsc7Payload("file://Mac.local/Users/foo/dev%20stuff")).toBe(
      "/Users/foo/dev stuff",
    );
  });

  it("handles deeply nested path", () => {
    expect(parseOsc7Payload("file:///a/b/c/d/e/f/g/h/i/j/k/l")).toBe(
      "/a/b/c/d/e/f/g/h/i/j/k/l",
    );
  });

  it("preserves trailing path segments", () => {
    expect(parseOsc7Payload("file:///home/user/")).toBe("/home/user/");
  });
});

// ---------------------------------------------------------------------------
// parseOsc1337CurrentDir — unit tests
// ---------------------------------------------------------------------------

describe("parseOsc1337CurrentDir", () => {
  it("parses CurrentDir= payload", () => {
    expect(parseOsc1337CurrentDir("CurrentDir=/home/user")).toBe("/home/user");
  });

  it("parses CurrentDir= with Windows path", () => {
    expect(parseOsc1337CurrentDir("CurrentDir=C:\\Users\\foo")).toBe(
      "C:\\Users\\foo",
    );
  });

  it("returns null for non-CurrentDir payloads", () => {
    expect(parseOsc1337CurrentDir("SetMark")).toBeNull();
    expect(parseOsc1337CurrentDir("ShellIntegrationVersion=1")).toBeNull();
  });

  it("returns null for empty payload", () => {
    expect(parseOsc1337CurrentDir("")).toBeNull();
  });

  it("rejects payload > 8 KB", () => {
    const huge = "CurrentDir=/" + "a".repeat(MAX_OSC_PAYLOAD_BYTES);
    expect(parseOsc1337CurrentDir(huge)).toBeNull();
  });

  it("rejects path > 4096 bytes", () => {
    const longPath = "/" + "a".repeat(MAX_CWD_PATH_BYTES);
    expect(parseOsc1337CurrentDir(`CurrentDir=${longPath}`)).toBeNull();
  });

  it("rejects invalid UTF-8 percent sequences (%FF%FE)", () => {
    // %FF%FE is not valid UTF-8 — decodeURIComponent must throw, parser returns null
    expect(parseOsc1337CurrentDir("CurrentDir=%FF%FE")).toBeNull();
  });

  it("decodes percent-encoded paths (symmetric with OSC 7)", () => {
    expect(parseOsc1337CurrentDir("CurrentDir=/path%20with%20spaces")).toBe(
      "/path with spaces",
    );
  });
});

describe("parseOsc1337CurrentDir + createOscParser integration", () => {
  it("does not emit event for invalid UTF-8 in OSC 1337", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    // Invalid UTF-8 percent-encoded path — should be silently rejected
    fireOsc(1337, "CurrentDir=%FF%FE");

    expect(events).toHaveLength(0);

    parser.dispose();
  });
});

// ---------------------------------------------------------------------------
// createOscParser — factory + lifecycle tests
// ---------------------------------------------------------------------------

describe("createOscParser", () => {
  it("registers OSC 7, OSC 133, and OSC 1337 handlers (allowlist)", () => {
    const { terminal, registeredCodes } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const codes = registeredCodes().sort((a, b) => a - b);
    expect(codes).toEqual([7, 133, 1337]);

    parser.dispose();
  });

  it("emits cwd-updated event for OSC 7", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(7, "file:///home/user");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "cwd-updated",
      sessionId: "session-1",
      cwd: "/home/user",
      source: "osc-7",
    });

    parser.dispose();
  });

  it("emits cwd-updated event for OSC 1337 CurrentDir", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(1337, "CurrentDir=/tmp");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: "cwd-updated",
      sessionId: "session-1",
      cwd: "/tmp",
      source: "osc-1337",
    });

    parser.dispose();
  });

  it("does not emit for unrecognized OSC codes", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    // OSC 2 (window title) — not in allowlist
    fireOsc(2, "My Terminal");

    expect(events).toHaveLength(0);

    parser.dispose();
  });

  it("does not emit for invalid OSC 7 payloads", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(7, "not-a-file-url");

    expect(events).toHaveLength(0);

    parser.dispose();
  });

  it("emits multiple events for sequential OSC 7s (cwd changes)", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    fireOsc(7, "file:///home/user");
    fireOsc(7, "file:///home/user/projects");
    fireOsc(7, "file:///tmp");

    expect(events).toHaveLength(3);
    expect(events[0].cwd).toBe("/home/user");
    expect(events[1].cwd).toBe("/home/user/projects");
    expect(events[2].cwd).toBe("/tmp");

    parser.dispose();
  });

  it("unsubscribe stops event delivery", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    const unsub = parser.on((e) => events.push(e));

    fireOsc(7, "file:///home/user");
    expect(events).toHaveLength(1);

    unsub();

    fireOsc(7, "file:///tmp");
    expect(events).toHaveLength(1); // no new event

    parser.dispose();
  });

  it("dispose stops all event delivery", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    parser.dispose();

    fireOsc(7, "file:///home/user");
    expect(events).toHaveLength(0);
  });

  it("rejects OSC 7 payload > 8 KB in parser context", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on((e) => events.push(e));

    const huge = "file://host/" + "x".repeat(MAX_OSC_PAYLOAD_BYTES);
    fireOsc(7, huge);

    expect(events).toHaveLength(0);

    parser.dispose();
  });

  it("listener errors do not break the parser", () => {
    const { terminal, fireOsc } = createMockTerminal();
    const parser = createOscParser("session-1");
    parser.attach(terminal);

    const events: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser.on(() => {
      throw new Error("kaboom");
    });
    parser.on((e) => events.push(e));

    fireOsc(7, "file:///home/user");

    // Second listener should still receive the event
    expect(events).toHaveLength(1);

    parser.dispose();
  });

  it("scopes events to the correct sessionId", () => {
    const { terminal: t1, fireOsc: fire1 } = createMockTerminal();
    const { terminal: t2, fireOsc: fire2 } = createMockTerminal();

    const parser1 = createOscParser("sess-a");
    const parser2 = createOscParser("sess-b");
    parser1.attach(t1);
    parser2.attach(t2);

    const events1: import("../lib/terminal/oscParser").OscEvent[] = [];
    const events2: import("../lib/terminal/oscParser").OscEvent[] = [];
    parser1.on((e) => events1.push(e));
    parser2.on((e) => events2.push(e));

    fire1(7, "file:///a");
    fire2(7, "file:///b");

    expect(events1).toHaveLength(1);
    expect(events1[0].sessionId).toBe("sess-a");
    expect(events1[0].cwd).toBe("/a");

    expect(events2).toHaveLength(1);
    expect(events2[0].sessionId).toBe("sess-b");
    expect(events2[0].cwd).toBe("/b");

    parser1.dispose();
    parser2.dispose();
  });
});
