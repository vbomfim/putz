/// Auto-login error types.
///
/// Each variant represents a specific failure mode in auto-login operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum AutoLoginError {
    /// Login profile not found for the given session ID.
    NotFound(String),
    /// Input validation failed.
    InvalidInput(String),
    /// Pattern matching or regex compilation failed.
    PatternError(String),
    /// Failed to read or write profile storage.
    IoError(String),
    /// Internal mutex was poisoned.
    LockError(String),
}

impl fmt::Display for AutoLoginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Auto-login profile not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::PatternError(msg) => write!(f, "Pattern error: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
        }
    }
}

impl std::error::Error for AutoLoginError {}

impl From<std::io::Error> for AutoLoginError {
    fn from(err: std::io::Error) -> Self {
        AutoLoginError::IoError(err.to_string())
    }
}

impl From<regex::Error> for AutoLoginError {
    fn from(err: regex::Error) -> Self {
        AutoLoginError::PatternError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = AutoLoginError::NotFound("sess-123".into());
        assert_eq!(err.to_string(), "Auto-login profile not found: sess-123");
    }

    #[test]
    fn display_invalid_input() {
        let err = AutoLoginError::InvalidInput("empty pattern".into());
        assert_eq!(err.to_string(), "Invalid input: empty pattern");
    }

    #[test]
    fn display_pattern_error() {
        let err = AutoLoginError::PatternError("invalid regex".into());
        assert_eq!(err.to_string(), "Pattern error: invalid regex");
    }

    #[test]
    fn display_io_error() {
        let err = AutoLoginError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_lock_error() {
        let err = AutoLoginError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let auto_err: AutoLoginError = io_err.into();
        assert!(matches!(auto_err, AutoLoginError::IoError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = AutoLoginError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = AutoLoginError::PatternError("test".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
