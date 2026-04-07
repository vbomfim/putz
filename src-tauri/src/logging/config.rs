/// Configuration for session logging.
///
/// Controls where and how terminal output is logged to disk.
/// Serializable for IPC transport and persistence.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Default log directory under the user's home directory.
const DEFAULT_LOG_DIR_NAME: &str = "putz-logs";

/// Default maximum log file size in bytes (100 MB).
const DEFAULT_MAX_FILE_SIZE: u64 = 100 * 1024 * 1024;

/// Default flush interval in milliseconds.
const DEFAULT_FLUSH_INTERVAL_MS: u64 = 100;

/// Configuration for a session logger instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    /// Directory where log files are stored.
    /// Defaults to `~/putz-logs/`.
    pub directory: PathBuf,
    /// Session name used in the log file name.
    /// File pattern: `{session_name}_{YYYY-MM-DD_HH-mm-ss}.log`
    pub session_name: String,
    /// Whether to prepend timestamps to each line.
    /// Format: `[2025-01-15 14:32:01.123] `
    pub timestamps: bool,
    /// Whether to strip ANSI escape sequences from output.
    pub strip_ansi: bool,
    /// Maximum file size in bytes before rotation.
    pub max_file_size: u64,
    /// Flush interval in milliseconds.
    pub flush_interval_ms: u64,
}

impl LogConfig {
    /// Creates a new LogConfig with defaults and the given session name.
    pub fn new(session_name: &str) -> Self {
        Self {
            directory: default_log_directory(),
            session_name: session_name.to_string(),
            timestamps: true,
            strip_ansi: true,
            max_file_size: DEFAULT_MAX_FILE_SIZE,
            flush_interval_ms: DEFAULT_FLUSH_INTERVAL_MS,
        }
    }

    /// Validates the configuration, returning an error message if invalid.
    pub fn validate(&self) -> Result<(), String> {
        let name = self.session_name.trim();
        if name.is_empty() {
            return Err("Session name cannot be empty".into());
        }
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err("Session name contains invalid characters".into());
        }
        if name.len() > 128 {
            return Err("Session name exceeds 128 characters".into());
        }
        if self.max_file_size < 1024 {
            return Err("Max file size must be at least 1 KB".into());
        }
        Ok(())
    }
}

/// Returns the default log directory: `~/putz-logs/`.
pub fn default_log_directory() -> PathBuf {
    directories::UserDirs::new()
        .map(|dirs| dirs.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join(DEFAULT_LOG_DIR_NAME)
}

/// Information about an active logging session, returned by status queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatus {
    /// Whether logging is currently active.
    pub active: bool,
    /// Path to the current log file (if active).
    pub file_path: Option<String>,
    /// Total bytes written in the current session.
    pub bytes_written: u64,
    /// Number of file rotations that have occurred.
    pub rotation_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_config_has_sensible_defaults() {
        let config = LogConfig::new("my-session");
        assert_eq!(config.session_name, "my-session");
        assert!(config.timestamps);
        assert!(config.strip_ansi);
        assert_eq!(config.max_file_size, 100 * 1024 * 1024);
        assert_eq!(config.flush_interval_ms, 100);
        assert!(config.directory.to_string_lossy().contains(DEFAULT_LOG_DIR_NAME));
    }

    #[test]
    fn validate_accepts_valid_name() {
        let config = LogConfig::new("my-session");
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_rejects_empty_name() {
        let config = LogConfig::new("");
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_whitespace_only_name() {
        let config = LogConfig::new("   ");
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_path_separator_forward_slash() {
        let config = LogConfig::new("../evil");
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_path_separator_backslash() {
        let config = LogConfig::new("..\\evil");
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_dot_dot_traversal() {
        let config = LogConfig::new("foo..bar");
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_name_exceeding_max_length() {
        let long_name = "a".repeat(129);
        let config = LogConfig::new(&long_name);
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_accepts_name_at_max_length() {
        let name = "a".repeat(128);
        let config = LogConfig::new(&name);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_rejects_tiny_max_file_size() {
        let mut config = LogConfig::new("test");
        config.max_file_size = 512;
        assert!(config.validate().is_err());
    }

    #[test]
    fn serde_roundtrip_json() {
        let config = LogConfig::new("roundtrip-test");
        let json = serde_json::to_string(&config).unwrap();
        let restored: LogConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config.session_name, restored.session_name);
        assert_eq!(config.timestamps, restored.timestamps);
        assert_eq!(config.strip_ansi, restored.strip_ansi);
        assert_eq!(config.max_file_size, restored.max_file_size);
    }

    #[test]
    fn serde_camel_case_field_names() {
        let config = LogConfig::new("camel-test");
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("sessionName"));
        assert!(json.contains("stripAnsi"));
        assert!(json.contains("maxFileSize"));
        assert!(json.contains("flushIntervalMs"));
    }

    #[test]
    fn log_status_default_inactive() {
        let status = LogStatus {
            active: false,
            file_path: None,
            bytes_written: 0,
            rotation_count: 0,
        };
        assert!(!status.active);
        assert!(status.file_path.is_none());
    }

    #[test]
    fn log_status_serde_roundtrip() {
        let status = LogStatus {
            active: true,
            file_path: Some("/tmp/test.log".into()),
            bytes_written: 1024,
            rotation_count: 2,
        };
        let json = serde_json::to_string(&status).unwrap();
        let restored: LogStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status.active, restored.active);
        assert_eq!(status.file_path, restored.file_path);
        assert_eq!(status.bytes_written, restored.bytes_written);
        assert_eq!(status.rotation_count, restored.rotation_count);
    }

    #[test]
    fn default_log_directory_is_under_home() {
        let dir = default_log_directory();
        let dir_str = dir.to_string_lossy();
        assert!(dir_str.contains(DEFAULT_LOG_DIR_NAME));
    }
}
