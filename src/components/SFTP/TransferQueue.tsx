/**
 * Transfer queue component — displays active file transfers.
 *
 * Shows progress bars with filename, speed, ETA, and transfer status.
 * Used alongside SFTPPanel to show upload/download progress.
 *
 * @module TransferQueue
 */
import type { TransferInfo } from "./types";
import { formatFileSize, formatSpeed, formatEta } from "./types";
import "./SFTP.css";

interface TransferQueueProps {
  /** Active and recent transfers. */
  transfers: TransferInfo[];
}

/**
 * Transfer queue panel showing progress for active file transfers.
 *
 * Displays each transfer with a progress bar, speed, and ETA.
 * Completed/failed transfers show final status.
 */
export function TransferQueue({ transfers }: TransferQueueProps) {
  if (transfers.length === 0) return null;

  const activeCount = transfers.filter(
    (t) => t.status === "queued" || t.status === "inprogress",
  ).length;

  return (
    <div
      className="sftp-transfer-queue"
      role="region"
      aria-label="File transfers"
    >
      <div className="sftp-transfer-header">
        <span>
          Transfers ({activeCount} active / {transfers.length} total)
        </span>
      </div>

      <div className="sftp-transfer-list">
        {transfers.map((transfer) => (
          <TransferRow key={transfer.transferId} transfer={transfer} />
        ))}
      </div>
    </div>
  );
}

/** Individual transfer row with progress bar. */
function TransferRow({ transfer }: { transfer: TransferInfo }) {
  const fileName = transfer.remotePath.split("/").pop() ?? transfer.remotePath;
  const progressPercent =
    transfer.totalBytes > 0
      ? Math.min(
          100,
          Math.round((transfer.bytesTransferred / transfer.totalBytes) * 100),
        )
      : 0;

  const statusIcon = getStatusIcon(transfer.status);
  const directionIcon = transfer.direction === "download" ? "⬇" : "⬆";

  return (
    <div
      className={`sftp-transfer-row status-${transfer.status}`}
      role="listitem"
      aria-label={`${transfer.direction} ${fileName}: ${transfer.status}`}
    >
      <div className="sftp-transfer-info">
        <span className="sftp-transfer-icon" title={transfer.direction}>
          {directionIcon}
        </span>
        <span className="sftp-transfer-name" title={transfer.remotePath}>
          {fileName}
        </span>
        <span className="sftp-transfer-status">{statusIcon}</span>
      </div>

      <div className="sftp-transfer-progress">
        <div className="sftp-progress-bar">
          <div
            className="sftp-progress-fill"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <span className="sftp-transfer-details">
          {transfer.status === "inprogress" && (
            <>
              {formatFileSize(transfer.bytesTransferred)} /{" "}
              {formatFileSize(transfer.totalBytes)} —{" "}
              {formatSpeed(transfer.speed)} — ETA{" "}
              {formatEta(transfer.etaSeconds)}
            </>
          )}
          {transfer.status === "completed" && (
            <>{formatFileSize(transfer.bytesTransferred)} — Complete</>
          )}
          {transfer.status === "failed" && (
            <span className="sftp-transfer-error">
              {transfer.error ?? "Transfer failed"}
            </span>
          )}
          {transfer.status === "queued" && <>Queued</>}
          {transfer.status === "cancelled" && <>Cancelled</>}
        </span>
      </div>
    </div>
  );
}

/** Returns a status emoji for the given transfer status. */
function getStatusIcon(status: string): string {
  switch (status) {
    case "queued":
      return "⏳";
    case "inprogress":
      return "🔄";
    case "completed":
      return "✅";
    case "failed":
      return "❌";
    case "cancelled":
      return "⛔";
    default:
      return "❓";
  }
}
