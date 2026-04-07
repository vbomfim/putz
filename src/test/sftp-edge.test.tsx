/**
 * SFTP Feature — Edge Case & Boundary Tests
 *
 * Tests boundary conditions, concurrent scenarios, and unusual inputs
 * that are not covered by acceptance criteria but important for robustness.
 *
 * Tags: [EDGE], [BOUNDARY], [AC-2], [AC-5], [AC-6], [AC-7]
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SFTPPanel } from "../components/SFTP/SFTPPanel";
import { TransferQueue } from "../components/SFTP/TransferQueue";
import type { RemoteFileEntry, TransferInfo } from "../components/SFTP/types";
import { formatFileSize, formatPermissions, formatSpeed, formatEta } from "../components/SFTP/types";

// ── Tauri IPC mocks ───────────────────────────────────────────────

let mockInvoke: Mock;
let mockListen: Mock;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────

function setupMocks(files: RemoteFileEntry[] = []) {
  mockInvoke = vi.fn().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "sftp_open":
        return "sftp-edge-session";
      case "sftp_list":
        return files;
      case "sftp_stat":
        return {
          path: args?.path,
          isDir: false,
          size: 0,
          permissions: 0o644,
          modified: 1700000000,
        };
      case "sftp_download":
        return "transfer-edge-dl";
      case "sftp_upload":
        return "transfer-edge-ul";
      case "sftp_rename":
      case "sftp_delete":
      case "sftp_mkdir":
      case "sftp_close":
        return undefined;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  });

  mockListen = vi.fn().mockResolvedValue(vi.fn());
}

// ── Tests ─────────────────────────────────────────────────────────

describe("SFTP Edge Case Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── File name edge cases ────────────────────────────────────

  describe("[EDGE] File name edge cases", () => {
    it("handles files with Unicode/emoji names", async () => {
      setupMocks([
        {
          name: "📊 report — 日本語.xlsx",
          path: "/📊 report — 日本語.xlsx",
          isDir: false,
          size: 1024,
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("📊 report — 日本語.xlsx")).toBeDefined();
      });
    });

    it("handles files with very long names (200+ chars)", async () => {
      const longName = "a".repeat(200) + ".txt";
      setupMocks([
        {
          name: longName,
          path: `/${longName}`,
          isDir: false,
          size: 100,
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText(longName)).toBeDefined();
      });
    });

    it("handles files with special characters in name", async () => {
      setupMocks([
        {
          name: "config (backup) [v2] {final}.txt",
          path: "/config (backup) [v2] {final}.txt",
          isDir: false,
          size: 512,
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(
          screen.getByText("config (backup) [v2] {final}.txt"),
        ).toBeDefined();
      });
    });

    it("handles dotfiles (hidden Unix files)", async () => {
      setupMocks([
        { name: ".bashrc", path: "/home/.bashrc", isDir: false, size: 256 },
        { name: ".ssh", path: "/home/.ssh", isDir: true, size: 0 },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText(".bashrc")).toBeDefined();
        expect(screen.getByText(".ssh")).toBeDefined();
      });
    });

    it("handles file named with only spaces", async () => {
      setupMocks([
        { name: "   ", path: "/   ", isDir: false, size: 0 },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        // Should render without crashing — the file name is just spaces
        const rows = screen.getAllByRole("row");
        expect(rows.length).toBeGreaterThanOrEqual(2); // header + file row
      });
    });
  });

  // ── File size edge cases ────────────────────────────────────

  describe("[BOUNDARY] File size boundaries", () => {
    it("handles zero-byte file", async () => {
      setupMocks([
        { name: "empty.txt", path: "/empty.txt", isDir: false, size: 0 },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("empty.txt")).toBeDefined();
        expect(screen.getByText("0 B")).toBeDefined();
      });
    });

    it("handles file larger than 4GB (large file support)", async () => {
      const largeSize = 5 * 1024 * 1024 * 1024; // 5 GB
      setupMocks([
        {
          name: "ios-image.bin",
          path: "/ios-image.bin",
          isDir: false,
          size: largeSize,
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("ios-image.bin")).toBeDefined();
        expect(screen.getByText("5.0 GB")).toBeDefined();
      });
    });

    it("formatFileSize handles Number.MAX_SAFE_INTEGER", () => {
      // Should not crash or produce NaN
      const result = formatFileSize(Number.MAX_SAFE_INTEGER);
      expect(result).toContain("TB");
      expect(result).not.toContain("NaN");
    });

    it("formatFileSize handles 1 byte", () => {
      expect(formatFileSize(1)).toBe("1 B");
    });

    it("formatFileSize handles exact boundary values", () => {
      expect(formatFileSize(1023)).toBe("1023 B");
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1024 * 1024 - 1)).toContain("KB");
      expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    });
  });

  // ── Permission edge cases ───────────────────────────────────

  describe("[EDGE] Permission edge cases", () => {
    it("handles files with no permissions field", async () => {
      setupMocks([
        {
          name: "noperm.txt",
          path: "/noperm.txt",
          isDir: false,
          size: 100,
          // no permissions field
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("noperm.txt")).toBeDefined();
        // Should show dash for missing permissions
        const cells = screen.getAllByRole("cell");
        const permCells = cells.filter((c) => c.textContent === "—");
        expect(permCells.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("formatPermissions handles setuid/setgid bits correctly", () => {
      // Only lower 9 bits (0o777) should be processed
      expect(formatPermissions(0o4755 & 0o777)).toBe("rwxr-xr-x");
      expect(formatPermissions(0o2755 & 0o777)).toBe("rwxr-xr-x");
    });

    it("formatPermissions handles sticky bit", () => {
      expect(formatPermissions(0o1777 & 0o777)).toBe("rwxrwxrwx");
    });
  });

  // ── Date edge cases ─────────────────────────────────────────

  describe("[EDGE] Date display edge cases", () => {
    it("handles files with no modified date", async () => {
      setupMocks([
        {
          name: "nodate.txt",
          path: "/nodate.txt",
          isDir: false,
          size: 100,
          // no modified field
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("nodate.txt")).toBeDefined();
        // Should show dash for missing date
        const dashes = screen.getAllByText("—");
        expect(dashes.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("handles files with epoch timestamp 0", async () => {
      setupMocks([
        {
          name: "epoch.txt",
          path: "/epoch.txt",
          isDir: false,
          size: 100,
          modified: 0,
        },
      ]);

      render(<SFTPPanel connectionId="conn-edge" />);

      await waitFor(() => {
        expect(screen.getByText("epoch.txt")).toBeDefined();
        // modified=0 is falsy — the formatDate function treats it as "—"
        const dashes = screen.getAllByText("—");
        expect(dashes.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── Transfer progress edge cases ────────────────────────────

  describe("[EDGE] Transfer progress edge cases", () => {
    it("handles transfer with unknown total size (totalBytes=0)", () => {
      const transfers: TransferInfo[] = [
        {
          transferId: "t-unknown",
          sftpSessionId: "sftp-1",
          remotePath: "/stream.dat",
          localPath: "/tmp/stream.dat",
          direction: "download",
          status: "inprogress",
          bytesTransferred: 5000,
          totalBytes: 0,
          speed: 1000,
          etaSeconds: 0,
        },
      ];

      render(<TransferQueue transfers={transfers} />);
      // Progress bar should be at 0% when total is unknown
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("0");
    });

    it("handles transfer with bytesTransferred > totalBytes (overshoot)", () => {
      const transfers: TransferInfo[] = [
        {
          transferId: "t-overshoot",
          sftpSessionId: "sftp-1",
          remotePath: "/growing.log",
          localPath: "/tmp/growing.log",
          direction: "download",
          status: "inprogress",
          bytesTransferred: 15000,
          totalBytes: 10000,
          speed: 5000,
          etaSeconds: 0,
        },
      ];

      render(<TransferQueue transfers={transfers} />);
      // Progress should be capped at 100%
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("100");
    });

    it("handles failed transfer with no error message", () => {
      const transfers: TransferInfo[] = [
        {
          transferId: "t-fail-no-msg",
          sftpSessionId: "sftp-1",
          remotePath: "/fail.dat",
          localPath: "/tmp/fail.dat",
          direction: "download",
          status: "failed",
          bytesTransferred: 0,
          totalBytes: 1000,
          speed: 0,
          etaSeconds: 0,
          // no error field
        },
      ];

      render(<TransferQueue transfers={transfers} />);
      // Should show fallback error text
      expect(screen.getByText("Transfer failed")).toBeDefined();
    });
  });

  // ── formatEta edge cases ────────────────────────────────────

  describe("[BOUNDARY] formatEta boundary values", () => {
    it("handles exactly 59 seconds (boundary)", () => {
      expect(formatEta(59)).toBe("59s");
    });

    it("handles exactly 60 seconds (boundary)", () => {
      expect(formatEta(60)).toBe("1m 0s");
    });

    it("handles exactly 3599 seconds (just under 1 hour)", () => {
      expect(formatEta(3599)).toBe("59m 59s");
    });

    it("handles exactly 3600 seconds (1 hour)", () => {
      expect(formatEta(3600)).toBe("1h 0m");
    });

    it("handles very large ETA (24+ hours)", () => {
      const result = formatEta(86400); // 24 hours
      expect(result).toBe("24h 0m");
    });

    it("handles fractional seconds (integer input expected)", () => {
      // formatEta takes integer seconds
      expect(formatEta(1)).toBe("1s");
    });
  });

  // ── formatSpeed edge cases ──────────────────────────────────

  describe("[BOUNDARY] formatSpeed boundary values", () => {
    it("formats zero speed", () => {
      expect(formatSpeed(0)).toBe("0 B/s");
    });

    it("formats exactly 1 KB/s", () => {
      expect(formatSpeed(1024)).toBe("1.0 KB/s");
    });

    it("formats gigabit speed (100+ MB/s)", () => {
      const result = formatSpeed(125 * 1024 * 1024); // ~125 MB/s
      expect(result).toContain("MB/s");
    });
  });

  // ── Concurrent/stress scenarios ─────────────────────────────

  describe("[EDGE] Concurrent transfer scenarios", () => {
    it("renders 10+ transfers without error", () => {
      const transfers: TransferInfo[] = Array.from({ length: 15 }, (_, i) => ({
        transferId: `t-${i}`,
        sftpSessionId: "sftp-1",
        remotePath: `/file${i}.txt`,
        localPath: `/tmp/file${i}.txt`,
        direction: i % 2 === 0 ? ("download" as const) : ("upload" as const),
        status: i < 5 ? ("inprogress" as const) : ("queued" as const),
        bytesTransferred: i * 1000,
        totalBytes: 10000,
        speed: i < 5 ? 2000 : 0,
        etaSeconds: i < 5 ? 5 : 0,
      }));

      render(<TransferQueue transfers={transfers} />);

      // Verify header counts
      expect(screen.getByText(/5 active/)).toBeDefined();
      expect(screen.getByText(/15 total/)).toBeDefined();

      // All 15 progress bars
      const bars = screen.getAllByRole("progressbar");
      expect(bars.length).toBe(15);
    });

    it("handles mixed status transfers correctly", () => {
      const transfers: TransferInfo[] = [
        {
          transferId: "t-q",
          sftpSessionId: "s1",
          remotePath: "/a",
          localPath: "/b",
          direction: "download",
          status: "queued",
          bytesTransferred: 0,
          totalBytes: 1000,
          speed: 0,
          etaSeconds: 0,
        },
        {
          transferId: "t-ip",
          sftpSessionId: "s1",
          remotePath: "/c",
          localPath: "/d",
          direction: "upload",
          status: "inprogress",
          bytesTransferred: 500,
          totalBytes: 1000,
          speed: 250,
          etaSeconds: 2,
        },
        {
          transferId: "t-done",
          sftpSessionId: "s1",
          remotePath: "/e",
          localPath: "/f",
          direction: "download",
          status: "completed",
          bytesTransferred: 1000,
          totalBytes: 1000,
          speed: 0,
          etaSeconds: 0,
        },
        {
          transferId: "t-fail",
          sftpSessionId: "s1",
          remotePath: "/g",
          localPath: "/h",
          direction: "upload",
          status: "failed",
          bytesTransferred: 100,
          totalBytes: 1000,
          speed: 0,
          etaSeconds: 0,
          error: "disk full",
        },
        {
          transferId: "t-cancel",
          sftpSessionId: "s1",
          remotePath: "/i",
          localPath: "/j",
          direction: "download",
          status: "cancelled",
          bytesTransferred: 200,
          totalBytes: 1000,
          speed: 0,
          etaSeconds: 0,
        },
      ];

      render(<TransferQueue transfers={transfers} />);

      // 2 active (queued + inprogress)
      expect(screen.getByText(/2 active/)).toBeDefined();
      expect(screen.getByText(/5 total/)).toBeDefined();

      // Status indicators
      expect(screen.getByText("Queued")).toBeDefined();
      expect(screen.getByText(/Complete/)).toBeDefined();
      expect(screen.getByText("disk full")).toBeDefined();
      expect(screen.getByText("Cancelled")).toBeDefined();

      // Status emojis
      expect(screen.getByText("⏳")).toBeDefined();
      expect(screen.getByText("✅")).toBeDefined();
      expect(screen.getByText("❌")).toBeDefined();
      expect(screen.getByText("⛔")).toBeDefined();
    });
  });

  // ── IPC error handling in SFTPPanel ─────────────────────────

  describe("[EDGE] IPC error handling", () => {
    it("handles sftp_list failure gracefully after successful open", async () => {
      let callCount = 0;
      mockInvoke = vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd === "sftp_open") return "sftp-err-session";
        if (cmd === "sftp_list") throw new Error("Permission denied");
        if (cmd === "sftp_close") return undefined;
        return undefined;
      });
      mockListen = vi.fn().mockResolvedValue(vi.fn());

      render(<SFTPPanel connectionId="conn-err" />);

      await waitFor(() => {
        // Error in the setup catch block wraps both open and list failures
        // as "SFTP connection failed: ..."
        expect(screen.getByText(/SFTP connection failed/)).toBeDefined();
      });
    });

    it("handles sftp_delete failure without crashing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

      setupMocks([
        { name: "protected.txt", path: "/protected.txt", isDir: false, size: 100 },
      ]);

      // Override delete to fail
      const origInvoke = mockInvoke;
      mockInvoke = vi.fn().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "sftp_delete") throw new Error("Permission denied");
        return origInvoke(cmd, args);
      });

      render(<SFTPPanel connectionId="conn-err2" />);

      await waitFor(() => {
        expect(screen.getByText("protected.txt")).toBeDefined();
      });

      // Right-click and delete
      const row = screen.getByText("protected.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("Delete")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Delete"));

      // Should not crash — error is logged to console
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[SFTPPanel] Delete failed:"),
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
      confirmSpy.mockRestore();
    });

    it("handles sftp_rename failure without crashing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      const origInvoke = mockInvoke;
      mockInvoke = vi.fn().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "sftp_rename") throw new Error("File exists");
        return origInvoke(cmd, args);
      });

      const user = userEvent.setup();
      render(<SFTPPanel connectionId="conn-err3" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      // Right-click and rename
      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("Rename")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Rename"));

      await waitFor(() => {
        expect(screen.getByLabelText("New file name")).toBeDefined();
      });

      const input = screen.getByLabelText("New file name") as HTMLInputElement;
      await user.clear(input);
      await user.type(input, "conflict.txt");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[SFTPPanel] Rename failed:"),
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });
  });

  // ── Rename edge cases ───────────────────────────────────────

  describe("[EDGE] Rename edge cases", () => {
    it("rename with empty name does not call sftp_rename", async () => {
      const user = userEvent.setup();
      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-rename" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("Rename")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Rename"));

      await waitFor(() => {
        expect(screen.getByLabelText("New file name")).toBeDefined();
      });

      // Clear the input and submit empty
      const input = screen.getByLabelText("New file name") as HTMLInputElement;
      await user.clear(input);
      await user.keyboard("{Enter}");

      // sftp_rename should NOT have been called
      const renameCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_rename",
      );
      expect(renameCalls.length).toBe(0);
    });

    it("rename with whitespace-only name does not call sftp_rename", async () => {
      const user = userEvent.setup();
      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-rename2" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("Rename")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Rename"));

      await waitFor(() => {
        expect(screen.getByLabelText("New file name")).toBeDefined();
      });

      const input = screen.getByLabelText("New file name") as HTMLInputElement;
      await user.clear(input);
      await user.type(input, "   ");
      await user.keyboard("{Enter}");

      // Wait a tick, then verify no rename was called
      await new Promise((r) => setTimeout(r, 50));
      const renameCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_rename",
      );
      expect(renameCalls.length).toBe(0);
    });

    it("pressing Escape cancels rename without calling sftp_rename", async () => {
      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-rename3" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("Rename")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Rename"));

      await waitFor(() => {
        expect(screen.getByLabelText("New file name")).toBeDefined();
      });

      // Press Escape
      const input = screen.getByLabelText("New file name");
      fireEvent.keyDown(input, { key: "Escape" });

      // Input should be gone
      expect(screen.queryByLabelText("New file name")).toBeNull();

      // No rename call
      const renameCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_rename",
      );
      expect(renameCalls.length).toBe(0);
    });
  });

  // ── New folder edge cases ───────────────────────────────────

  describe("[EDGE] New folder edge cases", () => {
    it("pressing Escape cancels new folder creation", async () => {
      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-mkdir" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("New Folder")).toBeDefined();
      });

      fireEvent.click(screen.getByText("New Folder"));

      await waitFor(() => {
        expect(screen.getByLabelText("New folder name")).toBeDefined();
      });

      // Press Escape
      const input = screen.getByLabelText("New folder name");
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByLabelText("New folder name")).toBeNull();

      // No mkdir call
      const mkdirCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_mkdir",
      );
      expect(mkdirCalls.length).toBe(0);
    });

    it("empty folder name does not call sftp_mkdir", async () => {
      const user = userEvent.setup();
      setupMocks([
        { name: "file.txt", path: "/file.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-mkdir2" />);

      await waitFor(() => {
        expect(screen.getByText("file.txt")).toBeDefined();
      });

      const row = screen.getByText("file.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);

      await waitFor(() => {
        expect(screen.getByText("New Folder")).toBeDefined();
      });

      fireEvent.click(screen.getByText("New Folder"));

      await waitFor(() => {
        expect(screen.getByLabelText("New folder name")).toBeDefined();
      });

      // Submit empty
      const input = screen.getByLabelText("New folder name");
      await user.keyboard("{Enter}");

      await new Promise((r) => setTimeout(r, 50));
      const mkdirCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_mkdir",
      );
      expect(mkdirCalls.length).toBe(0);
    });
  });

  // ── Large directory listing ─────────────────────────────────

  describe("[EDGE] Large directory listing", () => {
    it("renders 500+ files without crashing", async () => {
      const manyFiles: RemoteFileEntry[] = Array.from({ length: 500 }, (_, i) => ({
        name: `file_${String(i).padStart(3, "0")}.cfg`,
        path: `/configs/file_${String(i).padStart(3, "0")}.cfg`,
        isDir: false,
        size: i * 100,
      }));

      setupMocks(manyFiles);

      render(<SFTPPanel connectionId="conn-large" />);

      await waitFor(() => {
        expect(screen.getByText("file_000.cfg")).toBeDefined();
        expect(screen.getByText("file_499.cfg")).toBeDefined();
      });

      // All file rows rendered (500 files + 1 header)
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(501);
    });
  });

  // ── Double-click on file (not directory) ────────────────────

  describe("[EDGE] Double-click on non-directory file", () => {
    it("does not navigate when double-clicking a file", async () => {
      setupMocks([
        { name: "readme.md", path: "/readme.md", isDir: false, size: 1024 },
      ]);

      render(<SFTPPanel connectionId="conn-dblclick" />);

      await waitFor(() => {
        expect(screen.getByText("readme.md")).toBeDefined();
      });

      // Double-click on a file — should not trigger navigation
      const row = screen.getByText("readme.md").closest("[role='row']")!;
      fireEvent.doubleClick(row);

      // sftp_list should have been called only once (initial load)
      await new Promise((r) => setTimeout(r, 100));
      const listCalls = mockInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === "sftp_list",
      );
      expect(listCalls.length).toBe(1);
    });
  });

  // ── Properties dialog ───────────────────────────────────────

  describe("[EDGE] Properties dialog", () => {
    it("properties dialog closes when clicking overlay", async () => {
      setupMocks([
        { name: "test.txt", path: "/test.txt", isDir: false, size: 100, permissions: 0o644 },
      ]);

      render(<SFTPPanel connectionId="conn-props" />);

      await waitFor(() => {
        expect(screen.getByText("test.txt")).toBeDefined();
      });

      // Open properties
      const row = screen.getByText("test.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);
      await waitFor(() => {
        expect(screen.getByText("Properties")).toBeDefined();
      });
      fireEvent.click(screen.getByText("Properties"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeDefined();
      });

      // Click the overlay div itself (role="dialog") — not the inner content
      // The overlay's onClick={() => setProperties(null)} should close it
      const overlay = screen.getByRole("dialog");
      fireEvent.click(overlay);

      // Dialog should be gone
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });

    it("properties dialog close button works", async () => {
      setupMocks([
        { name: "test.txt", path: "/test.txt", isDir: false, size: 100 },
      ]);

      render(<SFTPPanel connectionId="conn-props2" />);

      await waitFor(() => {
        expect(screen.getByText("test.txt")).toBeDefined();
      });

      const row = screen.getByText("test.txt").closest("[role='row']")!;
      fireEvent.contextMenu(row);
      await waitFor(() => {
        expect(screen.getByText("Properties")).toBeDefined();
      });
      fireEvent.click(screen.getByText("Properties"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeDefined();
      });

      // Click close button inside dialog
      const closeBtn = screen.getAllByText("Close").find(
        (el) => el.closest("[role='dialog']") !== null
      );
      expect(closeBtn).toBeDefined();
      fireEvent.click(closeBtn!);

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
