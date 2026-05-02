/**
 * Unit tests for the LCS-based line diff engine.
 *
 * Tags: [TDD], [AC-4] Config Diff Viewer
 */
import { describe, it, expect } from "vitest";
import {
  computeLineDiff,
  exportDiffAsText,
  type DiffLine,
} from "../components/ConfigDiff/diffEngine";

describe("computeLineDiff", () => {
  // ── Empty inputs ───────────────────────────────────────────

  it("returns empty array for two empty strings", () => {
    const result = computeLineDiff("", "");
    expect(result).toEqual([]);
  });

  it("returns all additions when old text is empty", () => {
    const result = computeLineDiff("", "line1\nline2");
    expect(result).toEqual([
      { type: "add", content: "line1", oldLineNumber: null, newLineNumber: 1 },
      { type: "add", content: "line2", oldLineNumber: null, newLineNumber: 2 },
    ]);
  });

  it("returns all deletions when new text is empty", () => {
    const result = computeLineDiff("line1\nline2", "");
    expect(result).toEqual([
      {
        type: "delete",
        content: "line1",
        oldLineNumber: 1,
        newLineNumber: null,
      },
      {
        type: "delete",
        content: "line2",
        oldLineNumber: 2,
        newLineNumber: null,
      },
    ]);
  });

  // ── Identical texts ────────────────────────────────────────

  it("returns all equal lines for identical texts", () => {
    const text =
      "hostname R1\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0";
    const result = computeLineDiff(text, text);
    expect(result).toHaveLength(3);
    result.forEach((line) => expect(line.type).toBe("equal"));
  });

  it("preserves line numbers for identical texts", () => {
    const result = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(result).toEqual([
      { type: "equal", content: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "equal", content: "b", oldLineNumber: 2, newLineNumber: 2 },
      { type: "equal", content: "c", oldLineNumber: 3, newLineNumber: 3 },
    ]);
  });

  // ── Single line changes ────────────────────────────────────

  it("detects a single added line at the end", () => {
    const result = computeLineDiff("a\nb", "a\nb\nc");
    expect(result).toEqual([
      { type: "equal", content: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "equal", content: "b", oldLineNumber: 2, newLineNumber: 2 },
      { type: "add", content: "c", oldLineNumber: null, newLineNumber: 3 },
    ]);
  });

  it("detects a single deleted line at the end", () => {
    const result = computeLineDiff("a\nb\nc", "a\nb");
    expect(result).toEqual([
      { type: "equal", content: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "equal", content: "b", oldLineNumber: 2, newLineNumber: 2 },
      { type: "delete", content: "c", oldLineNumber: 3, newLineNumber: null },
    ]);
  });

  it("detects a single added line at the beginning", () => {
    const result = computeLineDiff("b\nc", "a\nb\nc");
    expect(result).toEqual([
      { type: "add", content: "a", oldLineNumber: null, newLineNumber: 1 },
      { type: "equal", content: "b", oldLineNumber: 1, newLineNumber: 2 },
      { type: "equal", content: "c", oldLineNumber: 2, newLineNumber: 3 },
    ]);
  });

  it("detects a single line modification (delete + add)", () => {
    const result = computeLineDiff("a\nold\nc", "a\nnew\nc");
    expect(result).toEqual([
      { type: "equal", content: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "delete", content: "old", oldLineNumber: 2, newLineNumber: null },
      { type: "add", content: "new", oldLineNumber: null, newLineNumber: 2 },
      { type: "equal", content: "c", oldLineNumber: 3, newLineNumber: 3 },
    ]);
  });

  // ── Mixed changes ──────────────────────────────────────────

  it("handles multiple additions, deletions, and equals", () => {
    const oldText =
      "hostname R1\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n!";
    const newText =
      "hostname R1\ninterface Gi0/0\n ip address 10.0.0.2 255.255.255.0\n no shutdown\n!";
    const result = computeLineDiff(oldText, newText);

    // hostname R1 — equal
    expect(result[0]).toEqual({
      type: "equal",
      content: "hostname R1",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    // interface Gi0/0 — equal
    expect(result[1]).toEqual({
      type: "equal",
      content: "interface Gi0/0",
      oldLineNumber: 2,
      newLineNumber: 2,
    });
    // ip address changed — delete old, add new
    expect(result[2]).toEqual({
      type: "delete",
      content: " ip address 10.0.0.1 255.255.255.0",
      oldLineNumber: 3,
      newLineNumber: null,
    });
    expect(result[3]).toEqual({
      type: "add",
      content: " ip address 10.0.0.2 255.255.255.0",
      oldLineNumber: null,
      newLineNumber: 3,
    });
    // no shutdown — added
    expect(result[4]).toEqual({
      type: "add",
      content: " no shutdown",
      oldLineNumber: null,
      newLineNumber: 4,
    });
    // ! — equal
    expect(result[5]).toEqual({
      type: "equal",
      content: "!",
      oldLineNumber: 4,
      newLineNumber: 5,
    });
  });

  // ── Edge cases ─────────────────────────────────────────────

  it("handles single-line texts", () => {
    const result = computeLineDiff("old", "new");
    expect(result).toEqual([
      { type: "delete", content: "old", oldLineNumber: 1, newLineNumber: null },
      { type: "add", content: "new", oldLineNumber: null, newLineNumber: 1 },
    ]);
  });

  it("handles trailing newlines correctly", () => {
    const result = computeLineDiff("a\n", "a\n");
    // "a\n" splits to ["a", ""] — the empty trailing line should be handled
    expect(
      result.filter((l) => l.type === "equal").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("handles completely different texts", () => {
    const result = computeLineDiff("a\nb\nc", "x\ny\nz");
    const deletions = result.filter((l) => l.type === "delete");
    const additions = result.filter((l) => l.type === "add");
    expect(deletions).toHaveLength(3);
    expect(additions).toHaveLength(3);
  });

  it("handles large inputs without error", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const oldText = lines.join("\n");
    const newText = lines
      .map((l, i) => (i === 250 ? "CHANGED LINE" : l))
      .join("\n");
    const result = computeLineDiff(oldText, newText);
    expect(result.length).toBeGreaterThan(0);
    const changes = result.filter((l) => l.type !== "equal");
    expect(changes).toHaveLength(2); // 1 delete + 1 add
  });
});

describe("exportDiffAsText", () => {
  it("returns empty string for empty diff", () => {
    expect(exportDiffAsText([])).toBe("");
  });

  it("formats additions with + prefix", () => {
    const diff: DiffLine[] = [
      {
        type: "add",
        content: "new line",
        oldLineNumber: null,
        newLineNumber: 1,
      },
    ];
    expect(exportDiffAsText(diff)).toBe("+ new line");
  });

  it("formats deletions with - prefix", () => {
    const diff: DiffLine[] = [
      {
        type: "delete",
        content: "old line",
        oldLineNumber: 1,
        newLineNumber: null,
      },
    ];
    expect(exportDiffAsText(diff)).toBe("- old line");
  });

  it("formats equal lines with space prefix", () => {
    const diff: DiffLine[] = [
      {
        type: "equal",
        content: "unchanged",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
    ];
    expect(exportDiffAsText(diff)).toBe("  unchanged");
  });

  it("formats a mixed diff correctly", () => {
    const diff: DiffLine[] = [
      {
        type: "equal",
        content: "hostname R1",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "delete",
        content: "old config",
        oldLineNumber: 2,
        newLineNumber: null,
      },
      {
        type: "add",
        content: "new config",
        oldLineNumber: null,
        newLineNumber: 2,
      },
    ];
    const expected = "  hostname R1\n- old config\n+ new config";
    expect(exportDiffAsText(diff)).toBe(expected);
  });
});
