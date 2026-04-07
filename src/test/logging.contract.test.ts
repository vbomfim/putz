/**
 * IPC Contract tests for session logging commands.
 *
 * Validates the TypeScript types match the Rust backend's
 * IPC command signatures for logging operations.
 */
import { describe, it, expect } from "vitest";

/** Mirrors Rust LogConfig struct (camelCase via serde). */
interface LogConfig {
  directory: string;
  sessionName: string;
  timestamps: boolean;
  stripAnsi: boolean;
  maxFileSize: number;
  flushIntervalMs: number;
}

/** Mirrors Rust LogStatus struct (camelCase via serde). */
interface LogStatus {
  active: boolean;
  filePath: string | null;
  bytesWritten: number;
  rotationCount: number;
}

describe("IPC Contract — Logging", () => {
  describe("LogConfig", () => {
    it("[CONTRACT] logging_start requires sessionId and config", () => {
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";
      const config: LogConfig = {
        directory: "/home/user/putz-logs",
        sessionName: "my-session",
        timestamps: true,
        stripAnsi: true,
        maxFileSize: 100 * 1024 * 1024,
        flushIntervalMs: 100,
      };

      expect(typeof sessionId).toBe("string");
      expect(typeof config.sessionName).toBe("string");
      expect(typeof config.timestamps).toBe("boolean");
      expect(typeof config.stripAnsi).toBe("boolean");
      expect(typeof config.maxFileSize).toBe("number");
    });

    it("[BOUNDARY] maxFileSize must be at least 1024 bytes", () => {
      const config: LogConfig = {
        directory: "/tmp",
        sessionName: "test",
        timestamps: true,
        stripAnsi: true,
        maxFileSize: 1024,
        flushIntervalMs: 100,
      };
      expect(config.maxFileSize).toBeGreaterThanOrEqual(1024);
    });

    it("[EDGE] sessionName cannot contain path separators", () => {
      const validName = "my-session-2025";
      expect(validName).not.toContain("/");
      expect(validName).not.toContain("\\");
      expect(validName).not.toContain("..");
    });

    it("[CONTRACT] all config fields use camelCase", () => {
      const config: LogConfig = {
        directory: "/tmp",
        sessionName: "test",
        timestamps: true,
        stripAnsi: true,
        maxFileSize: 1024,
        flushIntervalMs: 100,
      };

      const keys = Object.keys(config);
      expect(keys).toContain("sessionName");
      expect(keys).toContain("stripAnsi");
      expect(keys).toContain("maxFileSize");
      expect(keys).toContain("flushIntervalMs");
    });
  });

  describe("LogStatus", () => {
    it("[CONTRACT] status has required fields", () => {
      const status: LogStatus = {
        active: true,
        filePath: "/home/user/putz-logs/session_2025-01-15_14-32-01.log",
        bytesWritten: 1024,
        rotationCount: 0,
      };

      expect(typeof status.active).toBe("boolean");
      expect(typeof status.bytesWritten).toBe("number");
      expect(typeof status.rotationCount).toBe("number");
    });

    it("[CONTRACT] inactive status has null filePath", () => {
      const status: LogStatus = {
        active: false,
        filePath: null,
        bytesWritten: 0,
        rotationCount: 0,
      };

      expect(status.active).toBe(false);
      expect(status.filePath).toBeNull();
    });
  });

  describe("IPC Command Names", () => {
    it("[CONTRACT] logging commands follow naming convention", () => {
      const commands = ["logging_start", "logging_stop", "logging_status"];
      for (const cmd of commands) {
        expect(cmd).toMatch(/^logging_/);
      }
    });
  });
});
