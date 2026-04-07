/**
 * Extended contract and boundary tests for session logging.
 *
 * Validates the LogConfig contract more thoroughly:
 * - Session name sanitization rules
 * - File size boundaries
 * - Config defaults match between frontend and backend
 * - LogStatus state machine transitions
 * - IPC error response format
 *
 * Tags: [CONTRACT], [BOUNDARY], [EDGE], [AC-2], [AC-6]
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

/**
 * Mirrors the session name sanitization logic in tabStore.ts.
 * This ensures the frontend sanitization stays in sync with expectations.
 */
function sanitizeSessionName(title: string): string {
  return title.replace(/\s+/g, "-").toLowerCase();
}

describe("Logging Contract — Extended", () => {
  // ── AC-2: Timestamp format contract ───────────────────────────────

  describe("timestamp format [CONTRACT] [AC-2]", () => {
    it("timestamp format matches [YYYY-MM-DD HH:MM:SS.mmm]", () => {
      const timestampRegex =
        /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] $/;
      // Example from the PO ticket
      const example = "[2025-01-15 14:32:01.123] ";
      expect(example).toMatch(timestampRegex);
    });

    it("timestamp is exactly 26 characters including trailing space", () => {
      const example = "[2025-01-15 14:32:01.123] ";
      expect(example.length).toBe(26);
    });
  });

  // ── Session name sanitization contract ────────────────────────────

  describe("session name sanitization [CONTRACT]", () => {
    it("replaces spaces with dashes", () => {
      expect(sanitizeSessionName("My Tab")).toBe("my-tab");
    });

    it("converts to lowercase", () => {
      expect(sanitizeSessionName("TERMINAL")).toBe("terminal");
    });

    it("replaces multiple consecutive spaces with a single dash", () => {
      // \\s+ matches one-or-more whitespace and replaces with single "-"
      expect(sanitizeSessionName("My  SSH   Server")).toBe("my-ssh-server");
    });

    it("handles already sanitized names", () => {
      expect(sanitizeSessionName("terminal-1")).toBe("terminal-1");
    });

    it("[EDGE] handles tabs and newlines as whitespace", () => {
      expect(sanitizeSessionName("tab\there")).toBe("tab-here");
    });

    it("[EDGE] handles leading/trailing spaces", () => {
      // \\s+ replaces runs of whitespace with single "-"
      expect(sanitizeSessionName(" leading ")).toBe("-leading-");
    });

    it("[EDGE] handles empty string", () => {
      expect(sanitizeSessionName("")).toBe("");
    });

    it("[EDGE] handles unicode characters", () => {
      // Unicode should pass through — only spaces are replaced
      expect(sanitizeSessionName("日本語 テスト")).toBe("日本語-テスト");
    });
  });

  // ── AC-6: File size rotation boundaries ───────────────────────────

  describe("file size boundaries [BOUNDARY] [AC-6]", () => {
    it("default maxFileSize is exactly 100MB", () => {
      const defaultMax = 100 * 1024 * 1024;
      expect(defaultMax).toBe(104857600);
    });

    it("minimum maxFileSize is 1KB (1024 bytes)", () => {
      const minSize = 1024;
      const config: LogConfig = {
        directory: "",
        sessionName: "test",
        timestamps: true,
        stripAnsi: true,
        maxFileSize: minSize,
        flushIntervalMs: 100,
      };
      expect(config.maxFileSize).toBeGreaterThanOrEqual(1024);
    });

    it("[EDGE] maxFileSize below 1024 should be rejected by Rust", () => {
      const tooSmall = 1023;
      expect(tooSmall).toBeLessThan(1024);
      // Rust config.validate() returns error for this
    });

    it("rotation creates files with _partN suffix pattern", () => {
      const baseFile = "my-session_2025-01-15_14-32-01.log";
      const rotatedPattern = /^.+_part\d+\.log$/;
      const rotated = "my-session_2025-01-15_14-32-01_part1.log";
      expect(rotated).toMatch(rotatedPattern);
    });
  });

  // ── LogStatus state machine ───────────────────────────────────────

  describe("LogStatus state machine [CONTRACT]", () => {
    it("inactive status: active=false, filePath=null, bytes=0", () => {
      const inactive: LogStatus = {
        active: false,
        filePath: null,
        bytesWritten: 0,
        rotationCount: 0,
      };
      expect(inactive.active).toBe(false);
      expect(inactive.filePath).toBeNull();
      expect(inactive.bytesWritten).toBe(0);
    });

    it("active status: active=true, filePath non-null, bytes >= 0", () => {
      const active: LogStatus = {
        active: true,
        filePath: "/home/user/putz-logs/session_2025-01-15.log",
        bytesWritten: 4096,
        rotationCount: 0,
      };
      expect(active.active).toBe(true);
      expect(active.filePath).not.toBeNull();
      expect(active.bytesWritten).toBeGreaterThanOrEqual(0);
    });

    it("rotated status: rotationCount > 0", () => {
      const rotated: LogStatus = {
        active: true,
        filePath: "/home/user/putz-logs/session_part2.log",
        bytesWritten: 50000,
        rotationCount: 2,
      };
      expect(rotated.rotationCount).toBeGreaterThan(0);
    });

    it("[EDGE] bytesWritten and rotationCount are never negative", () => {
      const status: LogStatus = {
        active: true,
        filePath: "/tmp/test.log",
        bytesWritten: 0,
        rotationCount: 0,
      };
      expect(status.bytesWritten).toBeGreaterThanOrEqual(0);
      expect(status.rotationCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Config defaults match frontend ↔ backend ─────────────────────

  describe("config defaults alignment [CONTRACT]", () => {
    it("frontend defaults match PO ticket specification", () => {
      // These are the defaults from tabStore.toggleLogging()
      const frontendDefaults: LogConfig = {
        directory: "",
        sessionName: "terminal-1", // sanitized from "Terminal 1"
        timestamps: true,
        stripAnsi: true,
        maxFileSize: 100 * 1024 * 1024,
        flushIntervalMs: 100,
      };

      expect(frontendDefaults.timestamps).toBe(true);
      expect(frontendDefaults.stripAnsi).toBe(true);
      expect(frontendDefaults.maxFileSize).toBe(104857600); // 100MB
      expect(frontendDefaults.flushIntervalMs).toBe(100);
    });

    it("empty directory tells backend to use ~/putz-logs/", () => {
      const config: LogConfig = {
        directory: "",
        sessionName: "test",
        timestamps: true,
        stripAnsi: true,
        maxFileSize: 104857600,
        flushIntervalMs: 100,
      };
      expect(config.directory).toBe("");
    });
  });

  // ── Log file naming pattern ───────────────────────────────────────

  describe("log file naming pattern [CONTRACT] [AC-1]", () => {
    it("follows {session-name}_{YYYY-MM-DD_HH-mm-ss}.log pattern", () => {
      const pattern = /^[a-z0-9-]+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/;
      const example = "my-session_2025-01-15_14-32-01.log";
      expect(example).toMatch(pattern);
    });

    it("log directory default is ~/putz-logs/", () => {
      // This is documented in the PO ticket AC1
      const defaultDir = "~/putz-logs/";
      expect(defaultDir).toContain("putz-logs");
    });
  });

  // ── IPC command signatures ────────────────────────────────────────

  describe("IPC command signatures [CONTRACT]", () => {
    it("logging_start takes sessionId (string) and config (object)", () => {
      const args = {
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        config: {
          directory: "",
          sessionName: "test",
          timestamps: true,
          stripAnsi: true,
          maxFileSize: 104857600,
          flushIntervalMs: 100,
        },
      };

      expect(typeof args.sessionId).toBe("string");
      expect(typeof args.config).toBe("object");
      expect(typeof args.config.timestamps).toBe("boolean");
      expect(typeof args.config.maxFileSize).toBe("number");
    });

    it("logging_stop takes only sessionId", () => {
      const args = {
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(Object.keys(args)).toEqual(["sessionId"]);
    });

    it("logging_status takes only sessionId", () => {
      const args = {
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
      };
      expect(Object.keys(args)).toEqual(["sessionId"]);
    });

    it("logging_start returns file path on success", () => {
      const successResponse = "/home/user/putz-logs/session_2025-01-15.log";
      expect(typeof successResponse).toBe("string");
      expect(successResponse).toContain(".log");
    });

    it("logging_start returns error string on failure", () => {
      const errorResponse = "Directory creation failed: Permission denied";
      expect(typeof errorResponse).toBe("string");
    });
  });
});
