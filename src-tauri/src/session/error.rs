/// Session manager error types.
///
/// Each variant represents a specific failure mode in session operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub enum SessionError {
    /// Session profile not found for the given ID.
    NotFound(String),
    /// Session folder not found for the given ID.
    FolderNotFound(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write the sessions file.
    IoError(String),
    /// Failed to parse the sessions file (corrupted JSON).
    ParseError(String),
    /// Attempted to delete a folder that still contains sessions or sub-folders.
    FolderNotEmpty(String),
    /// Duplicate name within the same folder.
    DuplicateName(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Session not found: {id}"),
            Self::FolderNotFound(id) => write!(f, "Folder not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::FolderNotEmpty(id) => {
                write!(f, "Folder not empty: {id}")
            }
            Self::DuplicateName(name) => {
                write!(f, "Duplicate name in folder: {name}")
            }
        }
    }
}

impl std::error::Error for SessionError {}

impl From<std::io::Error> for SessionError {
    fn from(err: std::io::Error) -> Self {
        SessionError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for SessionError {
    fn from(err: serde_json::Error) -> Self {
        SessionError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = SessionError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Session not found: abc-123");
    }

    #[test]
    fn display_folder_not_found() {
        let err = SessionError::FolderNotFound("folder-1".into());
        assert_eq!(err.to_string(), "Folder not found: folder-1");
    }

    #[test]
    fn display_invalid_input() {
        let err = SessionError::InvalidInput("name too long".into());
        assert_eq!(err.to_string(), "Invalid input: name too long");
    }

    #[test]
    fn display_io_error() {
        let err = SessionError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = SessionError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_folder_not_empty() {
        let err = SessionError::FolderNotEmpty("folder-x".into());
        assert_eq!(err.to_string(), "Folder not empty: folder-x");
    }

    #[test]
    fn display_duplicate_name() {
        let err = SessionError::DuplicateName("My Server".into());
        assert_eq!(err.to_string(), "Duplicate name in folder: My Server");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let session_err: SessionError = io_err.into();
        assert!(matches!(session_err, SessionError::IoError(_)));
        assert!(session_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let session_err: SessionError = json_err.into();
        assert!(matches!(session_err, SessionError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = SessionError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = SessionError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
