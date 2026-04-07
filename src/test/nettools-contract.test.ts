/**
 * Contract tests for the Ping and Backup IPC layers.
 *
 * Verifies that pingApi.ts and backupApi.ts functions call the correct
 * Tauri commands with the expected parameters.
 *
 * Tags: [TDD], [CONTRACT]
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { pingStart, pingStop } from "../components/Ping/pingApi";
import { saveBackup } from "../components/Backup/backupApi";
import type { PingRequest } from "../components/Ping/types";
import type {
  SaveBackupRequest,
  SaveBackupResponse,
} from "../components/Backup/types";

describe("Ping API contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ─── ping_start ─────────────────────────────────────────────

  it("pingStart calls ping_start with request", async () => {
    mockInvoke.mockResolvedValue("session-123");

    const request: PingRequest = {
      targets: ["8.8.8.8", "1.1.1.1"],
      count: 4,
      interval: 1.0,
    };
    const result = await pingStart(request);

    expect(mockInvoke).toHaveBeenCalledWith("ping_start", { request });
    expect(result).toBe("session-123");
  });

  it("pingStart passes optional fields", async () => {
    mockInvoke.mockResolvedValue("session-456");

    const request: PingRequest = {
      targets: ["router1.example.com"],
    };
    const result = await pingStart(request);

    expect(mockInvoke).toHaveBeenCalledWith("ping_start", { request });
    expect(result).toBe("session-456");
  });

  it("pingStart rejects on backend error", async () => {
    mockInvoke.mockRejectedValue("At least one target is required");

    const request: PingRequest = { targets: [] };
    await expect(pingStart(request)).rejects.toBe(
      "At least one target is required",
    );
  });

  // ─── ping_stop ──────────────────────────────────────────────

  it("pingStop calls ping_stop with id", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await pingStop("session-123");
    expect(mockInvoke).toHaveBeenCalledWith("ping_stop", { id: "session-123" });
  });

  it("pingStop rejects on unknown id", async () => {
    mockInvoke.mockRejectedValue("No ping session found with id: unknown");

    await expect(pingStop("unknown")).rejects.toBe(
      "No ping session found with id: unknown",
    );
  });
});

describe("Backup API contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ─── save_backup ────────────────────────────────────────────

  it("saveBackup calls save_backup with request", async () => {
    const mockResponse: SaveBackupResponse = {
      path: "/Users/test/putz-backups/router1_20240101_120000.txt",
      size: 1024,
    };
    mockInvoke.mockResolvedValue(mockResponse);

    const request: SaveBackupRequest = {
      hostname: "router1",
      content: "hostname router1\ninterface Gi0/0\n",
    };
    const result = await saveBackup(request);

    expect(mockInvoke).toHaveBeenCalledWith("save_backup", { request });
    expect(result).toEqual(mockResponse);
  });

  it("saveBackup rejects on empty content", async () => {
    mockInvoke.mockRejectedValue("Backup content is empty");

    const request: SaveBackupRequest = {
      hostname: "router1",
      content: "",
    };
    await expect(saveBackup(request)).rejects.toBe("Backup content is empty");
  });

  it("saveBackup rejects on oversized content", async () => {
    mockInvoke.mockRejectedValue("Backup content too large (max 10 MB)");

    const request: SaveBackupRequest = {
      hostname: "router1",
      content: "x".repeat(11 * 1024 * 1024),
    };
    await expect(saveBackup(request)).rejects.toBe(
      "Backup content too large (max 10 MB)",
    );
  });
});
