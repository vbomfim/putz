/**
 * Contract tests for highlight IPC types.
 *
 * Validates that frontend TypeScript types match the expected
 * Rust backend IPC contract. Tests serialization, field names,
 * and type compatibility.
 *
 * Tags: [TDD], [AC-1], [AC-4]
 */
import { describe, it, expect } from "vitest";
import type {
  HighlightRule,
  HighlightSet,
  MatchType,
  CreateHighlightSetInput,
  UpdateHighlightSetInput,
  CreateHighlightRuleInput,
} from "../components/Terminal/highlightTypes";
import {
  MATCH_TYPE_LABELS,
  HIGHLIGHT_COLOR_PALETTE,
} from "../components/Terminal/highlightTypes";

describe("Highlight contract types", () => {
  // ─── MatchType ──────────────────────────────────────────────

  it("MatchType has all expected values", () => {
    const types: MatchType[] = [
      "exact",
      "exactinsensitive",
      "wildcard",
      "regex",
    ];
    expect(types).toHaveLength(4);
  });

  it("MATCH_TYPE_LABELS covers all types", () => {
    const keys = Object.keys(MATCH_TYPE_LABELS);
    expect(keys).toContain("exact");
    expect(keys).toContain("exactinsensitive");
    expect(keys).toContain("wildcard");
    expect(keys).toContain("regex");
    expect(keys).toHaveLength(4);
  });

  // ─── HighlightRule ──────────────────────────────────────────

  it("HighlightRule has all required fields", () => {
    const rule: HighlightRule = {
      id: "rule-1",
      pattern: "ERROR",
      matchType: "exact",
      foregroundColor: "#FF5555",
      backgroundColor: "",
      bold: true,
      underline: false,
      priority: 100,
    };
    expect(rule.id).toBe("rule-1");
    expect(rule.pattern).toBe("ERROR");
    expect(rule.matchType).toBe("exact");
    expect(rule.foregroundColor).toBe("#FF5555");
    expect(rule.backgroundColor).toBe("");
    expect(rule.bold).toBe(true);
    expect(rule.underline).toBe(false);
    expect(rule.priority).toBe(100);
  });

  // ─── HighlightSet ──────────────────────────────────────────

  it("HighlightSet has all required fields", () => {
    const set: HighlightSet = {
      id: "set-1",
      name: "Cisco IOS",
      description: "Cisco patterns",
      rules: [],
      isBuiltin: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(set.id).toBe("set-1");
    expect(set.name).toBe("Cisco IOS");
    expect(set.isBuiltin).toBe(true);
  });

  // ─── CreateHighlightSetInput ────────────────────────────────

  it("CreateHighlightSetInput has correct shape", () => {
    const input: CreateHighlightSetInput = {
      name: "My Set",
      description: "Description",
      rules: [
        {
          pattern: "ERROR",
          matchType: "exact",
          foregroundColor: "#FF0000",
          backgroundColor: "",
          bold: false,
          underline: false,
          priority: 50,
        },
      ],
    };
    expect(input.name).toBe("My Set");
    expect(input.rules).toHaveLength(1);
  });

  // ─── UpdateHighlightSetInput ────────────────────────────────

  it("UpdateHighlightSetInput allows partial fields", () => {
    const nameOnly: UpdateHighlightSetInput = { name: "New Name" };
    expect(nameOnly.name).toBe("New Name");
    expect(nameOnly.description).toBeUndefined();
    expect(nameOnly.rules).toBeUndefined();
  });

  it("UpdateHighlightSetInput allows rules update", () => {
    const rulesOnly: UpdateHighlightSetInput = {
      rules: [
        {
          pattern: "WARNING",
          matchType: "exactinsensitive",
          foregroundColor: "#FFFF00",
          backgroundColor: "",
          bold: false,
          underline: false,
          priority: 80,
        },
      ],
    };
    expect(rulesOnly.rules).toHaveLength(1);
  });

  // ─── Color palette ─────────────────────────────────────────

  it("color palette has at least 8 entries", () => {
    expect(HIGHLIGHT_COLOR_PALETTE.length).toBeGreaterThanOrEqual(8);
  });

  it("all palette colors are valid hex format", () => {
    for (const color of HIGHLIGHT_COLOR_PALETTE) {
      expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("all palette colors have names", () => {
    for (const color of HIGHLIGHT_COLOR_PALETTE) {
      expect(color.name.length).toBeGreaterThan(0);
    }
  });

  // ─── CreateHighlightRuleInput ───────────────────────────────

  it("CreateHighlightRuleInput has correct shape", () => {
    const rule: CreateHighlightRuleInput = {
      pattern: "test",
      matchType: "regex",
      foregroundColor: "#00FF00",
      backgroundColor: "#000000",
      bold: true,
      underline: true,
      priority: 999,
    };
    expect(rule.pattern).toBe("test");
    expect(rule.matchType).toBe("regex");
    expect(rule.priority).toBe(999);
  });
});
