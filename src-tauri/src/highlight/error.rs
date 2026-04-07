/// Highlight manager error types.
///
/// Each variant represents a specific failure mode in highlight operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum HighlightError {
    /// Highlight set not found for the given ID.
    NotFound(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write the highlights file.
    IoError(String),
    /// Failed to parse the highlights file (corrupted JSON).
    ParseError(String),
    /// Internal mutex was poisoned.
    LockError(String),
    /// Duplicate name among highlight sets.
    DuplicateName(String),
    /// Attempted to modify or delete a built-in preset.
    BuiltinProtected(String),
}

impl fmt::Display for HighlightError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Highlight set not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
            Self::DuplicateName(name) => {
                write!(f, "Duplicate highlight set name: {name}")
            }
            Self::BuiltinProtected(name) => {
                write!(f, "Cannot modify built-in preset: {name}")
            }
        }
    }
}

impl std::error::Error for HighlightError {}

impl From<std::io::Error> for HighlightError {
    fn from(err: std::io::Error) -> Self {
        HighlightError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for HighlightError {
    fn from(err: serde_json::Error) -> Self {
        HighlightError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = HighlightError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Highlight set not found: abc-123");
    }

    #[test]
    fn display_invalid_input() {
        let err = HighlightError::InvalidInput("bad pattern".into());
        assert_eq!(err.to_string(), "Invalid input: bad pattern");
    }

    #[test]
    fn display_io_error() {
        let err = HighlightError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = HighlightError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_lock_error() {
        let err = HighlightError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn display_duplicate_name() {
        let err = HighlightError::DuplicateName("Cisco IOS".into());
        assert_eq!(err.to_string(), "Duplicate highlight set name: Cisco IOS");
    }

    #[test]
    fn display_builtin_protected() {
        let err = HighlightError::BuiltinProtected("Cisco IOS".into());
        assert_eq!(err.to_string(), "Cannot modify built-in preset: Cisco IOS");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let highlight_err: HighlightError = io_err.into();
        assert!(matches!(highlight_err, HighlightError::IoError(_)));
        assert!(highlight_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let highlight_err: HighlightError = json_err.into();
        assert!(matches!(highlight_err, HighlightError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = HighlightError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = HighlightError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
