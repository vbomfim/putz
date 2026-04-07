/// Scripting engine error types.
///
/// Each variant represents a specific failure mode in script operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum ScriptError {
    /// Script not found for the given ID.
    NotFound(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write script files.
    IoError(String),
    /// Failed to parse script metadata (corrupted JSON).
    ParseError(String),
    /// JavaScript engine error during script execution.
    EngineError(String),
    /// Script operation timed out (e.g., `waitFor` pattern not found).
    Timeout(String),
    /// A script is already running for this run ID.
    AlreadyRunning(String),
    /// Script was stopped by the user.
    ScriptStopped(String),
    /// Internal mutex was poisoned.
    LockError(String),
    /// Resource limit exceeded.
    LimitExceeded(String),
    /// The target session is not connected.
    SessionNotConnected(String),
    /// Duplicate script name.
    DuplicateName(String),
}

impl fmt::Display for ScriptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Script not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::EngineError(msg) => write!(f, "Script engine error: {msg}"),
            Self::Timeout(msg) => write!(f, "Timeout: {msg}"),
            Self::AlreadyRunning(id) => write!(f, "Script already running: {id}"),
            Self::ScriptStopped(id) => write!(f, "Script stopped: {id}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
            Self::LimitExceeded(msg) => write!(f, "Limit exceeded: {msg}"),
            Self::SessionNotConnected(id) => {
                write!(f, "Session not connected: {id}")
            }
            Self::DuplicateName(name) => {
                write!(f, "Duplicate script name: {name}")
            }
        }
    }
}

impl std::error::Error for ScriptError {}

impl From<std::io::Error> for ScriptError {
    fn from(err: std::io::Error) -> Self {
        ScriptError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for ScriptError {
    fn from(err: serde_json::Error) -> Self {
        ScriptError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = ScriptError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Script not found: abc-123");
    }

    #[test]
    fn display_invalid_input() {
        let err = ScriptError::InvalidInput("name too long".into());
        assert_eq!(err.to_string(), "Invalid input: name too long");
    }

    #[test]
    fn display_io_error() {
        let err = ScriptError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = ScriptError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_engine_error() {
        let err = ScriptError::EngineError("SyntaxError".into());
        assert_eq!(err.to_string(), "Script engine error: SyntaxError");
    }

    #[test]
    fn display_timeout() {
        let err = ScriptError::Timeout("waitFor exceeded 30s".into());
        assert_eq!(err.to_string(), "Timeout: waitFor exceeded 30s");
    }

    #[test]
    fn display_already_running() {
        let err = ScriptError::AlreadyRunning("run-001".into());
        assert_eq!(err.to_string(), "Script already running: run-001");
    }

    #[test]
    fn display_script_stopped() {
        let err = ScriptError::ScriptStopped("run-001".into());
        assert_eq!(err.to_string(), "Script stopped: run-001");
    }

    #[test]
    fn display_lock_error() {
        let err = ScriptError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn display_limit_exceeded() {
        let err = ScriptError::LimitExceeded("too many scripts".into());
        assert_eq!(err.to_string(), "Limit exceeded: too many scripts");
    }

    #[test]
    fn display_session_not_connected() {
        let err = ScriptError::SessionNotConnected("sess-1".into());
        assert_eq!(err.to_string(), "Session not connected: sess-1");
    }

    #[test]
    fn display_duplicate_name() {
        let err = ScriptError::DuplicateName("backup".into());
        assert_eq!(err.to_string(), "Duplicate script name: backup");
    }

    #[test]
    fn from_io_error() {
        let io_err =
            std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let script_err: ScriptError = io_err.into();
        assert!(matches!(script_err, ScriptError::IoError(_)));
        assert!(script_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err =
            serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let script_err: ScriptError = json_err.into();
        assert!(matches!(script_err, ScriptError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = ScriptError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = ScriptError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
