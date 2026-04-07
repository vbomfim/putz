/**
 * Unit tests for the HighlightEngine.
 *
 * Tests pattern compilation, matching, lifecycle management,
 * and edge cases. Uses direct function imports for utility testing
 * and a mock Terminal for integration testing.
 *
 * Tags: [TDD], [AC-1], [AC-2], [AC-3], [AC-6], [AC-7]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HighlightEngine,
  patternToRegex,
  escapeRegex,
  wildcardToRegex,
  hasNestedQuantifiers,
  execRegexWithTimeout,
} from "../components/Terminal/HighlightEngine";
import type { HighlightRule } from "../components/Terminal/highlightTypes";

// ─── Helper: create a mock terminal ───────────────────────────

function createMockTerminal() {
  const onWriteParsedHandlers: Array<() => void> = [];
  const onRenderHandlers: Array<(el: HTMLElement) => void> = [];

  return {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        length: 5,
        viewportY: 0,
        baseY: 0,
        cursorY: 4,
        getLine: vi.fn().mockReturnValue({
          translateToString: vi.fn().mockReturnValue(""),
        }),
      },
    },
    registerMarker: vi.fn().mockReturnValue({
      dispose: vi.fn(),
    }),
    registerDecoration: vi.fn().mockReturnValue({
      dispose: vi.fn(),
      onRender: vi.fn((handler: (el: HTMLElement) => void) => {
        onRenderHandlers.push(handler);
      }),
    }),
    onWriteParsed: vi.fn((handler: () => void) => {
      onWriteParsedHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
    _triggerWriteParsed: () => {
      onWriteParsedHandlers.forEach((h) => h());
    },
    _onRenderHandlers: onRenderHandlers,
  };
}

function createRule(overrides: Partial<HighlightRule> = {}): HighlightRule {
  return {
    id: "test-rule",
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

// ─── Utility function tests ───────────────────────────────────

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("a.b*c+d")).toBe("a\\.b\\*c\\+d");
  });

  it("escapes brackets and parentheses", () => {
    expect(escapeRegex("[test](ok)")).toBe("\\[test\\]\\(ok\\)");
  });

  it("leaves alphanumeric characters unchanged", () => {
    expect(escapeRegex("ERROR")).toBe("ERROR");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("wildcardToRegex", () => {
  it("converts * to .*", () => {
    expect(wildcardToRegex("*error*")).toBe(".*error.*");
  });

  it("converts ? to .", () => {
    expect(wildcardToRegex("err?r")).toBe("err.r");
  });

  it("escapes regex-special characters in literal parts", () => {
    expect(wildcardToRegex("test.txt")).toBe("test\\.txt");
  });

  it("handles mixed wildcards and literals", () => {
    expect(wildcardToRegex("*.log")).toBe(".*\\.log");
  });

  it("collapses consecutive * wildcards", () => {
    expect(wildcardToRegex("***error***")).toBe(".*error.*");
  });

  it("collapses double * wildcards", () => {
    expect(wildcardToRegex("**")).toBe(".*");
  });
});

describe("patternToRegex", () => {
  it("creates case-sensitive regex for exact match", () => {
    const regex = patternToRegex("ERROR", "exact");
    expect(regex).not.toBeNull();
    expect(regex!.test("ERROR")).toBe(true);
    expect(regex!.test("error")).toBe(false);
  });

  it("creates case-insensitive regex for exactinsensitive match", () => {
    const regex = patternToRegex("ERROR", "exactinsensitive");
    expect(regex).not.toBeNull();
    expect("ERROR").toMatch(regex!);
    expect("error").toMatch(regex!);
    expect("Error").toMatch(regex!);
  });

  it("creates regex from wildcard pattern", () => {
    const regex = patternToRegex("*err*", "wildcard");
    expect(regex).not.toBeNull();
    expect(regex!.test("some error here")).toBe(true);
  });

  it("creates regex from regex pattern", () => {
    const regex = patternToRegex("\\d+\\.\\d+\\.\\d+\\.\\d+", "regex");
    expect(regex).not.toBeNull();
    expect(regex!.test("192.168.1.1")).toBe(true);
    expect(regex!.test("not-an-ip")).toBe(false);
  });

  it("returns null for invalid regex", () => {
    const regex = patternToRegex("[invalid", "regex");
    expect(regex).toBeNull();
  });

  it("returns null for regex with nested quantifiers (ReDoS)", () => {
    const regex = patternToRegex("(a+)+", "regex");
    expect(regex).toBeNull();
  });

  it("accepts safe regex patterns", () => {
    const regex = patternToRegex("\\d+\\.\\d+", "regex");
    expect(regex).not.toBeNull();
  });

  it("returns global flag for all match types", () => {
    const exact = patternToRegex("test", "exact");
    expect(exact!.global).toBe(true);

    const regex = patternToRegex("test", "regex");
    expect(regex!.global).toBe(true);
  });
});

// ─── HighlightEngine lifecycle tests ──────────────────────────

describe("HighlightEngine", () => {
  let mockTerminal: ReturnType<typeof createMockTerminal>;
  let engine: HighlightEngine;

  beforeEach(() => {
    mockTerminal = createMockTerminal();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine = new HighlightEngine(mockTerminal as any);
  });

  describe("lifecycle", () => {
    it("starts disabled", () => {
      expect(engine.isEnabled()).toBe(false);
    });

    it("can be enabled", () => {
      engine.enable();
      expect(engine.isEnabled()).toBe(true);
    });

    it("can be disabled", () => {
      engine.enable();
      engine.disable();
      expect(engine.isEnabled()).toBe(false);
    });

    it("toggle returns new state", () => {
      expect(engine.toggle()).toBe(true);
      expect(engine.toggle()).toBe(false);
      expect(engine.toggle()).toBe(true);
    });

    it("enable is idempotent", () => {
      engine.enable();
      engine.enable();
      expect(engine.isEnabled()).toBe(true);
      // Should only hook once
      expect(mockTerminal.onWriteParsed).toHaveBeenCalledTimes(1);
    });

    it("disable when not enabled is safe", () => {
      engine.disable(); // Should not throw
      expect(engine.isEnabled()).toBe(false);
    });

    it("dispose cleans up", () => {
      engine.enable();
      engine.dispose();
      expect(engine.isEnabled()).toBe(false);
    });

    it("operations after dispose are no-ops", () => {
      engine.dispose();
      engine.enable(); // Should not throw
      expect(engine.isEnabled()).toBe(false);
    });
  });

  describe("setRules", () => {
    it("accepts empty rules array", () => {
      engine.setRules([]);
      engine.enable();
      expect(engine.isEnabled()).toBe(true);
    });

    it("filters out invalid patterns", () => {
      engine.setRules([
        createRule({ pattern: "[invalid", matchType: "regex" }),
        createRule({ id: "valid", pattern: "ERROR" }),
      ]);
      // Should not throw, invalid rule silently skipped
      engine.enable();
      expect(engine.isEnabled()).toBe(true);
    });

    it("re-applies decorations when rules change while enabled", () => {
      engine.enable();
      engine.setRules([createRule()]);
      // Should have attempted to process viewport
      // (viewport is empty in mock, so no decorations created)
    });
  });

  describe("matching", () => {
    it("finds exact matches in terminal lines", () => {
      // Set up mock buffer with content
      mockTerminal.buffer.active.length = 2;
      mockTerminal.buffer.active.getLine = vi.fn((lineIdx: number) => {
        if (lineIdx === 0) {
          return {
            translateToString: vi
              .fn()
              .mockReturnValue("This has an ERROR in it"),
          };
        }
        return {
          translateToString: vi.fn().mockReturnValue("No match here"),
        };
      });

      engine.setRules([createRule({ pattern: "ERROR", matchType: "exact" })]);
      engine.enable();

      // Trigger processing (after debounce would fire)
      vi.useFakeTimers();
      mockTerminal._triggerWriteParsed();
      vi.advanceTimersByTime(20);
      vi.useRealTimers();

      // Verify registerMarker was called (decoration was created)
      expect(mockTerminal.registerMarker).toHaveBeenCalled();
    });

    it("skips very long lines (backtracking protection)", () => {
      const longLine = "A".repeat(10_001);
      mockTerminal.buffer.active.length = 1;
      mockTerminal.buffer.active.getLine = vi.fn().mockReturnValue({
        translateToString: vi.fn().mockReturnValue(longLine),
      });

      engine.setRules([createRule()]);
      engine.enable();

      vi.useFakeTimers();
      mockTerminal._triggerWriteParsed();
      vi.advanceTimersByTime(20);
      vi.useRealTimers();

      // Should NOT have created any decorations for the long line
      expect(mockTerminal.registerMarker).not.toHaveBeenCalled();
    });

    it("skips empty lines", () => {
      mockTerminal.buffer.active.length = 1;
      mockTerminal.buffer.active.getLine = vi.fn().mockReturnValue({
        translateToString: vi.fn().mockReturnValue(""),
      });

      engine.setRules([createRule()]);
      engine.enable();

      vi.useFakeTimers();
      mockTerminal._triggerWriteParsed();
      vi.advanceTimersByTime(20);
      vi.useRealTimers();

      expect(mockTerminal.registerMarker).not.toHaveBeenCalled();
    });
  });

  describe("priority ordering (AC-3)", () => {
    it("higher priority rule wins on overlap", () => {
      mockTerminal.buffer.active.length = 1;
      mockTerminal.buffer.active.getLine = vi.fn().mockReturnValue({
        translateToString: vi.fn().mockReturnValue("ERROR occurred"),
      });

      // Two rules matching "ERROR" — higher priority should win
      engine.setRules([
        createRule({
          id: "low",
          pattern: "ERROR",
          foregroundColor: "#00FF00",
          priority: 10,
        }),
        createRule({
          id: "high",
          pattern: "ERROR",
          foregroundColor: "#FF0000",
          priority: 100,
        }),
      ]);

      // Reset mock counts before enabling (so we only count new calls)
      mockTerminal.registerDecoration.mockClear();
      mockTerminal.registerMarker.mockClear();

      engine.enable();

      // The initial processViewport runs synchronously
      // Only ONE decoration should be created (high priority wins on overlap)
      expect(mockTerminal.registerDecoration).toHaveBeenCalledTimes(1);
    });
  });

  describe("decoration cleanup (memory leak prevention)", () => {
    it("disposes old decorations before each scan cycle", () => {
      const decorationDispose = vi.fn();
      const markerDispose = vi.fn();

      mockTerminal.registerMarker.mockReturnValue({
        dispose: markerDispose,
      });
      mockTerminal.registerDecoration.mockReturnValue({
        dispose: decorationDispose,
        onRender: vi.fn(),
      });

      mockTerminal.buffer.active.length = 1;
      mockTerminal.buffer.active.getLine = vi.fn().mockReturnValue({
        translateToString: vi.fn().mockReturnValue("ERROR here"),
      });

      engine.setRules([createRule({ pattern: "ERROR", matchType: "exact" })]);
      engine.enable();

      // First scan creates decorations
      expect(mockTerminal.registerDecoration).toHaveBeenCalled();
      const firstCallCount = mockTerminal.registerDecoration.mock.calls.length;

      // Trigger a new scan cycle (simulates onWriteParsed)
      vi.useFakeTimers();
      mockTerminal._triggerWriteParsed();
      vi.advanceTimersByTime(20);
      vi.useRealTimers();

      // Old decorations should be disposed before new ones are created
      expect(decorationDispose).toHaveBeenCalledTimes(firstCallCount);
      expect(markerDispose).toHaveBeenCalledTimes(firstCallCount);
    });
  });
});

// ─── hasNestedQuantifiers tests ───────────────────────────────

describe("hasNestedQuantifiers", () => {
  it("detects (a+)+", () => {
    expect(hasNestedQuantifiers("(a+)+")).toBe(true);
  });

  it("detects (a*)*", () => {
    expect(hasNestedQuantifiers("(a*)*")).toBe(true);
  });

  it("detects (a+)*", () => {
    expect(hasNestedQuantifiers("(a+)*")).toBe(true);
  });

  it("detects (a{2,})+", () => {
    expect(hasNestedQuantifiers("(a{2,})+")).toBe(true);
  });

  it("does not flag bounded inner repetition (a{2}){5}", () => {
    expect(hasNestedQuantifiers("(a{2}){5}")).toBe(false);
  });

  it("does not flag bounded range inner repetition (a{2,5}){3}", () => {
    expect(hasNestedQuantifiers("(a{2,5}){3}")).toBe(false);
  });

  it("allows MAC address regex (safe pattern)", () => {
    expect(hasNestedQuantifiers("[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}")).toBe(
      false,
    );
  });

  it("does not flag simple quantifiers", () => {
    expect(hasNestedQuantifiers("a+")).toBe(false);
    expect(hasNestedQuantifiers("(abc)+")).toBe(false);
  });

  it("does not flag groups without inner quantifiers", () => {
    expect(hasNestedQuantifiers("(test)")).toBe(false);
  });

  it("does not flag non-capturing nested groups", () => {
    expect(hasNestedQuantifiers("(?:test)+")).toBe(false);
  });

  it("allows alternation inside quantified group", () => {
    expect(hasNestedQuantifiers("(a|b)+")).toBe(false);
  });
});

// ─── execRegexWithTimeout tests ───────────────────────────────

describe("execRegexWithTimeout", () => {
  it("returns all matches for normal patterns", () => {
    const regex = /\d+/g;
    const results = execRegexWithTimeout(regex, "abc 123 def 456 ghi 789");
    expect(results).toHaveLength(3);
    expect(results[0][0]).toBe("123");
    expect(results[1][0]).toBe("456");
    expect(results[2][0]).toBe("789");
  });

  it("handles zero-length matches without infinite loop", () => {
    const regex = /(?=a)/g; // lookahead matches zero-length
    const results = execRegexWithTimeout(regex, "aaa");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array when no matches found", () => {
    const regex = /xyz/g;
    const results = execRegexWithTimeout(regex, "abc def ghi");
    expect(results).toHaveLength(0);
  });

  it("resets lastIndex before matching", () => {
    const regex = /test/g;
    regex.lastIndex = 999;
    const results = execRegexWithTimeout(regex, "test test");
    expect(results).toHaveLength(2);
  });
});
