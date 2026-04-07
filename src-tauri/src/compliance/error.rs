/// Compliance error types.
///
/// Each variant represents a specific failure mode in compliance operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
///
/// Follows the same pattern as `VaultError`.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum ComplianceError {
    /// Failed to read or write the configuration file.
    IoError(String),
    /// Failed to parse configuration (corrupted JSON).
    ParseError(String),
    /// Input validation failed.
    InvalidInput(String),
    /// Internal mutex was poisoned.
    LockError(String),
}

impl fmt::Display for ComplianceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
        }
    }
}

impl std::error::Error for ComplianceError {}

impl From<std::io::Error> for ComplianceError {
    fn from(err: std::io::Error) -> Self {
        ComplianceError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for ComplianceError {
    fn from(err: serde_json::Error) -> Self {
        ComplianceError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_io_error() {
        let err = ComplianceError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = ComplianceError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_invalid_input() {
        let err = ComplianceError::InvalidInput("name too long".into());
        assert_eq!(err.to_string(), "Invalid input: name too long");
    }

    #[test]
    fn display_lock_error() {
        let err = ComplianceError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let compliance_err: ComplianceError = io_err.into();
        assert!(matches!(compliance_err, ComplianceError::IoError(_)));
        assert!(compliance_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let compliance_err: ComplianceError = json_err.into();
        assert!(matches!(compliance_err, ComplianceError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = ComplianceError::IoError("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("IoError"));
    }

    #[test]
    fn error_is_clone() {
        let err = ComplianceError::InvalidInput("bad".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
