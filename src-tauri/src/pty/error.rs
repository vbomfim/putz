/// PTY error types for the terminal emulator backend.
///
/// Each variant represents a specific failure mode in PTY operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub enum PtyError {
    /// PTY process failed to start (e.g., shell not found).
    SpawnFailed(String),
    /// Write to PTY stdin failed.
    WriteFailed(String),
    /// No session found for the given ID.
    NotFound(String),
    /// Session was already closed.
    AlreadyClosed(String),
    /// Invalid session ID format (must be UUID v4).
    InvalidSessionId(String),
    /// Shell path is not in the allowlist.
    InvalidShell(String),
    /// Environment variable name is not allowed.
    InvalidEnvironment(String),
    /// Working directory is invalid or does not exist.
    InvalidWorkingDirectory(String),
    /// Maximum number of concurrent sessions reached.
    SessionLimitReached,
}

impl fmt::Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SpawnFailed(msg) => write!(f, "Failed to spawn PTY: {msg}"),
            Self::WriteFailed(msg) => write!(f, "Failed to write to PTY: {msg}"),
            Self::NotFound(id) => write!(f, "Session not found: {id}"),
            Self::AlreadyClosed(id) => write!(f, "Session already closed: {id}"),
            Self::InvalidSessionId(id) => write!(f, "Invalid session ID: {id}"),
            Self::InvalidShell(path) => write!(f, "Shell not allowed: {path}"),
            Self::InvalidEnvironment(var) => {
                write!(f, "Environment variable not allowed: {var}")
            }
            Self::InvalidWorkingDirectory(path) => {
                write!(f, "Invalid working directory: {path}")
            }
            Self::SessionLimitReached => {
                write!(f, "Maximum number of sessions reached (64)")
            }
        }
    }
}

impl std::error::Error for PtyError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_spawn_failed() {
        let err = PtyError::SpawnFailed("shell not found".into());
        assert_eq!(err.to_string(), "Failed to spawn PTY: shell not found");
    }

    #[test]
    fn display_write_failed() {
        let err = PtyError::WriteFailed("broken pipe".into());
        assert_eq!(err.to_string(), "Failed to write to PTY: broken pipe");
    }

    #[test]
    fn display_not_found() {
        let err = PtyError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Session not found: abc-123");
    }

    #[test]
    fn display_already_closed() {
        let err = PtyError::AlreadyClosed("abc-123".into());
        assert_eq!(err.to_string(), "Session already closed: abc-123");
    }

    #[test]
    fn display_invalid_session_id() {
        let err = PtyError::InvalidSessionId("not-a-uuid".into());
        assert_eq!(err.to_string(), "Invalid session ID: not-a-uuid");
    }

    #[test]
    fn display_invalid_shell() {
        let err = PtyError::InvalidShell("/usr/bin/evil".into());
        assert_eq!(err.to_string(), "Shell not allowed: /usr/bin/evil");
    }

    #[test]
    fn display_invalid_environment() {
        let err = PtyError::InvalidEnvironment("LD_PRELOAD".into());
        assert_eq!(
            err.to_string(),
            "Environment variable not allowed: LD_PRELOAD"
        );
    }

    #[test]
    fn display_invalid_working_directory() {
        let err = PtyError::InvalidWorkingDirectory("/nonexistent".into());
        assert_eq!(err.to_string(), "Invalid working directory: /nonexistent");
    }

    #[test]
    fn display_session_limit_reached() {
        let err = PtyError::SessionLimitReached;
        assert_eq!(err.to_string(), "Maximum number of sessions reached (64)");
    }

    #[test]
    fn error_is_serialize() {
        let err = PtyError::SpawnFailed("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("SpawnFailed"));
        assert!(json.contains("test"));
    }

    #[test]
    fn error_is_clone() {
        let err = PtyError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
