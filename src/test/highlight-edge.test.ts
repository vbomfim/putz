/**
 * QA Guardian — Edge case tests for keyword highlighting.
 *
 * Tests boundary conditions, unusual inputs, concurrent behavior,
 * and protective mechanisms (backtracking, zero-length matches,
 * Unicode, style combinations).
 *
 * Tags: [EDGE], [BOUNDARY], [REGRESSION]
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HighlightEngine,
  patternToRegex,
  escapeRegex,
  wildcardToRegex,
} from "../components/Terminal/HighlightEngine";
import type { HighlightRule } from "../components/Terminal/highlightTypes";

// ─── Helpers ──────────────────────────────────────────────────

function createRule(overrides: Partial<HighlightRule> = {}): HighlightRule {
  return {
    id: "r-" + Math.random().toString(36).slice(2, 8),
    pattern: "TEST",
    matchType: "exact",
    foregroundColor: "#FF5555",
    backgroundColor: "",
    bold: false,
    underline: false,
    priority: 100,
    ...overrides,
  };
}

function createMockTerminal(lineContents: string[] = []) {
  const onWriteParsedHandlers: Array<() => void> = [];
  const renderedStyles: Array<Partial<CSSStyleDeclaration>> = [];

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
    registerDecoration: vi.fn().mockImplementation(() => {
      return {
        dispose: vi.fn(),
        onRender: vi.fn((handler: (el: HTMLElement) => void) => {
          // Simulate render with a mock element
          const el = document.createElement("span");
          handler(el);
          renderedStyles.push({
            color: el.style.color,
            backgroundColor: el.style.backgroundColor,
            fontWeight: el.style.fontWeight,
            textDecoration: el.style.textDecoration,
          });
        }),
      };
    }),
    onWriteParsed: vi.fn((handler: () => void) => {
      onWriteParsedHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
    _triggerWriteParsed: () => {
      onWriteParsedHandlers.forEach((h) => h());
    },
    _renderedStyles: renderedStyles,
  };
}

// ─── patternToRegex edge cases ────────────────────────────────

describe("[EDGE] patternToRegex edge cases", () => {
  it("handles special regex characters in exact match", () => {
    const regex = patternToRegex("file.txt", "exact");
    expect(regex).not.toBeNull();
    // Should NOT match "filextxt" (the dot should be literal)
    expect(regex!.test("filextxt")).toBe(false);
    expect(regex!.test("file.txt")).toBe(true);
  });

  it("handles parentheses in exact match", () => {
    const regex = patternToRegex("(config)", "exact");
    expect(regex).not.toBeNull();
    expect(regex!.test("(config)")).toBe(true);
    expect(regex!.test("config")).toBe(false);
  });

  it("handles dollar signs and carets in exact match", () => {
    const regex = patternToRegex("$100", "exact");
    expect(regex).not.toBeNull();
    expect(regex!.test("$100")).toBe(true);
  });

  it("handles pipe character in exact match", () => {
    const regex = patternToRegex("up|down", "exact");
    expect(regex).not.toBeNull();
    // Should match literal "up|down", not "up" OR "down"
    expect(regex!.test("up|down")).toBe(true);
    expect(regex!.test("up")).toBe(false);
    expect(regex!.test("down")).toBe(false);
  });

  it("returns null for catastrophic regex patterns", () => {
    // Unclosed group
    const regex = patternToRegex("(((", "regex");
    expect(regex).toBeNull();
  });

  it("returns null for unknown matchType", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const regex = patternToRegex("test", "unknown" as any);
    expect(regex).toBeNull();
  });

  it("handles empty regex pattern", () => {
    // Empty regex matches everything — the engine should handle gracefully
    const regex = patternToRegex("", "regex");
    expect(regex).not.toBeNull();
  });

  it("handles regex with lookahead", () => {
    const regex = patternToRegex("(?=ERROR)ERROR", "regex");
    expect(regex).not.toBeNull();
    expect(regex!.test("ERROR")).toBe(true);
    expect(regex!.test("WARNING")).toBe(false);
  });

  it("handles regex with named groups", () => {
    const regex = patternToRegex(
      "(?<severity>ERROR|WARNING): (?<msg>.*)",
      "regex",
    );
    expect(regex).not.toBeNull();
    expect(regex!.test("ERROR: something failed")).toBe(true);
  });
});

// ─── wildcardToRegex edge cases ───────────────────────────────

describe("[EDGE] wildcardToRegex edge cases", () => {
  it("handles consecutive wildcards (collapses to single)", () => {
    const result = wildcardToRegex("**");
    expect(result).toBe(".*");
    const regex = new RegExp(result);
    expect(regex.test("anything")).toBe(true);
  });

  it("handles pattern with only *", () => {
    const result = wildcardToRegex("*");
    expect(result).toBe(".*");
  });

  it("handles pattern with only ?", () => {
    const result = wildcardToRegex("?");
    expect(result).toBe(".");
    const regex = new RegExp(result);
    expect(regex.test("a")).toBe(true);
    expect(regex.test("ab")).toBe(true); // partial match
  });

  it("handles multiple ? characters", () => {
    const result = wildcardToRegex("???");
    expect(result).toBe("...");
    const regex = new RegExp(result);
    expect(regex.test("abc")).toBe(true);
    expect(regex.test("ab")).toBe(false);
  });

  it("escapes brackets in wildcard patterns", () => {
    const result = wildcardToRegex("[test]");
    expect(result).toContain("\\[");
    expect(result).toContain("\\]");
  });
});

// ─── escapeRegex edge cases ───────────────────────────────────

describe("[EDGE] escapeRegex edge cases", () => {
  it("escapes all special characters", () => {
    const specials = ".*+?^${}()|[]\\";
    const escaped = escapeRegex(specials);
    // Each special should be preceded by backslash
    const regex = new RegExp(escaped);
    expect(regex.test(specials)).toBe(true);
  });

  it("handles single character patterns", () => {
    expect(escapeRegex(".")).toBe("\\.");
    expect(escapeRegex("*")).toBe("\\*");
    expect(escapeRegex("a")).toBe("a");
  });
});

// ─── Engine edge cases ────────────────────────────────────────

describe("[EDGE] HighlightEngine edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles null line from buffer", () => {
    const term = createMockTerminal([]);
    term.buffer.active.length = 3;
    term.buffer.active.getLine = vi.fn().mockReturnValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule()]);

    // Should not throw
    expect(() => engine.enable()).not.toThrow();
    engine.dispose();
  });

  it("handles registerMarker returning null", () => {
    const term = createMockTerminal(["ERROR here"]);
    term.registerMarker = vi.fn().mockReturnValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule({ pattern: "ERROR" })]);

    // Should not throw — null marker means skip decoration
    expect(() => engine.enable()).not.toThrow();
    expect(term.registerDecoration).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("handles registerDecoration returning null", () => {
    const term = createMockTerminal(["ERROR here"]);
    term.registerDecoration = vi.fn().mockReturnValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule({ pattern: "ERROR" })]);

    // Should not throw — null decoration means skip
    expect(() => engine.enable()).not.toThrow();
    engine.dispose();
  });

  it("skips lines at exactly MAX_LINE_LENGTH boundary", () => {
    const longLine = "A".repeat(10_000); // exactly 10_000 — should still be processed
    const term = createMockTerminal([longLine]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule({ pattern: "A", matchType: "exact" })]);

    term.registerDecoration.mockClear();
    engine.enable();

    // 10,000 chars is at the boundary — the code checks > MAX_LINE_LENGTH
    // so exactly 10_000 should be processed
    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("skips lines at MAX_LINE_LENGTH + 1", () => {
    const longLine = "A".repeat(10_001);
    const term = createMockTerminal([longLine]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule({ pattern: "A", matchType: "exact" })]);

    term.registerDecoration.mockClear();
    engine.enable();

    expect(term.registerDecoration).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("[EDGE] handles zero-length regex matches without infinite loop", () => {
    // Pattern "a*" matches zero-length strings — engine must prevent infinite loop
    const term = createMockTerminal(["test line"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule({ pattern: "x*", matchType: "regex" })]);

    // This should complete without hanging
    expect(() => {
      engine.enable();
      term._triggerWriteParsed();
      vi.advanceTimersByTime(20);
    }).not.toThrow();

    engine.dispose();
  });

  it("[EDGE] dispose cancels pending debounce timer", () => {
    const term = createMockTerminal(["ERROR found"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule()]);
    engine.enable();

    // Trigger write — starts debounce timer
    term._triggerWriteParsed();

    // Dispose before timer fires
    engine.dispose();

    // Timer fires but engine is disposed — should not throw
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });

  it("[EDGE] setRules after dispose is a no-op", () => {
    const term = createMockTerminal([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.dispose();

    // Should not throw
    expect(() => engine.setRules([createRule()])).not.toThrow();
  });

  it("[EDGE] toggle after dispose returns false", () => {
    const term = createMockTerminal([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.dispose();

    // enable after dispose is a no-op → toggle should also be
    engine.enable();
    expect(engine.isEnabled()).toBe(false);
  });

  it("[EDGE] rapidly toggling on/off is safe", () => {
    const term = createMockTerminal(["ERROR data"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);
    engine.setRules([createRule()]);

    expect(() => {
      for (let i = 0; i < 100; i++) {
        engine.toggle();
      }
    }).not.toThrow();

    engine.dispose();
  });
});

// ─── Style application edge cases ─────────────────────────────

describe("[EDGE] Decoration style application", () => {
  it("applies foreground color to element", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "ERROR",
        foregroundColor: "#FF5555",
        backgroundColor: "",
        bold: false,
        underline: false,
      }),
    ]);
    engine.enable();

    // Check rendered styles — jsdom normalizes hex to rgb()
    expect(term._renderedStyles.length).toBeGreaterThan(0);
    const color = term._renderedStyles[0].color!;
    // Accept either hex or rgb format (jsdom normalizes to rgb)
    expect(color === "#FF5555" || color === "rgb(255, 85, 85)").toBe(true);
    engine.dispose();
  });

  it("applies background color when set", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "ERROR",
        foregroundColor: "#FF5555",
        backgroundColor: "#1A1A2E",
        bold: false,
        underline: false,
      }),
    ]);
    engine.enable();

    const bgColor = term._renderedStyles[0].backgroundColor!;
    // Accept either hex or rgb format (jsdom normalizes to rgb)
    expect(bgColor === "#1A1A2E" || bgColor === "rgb(26, 26, 46)").toBe(true);
    engine.dispose();
  });

  it("does NOT set background when empty string", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "ERROR",
        backgroundColor: "",
      }),
    ]);
    engine.enable();

    // Background should remain empty/unset
    expect(term._renderedStyles[0].backgroundColor).toBeFalsy();
    engine.dispose();
  });

  it("applies bold style", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule({ pattern: "ERROR", bold: true })]);
    engine.enable();

    expect(term._renderedStyles[0].fontWeight).toBe("bold");
    engine.dispose();
  });

  it("applies underline style", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule({ pattern: "ERROR", underline: true })]);
    engine.enable();

    expect(term._renderedStyles[0].textDecoration).toBe("underline");
    engine.dispose();
  });

  it("applies combined bold + underline styles", () => {
    const term = createMockTerminal(["ERROR here"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "ERROR", bold: true, underline: true }),
    ]);
    engine.enable();

    expect(term._renderedStyles[0].fontWeight).toBe("bold");
    expect(term._renderedStyles[0].textDecoration).toBe("underline");
    engine.dispose();
  });

  it("applies all style options together with background", () => {
    const term = createMockTerminal(["CRITICAL error"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "CRITICAL",
        foregroundColor: "#FF5555",
        backgroundColor: "#330000",
        bold: true,
        underline: true,
      }),
    ]);
    engine.enable();

    const style = term._renderedStyles[0];
    // jsdom normalizes hex to rgb() format
    const fgColor = style.color!;
    expect(fgColor === "#FF5555" || fgColor === "rgb(255, 85, 85)").toBe(true);
    const bgColor = style.backgroundColor!;
    expect(bgColor === "#330000" || bgColor === "rgb(51, 0, 0)").toBe(true);
    expect(style.fontWeight).toBe("bold");
    expect(style.textDecoration).toBe("underline");
    engine.dispose();
  });
});

// ─── Unicode edge cases ───────────────────────────────────────

describe("[EDGE] Unicode and special characters", () => {
  it("matches Unicode text patterns", () => {
    const term = createMockTerminal(["接続エラー: connection failed"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({ pattern: "接続エラー", matchType: "exact" }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("matches emoji in terminal output", () => {
    const term = createMockTerminal(["✅ test passed", "❌ test failed"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        pattern: "❌",
        matchType: "exact",
        foregroundColor: "#FF0000",
      }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("handles line with mixed scripts", () => {
    const term = createMockTerminal([
      "Router(config)# ERROR: インターフェース down — erreur réseau",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule({ pattern: "ERROR", matchType: "exact" })]);

    term.registerDecoration.mockClear();
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});

// ─── Large rule set edge cases ────────────────────────────────

describe("[BOUNDARY] Large rule sets", () => {
  it("handles 50 rules without error", () => {
    const term = createMockTerminal(["keyword_25 found"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    const rules: HighlightRule[] = Array.from({ length: 50 }, (_, i) =>
      createRule({
        id: `rule-${i}`,
        pattern: `keyword_${i}`,
        matchType: "exact",
        priority: i,
      }),
    );

    expect(() => engine.setRules(rules)).not.toThrow();
    expect(() => engine.enable()).not.toThrow();

    // rule for "keyword_25" should match
    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("handles 100 rules without error", () => {
    const term = createMockTerminal(["some text"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    const rules: HighlightRule[] = Array.from({ length: 100 }, (_, i) =>
      createRule({
        id: `rule-${i}`,
        pattern: `kw_${i}`,
        matchType: "exact",
        priority: i,
      }),
    );

    expect(() => {
      engine.setRules(rules);
      engine.enable();
    }).not.toThrow();

    engine.dispose();
  });

  it("handles all invalid rules gracefully (all filtered out)", () => {
    const term = createMockTerminal(["test"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    const rules: HighlightRule[] = Array.from({ length: 10 }, (_, i) =>
      createRule({
        id: `bad-${i}`,
        pattern: `(((invalid_${i}`,
        matchType: "regex",
      }),
    );

    expect(() => {
      engine.setRules(rules);
      engine.enable();
    }).not.toThrow();

    // No valid rules → no decorations
    expect(term.registerDecoration).not.toHaveBeenCalled();
    engine.dispose();
  });
});

// ─── Priority boundary values ─────────────────────────────────

describe("[BOUNDARY] Priority boundary values", () => {
  it("handles priority 0 (lowest possible)", () => {
    const term = createMockTerminal(["test"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule({ pattern: "test", priority: 0 })]);
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("handles priority 999 (highest allowed)", () => {
    const term = createMockTerminal(["test"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([createRule({ pattern: "test", priority: 999 })]);
    engine.enable();

    expect(term.registerDecoration).toHaveBeenCalled();
    engine.dispose();
  });

  it("correctly orders 0 vs 999 priority", () => {
    const term = createMockTerminal(["test"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = new HighlightEngine(term as any);

    engine.setRules([
      createRule({
        id: "zero",
        pattern: "test",
        foregroundColor: "#000000",
        priority: 0,
      }),
      createRule({
        id: "max",
        pattern: "test",
        foregroundColor: "#FFFFFF",
        priority: 999,
      }),
    ]);

    term.registerDecoration.mockClear();
    engine.enable();

    // Priority 999 should win, only 1 decoration
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});

// ─── Editor validation edge cases ─────────────────────────────

describe("[EDGE] HighlightEditor validation edge cases", () => {
  // These test the validation logic at the patternToRegex level,
  // which is what the Editor uses to validate before save

  it("rejects regex with unbalanced brackets", () => {
    expect(patternToRegex("[unclosed", "regex")).toBeNull();
  });

  it("rejects regex with unbalanced parentheses", () => {
    expect(patternToRegex("(unclosed", "regex")).toBeNull();
  });

  it("accepts valid complex regex", () => {
    const regex = patternToRegex(
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}",
      "regex",
    );
    expect(regex).not.toBeNull();
    expect(regex!.test("2024-01-15T10:30:45")).toBe(true);
  });

  it("exact match with regex special chars is safe", () => {
    // User might type "192.168.1.1" as exact — dots should be literal
    const regex = patternToRegex("192.168.1.1", "exact");
    expect(regex).not.toBeNull();
    expect(regex!.test("192.168.1.1")).toBe(true);
    expect(regex!.test("19201680101")).toBe(false); // dots are literal
  });

  it("wildcard with complex pattern compiles", () => {
    const regex = patternToRegex(
      "show ip int brief | include *up*",
      "wildcard",
    );
    expect(regex).not.toBeNull();
  });
});
