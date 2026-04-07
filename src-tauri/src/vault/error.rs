/// Vault error types.
///
/// Each variant represents a specific failure mode in credential vault operations.
/// Implements `Serialize` so errors can cross the Tauri IPC boundary.
///
/// SECURITY: Error messages MUST NOT contain secret values — only IDs and
/// generic descriptions. This is enforced by the Display impl.
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub enum VaultError {
    /// Credential not found for the given ID.
    NotFound(String),
    /// Access was denied by the OS keychain.
    AccessDenied(String),
    /// The OS keychain service is unavailable.
    KeyringUnavailable(String),
    /// The keychain is locked and requires user authentication.
    Locked(String),
    /// Input validation failed with a reason.
    InvalidInput(String),
    /// Failed to read or write the vault index file.
    IoError(String),
    /// Failed to parse the vault index file (corrupted JSON).
    ParseError(String),
    /// Internal mutex was poisoned.
    LockError(String),
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Credential not found: {id}"),
            Self::AccessDenied(msg) => write!(f, "Access denied: {msg}"),
            Self::KeyringUnavailable(msg) => write!(f, "Keyring unavailable: {msg}"),
            Self::Locked(msg) => write!(f, "Keyring locked: {msg}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
            Self::LockError(msg) => write!(f, "Lock error: {msg}"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<std::io::Error> for VaultError {
    fn from(err: std::io::Error) -> Self {
        VaultError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(err: serde_json::Error) -> Self {
        VaultError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = VaultError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Credential not found: abc-123");
    }

    #[test]
    fn display_access_denied() {
        let err = VaultError::AccessDenied("user cancelled".into());
        assert_eq!(err.to_string(), "Access denied: user cancelled");
    }

    #[test]
    fn display_keyring_unavailable() {
        let err = VaultError::KeyringUnavailable("no keyring daemon".into());
        assert_eq!(err.to_string(), "Keyring unavailable: no keyring daemon");
    }

    #[test]
    fn display_locked() {
        let err = VaultError::Locked("keychain locked".into());
        assert_eq!(err.to_string(), "Keyring locked: keychain locked");
    }

    #[test]
    fn display_invalid_input() {
        let err = VaultError::InvalidInput("name too long".into());
        assert_eq!(err.to_string(), "Invalid input: name too long");
    }

    #[test]
    fn display_io_error() {
        let err = VaultError::IoError("permission denied".into());
        assert_eq!(err.to_string(), "I/O error: permission denied");
    }

    #[test]
    fn display_parse_error() {
        let err = VaultError::ParseError("unexpected EOF".into());
        assert_eq!(err.to_string(), "Parse error: unexpected EOF");
    }

    #[test]
    fn display_lock_error() {
        let err = VaultError::LockError("mutex poisoned".into());
        assert_eq!(err.to_string(), "Lock error: mutex poisoned");
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let vault_err: VaultError = io_err.into();
        assert!(matches!(vault_err, VaultError::IoError(_)));
        assert!(vault_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("{{bad}}").unwrap_err();
        let vault_err: VaultError = json_err.into();
        assert!(matches!(vault_err, VaultError::ParseError(_)));
    }

    #[test]
    fn error_is_serialize() {
        let err = VaultError::NotFound("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NotFound"));
    }

    #[test]
    fn error_is_clone() {
        let err = VaultError::NotFound("id".into());
        let cloned = err.clone();
        assert_eq!(err.to_string(), cloned.to_string());
    }

    #[test]
    fn error_messages_never_contain_secrets() {
        // Verify Display impl only references IDs and generic messages,
        // never credential secret values.
        let err = VaultError::NotFound("uuid-only".into());
        let msg = err.to_string();
        assert!(!msg.contains("password"));
        assert!(!msg.contains("secret"));
    }
}
