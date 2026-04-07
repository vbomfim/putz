/// SFTP protocol module — file transfer over SSH connections.
///
/// Provides SFTP file browsing and transfer capabilities using the
/// existing SSH connections managed by `ConnectionManager`.
///
/// Architecture:
/// - `SftpManager` — Tauri-managed state for SFTP session lifecycle
/// - `SftpSessionHandle` — wraps `russh_sftp::client::SftpSession`
/// - `TransferEngine` — manages concurrent file transfers with progress
/// - `path` — remote path validation (prevent traversal attacks)
///
/// The SFTP subsystem opens a separate channel on the existing SSH
/// connection, so terminal I/O and file transfers can run simultaneously.
pub mod path;
pub mod transfer;

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;

use super::ProtocolError;
use transfer::TransferEngine;

/// Maximum number of concurrent SFTP sessions.
const MAX_SFTP_SESSIONS: usize = 16;

/// Remote file entry returned from directory listings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    /// File or directory name.
    pub name: String,
    /// Full remote path.
    pub path: String,
    /// True if this entry is a directory.
    pub is_dir: bool,
    /// File size in bytes (0 for directories).
    pub size: u64,
    /// Unix permissions (e.g., 0o755). None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<u32>,
    /// Last modified timestamp (Unix epoch seconds). None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<i64>,
    /// Owner UID. None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
    /// Group GID. None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gid: Option<u32>,
}

/// File metadata returned from stat operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileStat {
    /// Full remote path.
    pub path: String,
    /// True if this is a directory.
    pub is_dir: bool,
    /// File size in bytes.
    pub size: u64,
    /// Unix permissions. None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<u32>,
    /// Last modified timestamp (Unix epoch seconds). None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<i64>,
    /// Last accessed timestamp (Unix epoch seconds). None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed: Option<i64>,
    /// Owner UID. None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
    /// Group GID. None if unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gid: Option<u32>,
}

/// Wraps a `russh_sftp::client::SftpSession` with connection metadata.
pub struct SftpSessionHandle {
    /// The russh-sftp client session.
    pub session: russh_sftp::client::SftpSession,
    /// The SSH connection ID this SFTP session is attached to.
    pub connection_id: String,
    /// Transfer engine for this session.
    pub transfers: TransferEngine,
}

/// Manages all active SFTP sessions.
///
/// Separate from `ConnectionManager` to keep SFTP lifecycle decoupled
/// from SSH connection management. Registered as Tauri managed state.
pub struct SftpManager {
    /// Active SFTP sessions keyed by sftp_session_id.
    sessions: Arc<TokioMutex<HashMap<String, SftpSessionHandle>>>,
}

impl SftpManager {
    /// Creates a new empty SFTP manager.
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    /// Registers a new SFTP session.
    ///
    /// Returns an error if the maximum number of sessions is reached.
    pub async fn register(
        &self,
        sftp_session_id: String,
        handle: SftpSessionHandle,
    ) -> Result<(), ProtocolError> {
        let mut sessions = self.sessions.lock().await;

        if sessions.len() >= MAX_SFTP_SESSIONS {
            return Err(ProtocolError::InvalidParams(format!(
                "Maximum SFTP sessions reached ({MAX_SFTP_SESSIONS})"
            )));
        }

        if sessions.contains_key(&sftp_session_id) {
            return Err(ProtocolError::InvalidParams(format!(
                "SFTP session already exists: {sftp_session_id}"
            )));
        }

        sessions.insert(sftp_session_id, handle);
        Ok(())
    }

    /// Closes and removes an SFTP session.
    pub async fn close(
        &self,
        sftp_session_id: &str,
    ) -> Result<(), ProtocolError> {
        let mut sessions = self.sessions.lock().await;
        let handle =
            sessions.remove(sftp_session_id).ok_or_else(|| {
                ProtocolError::ChannelClosed(format!(
                    "SFTP session not found: {sftp_session_id}"
                ))
            })?;

        // Close the SFTP session (best-effort)
        let _ = handle.session.close().await;
        Ok(())
    }

    /// Closes all SFTP sessions associated with a given SSH connection.
    ///
    /// Called when an SSH connection is closed to clean up SFTP sessions.
    pub async fn close_by_connection(
        &self,
        connection_id: &str,
    ) -> usize {
        let mut sessions = self.sessions.lock().await;
        let to_remove: Vec<String> = sessions
            .iter()
            .filter(|(_, h)| h.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect();

        let count = to_remove.len();
        for id in to_remove {
            if let Some(handle) = sessions.remove(&id) {
                let _ = handle.session.close().await;
            }
        }
        count
    }

    /// Returns the number of active SFTP sessions.
    #[allow(dead_code)]
    pub async fn count(&self) -> usize {
        self.sessions.lock().await.len()
    }

    /// Executes an operation on an SFTP session by ID.
    ///
    /// Acquires the session lock, runs the closure, and releases it.
    /// This pattern avoids exposing the internal mutex to callers.
    pub async fn with_session<F, R>(
        &self,
        sftp_session_id: &str,
        f: F,
    ) -> Result<R, ProtocolError>
    where
        F: FnOnce(
            &SftpSessionHandle,
        )
            -> std::pin::Pin<
            Box<
                dyn std::future::Future<
                        Output = Result<R, ProtocolError>,
                    > + Send
                    + '_,
            >,
        >,
    {
        let sessions = self.sessions.lock().await;
        let handle =
            sessions.get(sftp_session_id).ok_or_else(|| {
                ProtocolError::ChannelClosed(format!(
                    "SFTP session not found: {sftp_session_id}"
                ))
            })?;
        f(handle).await
    }

    /// Gets the transfer engine for a session.
    pub async fn get_transfers(
        &self,
        sftp_session_id: &str,
    ) -> Result<Arc<TokioMutex<HashMap<String, SftpSessionHandle>>>, ProtocolError>
    {
        // We return the sessions Arc so the caller can access transfers
        // This is a temporary pattern — will be refactored if needed
        let sessions = self.sessions.lock().await;
        if !sessions.contains_key(sftp_session_id) {
            return Err(ProtocolError::ChannelClosed(format!(
                "SFTP session not found: {sftp_session_id}"
            )));
        }
        Ok(self.sessions.clone())
    }
}

/// Formats Unix permissions as a human-readable string (e.g., "rwxr-xr-x").
pub fn format_permissions(mode: u32) -> String {
    let mut result = String::with_capacity(9);

    let flags = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];

