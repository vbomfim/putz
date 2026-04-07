/// SFTP transfer engine — manages file uploads/downloads with progress.
///
/// Handles transfer lifecycle (queue → in-progress → complete/failed),
/// progress event emission, and concurrent transfer limits.
///
/// Design: Each transfer runs as a tokio task. A per-session semaphore
/// limits concurrency to MAX_CONCURRENT_TRANSFERS. Progress is reported
/// via Tauri events at regular intervals to avoid flooding the frontend.
use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex as TokioMutex, Semaphore};

/// Maximum concurrent transfers per SFTP session.
pub const MAX_CONCURRENT_TRANSFERS: usize = 5;

/// SFTP read/write buffer size in bytes (64 KB).
pub const TRANSFER_BUFFER_SIZE: usize = 64 * 1024;

/// Minimum interval between progress events (milliseconds).
#[allow(dead_code)]
pub const PROGRESS_INTERVAL_MS: u64 = 250;

/// Direction of a file transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Download,
    Upload,
}

/// Current state of a file transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    /// Waiting in the queue for a semaphore permit.
    Queued,
    /// Actively transferring data.
    InProgress,
    /// Transfer completed successfully.
    Completed,
    /// Transfer failed with an error.
    Failed,
    /// Transfer was cancelled by the user.
    Cancelled,
}

impl TransferStatus {
    /// Returns true if the transfer is in a terminal state.
    #[allow(dead_code)]
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled
        )
    }
}

/// Information about an active or completed transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInfo {
    /// Unique transfer identifier.
    pub transfer_id: String,
    /// SFTP session this transfer belongs to.
    pub sftp_session_id: String,
    /// Remote file path.
    pub remote_path: String,
    /// Local file path.
    pub local_path: String,
    /// Transfer direction.
    pub direction: TransferDirection,
    /// Current status.
    pub status: TransferStatus,
    /// Bytes transferred so far.
    pub bytes_transferred: u64,
    /// Total file size in bytes (0 if unknown).
    pub total_bytes: u64,
    /// Transfer speed in bytes/second (0 if not yet calculated).
    pub speed: u64,
    /// Estimated time remaining in seconds (0 if unknown).
    pub eta_seconds: u64,
    /// Error message if status is Failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl TransferInfo {
    /// Creates a new transfer info for a pending transfer.
    pub fn new(
        transfer_id: String,
        sftp_session_id: String,
        remote_path: String,
        local_path: String,
        direction: TransferDirection,
        total_bytes: u64,
    ) -> Self {
        Self {
            transfer_id,
            sftp_session_id,
            remote_path,
            local_path,
            direction,
            status: TransferStatus::Queued,
            bytes_transferred: 0,
            total_bytes,
            speed: 0,
            eta_seconds: 0,
            error: None,
        }
    }

    /// Calculates transfer progress as a percentage (0–100).
    pub fn progress_percent(&self) -> u8 {
        if self.total_bytes == 0 {
            return 0;
        }
        let pct =
            (self.bytes_transferred as f64 / self.total_bytes as f64)
                * 100.0;
        pct.min(100.0) as u8
    }

    /// Updates speed and ETA based on elapsed time.
    pub fn update_speed(&mut self, elapsed_secs: f64) {
        if elapsed_secs <= 0.0 {
            return;
        }

        self.speed =
            (self.bytes_transferred as f64 / elapsed_secs) as u64;

        if self.speed > 0 && self.total_bytes > self.bytes_transferred
        {
            let remaining =
                self.total_bytes - self.bytes_transferred;
            self.eta_seconds = remaining / self.speed;
        } else {
            self.eta_seconds = 0;
        }
    }
}

/// Progress event payload sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressPayload {
    /// Transfer identifier.
    pub transfer_id: String,
    /// Current status.
    pub status: TransferStatus,
    /// Bytes transferred so far.
    pub bytes_transferred: u64,
    /// Total file size in bytes.
    pub total_bytes: u64,
    /// Transfer speed in bytes/second.
    pub speed: u64,
    /// Estimated time remaining in seconds.
    pub eta_seconds: u64,
    /// Progress percentage (0–100).
    pub progress_percent: u8,
}

impl From<&TransferInfo> for TransferProgressPayload {
    fn from(info: &TransferInfo) -> Self {
        Self {
            transfer_id: info.transfer_id.clone(),
            status: info.status,
            bytes_transferred: info.bytes_transferred,
            total_bytes: info.total_bytes,
            speed: info.speed,
            eta_seconds: info.eta_seconds,
            progress_percent: info.progress_percent(),
        }
    }
}

