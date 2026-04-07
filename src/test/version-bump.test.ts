/**
 * Unit tests for the version-bump script.
 *
 * Tests the core logic: CLI argument validation and error handling.
 * Uses the real script but tests error paths to avoid modifying project files.
 *
 * Tags: [TDD], [AC-VERSION]
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts", "version-bump.mjs");

describe("version-bump script", () => {
  it("shows usage when no argument is provided", () => {
    try {
      execSync(`node ${SCRIPT}`, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.fail("Should have exited with non-zero code");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("Usage:");
    }
  });

  it("rejects invalid version strings", () => {
    try {
      execSync(`node ${SCRIPT} abc`, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.fail("Should have exited with non-zero code");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
      expect(error.stderr).toContain("Invalid argument");
    }
  });

  it("rejects invalid flags", () => {
    try {
      execSync(`node ${SCRIPT} --invalid-flag`, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.fail("Should have exited with non-zero code");
    } catch (err: unknown) {
      const error = err as { status: number; stderr: string };
      expect(error.status).toBe(1);
    }
  });
});
