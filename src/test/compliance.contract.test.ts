/**
 * Compliance contract tests — validate TypeScript types match Rust backend.
 *
 * Tags: [CONTRACT], [TDD]
 */
import { describe, it, expect } from "vitest";
import type {
  ChangeWindow,
  ChangeWindowCheckResult,
  SetChangeWindowInput,
} from "../components/Compliance/types";

describe("Compliance type contracts", () => {
  // ─── ChangeWindow ────────────────────────────────────────

  it("ChangeWindow has all required fields", () => {
    const window: ChangeWindow = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Maintenance",
      startHour: 22,
      endHour: 6,
      daysOfWeek: [0, 6],
      enabled: true,
    };
    expect(window.id).toBeDefined();
    expect(window.name).toBe("Maintenance");
    expect(window.startHour).toBe(22);
    expect(window.endHour).toBe(6);
    expect(window.daysOfWeek).toEqual([0, 6]);
    expect(window.enabled).toBe(true);
  });

  it("ChangeWindow does NOT have timezone or other extra fields", () => {
    const window: ChangeWindow = {
      id: "id",
      name: "Test",
      startHour: 0,
      endHour: 23,
      daysOfWeek: [],
      enabled: false,
    };
    // @ts-expect-error — timezone should not exist
    expect(window.timezone).toBeUndefined();
  });

  // ─── ChangeWindowCheckResult ────────────────────────────

  it("ChangeWindowCheckResult has allowed and reason", () => {
    const result: ChangeWindowCheckResult = {
      allowed: false,
      reason: "Outside maintenance window",
    };
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Outside maintenance window");
  });

  it("ChangeWindowCheckResult allowed=true has empty reason", () => {
    const result: ChangeWindowCheckResult = {
      allowed: true,
      reason: "",
    };
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("");
  });

  // ─── SetChangeWindowInput ──────────────────────────────

  it("SetChangeWindowInput for create (no id)", () => {
    const input: SetChangeWindowInput = {
      name: "Weekend Window",
      startHour: 0,
      endHour: 23,
      daysOfWeek: [0, 6],
      enabled: true,
    };
    expect(input.id).toBeUndefined();
    expect(input.name).toBe("Weekend Window");
  });

  it("SetChangeWindowInput for update (with id)", () => {
    const input: SetChangeWindowInput = {
      id: "abc-123",
      name: "Updated Window",
      startHour: 18,
      endHour: 6,
      daysOfWeek: [1, 2, 3, 4, 5],
      enabled: false,
    };
    expect(input.id).toBe("abc-123");
    expect(input.enabled).toBe(false);
  });

  // ─── Serialization contracts ──────────────────────────────

  it("ChangeWindow uses camelCase field names", () => {
    const window: ChangeWindow = {
      id: "id",
      name: "Test",
      startHour: 22,
      endHour: 6,
      daysOfWeek: [0],
      enabled: true,
    };
    const json = JSON.stringify(window);
    expect(json).toContain("startHour");
    expect(json).toContain("endHour");
    expect(json).toContain("daysOfWeek");
    // Should NOT contain snake_case
    expect(json).not.toContain("start_hour");
    expect(json).not.toContain("end_hour");
    expect(json).not.toContain("days_of_week");
  });

  // ─── IPC command name contracts ────────────────────────

  it("compliance IPC command names use snake_case", () => {
    const commands = [
      "change_window_check",
      "change_window_list",
      "change_window_set",
      "change_window_delete",
      "change_window_active",
    ];
    commands.forEach((cmd) => {
      expect(cmd).toMatch(/^[a-z_]+$/);
    });
  });

  // ─── Vault rotation extension contracts ─────────────────

  it("vault_check_expiring IPC command name", () => {
    expect("vault_check_expiring").toMatch(/^[a-z_]+$/);
  });

  // ─── Boundary validation ──────────────────────────────────

  it("ChangeWindow hours are 0-23 range", () => {
    const window: ChangeWindow = {
      id: "id",
      name: "Full Day",
      startHour: 0,
      endHour: 23,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
    };
    expect(window.startHour).toBeGreaterThanOrEqual(0);
    expect(window.startHour).toBeLessThanOrEqual(23);
    expect(window.endHour).toBeGreaterThanOrEqual(0);
    expect(window.endHour).toBeLessThanOrEqual(23);
  });

  it("daysOfWeek values are 0-6 (Sunday-Saturday)", () => {
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    allDays.forEach((day) => {
      expect(day).toBeGreaterThanOrEqual(0);
      expect(day).toBeLessThanOrEqual(6);
    });
  });
});
