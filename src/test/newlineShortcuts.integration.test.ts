/**
 * Integration test wiring the live settings store to
 * `decideNewlineShortcut`. This is the exact seam `useTerminal.ts` uses:
 *
 *     const newlineSettings = useSettingsStore.getState().newlineShortcuts;
 *     const decision = decideNewlineShortcut(event, newlineSettings);
 *
 * The pure-helper tests prove the decision logic in isolation; the store
 * tests prove persistence. This test proves they connect correctly — i.e.
 * toggling a setting via the store actually changes what the terminal does.
 *
 * Tags: [AC-4], [AC-5], [INTEGRATION], [COVERAGE]
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  decideNewlineShortcut,
  META_ENTER_BYTES,
  SUBMIT_BYTES,
} from "../components/Terminal/newlineShortcuts";

let useSettingsStore: typeof import("../stores/settingsStore").useSettingsStore;

function enter(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Enter", ...init });
}

describe("newlineShortcuts ↔ settingsStore integration", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    useSettingsStore = mod.useSettingsStore;
  });

  it("default store state → all three shortcuts insert ESC+CR [AC-1, AC-2, AC-3]", () => {
    const settings = useSettingsStore.getState().newlineShortcuts;

    expect(decideNewlineShortcut(enter({ ctrlKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
    expect(decideNewlineShortcut(enter({ shiftKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
    expect(decideNewlineShortcut(enter({ altKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
  });

  it("disabling ctrlEnter via store → Ctrl+Enter falls through (submits) [AC-4]", () => {
    useSettingsStore.getState().setNewlineShortcut("ctrlEnter", false);
    const settings = useSettingsStore.getState().newlineShortcuts;

    // ctrlEnter now falls through to xterm's default (which sends \r → submit).
    expect(
      decideNewlineShortcut(enter({ ctrlKey: true }), settings),
    ).toBeNull();

    // Other bindings still work.
    expect(decideNewlineShortcut(enter({ shiftKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
    expect(decideNewlineShortcut(enter({ altKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
  });

  it("disabling shiftEnter via store → Shift+Enter falls through [AC-4]", () => {
    useSettingsStore.getState().setNewlineShortcut("shiftEnter", false);
    const settings = useSettingsStore.getState().newlineShortcuts;

    expect(
      decideNewlineShortcut(enter({ shiftKey: true }), settings),
    ).toBeNull();
  });

  it("disabling altEnter via store → Alt+Enter forces plain submit (\\r) [AC-4]", () => {
    // Spec: altEnter disabled = "off means off" — explicitly submit, do NOT
    // let shells interpret Alt+Enter as a newline insert.
    useSettingsStore.getState().setNewlineShortcut("altEnter", false);
    const settings = useSettingsStore.getState().newlineShortcuts;

    expect(decideNewlineShortcut(enter({ altKey: true }), settings)).toEqual({
      consume: true,
      bytes: SUBMIT_BYTES,
    });
  });

  it("toggle round-trip → decision returns to original after re-enable [AC-4]", () => {
    useSettingsStore.getState().setNewlineShortcut("ctrlEnter", false);
    let settings = useSettingsStore.getState().newlineShortcuts;
    expect(
      decideNewlineShortcut(enter({ ctrlKey: true }), settings),
    ).toBeNull();

    useSettingsStore.getState().setNewlineShortcut("ctrlEnter", true);
    settings = useSettingsStore.getState().newlineShortcuts;
    expect(decideNewlineShortcut(enter({ ctrlKey: true }), settings)).toEqual({
      consume: true,
      bytes: META_ENTER_BYTES,
    });
  });

  it("settings survive a simulated reload and still drive the helper [AC-5]", async () => {
    // User disables all three.
    useSettingsStore.getState().setNewlineShortcut("ctrlEnter", false);
    useSettingsStore.getState().setNewlineShortcut("shiftEnter", false);
    useSettingsStore.getState().setNewlineShortcut("altEnter", false);

    // Simulate app reload — re-import the module.
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    const settings = mod.useSettingsStore.getState().newlineShortcuts;

    // ctrl/shift fall through; alt force-submits.
    expect(
      decideNewlineShortcut(enter({ ctrlKey: true }), settings),
    ).toBeNull();
    expect(
      decideNewlineShortcut(enter({ shiftKey: true }), settings),
    ).toBeNull();
    expect(decideNewlineShortcut(enter({ altKey: true }), settings)).toEqual({
      consume: true,
      bytes: SUBMIT_BYTES,
    });
  });
});
