/// Theme manager error types.
///
/// Each variant represents a specific failure mode in theme operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum ThemeError {
    /// Theme not found for the given ID.
    NotFound(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write the themes file.
    IoError(String),
    /// Failed to parse the themes file (corrupted JSON).
    ParseError(String),
    /// Internal mutex was poisoned.
    LockError(String),
    /// Duplicate name among themes.
    DuplicateName(String),
    /// Attempted to modify or delete a built-in theme.
    BuiltinProtected(String),
}

impl fmt::Display for ThemeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Theme not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
            Self::DuplicateName(name) => write!(f, "Duplicate theme name: {name}"),
            Self::BuiltinProtected(name) => {
                write!(f, "Cannot modify built-in theme: {name}")
            }
        }
    }
}

impl std::error::Error for ThemeError {}

impl From<std::io::Error> for ThemeError {
    fn from(err: std::io::Error) -> Self {
        ThemeError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for ThemeError {
    fn from(err: serde_json::Error) -> Self {
        ThemeError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = ThemeError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Theme not found: abc-123");
    }

    #[test]
    fn display_invalid_input() {
        let err = ThemeError::InvalidInput("bad color".into());
        assert_eq!(err.to_string(), "Invalid input: bad color");
    }

    #[test]
    fn display_io_error() {
        let err = ThemeError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = ThemeError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_lock_error() {
        let err = ThemeError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn display_duplicate_name() {
        let err = ThemeError::DuplicateName("Dracula".into());
        assert_eq!(err.to_string(), "Duplicate theme name: Dracula");
    }

    #[test]
    fn display_builtin_protected() {
        let err = ThemeError::BuiltinProtected("Solarized Dark".into());
        assert_eq!(
            err.to_string(),
            "Cannot modify built-in theme: Solarized Dark"
        );
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let theme_err: ThemeError = io_err.into();
        assert!(matches!(theme_err, ThemeError::IoError(_)));
        assert!(theme_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let theme_err: ThemeError = json_err.into();
        assert!(matches!(theme_err, ThemeError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = ThemeError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = ThemeError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
