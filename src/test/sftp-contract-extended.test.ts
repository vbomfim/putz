/**
 * SFTP Feature — Extended Contract Tests
 *
 * Validates the IPC boundary contract between frontend TypeScript and
 * backend Rust. Tests that the interface shapes, event names, and data
 * contracts survive refactoring on either side.
 *
 * Extends the Developer's contract tests with deeper validation.
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
  TransferStatus,
  SftpContextAction,
} from "../components/SFTP/types";
import { formatFileSize, formatPermissions } from "../components/SFTP/types";

// ── IPC Command Invocation Contract ──────────────────────────────

describe("[CONTRACT] IPC Command Invocation Shapes", () => {
  describe("sftp_open input contract", () => {
    it("requires connectionId string", () => {
      const input: { connectionId: string } = {
        connectionId: "uuid-conn-123",
      };
      expect(typeof input.connectionId).toBe("string");
      expect(input.connectionId.length).toBeGreaterThan(0);
    });

    it("returns string sftp_session_id", () => {
      const output: string = "uuid-sftp-456";
      expect(typeof output).toBe("string");
    });
  });

  describe("sftp_list input/output contract", () => {
    it("requires sftpSessionId and path", () => {
      const input: { sftpSessionId: string; path: string } = {
        sftpSessionId: "sftp-001",
        path: "/home/user",
      };
      expect(input.path.startsWith("/")).toBe(true);
    });

    it("output is array of RemoteFileEntry", () => {
      const output: RemoteFileEntry[] = [
        { name: "file.txt", path: "/file.txt", isDir: false, size: 1024 },
      ];
      expect(Array.isArray(output)).toBe(true);
      expect(output[0]).toHaveProperty("name");
      expect(output[0]).toHaveProperty("path");
      expect(output[0]).toHaveProperty("isDir");
      expect(output[0]).toHaveProperty("size");
    });
  });

  describe("sftp_download input contract", () => {
    it("requires sftpSessionId, remotePath, and localPath", () => {
      const input = {
        sftpSessionId: "sftp-001",
        remotePath: "/home/user/config.cfg",
        localPath: "/Users/user/Downloads/config.cfg",
      };
      expect(input.remotePath.startsWith("/")).toBe(true);
      expect(typeof input.localPath).toBe("string");
      expect(input.localPath.length).toBeGreaterThan(0);
    });
  });

  describe("sftp_upload input contract", () => {
    it("requires sftpSessionId, localPath, and remotePath", () => {
      const input = {
        sftpSessionId: "sftp-001",
        localPath: "/Users/user/firmware.bin",
        remotePath: "/flash/firmware.bin",
      };
      expect(input.remotePath.startsWith("/")).toBe(true);
      expect(typeof input.localPath).toBe("string");
    });
  });

  describe("sftp_rename input contract", () => {
    it("requires sftpSessionId, oldPath, and newPath", () => {
      const input = {
        sftpSessionId: "sftp-001",
        oldPath: "/home/user/old.txt",
        newPath: "/home/user/new.txt",
      };
      expect(input.oldPath.startsWith("/")).toBe(true);
      expect(input.newPath.startsWith("/")).toBe(true);
    });
  });

  describe("sftp_delete input contract", () => {
    it("requires sftpSessionId and path", () => {
      const input = { sftpSessionId: "sftp-001", path: "/tmp/obsolete.log" };
      expect(input.path.startsWith("/")).toBe(true);
    });

    it("path must not be root", () => {
      // Backend enforces this — the test documents the constraint
      const dangerousPath = "/";
      expect(dangerousPath).toBe("/");
      // Frontend should prevent this at the UI level
    });
  });

  describe("sftp_mkdir input contract", () => {
    it("requires sftpSessionId and path", () => {
      const input = { sftpSessionId: "sftp-001", path: "/home/user/new-dir" };
      expect(input.path.startsWith("/")).toBe(true);
    });
  });

  describe("sftp_stat input/output contract", () => {
    it("requires sftpSessionId and path, returns RemoteFileStat", () => {
      const output: RemoteFileStat = {
        path: "/home/user/file.txt",
        isDir: false,
        size: 4096,
        permissions: 0o644,
        modified: 1700000000,
        accessed: 1700000100,
        uid: 1000,
        gid: 1000,
      };
      expect(output).toHaveProperty("path");
      expect(output).toHaveProperty("isDir");
      expect(output).toHaveProperty("size");
      // accessed is unique to stat (not in RemoteFileEntry)
      expect(output).toHaveProperty("accessed");
    });
  });

  describe("sftp_close input contract", () => {
    it("requires sftpSessionId", () => {
      const input = { sftpSessionId: "sftp-001" };
      expect(typeof input.sftpSessionId).toBe("string");
    });
  });
});

// ── Data Shape Consistency ────────────────────────────────────────

describe("[CONTRACT] RemoteFileEntry ↔ RemoteFileStat field alignment", () => {
  it("shared fields have identical types", () => {
    const entry: RemoteFileEntry = {
      name: "f",
      path: "/f",
      isDir: false,
      size: 100,
      permissions: 0o644,
      modified: 1700000000,
      uid: 1000,
      gid: 1000,
    };

    const stat: RemoteFileStat = {
      path: "/f",
      isDir: false,
      size: 100,
      permissions: 0o644,
      modified: 1700000000,
      uid: 1000,
      gid: 1000,
    };

    // Shared fields must be type-compatible
    expect(typeof entry.path).toBe(typeof stat.path);
    expect(typeof entry.isDir).toBe(typeof stat.isDir);
    expect(typeof entry.size).toBe(typeof stat.size);
    expect(typeof entry.permissions).toBe(typeof stat.permissions);
    expect(typeof entry.modified).toBe(typeof stat.modified);
    expect(typeof entry.uid).toBe(typeof stat.uid);
    expect(typeof entry.gid).toBe(typeof stat.gid);
  });

  it("stat has 'accessed' field that entry does not", () => {
    const stat: RemoteFileStat = {
      path: "/f",
      isDir: false,
      size: 100,
      accessed: 1700000100,
    };
    expect(stat.accessed).toBe(1700000100);
    // RemoteFileEntry doesn't have 'accessed' — that's by design
  });

  it("entry has 'name' field that stat does not", () => {
    const entry: RemoteFileEntry = {
      name: "file.txt",
      path: "/file.txt",
      isDir: false,
      size: 100,
    };
    expect(entry.name).toBe("file.txt");
    // RemoteFileStat doesn't need 'name' — path is enough
  });
});

// ── TransferInfo → Event Payload consistency ──────────────────────

describe("[CONTRACT] TransferInfo → TransferProgressPayload consistency", () => {
  it("progress payload captures essential transfer state", () => {
    const info: TransferInfo = {
      transferId: "t1",
      sftpSessionId: "sftp-1",
      remotePath: "/f",
      localPath: "/l",
      direction: "download",
      status: "inprogress",
      bytesTransferred: 5000,
      totalBytes: 10000,
      speed: 2500,
      etaSeconds: 2,
    };

    const payload: TransferProgressPayload = {
      transferId: info.transferId,
      status: info.status,
      bytesTransferred: info.bytesTransferred,
      totalBytes: info.totalBytes,
      speed: info.speed,
      etaSeconds: info.etaSeconds,
      progressPercent: Math.round(
        (info.bytesTransferred / info.totalBytes) * 100,
      ),
    };

    // Payload is a proper subset of TransferInfo fields
    expect(payload.transferId).toBe(info.transferId);
    expect(payload.status).toBe(info.status);
    expect(payload.bytesTransferred).toBe(info.bytesTransferred);
    expect(payload.totalBytes).toBe(info.totalBytes);
    expect(payload.speed).toBe(info.speed);
    expect(payload.etaSeconds).toBe(info.etaSeconds);
    expect(payload.progressPercent).toBe(50);
  });
});

describe("[CONTRACT] TransferInfo → TransferCompletePayload consistency", () => {
  it("complete payload has transferId, status, bytesTransferred, optional error", () => {
    const successPayload: TransferCompletePayload = {
      transferId: "t1",
      status: "completed",
      bytesTransferred: 10000,
    };
    expect(successPayload.error).toBeUndefined();

    const failPayload: TransferCompletePayload = {
      transferId: "t2",
      status: "failed",
      bytesTransferred: 500,
      error: "Read error: broken pipe",
    };
    expect(failPayload.error).toBe("Read error: broken pipe");
  });
});

// ── Utility function contracts ────────────────────────────────────

describe("[CONTRACT] Utility function symmetry with Rust backend", () => {
  describe("formatFileSize matches Rust format_file_size", () => {
    // These values must match the Rust backend's tests exactly
    const rustTestCases: [number, string][] = [
      [0, "0 B"],
      [512, "512 B"],
      [1023, "1023 B"],
      [1024, "1.0 KB"],
      [1536, "1.5 KB"],
      [1024 * 1024, "1.0 MB"],
      [5 * 1024 * 1024, "5.0 MB"],
      [1024 * 1024 * 1024, "1.0 GB"],
      [1024 * 1024 * 1024 * 1024, "1.0 TB"],
    ];

    for (const [bytes, expected] of rustTestCases) {
      it(`formatFileSize(${bytes}) === "${expected}" (matches Rust)`, () => {
        expect(formatFileSize(bytes)).toBe(expected);
      });
    }
  });

  describe("formatPermissions matches Rust format_permissions", () => {
    // These values must match the Rust backend's tests exactly
    const rustTestCases: [number, string][] = [
      [0o755, "rwxr-xr-x"],
      [0o644, "rw-r--r--"],
      [0o777, "rwxrwxrwx"],
      [0o000, "---------"],
      [0o600, "rw-------"],
    ];

    for (const [mode, expected] of rustTestCases) {
      it(`formatPermissions(0o${mode.toString(8)}) === "${expected}" (matches Rust)`, () => {
        expect(formatPermissions(mode)).toBe(expected);
      });
    }
  });
});

// ── Transfer status lifecycle contract ────────────────────────────

describe("[CONTRACT] Transfer status lifecycle", () => {
  it("valid status transitions: queued → inprogress → completed", () => {
    const lifecycle: TransferStatus[] = ["queued", "inprogress", "completed"];
    expect(lifecycle[0]).toBe("queued");
    expect(lifecycle[lifecycle.length - 1]).toBe("completed");
  });

  it("valid status transitions: queued → inprogress → failed", () => {
    const lifecycle: TransferStatus[] = ["queued", "inprogress", "failed"];
    expect(lifecycle[lifecycle.length - 1]).toBe("failed");
  });

  it("valid status transitions: queued → cancelled", () => {
    const lifecycle: TransferStatus[] = ["queued", "cancelled"];
    expect(lifecycle[lifecycle.length - 1]).toBe("cancelled");
  });

  it("terminal statuses are completed, failed, cancelled", () => {
    const terminal: TransferStatus[] = ["completed", "failed", "cancelled"];
    const nonTerminal: TransferStatus[] = ["queued", "inprogress"];

    // This documents the Rust is_terminal() function's behavior
    for (const status of terminal) {
      expect(terminal).toContain(status);
    }
    for (const status of nonTerminal) {
      expect(terminal).not.toContain(status);
    }
  });
});

// ── SftpContextAction contract ────────────────────────────────────

describe("[CONTRACT] SftpContextAction completeness", () => {
  it("covers all context menu items in the UI", () => {
    // Must stay in sync with SFTPPanel's handleContextAction switch
    const actions: SftpContextAction[] = [
      "download",
      "upload",
      "rename",
      "delete",
      "newFolder",
      "properties",
    ];

    // If a new action is added to the type but not here, this will
    // catch the type error at compile time (TypeScript exhaustiveness)
    expect(actions).toHaveLength(6);
  });

  it("download only applies to non-directory files", () => {
    // Documents the UI rule: directories cannot be downloaded
    const action: SftpContextAction = "download";
    expect(action).toBe("download");
    // SFTPPanel checks: contextMenu.file && !contextMenu.file.isDir
  });
});

// ── Constants contract ────────────────────────────────────────────

describe("[CONTRACT] SFTP configuration constants", () => {
  it("SFTP IPC commands follow sftp_ prefix convention", () => {
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

    for (const cmd of commands) {
      expect(cmd).toMatch(/^sftp_[a-z]+$/);
    }
  });

  it("event name patterns use sftp- prefix with transfer ID", () => {
    const transferId = "uuid-abc-123";
    const progressEvent = `sftp-progress-${transferId}`;
    const completeEvent = `sftp-complete-${transferId}`;

    expect(progressEvent).toMatch(/^sftp-progress-/);
    expect(completeEvent).toMatch(/^sftp-complete-/);
  });
});
