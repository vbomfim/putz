/**
 * Type definitions for the SFTP IPC layer.
 *
 * These types mirror the Rust backend's SFTP types.
 * Keep in sync with src-tauri/src/protocol/sftp/ and src-tauri/src/ipc/sftp.rs.
 *
 * @module sftpTypes
 */

/** A file or directory entry from a remote directory listing. */
export interface RemoteFileEntry {
  /** File or directory name. */
  name: string;
  /** Full remote path. */
  path: string;
  /** True if this entry is a directory. */
  isDir: boolean;
  /** File size in bytes (0 for directories). */
  size: number;
  /** Unix permissions (e.g., 0o755). */
  permissions?: number;
  /** Last modified timestamp (Unix epoch seconds). */
  modified?: number;
  /** Owner UID. */
  uid?: number;
  /** Group GID. */
  gid?: number;
}

/** File metadata from a stat operation. */
export interface RemoteFileStat {
  /** Full remote path. */
  path: string;
  /** True if this is a directory. */
  isDir: boolean;
  /** File size in bytes. */
  size: number;
  /** Unix permissions. */
  permissions?: number;
  /** Last modified timestamp (Unix epoch seconds). */
  modified?: number;
  /** Last accessed timestamp (Unix epoch seconds). */
  accessed?: number;
  /** Owner UID. */
  uid?: number;
  /** Group GID. */
  gid?: number;
}

/** Direction of a file transfer. */
export type TransferDirection = "download" | "upload";

/** Status of a file transfer. */
export type TransferStatus =
  | "queued"
  | "inprogress"
  | "completed"
  | "failed"
  | "cancelled";

/** Information about an active or completed transfer. */
export interface TransferInfo {
  /** Unique transfer identifier. */
  transferId: string;
  /** SFTP session this transfer belongs to. */
  sftpSessionId: string;
  /** Remote file path. */
  remotePath: string;
  /** Local file path. */
  localPath: string;
  /** Transfer direction. */
  direction: TransferDirection;
  /** Current status. */
  status: TransferStatus;
  /** Bytes transferred so far. */
  bytesTransferred: number;
  /** Total file size in bytes (0 if unknown). */
  totalBytes: number;
  /** Transfer speed in bytes/second. */
  speed: number;
  /** Estimated time remaining in seconds. */
  etaSeconds: number;
  /** Error message if status is "failed". */
  error?: string;
}

/** Progress event payload from the backend. */
export interface TransferProgressPayload {
  /** Transfer identifier. */
  transferId: string;
  /** Current status. */
  status: TransferStatus;
  /** Bytes transferred so far. */
  bytesTransferred: number;
  /** Total file size in bytes. */
  totalBytes: number;
  /** Transfer speed in bytes/second. */
  speed: number;
  /** Estimated time remaining in seconds. */
  etaSeconds: number;
  /** Progress percentage (0–100). */
  progressPercent: number;
}

/** Transfer completion event payload from the backend. */
export interface TransferCompletePayload {
  /** Transfer identifier. */
  transferId: string;
  /** Final status. */
  status: TransferStatus;
  /** Error message if failed. */
  error?: string;
  /** Total bytes transferred. */
  bytesTransferred: number;
}

/** Context menu action for file operations. */
export type SftpContextAction =
  | "download"
  | "upload"
  | "rename"
  | "delete"
  | "newFolder"
  | "properties";

/** Formats a file size in human-readable units. */
export function formatFileSize(bytes: number): string {
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;
  const TB = 1024 * GB;

  if (bytes >= TB) return `${(bytes / TB).toFixed(1)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Formats Unix permissions as a human-readable string (e.g., "rwxr-xr-x"). */
export function formatPermissions(mode: number): string {
  const flags: [number, string][] = [
    [0o400, "r"],
    [0o200, "w"],
    [0o100, "x"],
    [0o040, "r"],
    [0o020, "w"],
    [0o010, "x"],
    [0o004, "r"],
    [0o002, "w"],
    [0o001, "x"],
  ];

  return flags.map(([bit, ch]) => (mode & bit ? ch : "-")).join("");
}

/** Formats transfer speed in human-readable units per second. */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`;
}

/** Formats ETA in human-readable format. */
export function formatEta(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}m ${sec}s`;
  }
  const hrs = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return `${hrs}h ${min}m`;
}
