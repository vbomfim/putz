/// SSH key error types.
///
/// Each variant represents a specific failure mode in key operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
///
/// SECURITY: Error messages MUST NOT contain private key material —
/// only IDs and generic descriptions.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum KeyError {
    /// Key not found for the given ID.
    NotFound(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write key files.
    IoError(String),
    /// Cryptographic operation failed (generation, parsing, fingerprint).
    CryptoError(String),
    /// Failed to parse key index or key data.
    ParseError(String),
    /// Internal mutex was poisoned.
    LockError(String),
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Key not found: {id}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::CryptoError(msg) => write!(f, "Crypto error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
        }
    }
}

impl std::error::Error for KeyError {}

impl From<std::io::Error> for KeyError {
    fn from(err: std::io::Error) -> Self {
        KeyError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for KeyError {
    fn from(err: serde_json::Error) -> Self {
        KeyError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = KeyError::NotFound("key-123".into());
        assert_eq!(err.to_string(), "Key not found: key-123");
    }

    #[test]
    fn display_invalid_input() {
        let err = KeyError::InvalidInput("name too long".into());
        assert_eq!(err.to_string(), "Invalid input: name too long");
    }

    #[test]
    fn display_io_error() {
        let err = KeyError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_crypto_error() {
        let err = KeyError::CryptoError("invalid key format".into());
        assert_eq!(err.to_string(), "Crypto error: invalid key format");
    }

    #[test]
    fn display_parse_error() {
        let err = KeyError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_lock_error() {
        let err = KeyError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let key_err: KeyError = io_err.into();
        assert!(matches!(key_err, KeyError::IoError(_)));
        assert!(key_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let key_err: KeyError = json_err.into();
        assert!(matches!(key_err, KeyError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = KeyError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = KeyError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }

    #[test]
    fn error_messages_never_contain_key_material() {
        let err = KeyError::NotFound("uuid-only".into());
        let msg = err.to_string();
        assert!(!msg.contains("private"));
        assert!(!msg.contains("BEGIN"));
    }
}
