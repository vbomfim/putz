/**
 * SFTP Components — Unit Tests
 *
 * Tests for SFTPPanel and TransferQueue rendering.
 *
 * Tags: [UNIT], [AC-1]–[AC-6]
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransferQueue } from "../components/SFTP/TransferQueue";
import type { TransferInfo } from "../components/SFTP/types";

// Mock Tauri IPC
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("TransferQueue", () => {
  const mockTransfers: TransferInfo[] = [
    {
      transferId: "t1",
      sftpSessionId: "sftp-1",
      remotePath: "/home/user/report.pdf",
      localPath: "/tmp/report.pdf",
      direction: "download",
      status: "inprogress",
      bytesTransferred: 5000000,
      totalBytes: 10000000,
      speed: 2500000,
      etaSeconds: 2,
    },
    {
      transferId: "t2",
      sftpSessionId: "sftp-1",
      remotePath: "/home/user/backup.tar",
      localPath: "/tmp/backup.tar",
      direction: "upload",
      status: "completed",
      bytesTransferred: 8000000,
      totalBytes: 8000000,
      speed: 0,
      etaSeconds: 0,
    },
    {
      transferId: "t3",
      sftpSessionId: "sftp-1",
      remotePath: "/home/user/big.iso",
      localPath: "/tmp/big.iso",
      direction: "download",
      status: "failed",
      bytesTransferred: 1000,
      totalBytes: 5000000000,
      speed: 0,
      etaSeconds: 0,
      error: "connection lost",
    },
  ];

  it("renders nothing when no transfers", () => {
    const { container } = render(<TransferQueue transfers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders transfer queue with header", () => {
    render(<TransferQueue transfers={mockTransfers} />);
    expect(screen.getByText(/Transfers/)).toBeDefined();
    expect(screen.getByText(/1 active/)).toBeDefined();
    expect(screen.getByText(/3 total/)).toBeDefined();
  });

  it("renders in-progress transfer with speed and ETA", () => {
    render(<TransferQueue transfers={[mockTransfers[0]]} />);
    // Check file name is rendered
    expect(screen.getByText("report.pdf")).toBeDefined();
    // Check progress details
    expect(screen.getByText(/2.4 MB\/s/)).toBeDefined();
  });

  it("renders completed transfer", () => {
    render(<TransferQueue transfers={[mockTransfers[1]]} />);
    expect(screen.getByText("backup.tar")).toBeDefined();
    expect(screen.getByText(/Complete/)).toBeDefined();
  });

  it("renders failed transfer with error", () => {
    render(<TransferQueue transfers={[mockTransfers[2]]} />);
    expect(screen.getByText("big.iso")).toBeDefined();
    expect(screen.getByText("connection lost")).toBeDefined();
  });

  it("renders download icon for downloads", () => {
    render(<TransferQueue transfers={[mockTransfers[0]]} />);
    expect(screen.getByText("⬇")).toBeDefined();
  });

  it("renders upload icon for uploads", () => {
    render(<TransferQueue transfers={[mockTransfers[1]]} />);
    expect(screen.getByText("⬆")).toBeDefined();
  });

  it("renders progress bar with correct width", () => {
    render(<TransferQueue transfers={[mockTransfers[0]]} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeDefined();
    expect(progressBar.getAttribute("aria-valuenow")).toBe("50");
  });

  it("renders queued transfer", () => {
    const queued: TransferInfo = {
      ...mockTransfers[0],
      transferId: "t-queued",
      status: "queued",
      bytesTransferred: 0,
      speed: 0,
    };
    render(<TransferQueue transfers={[queued]} />);
    expect(screen.getByText("Queued")).toBeDefined();
  });

  it("renders cancelled transfer", () => {
    const cancelled: TransferInfo = {
      ...mockTransfers[0],
      transferId: "t-cancelled",
      status: "cancelled",
    };
    render(<TransferQueue transfers={[cancelled]} />);
    expect(screen.getByText("Cancelled")).toBeDefined();
  });

  it("has accessible labels", () => {
    render(<TransferQueue transfers={mockTransfers} />);
    expect(screen.getByRole("region")).toBeDefined();
    expect(screen.getByLabelText("File transfers")).toBeDefined();
  });
});
