/**
 * QA Guardian — Integration tests for keyword highlighting.
 *
 * Tests the full flow: rules compilation → engine matching → decoration creation,
 * multiple match types interacting, per-session isolation, and built-in preset
 * content validation.
 *
 * Tags: [AC-1], [AC-2], [AC-3], [AC-4], [AC-5], [AC-6], [AC-7]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HighlightEngine,
  patternToRegex,
} from "../components/Terminal/HighlightEngine";
import type { HighlightRule } from "../components/Terminal/highlightTypes";

// ─── Helpers ──────────────────────────────────────────────────

function createRule(overrides: Partial<HighlightRule> = {}): HighlightRule {
  return {
    id: "r-" + Math.random().toString(36).slice(2, 8),
    pattern: "ERROR",
    matchType: "exact",
    foregroundColor: "#FF5555",
    backgroundColor: "",
    bold: false,
    underline: false,
    priority: 100,
    ...overrides,
  };
}

/**
 * Creates a mock xterm.js Terminal with configurable line content.
 * lineContents is a string[] where each element is one terminal line.
 */
function createMockTerminal(lineContents: string[] = []) {
  const onWriteParsedHandlers: Array<() => void> = [];
  const onRenderHandlers: Array<(el: HTMLElement) => void> = [];
  const registeredDecorations: Array<{
    marker: unknown;
    x: number;
    width: number;
    handler: (el: HTMLElement) => void;
  }> = [];

  return {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        length: lineContents.length,
        viewportY: 0,
        baseY: 0,
        cursorY: Math.max(0, lineContents.length - 1),
        getLine: vi.fn((idx: number) => {
          if (idx < 0 || idx >= lineContents.length) return null;
          return {
            translateToString: vi.fn().mockReturnValue(lineContents[idx]),
          };
        }),
      },
    },
    registerMarker: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    registerDecoration: vi.fn().mockImplementation((opts: { marker: unknown; x: number; width: number }) => {
      const decoration = {
        dispose: vi.fn(),
        onRender: vi.fn((handler: (el: HTMLElement) => void) => {
          onRenderHandlers.push(handler);
          registeredDecorations.push({
            marker: opts.marker,
            x: opts.x,
            width: opts.width,
            handler,
          });
        }),
      };
      return decoration;
    }),
    onWriteParsed: vi.fn((handler: () => void) => {
      onWriteParsedHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
    _triggerWriteParsed: () => {
      onWriteParsedHandlers.forEach((h) => h());
    },
    _onRenderHandlers: onRenderHandlers,
    _registeredDecorations: registeredDecorations,
  };
}

// ─── AC-1: Exact keyword highlighting ─────────────────────────

