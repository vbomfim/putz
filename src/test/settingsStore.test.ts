/**
 * Unit tests for settings store.
 *
 * Tags: [TDD], [AC-toolbar-visibility], [AC-persistence]
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Reset store between tests by re-importing
let useSettingsStore: typeof import("../stores/settingsStore").useSettingsStore;

describe("settingsStore", () => {
  beforeEach(async () => {
    localStorage.clear();
    // Clear module cache to get fresh store each test
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    useSettingsStore = mod.useSettingsStore;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults shortcutsPanelOpen to false", () => {
    const state = useSettingsStore.getState();
    expect(state.shortcutsPanelOpen).toBe(false);
  });

  it("handles corrupted localStorage gracefully", async () => {
    localStorage.setItem("putz-settings", "not-json{{{");
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    expect(mod.useSettingsStore.getState().shortcutsPanelOpen).toBe(false);
  });

  it("toggleShortcutsPanel flips open state", () => {
    useSettingsStore.getState().toggleShortcutsPanel();
    expect(useSettingsStore.getState().shortcutsPanelOpen).toBe(true);

    useSettingsStore.getState().toggleShortcutsPanel();
    expect(useSettingsStore.getState().shortcutsPanelOpen).toBe(false);
  });

  it("setShortcutsPanelOpen sets state explicitly", () => {
    useSettingsStore.getState().setShortcutsPanelOpen(true);
    expect(useSettingsStore.getState().shortcutsPanelOpen).toBe(true);

    useSettingsStore.getState().setShortcutsPanelOpen(false);
    expect(useSettingsStore.getState().shortcutsPanelOpen).toBe(false);
  });
});
