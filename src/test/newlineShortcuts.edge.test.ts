/**
 * Edge-case and contract tests for `decideNewlineShortcut`, complementing
 * the happy-path tests in newlineShortcuts.test.ts.
 *
 * Covers modifier combinations the original suite doesn't enumerate, and
 * verifies the helper's purity contract (no mutation of event or settings).
 *
 * Tags: [EDGE], [CONTRACT], [BOUNDARY], [COVERAGE]
 */
import { describe, it, expect } from "vitest";
import {
  decideNewlineShortcut,
  META_ENTER_BYTES,
  SUBMIT_BYTES,
  type NewlineShortcutSettings,
} from "../components/Terminal/newlineShortcuts";

const ALL_ENABLED: NewlineShortcutSettings = {
  ctrlEnter: true,
  shiftEnter: true,
  altEnter: true,
};

const ALL_DISABLED: NewlineShortcutSettings = {
  ctrlEnter: false,
  shiftEnter: false,
  altEnter: false,
};

function enter(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Enter", ...init });
}

describe("decideNewlineShortcut — modifier combinations [EDGE]", () => {
  // The implementation only matches three exact modifier patterns:
  //   Ctrl/Meta-only, Shift-only, Alt-only.
  // Any other combination must fall through to null so the existing
  // key handler / xterm.js can process it.

  it("Shift+Alt+Enter → null (combo not owned by helper)", () => {
    const ev = enter({ shiftKey: true, altKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("Ctrl+Shift+Alt+Enter → null (triple-modifier combo)", () => {
    const ev = enter({ ctrlKey: true, shiftKey: true, altKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("Cmd+Shift+Enter → null (mirrors Ctrl+Shift behavior on macOS)", () => {
    const ev = enter({ metaKey: true, shiftKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("Cmd+Alt+Enter → null (mirrors Ctrl+Alt behavior on macOS)", () => {
    const ev = enter({ metaKey: true, altKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("plain Enter with no modifiers and all-disabled settings → null", () => {
    // Regression guard: disabling shortcuts must not break plain submit.
    expect(decideNewlineShortcut(enter({}), ALL_DISABLED)).toBeNull();
  });
});

describe("decideNewlineShortcut — non-Enter keys [BOUNDARY]", () => {
  it("returns null for empty key string", () => {
    const ev = new KeyboardEvent("keydown", { key: "", ctrlKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("returns null for 'NumpadEnter'-style code (key is not 'Enter')", () => {
    // Note: real browsers dispatch numpad Enter with key === "Enter" too,
    // so this is a defensive guard for arbitrary inputs only. We are NOT
    // promising NumpadEnter is unsupported — we ARE promising the helper
    // is strictly gated on `event.key === "Enter"`.
    const ev = new KeyboardEvent("keydown", {
      key: "NumpadEnter",
      ctrlKey: true,
    });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });

  it("returns null for case-mismatched key 'enter' (case-sensitive)", () => {
    const ev = new KeyboardEvent("keydown", { key: "enter", shiftKey: true });
    expect(decideNewlineShortcut(ev, ALL_ENABLED)).toBeNull();
  });
});

describe("decideNewlineShortcut — purity contract [CONTRACT]", () => {
  it("does not mutate the settings object", () => {
    const settings: NewlineShortcutSettings = { ...ALL_ENABLED };
    const snapshot = { ...settings };
    decideNewlineShortcut(enter({ ctrlKey: true }), settings);
    decideNewlineShortcut(enter({ shiftKey: true }), settings);
    decideNewlineShortcut(enter({ altKey: true }), settings);
    decideNewlineShortcut(enter({ altKey: true }), ALL_DISABLED);
    expect(settings).toEqual(snapshot);
  });

  it("returns the SAME byte-array reference (caller must not mutate)", () => {
    // Implementation detail: META_ENTER_BYTES is a shared readonly constant.
    // If the helper ever switched to a fresh array per call we'd have a
    // subtle perf regression; this test pins the cheap-shared-constant
    // contract.
    const d1 = decideNewlineShortcut(enter({ ctrlKey: true }), ALL_ENABLED);
    const d2 = decideNewlineShortcut(enter({ shiftKey: true }), ALL_ENABLED);
    expect(d1?.bytes).toBe(META_ENTER_BYTES);
    expect(d2?.bytes).toBe(META_ENTER_BYTES);
    const d3 = decideNewlineShortcut(enter({ altKey: true }), ALL_DISABLED);
    expect(d3?.bytes).toBe(SUBMIT_BYTES);
  });

  it("is deterministic — same input yields equal output", () => {
    const ev1 = enter({ ctrlKey: true });
    const ev2 = enter({ ctrlKey: true });
    expect(decideNewlineShortcut(ev1, ALL_ENABLED)).toEqual(
      decideNewlineShortcut(ev2, ALL_ENABLED),
    );
  });
});

describe("decideNewlineShortcut — rapid repeated invocations [EDGE]", () => {
  it("handles 1000 sequential calls without drift", () => {
    // The helper is stateless; repeated rapid keypresses must not change
    // its decision. This guards against accidental closure / cache state.
    for (let i = 0; i < 1000; i++) {
      const decision = decideNewlineShortcut(
        enter({ ctrlKey: true }),
        ALL_ENABLED,
      );
      expect(decision).toEqual({ consume: true, bytes: META_ENTER_BYTES });
    }
  });
});