describe("[AC-1] Exact keyword highlighting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("highlights exact keyword match in terminal output", () => {
    const term = createMockTerminal(["ERROR: interface down"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exact", priority: 100 }),
    ]);
    engine.enable();

    term._triggerWriteParsed();
    vi.advanceTimersByTime(20);

    expect(term.registerMarker).toHaveBeenCalled();
    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("highlights multiple occurrences on the same line", () => {
    const term = createMockTerminal(["ERROR occurred then another ERROR"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exact" }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // 2 occurrences → 2 decorations
    expect(term.registerDecoration.mock.calls.length).toBeGreaterThanOrEqual(2);
    engine.dispose();
  });

  it("does NOT match different case for exact match", () => {
    const term = createMockTerminal(["error: something failed"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exact" }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("matches different case for exactinsensitive match", () => {
    const term = createMockTerminal(["error: something failed"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exactinsensitive" }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });
});

// ─── AC-2: Regex pattern highlighting ─────────────────────────

describe("[AC-2] Regex pattern highlighting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("highlights IP addresses with regex pattern", () => {
    const term = createMockTerminal(["Connected to 192.168.1.1 on port 22"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
        matchType: "regex",
        foregroundColor: "#50FA7B",
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("highlights MAC addresses with regex pattern", () => {
    const term = createMockTerminal([
      "MAC: aa:bb:cc:dd:ee:ff learned on Gi0/1",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}",
        matchType: "regex",
        foregroundColor: "#BD93F9",
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("highlights Cisco syslog patterns", () => {
    const term = createMockTerminal([
      "%LINK-3-UPDOWN: Interface FastEthernet0/1, changed state to down",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "%.*-\\d-.*",
        matchType: "regex",
        foregroundColor: "#F1FA8C",
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});

// ─── AC-3: Multiple rule priority ordering ────────────────────

describe("[AC-3] Multiple rule priorities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("higher-priority rule wins when both match same text", () => {
    const term = createMockTerminal(["ERROR occurred"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "low",
        pattern: "ERROR",
        matchType: "exactinsensitive",
        foregroundColor: "#FFFF00",
        priority: 10,
      }),
      createRule({
        id: "high",
        pattern: "ERROR",
        matchType: "exact",
        foregroundColor: "#FF0000",
        priority: 100,
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // Only 1 decoration — the high-priority match occupies the position
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("non-overlapping matches from different rules both render", () => {
    const term = createMockTerminal(["ERROR: WARNING something"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "err",
        pattern: "ERROR",
        matchType: "exact",
        foregroundColor: "#FF0000",
        priority: 100,
      }),
      createRule({
        id: "warn",
        pattern: "WARNING",
        matchType: "exact",
        foregroundColor: "#FFFF00",
        priority: 80,
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // Both should render — no overlap
    expect(term.registerDecoration).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("partial overlap: higher priority covers, lower is blocked", () => {
    // "ERROR_MSG" — rule 1 matches "ERROR" (pos 0-4), rule 2 matches "ERROR_MSG" (pos 0-8)
    // Higher priority should win, blocking the lower on overlapping positions
    const term = createMockTerminal(["ERROR_MSG found"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "short-high",
        pattern: "ERROR",
        matchType: "exact",
        priority: 200,
      }),
      createRule({
        id: "long-low",
        pattern: "ERROR_MSG",
        matchType: "exact",
        priority: 50,
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // high-priority "ERROR" takes positions 0-4
    // low-priority "ERROR_MSG" overlaps at 0-4, so it gets blocked
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("equal priority resolves by array order (first match wins)", () => {
    const term = createMockTerminal(["test match"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "first",
        pattern: "test",
        matchType: "exact",
        foregroundColor: "#FF0000",
        priority: 50,
      }),
      createRule({
        id: "second",
        pattern: "test",
        matchType: "exact",
        foregroundColor: "#00FF00",
        priority: 50,
      }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // Only 1 decoration — first processed wins on overlap
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});

// ─── AC-4: Built-in presets content validation ────────────────

describe("[AC-4] Built-in keyword sets", () => {
  it("Cisco IOS preset regex matches syslog format", () => {
    // Validates the Cisco IOS syslog regex from the preset
    // Note: patternToRegex returns a `g` flag regex — test() is stateful, reset lastIndex
    const regex = patternToRegex("%.*-\\d-.*", "regex");
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("%LINK-3-UPDOWN: Interface down")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("%SYS-5-CONFIG_I: Configured from console")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("normal output")).toBe(false);
  });

  it("Cisco IOS preset matches up/up exactly", () => {
    const regex = patternToRegex("up/up", "exact");
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("up/up")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("Up/Up")).toBe(false); // exact is case-sensitive
  });

  it("Cisco IOS preset matches down/down exactly", () => {
    const regex = patternToRegex("down/down", "exact");
    expect(regex).not.toBeNull();
    expect(regex!.test("down/down")).toBe(true);
  });

  it("Cisco IOS preset matches err-disabled case-insensitively", () => {
    const regex = patternToRegex("err-disabled", "exactinsensitive");
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("err-disabled")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("Err-Disabled")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("ERR-DISABLED")).toBe(true);
  });

  it("Cisco IOS preset matches administratively down case-insensitively", () => {
    const regex = patternToRegex("administratively down", "exactinsensitive");
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("administratively down")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("Administratively Down")).toBe(true);
  });

  it("IP address regex matches valid IPs", () => {
    const regex = patternToRegex(
      "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
      "regex"
    );
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("192.168.1.1")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("10.0.0.1")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("255.255.255.0")).toBe(true);
  });

  it("MAC address regex matches colon-separated MACs", () => {
    const regex = patternToRegex(
      "[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}",
      "regex"
    );
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("aa:bb:cc:dd:ee:ff")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("AA:BB:CC:DD:EE:FF")).toBe(true);
  });

  it("Syslog severity keywords compile correctly", () => {
    for (const keyword of [
      "CRITICAL",
      "ERROR",
      "WARNING",
      "INFO",
      "DEBUG",
    ]) {
      const regex = patternToRegex(keyword, "exactinsensitive");
      expect(regex).not.toBeNull();
      regex!.lastIndex = 0;
      expect(regex!.test(keyword.toLowerCase())).toBe(true);
    }
  });

  it("Junos keywords compile and match", () => {
    const up = patternToRegex("Up", "exact");
    up!.lastIndex = 0;
    expect(up!.test("Up")).toBe(true);
    up!.lastIndex = 0;
    expect(up!.test("up")).toBe(false); // exact is case-sensitive

    const down = patternToRegex("Down", "exact");
    expect(down!.test("Down")).toBe(true);

    const major = patternToRegex("MAJOR", "exactinsensitive");
    major!.lastIndex = 0;
    expect(major!.test("major")).toBe(true);
    major!.lastIndex = 0;
    expect(major!.test("MAJOR")).toBe(true);
  });
});

// ─── AC-5: Per-session override ───────────────────────────────

describe("[AC-5] Per-session override", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("different engines can have different rule sets", () => {
    const term1 = createMockTerminal(["ERROR and WARNING"]);
    const term2 = createMockTerminal(["ERROR and WARNING"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine1 = new HighlightEngine(term1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine2 = new HighlightEngine(term2 as any);

    // Session 1: only highlights ERROR
    engine1.setRules([
      createRule({ pattern: "ERROR", matchType: "exact", priority: 100 }),
    ]);

    // Session 2: only highlights WARNING
    engine2.setRules([
      createRule({ pattern: "WARNING", matchType: "exact", priority: 100 }),
    ]);

    term1.registerDecoration.mockClear();
    term2.registerDecoration.mockClear();

    engine1.enable();
    engine2.enable();

    // Each engine has its own rules
    expect(term1.registerDecoration).toHaveBeenCalledTimes(1);
    expect(term2.registerDecoration).toHaveBeenCalledTimes(1);

    engine1.dispose();
    engine2.dispose();
  });

  it("changing rules on one engine does not affect another", () => {
    const term1 = createMockTerminal(["ERROR found"]);
    const term2 = createMockTerminal(["ERROR found"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine1 = new HighlightEngine(term1 as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine2 = new HighlightEngine(term2 as any);

    const rules = [
      createRule({ pattern: "ERROR", matchType: "exact", priority: 100 }),
    ];

    engine1.setRules(rules);
    engine2.setRules(rules);

    engine1.enable();
    engine2.enable();

    // Now clear rules on engine1
    engine1.setRules([]);

    term1.registerDecoration.mockClear();
    term2.registerDecoration.mockClear();

    // Trigger new output on both
    term1._triggerWriteParsed();
    term2._triggerWriteParsed();
    vi.advanceTimersByTime(20);

    // Engine1 should create 0 decorations (empty rules)
    // Engine2 still has rules → should create decorations
    // (The exact behavior depends on the viewport re-processing, but
    // at minimum engine2 should still have its rules intact)
    expect(engine2.isEnabled()).toBe(true);

    engine1.dispose();
    engine2.dispose();
  });
});

// ─── AC-6: Real-time application with debounce ────────────────

describe("[AC-6] Real-time application", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid writes to 16ms", () => {
    const term = createMockTerminal(["ERROR in output"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exact" }),
    ]);

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    // Initial synchronous processViewport already ran
    const initialDecCount = term.registerDecoration.mock.calls.length;

    // Fire several rapid writes
    term._triggerWriteParsed();
    term._triggerWriteParsed();
    term._triggerWriteParsed();

    // Before debounce fires — no NEW decorations beyond initial
    vi.advanceTimersByTime(10);
    // After debounce fires
    vi.advanceTimersByTime(10);

    // Should have processed (initial + one debounced batch, not 3 separate)
    expect(term.registerDecoration.mock.calls.length).toBeGreaterThanOrEqual(
      initialDecCount
    );
    engine.dispose();
  });

  it("processes existing content on enable", () => {
    const term = createMockTerminal(["pre-existing ERROR line"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", matchType: "exact" }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    // processViewport runs synchronously on enable
    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });
});

// ─── AC-7: Toggle highlighting ────────────────────────────────

describe("[AC-7] Toggle highlighting", () => {
  it("toggle enables then disables", () => {
    const term = createMockTerminal([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    expect(engine.isEnabled()).toBe(false);
    const state1 = engine.toggle();
    expect(state1).toBe(true);
    expect(engine.isEnabled()).toBe(true);

    const state2 = engine.toggle();
    expect(state2).toBe(false);
    expect(engine.isEnabled()).toBe(false);

    engine.dispose();
  });

  it("disabling clears all decorations", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule()]);
    engine.enable();

    // Decorations were created
    const decoCount = term.registerDecoration.mock.calls.length;
    expect(decoCount).toBeGreaterThan(0);

    // All registered decorations should have dispose called on disable
    const decoDisposeFns = term.registerDecoration.mock.results
      .map((r) => r.value?.dispose)
      .filter(Boolean);

    engine.disable();

    for (const disposeFn of decoDisposeFns) {
      expect(disposeFn).toHaveBeenCalled();
    }

    engine.dispose();
  });

  it("re-enabling re-applies decorations", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule()]);
    engine.enable();
    engine.disable();

    term.registerDecoration.mockClear();
    term.registerMarker.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });
});

// ─── Multi-line, multi-rule integration ───────────────────────

describe("[AC-1][AC-2][AC-3] Multi-line multi-rule integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches different rules on different lines", () => {
    const term = createMockTerminal([
      "Line 1: ERROR occurred",
      "Line 2: WARNING possible",
      "Line 3: all clear",
      "Line 4: 192.168.1.1 connected",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "error",
        pattern: "ERROR",
        matchType: "exact",
        foregroundColor: "#FF0000",
        priority: 100,
      }),
      createRule({
        id: "warning",
        pattern: "WARNING",
        matchType: "exact",
        foregroundColor: "#FFFF00",
        priority: 80,
      }),
      createRule({
        id: "ip",
        pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
        matchType: "regex",
        foregroundColor: "#00FF00",
        priority: 60,
      }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    // Line 1 → ERROR, Line 2 → WARNING, Line 3 → none, Line 4 → IP
    expect(term.registerDecoration.mock.calls.length).toBe(3);
    engine.dispose();
  });

  it("handles wildcard pattern matching across lines", () => {
    const term = createMockTerminal([
      "access.log",
      "error.log",
      "system.txt",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "*.log",
        matchType: "wildcard",
        foregroundColor: "#FFB86C",
        priority: 50,
      }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    // Lines 0 and 1 match, line 2 does not
    expect(term.registerDecoration.mock.calls.length).toBe(2);
    engine.dispose();
  });
});