/// Completion event payload sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCompletePayload {
    /// Transfer identifier.
    pub transfer_id: String,
    /// Final status (Completed, Failed, or Cancelled).
    pub status: TransferStatus,
    /// Error message if failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Total bytes transferred.
    pub bytes_transferred: u64,
}

/// Manages transfer state and concurrency for an SFTP session.
pub struct TransferEngine {
    /// Active and recent transfers.
    transfers: Arc<TokioMutex<HashMap<String, TransferInfo>>>,
    /// Concurrency limiter.
    semaphore: Arc<Semaphore>,
}

impl TransferEngine {
    /// Creates a new transfer engine with default concurrency limit.
    pub fn new() -> Self {
        Self {
            transfers: Arc::new(TokioMutex::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(
                MAX_CONCURRENT_TRANSFERS,
            )),
        }
    }

    /// Registers a new transfer and returns its initial info.
    pub async fn register(
        &self,
        info: TransferInfo,
    ) -> Result<(), String> {
        let mut transfers = self.transfers.lock().await;

        if transfers.contains_key(&info.transfer_id) {
            return Err(format!(
                "Transfer {} already exists",
                info.transfer_id
            ));
        }

        transfers.insert(info.transfer_id.clone(), info);
        Ok(())
    }

    /// Updates a transfer's status.
    pub async fn update_status(
        &self,
        transfer_id: &str,
        status: TransferStatus,
    ) -> Result<(), String> {
        let mut transfers = self.transfers.lock().await;
        let info =
            transfers.get_mut(transfer_id).ok_or_else(|| {
                format!("Transfer not found: {transfer_id}")
            })?;
        info.status = status;
        Ok(())
    }

    /// Updates transfer progress.
    pub async fn update_progress(
        &self,
        transfer_id: &str,
        bytes_transferred: u64,
        elapsed_secs: f64,
    ) -> Result<TransferProgressPayload, String> {
        let mut transfers = self.transfers.lock().await;
        let info =
            transfers.get_mut(transfer_id).ok_or_else(|| {
                format!("Transfer not found: {transfer_id}")
            })?;

        info.bytes_transferred = bytes_transferred;
        info.update_speed(elapsed_secs);

        Ok(TransferProgressPayload::from(&*info))
    }

    /// Marks a transfer as failed with an error message.
    pub async fn mark_failed(
        &self,
        transfer_id: &str,
        error: String,
    ) -> Result<(), String> {
        let mut transfers = self.transfers.lock().await;
        let info =
            transfers.get_mut(transfer_id).ok_or_else(|| {
                format!("Transfer not found: {transfer_id}")
            })?;
        info.status = TransferStatus::Failed;
        info.error = Some(error);
        Ok(())
    }

    /// Gets a snapshot of a specific transfer.
    #[allow(dead_code)]
    pub async fn get(
        &self,
        transfer_id: &str,
    ) -> Option<TransferInfo> {
        let transfers = self.transfers.lock().await;
        transfers.get(transfer_id).cloned()
    }

    /// Gets snapshots of all transfers.
    #[allow(dead_code)]
    pub async fn list(&self) -> Vec<TransferInfo> {
        let transfers = self.transfers.lock().await;
        transfers.values().cloned().collect()
    }

    /// Acquires a concurrency permit (blocks if at limit).
    pub fn semaphore(&self) -> Arc<Semaphore> {
        self.semaphore.clone()
    }

