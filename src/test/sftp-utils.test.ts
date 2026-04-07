/**
 * SFTP Utility Functions — Unit Tests
 *
 * Tests for formatFileSize, formatPermissions, formatSpeed, formatEta.
 *
 * Tags: [UNIT], [AC-2], [AC-3], [AC-4]
 */
import { describe, it, expect } from "vitest";
import {
  formatFileSize,
  formatPermissions,
  formatSpeed,
  formatEta,
} from "../components/SFTP/types";

describe("SFTP Utility Functions", () => {
  // ─── formatFileSize ────────────────────────────────────────

  describe("formatFileSize", () => {
    it("formats 0 bytes", () => {
      expect(formatFileSize(0)).toBe("0 B");
    });

    it("formats bytes", () => {
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes", () => {
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
      expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    });

    it("formats gigabytes", () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    });

    it("formats terabytes", () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe("1.0 TB");
    });

    it("handles large files (>4GB)", () => {
      // 5 GB
      expect(formatFileSize(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
    });
  });

  // ─── formatPermissions ─────────────────────────────────────

  describe("formatPermissions", () => {
    it("formats 755 permissions", () => {
      expect(formatPermissions(0o755)).toBe("rwxr-xr-x");
    });

    it("formats 644 permissions", () => {
      expect(formatPermissions(0o644)).toBe("rw-r--r--");
    });

    it("formats 777 permissions", () => {
      expect(formatPermissions(0o777)).toBe("rwxrwxrwx");
    });

    it("formats 000 permissions", () => {
      expect(formatPermissions(0o000)).toBe("---------");
    });

    it("formats 600 permissions", () => {
      expect(formatPermissions(0o600)).toBe("rw-------");
    });

    it("formats 400 permissions (read-only)", () => {
      expect(formatPermissions(0o400)).toBe("r--------");
    });
  });

  // ─── formatSpeed ───────────────────────────────────────────

  describe("formatSpeed", () => {
    it("formats bytes per second", () => {
      expect(formatSpeed(512)).toBe("512 B/s");
    });

    it("formats KB per second", () => {
      expect(formatSpeed(1024)).toBe("1.0 KB/s");
    });

    it("formats MB per second", () => {
      expect(formatSpeed(5 * 1024 * 1024)).toBe("5.0 MB/s");
    });

    it("formats zero speed", () => {
      expect(formatSpeed(0)).toBe("0 B/s");
    });
  });

  // ─── formatEta ─────────────────────────────────────────────

  describe("formatEta", () => {
    it("returns dash for zero seconds", () => {
      expect(formatEta(0)).toBe("—");
    });

    it("returns dash for negative seconds", () => {
      expect(formatEta(-5)).toBe("—");
    });

    it("formats seconds", () => {
      expect(formatEta(30)).toBe("30s");
    });

    it("formats minutes and seconds", () => {
      expect(formatEta(90)).toBe("1m 30s");
    });

    it("formats hours and minutes", () => {
      expect(formatEta(3661)).toBe("1h 1m");
    });

    it("formats 59 seconds", () => {
      expect(formatEta(59)).toBe("59s");
    });

    it("formats 60 seconds as 1m 0s", () => {
      expect(formatEta(60)).toBe("1m 0s");
    });
  });
});
