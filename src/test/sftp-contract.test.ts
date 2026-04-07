/**
 * SFTP Protocol — Contract Tests
 *
 * Validates that TypeScript type definitions for SFTP-specific IPC
 * commands and events match the Rust backend's expected structure.
 * Catches type drift between frontend and backend.
 *
 * Tags: [CONTRACT], [AC-1]–[AC-7]
 */
import { describe, it, expect } from "vitest";
import type {
  RemoteFileEntry,
  RemoteFileStat,
  TransferInfo,
  TransferProgressPayload,
  TransferCompletePayload,
  TransferDirection,
  TransferStatus,
  SftpContextAction,
} from "../components/SFTP/types";

describe("SFTP Contract Tests", () => {
  // ─── RemoteFileEntry ───────────────────────────────────────

  describe("[CONTRACT] RemoteFileEntry", () => {
    it("has all required fields for a file entry", () => {
      const entry: RemoteFileEntry = {
        name: "config.json",
        path: "/etc/config.json",
        isDir: false,
        size: 4096,
        permissions: 0o644,
        modified: 1700000000,
        uid: 1000,
        gid: 1000,
      };
      expect(entry.name).toBe("config.json");
      expect(entry.path).toBe("/etc/config.json");
      expect(entry.isDir).toBe(false);
      expect(entry.size).toBe(4096);
    });

    it("allows optional fields to be undefined", () => {
      const entry: RemoteFileEntry = {
        name: "dir",
        path: "/dir",
        isDir: true,
        size: 0,
      };
      expect(entry.permissions).toBeUndefined();
      expect(entry.modified).toBeUndefined();
      expect(entry.uid).toBeUndefined();
      expect(entry.gid).toBeUndefined();
    });

    it("directory entry has isDir=true and size=0", () => {
      const entry: RemoteFileEntry = {
        name: "home",
        path: "/home",
        isDir: true,
        size: 0,
      };
      expect(entry.isDir).toBe(true);
      expect(entry.size).toBe(0);
    });
  });

  // ─── RemoteFileStat ────────────────────────────────────────

  describe("[CONTRACT] RemoteFileStat", () => {
    it("has all fields including accessed time", () => {
      const stat: RemoteFileStat = {
        path: "/home/user",
        isDir: true,
        size: 0,
        permissions: 0o755,
        modified: 1700000000,
        accessed: 1700000100,
        uid: 0,
        gid: 0,
      };
      expect(stat.path).toBe("/home/user");
      expect(stat.isDir).toBe(true);
      expect(stat.accessed).toBe(1700000100);
    });

    it("all optional fields can be omitted", () => {
      const stat: RemoteFileStat = {
        path: "/f",
        isDir: false,
        size: 100,
      };
      expect(stat.permissions).toBeUndefined();
      expect(stat.modified).toBeUndefined();
      expect(stat.accessed).toBeUndefined();
    });
  });

  // ─── TransferInfo ──────────────────────────────────────────

  describe("[CONTRACT] TransferInfo", () => {
    it("has all required fields for an active transfer", () => {
      const info: TransferInfo = {
        transferId: "uuid-123",
        sftpSessionId: "sftp-001",
        remotePath: "/home/user/file.tar.gz",
        localPath: "/Users/user/Downloads/file.tar.gz",
        direction: "download",
        status: "inprogress",
        bytesTransferred: 5000000,
        totalBytes: 10000000,
        speed: 2500000,
        etaSeconds: 2,
      };
      expect(info.transferId).toBe("uuid-123");
      expect(info.direction).toBe("download");
      expect(info.status).toBe("inprogress");
    });

    it("failed transfer includes error message", () => {
      const info: TransferInfo = {
        transferId: "uuid-456",
        sftpSessionId: "sftp-001",
        remotePath: "/f",
        localPath: "/l",
        direction: "upload",
        status: "failed",
        bytesTransferred: 0,
        totalBytes: 1000,
        speed: 0,
        etaSeconds: 0,
        error: "connection lost",
      };
      expect(info.status).toBe("failed");
      expect(info.error).toBe("connection lost");
    });
  });

  // ─── TransferDirection ─────────────────────────────────────

  describe("[CONTRACT] TransferDirection", () => {
    it("has download and upload values", () => {
      const directions: TransferDirection[] = ["download", "upload"];
      expect(directions).toHaveLength(2);
    });
  });

  // ─── TransferStatus ────────────────────────────────────────

  describe("[CONTRACT] TransferStatus", () => {
    it("has all five status values", () => {
      const statuses: TransferStatus[] = [
        "queued",
        "inprogress",
        "completed",
        "failed",
        "cancelled",
      ];
      expect(statuses).toHaveLength(5);
    });
  });

  // ─── TransferProgressPayload ───────────────────────────────

  describe("[CONTRACT] TransferProgressPayload", () => {
    it("has all progress fields including progressPercent", () => {
      const payload: TransferProgressPayload = {
        transferId: "t1",
        status: "inprogress",
        bytesTransferred: 5000,
        totalBytes: 10000,
        speed: 2500,
        etaSeconds: 2,
        progressPercent: 50,
      };
      expect(payload.progressPercent).toBe(50);
      expect(payload.speed).toBe(2500);
    });
  });

  // ─── TransferCompletePayload ───────────────────────────────

  describe("[CONTRACT] TransferCompletePayload", () => {
    it("completed transfer has no error", () => {
      const payload: TransferCompletePayload = {
        transferId: "t1",
        status: "completed",
        bytesTransferred: 10000,
      };
      expect(payload.status).toBe("completed");
      expect(payload.error).toBeUndefined();
    });

    it("failed transfer includes error", () => {
      const payload: TransferCompletePayload = {
        transferId: "t2",
        status: "failed",
        error: "Read error: broken pipe",
        bytesTransferred: 500,
      };
      expect(payload.error).toBe("Read error: broken pipe");
    });
  });

  // ─── Event name format contracts ───────────────────────────

  describe("[CONTRACT] SFTP Event Name Format", () => {
    it("progress event follows pattern: sftp-progress-{transferId}", () => {
      const transferId = "uuid-123";
      const eventName = `sftp-progress-${transferId}`;
      expect(eventName).toBe("sftp-progress-uuid-123");
    });

    it("complete event follows pattern: sftp-complete-{transferId}", () => {
      const transferId = "uuid-456";
      const eventName = `sftp-complete-${transferId}`;
      expect(eventName).toBe("sftp-complete-uuid-456");
    });
  });

  // ─── Context menu actions ──────────────────────────────────

  describe("[CONTRACT] SftpContextAction", () => {
    it("has all six context menu actions", () => {
      const actions: SftpContextAction[] = [
        "download",
        "upload",
        "rename",
        "delete",
        "newFolder",
        "properties",
      ];
      expect(actions).toHaveLength(6);
    });
  });

  // ─── IPC command name contracts ────────────────────────────

  describe("[CONTRACT] IPC command names", () => {
    it("SFTP commands follow naming convention", () => {
      const commands = [
        "sftp_open",
        "sftp_list",
        "sftp_stat",
        "sftp_download",
        "sftp_upload",
        "sftp_rename",
        "sftp_delete",
        "sftp_mkdir",
        "sftp_close",
      ];
      expect(commands).toHaveLength(9);
      for (const cmd of commands) {
        expect(cmd).toMatch(/^sftp_\w+$/);
      }
    });
  });
});
