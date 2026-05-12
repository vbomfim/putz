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

  // ─── newlineShortcuts ────────────────────────────────────────────
  // Tags: [TDD], [AC-4], [AC-5]

  describe("newlineShortcuts", () => {
    it("defaults all three shortcuts to true", () => {
      const state = useSettingsStore.getState();
      expect(state.newlineShortcuts).toEqual({
        ctrlEnter: true,
        shiftEnter: true,
        altEnter: true,
      });
    });

    it("setNewlineShortcut updates a single key", () => {
      useSettingsStore.getState().setNewlineShortcut("ctrlEnter", false);
      expect(useSettingsStore.getState().newlineShortcuts).toEqual({
        ctrlEnter: false,
        shiftEnter: true,
        altEnter: true,
      });

      useSettingsStore.getState().setNewlineShortcut("altEnter", false);
      expect(useSettingsStore.getState().newlineShortcuts).toEqual({
        ctrlEnter: false,
        shiftEnter: true,
        altEnter: false,
      });
    });

    it("persists newlineShortcuts to localStorage (round-trip) [AC-5]", async () => {
      useSettingsStore.getState().setNewlineShortcut("shiftEnter", false);
      useSettingsStore.getState().setNewlineShortcut("altEnter", false);

      // Reload the module to simulate app restart
      vi.resetModules();
      const mod = await import("../stores/settingsStore");
      expect(mod.useSettingsStore.getState().newlineShortcuts).toEqual({
        ctrlEnter: true,
        shiftEnter: false,
        altEnter: false,
      });
    });

    it("migrates from older payloads lacking newlineShortcuts (defaults to true)", async () => {
      // Simulate an older persisted payload that predates this feature.
      localStorage.setItem(
        "putz-settings",
        JSON.stringify({ workspaceBarVisible: false }),
      );
      vi.resetModules();
      const mod = await import("../stores/settingsStore");
      expect(mod.useSettingsStore.getState().newlineShortcuts).toEqual({
        ctrlEnter: true,
        shiftEnter: true,
        altEnter: true,
      });
    });

    it("fills missing sub-fields when only some are persisted", async () => {
      // Partial older payload — only ctrlEnter persisted, others missing.
      localStorage.setItem(
        "putz-settings",
        JSON.stringify({
          newlineShortcuts: { ctrlEnter: false },
        }),
      );
      vi.resetModules();
      const mod = await import("../stores/settingsStore");
      expect(mod.useSettingsStore.getState().newlineShortcuts).toEqual({
        ctrlEnter: false,
        shiftEnter: true,
        altEnter: true,
      });
    });
  });
});
