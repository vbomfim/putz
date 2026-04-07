/**
 * Unit tests for the broadcast store (Zustand).
 *
 * Tests cover: toggle, addTab, removeTab, setTargets, deactivate,
 * auto-selection, edge cases, and tab lifecycle cleanup.
 *
 * Tags: [TDD], [AC-broadcast]
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useBroadcastStore } from "../stores/broadcastStore";

describe("broadcastStore", () => {
  beforeEach(() => {
    // Reset Zustand state between tests
    useBroadcastStore.setState({
      isActive: false,
      targetTabIds: new Set<string>(),
    });
  });

  describe("initial state", () => {
    it("starts with broadcast inactive", () => {
      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
    });

    it("starts with empty target set", () => {
      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.size).toBe(0);
    });
  });

  describe("toggle", () => {
    it("activates broadcast and auto-selects all other tabs as targets", () => {
      const allTabs = ["tab-1", "tab-2", "tab-3"];
      const activeTab = "tab-1";

      useBroadcastStore.getState().toggle(allTabs, activeTab);

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(true);
      expect(state.targetTabIds).toEqual(new Set(["tab-2", "tab-3"]));
    });

    it("does not include the active tab in targets", () => {
      const allTabs = ["tab-1", "tab-2"];
      const activeTab = "tab-1";

      useBroadcastStore.getState().toggle(allTabs, activeTab);

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.has("tab-1")).toBe(false);
    });

    it("deactivates broadcast when already active", () => {
      // First toggle — activate
      useBroadcastStore.getState().toggle(["tab-1", "tab-2"], "tab-1");
      expect(useBroadcastStore.getState().isActive).toBe(true);

      // Second toggle — deactivate
      useBroadcastStore.getState().toggle(["tab-1", "tab-2"], "tab-1");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });

    it("does not activate when only one tab exists (no targets)", () => {
      useBroadcastStore.getState().toggle(["tab-1"], "tab-1");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });

    it("does not activate with empty tab list", () => {
      useBroadcastStore.getState().toggle([], "");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
    });
  });

  describe("addTab", () => {
    it("adds a tab to the target set", () => {
      useBroadcastStore.getState().addTab("tab-2");

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.has("tab-2")).toBe(true);
    });

    it("does not duplicate existing targets", () => {
      useBroadcastStore.getState().addTab("tab-2");
      useBroadcastStore.getState().addTab("tab-2");

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.size).toBe(1);
    });

    it("can add multiple tabs", () => {
      useBroadcastStore.getState().addTab("tab-2");
      useBroadcastStore.getState().addTab("tab-3");

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.size).toBe(2);
      expect(state.targetTabIds.has("tab-2")).toBe(true);
      expect(state.targetTabIds.has("tab-3")).toBe(true);
    });
  });

  describe("removeTab", () => {
    it("removes a tab from the target set", () => {
      // Set up with targets
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2", "tab-3"]),
      });

      useBroadcastStore.getState().removeTab("tab-2");

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds.has("tab-2")).toBe(false);
      expect(state.targetTabIds.has("tab-3")).toBe(true);
    });

    it("deactivates broadcast when last target is removed", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2"]),
      });

      useBroadcastStore.getState().removeTab("tab-2");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });

    it("handles removing a non-existent tab gracefully", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2"]),
      });

      useBroadcastStore.getState().removeTab("tab-nonexistent");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(true);
      expect(state.targetTabIds.size).toBe(1);
    });
  });

  describe("setTargets", () => {
    it("replaces the entire target set", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2"]),
      });

      useBroadcastStore.getState().setTargets(["tab-3", "tab-4"]);

      const state = useBroadcastStore.getState();
      expect(state.targetTabIds).toEqual(new Set(["tab-3", "tab-4"]));
    });

    it("deactivates broadcast when set to empty targets while active", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2"]),
      });

      useBroadcastStore.getState().setTargets([]);

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });

    it("allows setting targets while inactive without activating", () => {
      useBroadcastStore.getState().setTargets(["tab-2", "tab-3"]);

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(2);
    });
  });

  describe("deactivate", () => {
    it("deactivates broadcast and clears targets", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2", "tab-3"]),
      });

      useBroadcastStore.getState().deactivate();

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });

    it("is idempotent when already inactive", () => {
      useBroadcastStore.getState().deactivate();

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
      expect(state.targetTabIds.size).toBe(0);
    });
  });

  describe("tab lifecycle", () => {
    it("removing a closed tab from targets keeps broadcast active if other targets remain", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2", "tab-3", "tab-4"]),
      });

      // Simulate tab-3 being closed
      useBroadcastStore.getState().removeTab("tab-3");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(true);
      expect(state.targetTabIds).toEqual(new Set(["tab-2", "tab-4"]));
    });

    it("removing the last target deactivates broadcast silently", () => {
      useBroadcastStore.setState({
        isActive: true,
        targetTabIds: new Set(["tab-2"]),
      });

      useBroadcastStore.getState().removeTab("tab-2");

      const state = useBroadcastStore.getState();
      expect(state.isActive).toBe(false);
    });
  });
});
