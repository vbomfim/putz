/// Configuration backup utility — saves device output to local filesystem.
///
/// Writes captured command output (e.g., `show running-config`) to
/// `~/putz-backups/` with timestamped filenames. The frontend drives
/// the capture; this module only handles file I/O with path sanitization.
use serde::{Deserialize, Serialize};

/// Request to save a configuration backup.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupRequest {
    /// Hostname or label for the device (used in filename).
    pub hostname: String,
    /// The captured configuration text.
    pub content: String,
}

/// Response after saving a backup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupResponse {
    /// Full path where the backup was saved.
    pub path: String,
    /// Size of the saved file in bytes.
    pub size: usize,
}

/// Sanitizes a hostname for safe use in filenames.
///
/// Keeps alphanumerics, hyphens, dots, and underscores.
/// Replaces everything else with underscores. Limits to 64 chars.
fn sanitize_hostname(hostname: &str) -> String {
    let sanitized: String = hostname
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '.' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();

    if sanitized.is_empty() {
        "unknown-device".to_string()
    } else {
        sanitized
    }
}

/// Returns the backup directory path (`~/putz-backups/`), creating it if needed.
fn ensure_backup_dir() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Cannot determine home directory".to_string())?;
    let backup_dir = home.join("putz-backups");

    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup directory: {e}"))?;
    }

    Ok(backup_dir)
}

/// Saves configuration content to a timestamped file.
///
/// Returns the file path and size.
pub fn save_backup(req: &SaveBackupRequest) -> Result<SaveBackupResponse, String> {
    if req.content.is_empty() {
        return Err("Backup content is empty".into());
    }
    if req.content.len() > 10 * 1024 * 1024 {
        return Err("Backup content too large (max 10 MB)".into());
    }

    let backup_dir = ensure_backup_dir()?;
    let hostname = sanitize_hostname(&req.hostname);
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{hostname}_{timestamp}.txt");
    let filepath = backup_dir.join(&filename);

    // Verify the resolved path is still inside the backup directory
    let canonical_dir = backup_dir.canonicalize()
        .map_err(|e| format!("Failed to resolve backup directory: {e}"))?;

    // Write first, then verify (the file must exist for canonicalize)
    std::fs::write(&filepath, &req.content)
        .map_err(|e| format!("Failed to write backup file: {e}"))?;

    let canonical_file = filepath.canonicalize()
        .map_err(|e| format!("Failed to resolve backup file path: {e}"))?;

    if !canonical_file.starts_with(&canonical_dir) {
        // Path traversal detected — remove the file and reject
        let _ = std::fs::remove_file(&filepath);
        return Err("Invalid backup path: path traversal detected".into());
    }

    let size = req.content.len();
    Ok(SaveBackupResponse {
        path: canonical_file.to_string_lossy().to_string(),
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_hostname_keeps_valid_chars() {
        assert_eq!(sanitize_hostname("router-1.lab"), "router-1.lab");
        assert_eq!(sanitize_hostname("switch_core_01"), "switch_core_01");
    }

    #[test]
    fn sanitize_hostname_replaces_invalid_chars() {
        assert_eq!(sanitize_hostname("host;rm -rf"), "host_rm_-rf");
        assert_eq!(sanitize_hostname("a/b\\c"), "a_b_c");
    }

    #[test]
    fn sanitize_hostname_limits_length() {
        let long = "a".repeat(100);
        assert_eq!(sanitize_hostname(&long).len(), 64);
    }

    #[test]
    fn sanitize_hostname_handles_empty() {
        assert_eq!(sanitize_hostname(""), "unknown-device");
    }

    #[test]
    fn save_backup_rejects_empty_content() {
        let req = SaveBackupRequest {
            hostname: "router1".into(),
            content: "".into(),
        };
        assert!(save_backup(&req).is_err());
    }

    #[test]
    fn save_backup_rejects_oversized_content() {
        let req = SaveBackupRequest {
            hostname: "router1".into(),
            content: "x".repeat(11 * 1024 * 1024),
        };
        assert!(save_backup(&req).is_err());
    }

    #[test]
    fn save_backup_writes_file_successfully() {
        let req = SaveBackupRequest {
            hostname: "test-router".into(),
            content: "hostname test-router\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n".into(),
        };
        let result = save_backup(&req).unwrap();
        assert!(result.path.contains("test-router"));
        assert!(result.size > 0);

        // Clean up
        let _ = std::fs::remove_file(&result.path);
    }

    #[test]
    fn save_backup_creates_directory_if_missing() {
        // This test relies on ~/putz-backups/ being creatable
        let req = SaveBackupRequest {
            hostname: "dir-test".into(),
            content: "test content".into(),
        };
        let result = save_backup(&req);
        assert!(result.is_ok());
        if let Ok(resp) = result {
            let _ = std::fs::remove_file(&resp.path);
        }
    }
}
