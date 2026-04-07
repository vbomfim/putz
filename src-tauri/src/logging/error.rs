/// Logging error types for the session logger.
///
/// Each variant represents a specific failure mode in logging operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum LogError {
    /// Log directory could not be created or accessed.
    DirectoryFailed(String),
    /// Log file could not be created or opened.
    FileCreateFailed(String),
    /// Write to log file failed.
    WriteFailed(String),
    /// No active logger found for the given session ID.
    NotFound(String),
    /// Logging is already active for this session.
    AlreadyActive(String),
    /// Invalid session name (empty or contains path separators).
    InvalidSessionName(String),
    /// File rotation failed.
    RotationFailed(String),
}

impl fmt::Display for LogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DirectoryFailed(msg) => write!(f, "Log directory error: {msg}"),
            Self::FileCreateFailed(msg) => write!(f, "Failed to create log file: {msg}"),
            Self::WriteFailed(msg) => write!(f, "Failed to write to log: {msg}"),
            Self::NotFound(id) => write!(f, "No active logger for session: {id}"),
            Self::AlreadyActive(id) => write!(f, "Logging already active for session: {id}"),
            Self::InvalidSessionName(name) => write!(f, "Invalid session name: {name}"),
            Self::RotationFailed(msg) => write!(f, "Log rotation failed: {msg}"),
        }
    }
}

impl std::error::Error for LogError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_directory_failed() {
        let err = LogError::DirectoryFailed("permission denied".into());
        assert_eq!(err.to_string(), "Log directory error: permission denied");
    }

    #[test]
    fn display_file_create_failed() {
        let err = LogError::FileCreateFailed("disk full".into());
        assert_eq!(err.to_string(), "Failed to create log file: disk full");
    }

    #[test]
    fn display_write_failed() {
        let err = LogError::WriteFailed("broken pipe".into());
        assert_eq!(err.to_string(), "Failed to write to log: broken pipe");
    }

    #[test]
    fn display_not_found() {
        let err = LogError::NotFound("abc-123".into());
        assert_eq!(
            err.to_string(),
            "No active logger for session: abc-123"
        );
    }

    #[test]
    fn display_already_active() {
        let err = LogError::AlreadyActive("abc-123".into());
        assert_eq!(
            err.to_string(),
            "Logging already active for session: abc-123"
        );
    }

    #[test]
    fn display_invalid_session_name() {
        let err = LogError::InvalidSessionName("../evil".into());
        assert_eq!(err.to_string(), "Invalid session name: ../evil");
    }

    #[test]
    fn display_rotation_failed() {
        let err = LogError::RotationFailed("rename error".into());
        assert_eq!(err.to_string(), "Log rotation failed: rename error");
    }

    #[test]
    fn error_is_serialize() {
        let err = LogError::WriteFailed("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("WriteFailed"));
        assert!(json.contains("test"));
    }

    #[test]
    fn error_is_clone() {
        let err = LogError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
