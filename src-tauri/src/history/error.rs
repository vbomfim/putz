/// Command history error types.
///
/// Each variant represents a specific failure mode in history operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
///
/// Error messages MUST NOT contain sensitive data — only generic descriptions.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum HistoryError {
    /// Failed to open or initialize the SQLite database.
    DatabaseError(String),
    /// A query or operation failed.
    QueryError(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Internal mutex was poisoned.
    LockError(String),
}

impl fmt::Display for HistoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DatabaseError(msg) => write!(f, "Database error: {msg}"),
            Self::QueryError(msg) => write!(f, "Query error: {msg}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
        }
    }
}

impl std::error::Error for HistoryError {}

impl From<rusqlite::Error> for HistoryError {
    fn from(err: rusqlite::Error) -> Self {
        HistoryError::QueryError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_database_error() {
        let err = HistoryError::DatabaseError("cannot open".into());
        assert_eq!(err.to_string(), "Database error: cannot open");
    }

    #[test]
    fn display_query_error() {
        let err = HistoryError::QueryError("syntax error".into());
        assert_eq!(err.to_string(), "Query error: syntax error");
    }

    #[test]
    fn display_invalid_input() {
        let err = HistoryError::InvalidInput("empty query".into());
        assert_eq!(err.to_string(), "Invalid input: empty query");
    }

    #[test]
    fn display_lock_error() {
        let err = HistoryError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn from_rusqlite_error() {
        let sql_err = rusqlite::Error::QueryReturnedNoRows;
        let hist_err: HistoryError = sql_err.into();
        assert!(matches!(hist_err, HistoryError::QueryError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = HistoryError::DatabaseError("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("DatabaseError"));
    }

    #[test]
    fn error_is_clone() {
        let err = HistoryError::QueryError("test".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }
}
