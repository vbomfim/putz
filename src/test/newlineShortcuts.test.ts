/**
 * Unit tests for the newline-shortcut decision helper used by the terminal
 * custom key event handler.
 *
 * Tags: [TDD], [AC-1], [AC-2], [AC-3], [AC-4]
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

function makeEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Enter", ...init });
}

describe("decideNewlineShortcut", () => {
  it("returns null for non-Enter keys", () => {
    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true });
    expect(decideNewlineShortcut(event, ALL_ENABLED)).toBeNull();
  });

  it("returns null for plain Enter (no modifiers) — let xterm submit", () => {
    const event = makeEvent({});
    expect(decideNewlineShortcut(event, ALL_ENABLED)).toBeNull();
  });

  // ─── Ctrl+Enter / Cmd+Enter ─────────────────────────────────────

  it("Ctrl+Enter (enabled) → consume + ESC+CR bytes", () => {
    const event = makeEvent({ ctrlKey: true });
    const decision = decideNewlineShortcut(event, ALL_ENABLED);
    expect(decision).toEqual({ consume: true, bytes: META_ENTER_BYTES });
  });

  it("Cmd+Enter on macOS (enabled) → consume + ESC+CR bytes", () => {
    const event = makeEvent({ metaKey: true });
    const decision = decideNewlineShortcut(event, ALL_ENABLED);
    expect(decision).toEqual({ consume: true, bytes: META_ENTER_BYTES });
  });

  it("Ctrl+Enter (disabled) → null (xterm sends default \\r)", () => {
    const event = makeEvent({ ctrlKey: true });
    expect(decideNewlineShortcut(event, ALL_DISABLED)).toBeNull();
  });

  it("Cmd+Enter (disabled) → null (xterm sends default \\r)", () => {
    const event = makeEvent({ metaKey: true });
    expect(decideNewlineShortcut(event, ALL_DISABLED)).toBeNull();
  });

  // ─── Shift+Enter ────────────────────────────────────────────────

  it("Shift+Enter (enabled) → consume + ESC+CR bytes", () => {
    const event = makeEvent({ shiftKey: true });
    const decision = decideNewlineShortcut(event, ALL_ENABLED);
    expect(decision).toEqual({ consume: true, bytes: META_ENTER_BYTES });
  });

  it("Shift+Enter (disabled) → null (xterm sends default \\r)", () => {
    const event = makeEvent({ shiftKey: true });
    expect(decideNewlineShortcut(event, ALL_DISABLED)).toBeNull();
  });

  // ─── Alt+Enter ──────────────────────────────────────────────────

  it("Alt+Enter (enabled) → consume + ESC+CR bytes", () => {
    const event = makeEvent({ altKey: true });
    const decision = decideNewlineShortcut(event, ALL_ENABLED);
    expect(decision).toEqual({ consume: true, bytes: META_ENTER_BYTES });
  });

  it("Alt+Enter (disabled) → consume + plain CR bytes (force submit)", () => {
    // User explicitly asked: "off means off" — actively intercept Alt+Enter
    // and submit plain \r so it no longer inserts a newline in shells that
    // would otherwise treat it as one.
    const event = makeEvent({ altKey: true });
    const decision = decideNewlineShortcut(event, ALL_DISABLED);
    expect(decision).toEqual({ consume: true, bytes: SUBMIT_BYTES });
  });

  // ─── Modifier combinations — ignored, fall through ──────────────

  it("Ctrl+Shift+Enter → null (not handled here)", () => {
    const event = makeEvent({ ctrlKey: true, shiftKey: true });
    expect(decideNewlineShortcut(event, ALL_ENABLED)).toBeNull();
  });

  it("Ctrl+Alt+Enter → null (not handled here)", () => {
    const event = makeEvent({ ctrlKey: true, altKey: true });
    expect(decideNewlineShortcut(event, ALL_ENABLED)).toBeNull();
  });

  // ─── Byte payload sanity ────────────────────────────────────────

  it("META_ENTER_BYTES is [0x1b, 0x0d] (ESC + CR)", () => {
    expect(META_ENTER_BYTES).toEqual([0x1b, 0x0d]);
  });

  it("SUBMIT_BYTES is [0x0d] (plain CR)", () => {
    expect(SUBMIT_BYTES).toEqual([0x0d]);
  });
});
