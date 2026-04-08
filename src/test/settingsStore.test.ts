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

  it("defaults toolbarVisible to false when no persisted state", () => {
    const state = useSettingsStore.getState();
    expect(state.toolbarVisible).toBe(false);
  });

  it("defaults shortcutsPanelOpen to false", () => {
    const state = useSettingsStore.getState();
    expect(state.shortcutsPanelOpen).toBe(false);
  });

  it("toggleToolbar flips visibility", () => {
    useSettingsStore.getState().toggleToolbar();
    expect(useSettingsStore.getState().toolbarVisible).toBe(true);

    useSettingsStore.getState().toggleToolbar();
    expect(useSettingsStore.getState().toolbarVisible).toBe(false);
  });

  it("toggleToolbar persists to localStorage", () => {
    useSettingsStore.getState().toggleToolbar();
    const stored = JSON.parse(localStorage.getItem("putz-settings") || "{}");
    expect(stored.toolbarVisible).toBe(true);
  });

  it("setToolbarVisible sets and persists", () => {
    useSettingsStore.getState().setToolbarVisible(false);
    expect(useSettingsStore.getState().toolbarVisible).toBe(false);

    const stored = JSON.parse(localStorage.getItem("putz-settings") || "{}");
    expect(stored.toolbarVisible).toBe(false);
  });

  it("loads persisted toolbar state on creation", async () => {
    localStorage.setItem(
      "putz-settings",
      JSON.stringify({ toolbarVisible: false }),
    );
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    expect(mod.useSettingsStore.getState().toolbarVisible).toBe(false);
  });

  it("handles corrupted localStorage gracefully", async () => {
    localStorage.setItem("putz-settings", "not-json{{{");
    vi.resetModules();
    const mod = await import("../stores/settingsStore");
    expect(mod.useSettingsStore.getState().toolbarVisible).toBe(false);
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