    /// Removes completed/failed/cancelled transfers from tracking.
    #[allow(dead_code)]
    pub async fn prune_terminal(&self) -> usize {
        let mut transfers = self.transfers.lock().await;
        let before = transfers.len();
        transfers.retain(|_, info| !info.status.is_terminal());
        before - transfers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TransferDirection ────────────────────────────────────────

    #[test]
    fn transfer_direction_serializes_lowercase() {
        let json =
            serde_json::to_string(&TransferDirection::Download)
                .unwrap();
        assert_eq!(json, r#""download""#);
    }

    #[test]
    fn transfer_direction_roundtrip() {
        for dir in
            [TransferDirection::Download, TransferDirection::Upload]
        {
            let json = serde_json::to_string(&dir).unwrap();
            let restored: TransferDirection =
                serde_json::from_str(&json).unwrap();
            assert_eq!(dir, restored);
        }
    }

    // ── TransferStatus ───────────────────────────────────────────

    #[test]
    fn transfer_status_serializes_lowercase() {
        let json =
            serde_json::to_string(&TransferStatus::InProgress)
                .unwrap();
        assert_eq!(json, r#""inprogress""#);
    }

    #[test]
    fn transfer_status_all_variants_roundtrip() {
        let variants = [
            TransferStatus::Queued,
            TransferStatus::InProgress,
            TransferStatus::Completed,
            TransferStatus::Failed,
            TransferStatus::Cancelled,
        ];
        for status in variants {
            let json = serde_json::to_string(&status).unwrap();
            let restored: TransferStatus =
                serde_json::from_str(&json).unwrap();
            assert_eq!(status, restored);
        }
    }

    #[test]
    fn terminal_states_are_correct() {
        assert!(!TransferStatus::Queued.is_terminal());
        assert!(!TransferStatus::InProgress.is_terminal());
        assert!(TransferStatus::Completed.is_terminal());
        assert!(TransferStatus::Failed.is_terminal());
        assert!(TransferStatus::Cancelled.is_terminal());
    }

    // ── TransferInfo ─────────────────────────────────────────────

    #[test]
    fn transfer_info_new_defaults() {
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/remote/file.txt".into(),
            "/local/file.txt".into(),
            TransferDirection::Download,
            1024,
        );
        assert_eq!(info.status, TransferStatus::Queued);
        assert_eq!(info.bytes_transferred, 0);
        assert_eq!(info.total_bytes, 1024);
        assert_eq!(info.speed, 0);
        assert_eq!(info.eta_seconds, 0);
        assert!(info.error.is_none());
    }

    #[test]
    fn progress_percent_zero_when_no_total() {
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            0,
        );
        assert_eq!(info.progress_percent(), 0);
    }

    #[test]
    fn progress_percent_half() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            1000,
        );
        info.bytes_transferred = 500;
        assert_eq!(info.progress_percent(), 50);
    }

    #[test]
    fn progress_percent_complete() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            1000,
        );
        info.bytes_transferred = 1000;
        assert_eq!(info.progress_percent(), 100);
    }

    #[test]
    fn progress_percent_caps_at_100() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            1000,
        );
        info.bytes_transferred = 2000; // overshoots
        assert_eq!(info.progress_percent(), 100);
    }

    #[test]
    fn update_speed_calculates_correctly() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            10000,
        );
        info.bytes_transferred = 5000;
        info.update_speed(2.0); // 5000 bytes in 2 seconds = 2500 B/s
        assert_eq!(info.speed, 2500);
        // ETA: 5000 remaining / 2500 B/s = 2 seconds
        assert_eq!(info.eta_seconds, 2);
    }

    #[test]
    fn update_speed_ignores_zero_elapsed() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            10000,
        );
        info.bytes_transferred = 5000;
        info.update_speed(0.0);
        assert_eq!(info.speed, 0);
    }

    #[test]
    fn update_speed_eta_zero_when_complete() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            10000,
        );
        info.bytes_transferred = 10000;
        info.update_speed(5.0);
        assert_eq!(info.speed, 2000);
        assert_eq!(info.eta_seconds, 0);
    }

    // ── TransferInfo serialization ───────────────────────────────

    #[test]
    fn transfer_info_serializes_camel_case() {
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/remote/f.txt".into(),
            "/local/f.txt".into(),
            TransferDirection::Upload,
            2048,
        );
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("transferId"));
        assert!(json.contains("sftpSessionId"));
        assert!(json.contains("remotePath"));
        assert!(json.contains("localPath"));
        assert!(json.contains("bytesTransferred"));
        assert!(json.contains("totalBytes"));
        assert!(json.contains("etaSeconds"));
        // error should be omitted when None
        assert!(!json.contains("error"));
    }

    #[test]
    fn transfer_info_includes_error_when_present() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            0,
        );
        info.error = Some("connection lost".into());
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("connection lost"));
    }

    // ── TransferProgressPayload ──────────────────────────────────

    #[test]
    fn progress_payload_from_transfer_info() {
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            2000,
        );
        info.bytes_transferred = 1000;
        info.status = TransferStatus::InProgress;
        info.speed = 500;
        info.eta_seconds = 2;

        let payload = TransferProgressPayload::from(&info);
        assert_eq!(payload.transfer_id, "t1");
        assert_eq!(payload.status, TransferStatus::InProgress);
        assert_eq!(payload.bytes_transferred, 1000);
        assert_eq!(payload.total_bytes, 2000);
        assert_eq!(payload.speed, 500);
        assert_eq!(payload.eta_seconds, 2);
        assert_eq!(payload.progress_percent, 50);
    }

    // ── TransferEngine ───────────────────────────────────────────

    #[tokio::test]
    async fn engine_register_and_get() {
        let engine = TransferEngine::new();
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            1024,
        );
        engine.register(info).await.unwrap();

        let retrieved = engine.get("t1").await.unwrap();
        assert_eq!(retrieved.transfer_id, "t1");
        assert_eq!(retrieved.status, TransferStatus::Queued);
    }

    #[tokio::test]
    async fn engine_rejects_duplicate_transfer_id() {
        let engine = TransferEngine::new();
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            0,
        );
        engine.register(info.clone()).await.unwrap();
        let err = engine.register(info).await.unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[tokio::test]
    async fn engine_update_status() {
        let engine = TransferEngine::new();
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            0,
        );
        engine.register(info).await.unwrap();
        engine
            .update_status("t1", TransferStatus::InProgress)
            .await
            .unwrap();

        let updated = engine.get("t1").await.unwrap();
        assert_eq!(updated.status, TransferStatus::InProgress);
    }

    #[tokio::test]
    async fn engine_update_status_not_found() {
        let engine = TransferEngine::new();
        let err = engine
            .update_status("nonexistent", TransferStatus::Failed)
            .await
            .unwrap_err();
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn engine_update_progress() {
        let engine = TransferEngine::new();
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            10000,
        );
        engine.register(info).await.unwrap();

        let payload = engine
            .update_progress("t1", 5000, 2.0)
            .await
            .unwrap();
        assert_eq!(payload.bytes_transferred, 5000);
        assert_eq!(payload.speed, 2500);
        assert_eq!(payload.progress_percent, 50);
    }

    #[tokio::test]
    async fn engine_mark_failed() {
        let engine = TransferEngine::new();
        let info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f".into(),
            "/f".into(),
            TransferDirection::Download,
            0,
        );
        engine.register(info).await.unwrap();
        engine
            .mark_failed("t1", "connection lost".into())
            .await
            .unwrap();

        let updated = engine.get("t1").await.unwrap();
        assert_eq!(updated.status, TransferStatus::Failed);
        assert_eq!(updated.error, Some("connection lost".into()));
    }

    #[tokio::test]
    async fn engine_list_all_transfers() {
        let engine = TransferEngine::new();

        for i in 0..3 {
            let info = TransferInfo::new(
                format!("t{i}"),
                "sftp1".into(),
                format!("/file{i}"),
                format!("/local{i}"),
                TransferDirection::Download,
                0,
            );
            engine.register(info).await.unwrap();
        }

        let all = engine.list().await;
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn engine_prune_terminal_transfers() {
        let engine = TransferEngine::new();

        // Register 3 transfers: completed, failed, in-progress
        let mut t1 = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/f1".into(),
            "/l1".into(),
            TransferDirection::Download,
            0,
        );
        t1.status = TransferStatus::Completed;

        let mut t2 = TransferInfo::new(
            "t2".into(),
            "sftp1".into(),
            "/f2".into(),
            "/l2".into(),
            TransferDirection::Upload,
            0,
        );
        t2.status = TransferStatus::Failed;

        let t3 = TransferInfo::new(
            "t3".into(),
            "sftp1".into(),
            "/f3".into(),
            "/l3".into(),
            TransferDirection::Download,
            0,
        );

        engine.register(t1).await.unwrap();
        engine.register(t2).await.unwrap();
        engine.register(t3).await.unwrap();

        let pruned = engine.prune_terminal().await;
        assert_eq!(pruned, 2);

        let remaining = engine.list().await;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].transfer_id, "t3");
    }

    // ── Large file support (u64) ─────────────────────────────────

    #[test]
    fn transfer_info_handles_large_files() {
        let size: u64 = 5_000_000_000; // 5 GB
        let mut info = TransferInfo::new(
            "t1".into(),
            "sftp1".into(),
            "/big_file.iso".into(),
            "/local/big_file.iso".into(),
            TransferDirection::Download,
            size,
        );
        info.bytes_transferred = 2_500_000_000;
        assert_eq!(info.progress_percent(), 50);

        info.update_speed(100.0); // 2.5GB in 100s = 25MB/s
        assert_eq!(info.speed, 25_000_000);
        assert_eq!(info.eta_seconds, 100); // 2.5GB remaining / 25MB/s
    }
}