    for (bit, ch) in flags {
        if mode & bit != 0 {
            result.push(ch);
        } else {
            result.push('-');
        }
    }

    result
}

/// Formats a file size in human-readable units (B, KB, MB, GB, TB).
pub fn format_file_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.1} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── RemoteFileEntry serialization ────────────────────────────

    #[test]
    fn remote_file_entry_serializes_camel_case() {
        let entry = RemoteFileEntry {
            name: "test.txt".into(),
            path: "/home/user/test.txt".into(),
            is_dir: false,
            size: 4096,
            permissions: Some(0o644),
            modified: Some(1700000000),
            uid: Some(1000),
            gid: Some(1000),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("isDir"));
        assert!(json.contains("\"name\""));
        assert!(json.contains("\"path\""));
        assert!(json.contains("\"size\""));
    }

    #[test]
    fn remote_file_entry_omits_none_fields() {
        let entry = RemoteFileEntry {
            name: "dir".into(),
            path: "/dir".into(),
            is_dir: true,
            size: 0,
            permissions: None,
            modified: None,
            uid: None,
            gid: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(!json.contains("permissions"));
        assert!(!json.contains("modified"));
        assert!(!json.contains("uid"));
        assert!(!json.contains("gid"));
    }

    #[test]
    fn remote_file_entry_roundtrip() {
        let entry = RemoteFileEntry {
            name: "config.json".into(),
            path: "/etc/config.json".into(),
            is_dir: false,
            size: 512,
            permissions: Some(0o755),
            modified: Some(1700000000),
            uid: None,
            gid: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let restored: RemoteFileEntry =
            serde_json::from_str(&json).unwrap();
        assert_eq!(restored.name, "config.json");
        assert_eq!(restored.size, 512);
        assert!(!restored.is_dir);
    }

    // ── RemoteFileStat serialization ─────────────────────────────

    #[test]
    fn remote_file_stat_serializes_camel_case() {
        let stat = RemoteFileStat {
            path: "/home/user".into(),
            is_dir: true,
            size: 0,
            permissions: Some(0o755),
            modified: Some(1700000000),
            accessed: Some(1700000100),
            uid: Some(0),
            gid: Some(0),
        };
        let json = serde_json::to_string(&stat).unwrap();
        assert!(json.contains("isDir"));
        assert!(json.contains("\"path\""));
        assert!(json.contains("accessed"));
    }

    #[test]
    fn remote_file_stat_omits_none_fields() {
        let stat = RemoteFileStat {
            path: "/f".into(),
            is_dir: false,
            size: 100,
            permissions: None,
            modified: None,
            accessed: None,
            uid: None,
            gid: None,
        };
        let json = serde_json::to_string(&stat).unwrap();
        assert!(!json.contains("permissions"));
        assert!(!json.contains("modified"));
        assert!(!json.contains("accessed"));
    }

    // ── format_permissions ───────────────────────────────────────

    #[test]
    fn format_permissions_755() {
        assert_eq!(format_permissions(0o755), "rwxr-xr-x");
    }

    #[test]
    fn format_permissions_644() {
        assert_eq!(format_permissions(0o644), "rw-r--r--");
    }

    #[test]
    fn format_permissions_777() {
        assert_eq!(format_permissions(0o777), "rwxrwxrwx");
    }

    #[test]
    fn format_permissions_000() {
        assert_eq!(format_permissions(0o000), "---------");
    }

    #[test]
    fn format_permissions_600() {
        assert_eq!(format_permissions(0o600), "rw-------");
    }

    // ── format_file_size ─────────────────────────────────────────

    #[test]
    fn format_size_bytes() {
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(512), "512 B");
        assert_eq!(format_file_size(1023), "1023 B");
    }

    #[test]
    fn format_size_kb() {
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
    }

    #[test]
    fn format_size_mb() {
        assert_eq!(format_file_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_file_size(5 * 1024 * 1024), "5.0 MB");
    }

    #[test]
    fn format_size_gb() {
        assert_eq!(
            format_file_size(1024 * 1024 * 1024),
            "1.0 GB"
        );
    }

    #[test]
    fn format_size_tb() {
        assert_eq!(
            format_file_size(1024_u64 * 1024 * 1024 * 1024),
            "1.0 TB"
        );
    }

    #[test]
    fn format_size_large_file() {
        // 4.7 GB
        assert_eq!(
            format_file_size(5_046_586_573),
            "4.7 GB"
        );
    }

    // ── SftpManager ──────────────────────────────────────────────
    // Note: SftpManager tests that require a real SftpSession are
    // integration tests. Here we test the manager logic without
    // actual SFTP connections.
}
