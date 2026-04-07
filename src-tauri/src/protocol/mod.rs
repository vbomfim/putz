/// Protocol abstraction layer — shared interface for all connection protocols.
///
/// Defines the `Protocol` trait that SSH, Telnet, and Serial connections
/// must implement. This is the foundation for protocol-agnostic connection
/// management in the Putz terminal emulator.
///
/// Design: Uses `async_trait` since network protocols are inherently async.
/// The trait is object-safe (`Send + Sync`) so it can be stored in a
/// `HashMap<String, Box<dyn Protocol>>` behind a `tokio::sync::Mutex`.
pub mod connection_manager;
pub mod serial;
pub mod sftp;
pub mod ssh;
pub mod telnet;

#[cfg(test)]
pub mod test_utils;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Identifies the type of protocol a connection uses.
///
/// Maps to `session::models::Protocol` but lives in the protocol layer
/// to avoid coupling session management to protocol implementation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProtocolType {
    Ssh,
    Telnet,
    Serial,
    Local,
}

/// Parameters required to establish a protocol connection.
///
/// Not all fields apply to every protocol:
/// - SSH/Telnet: host + port (+ optional username)
/// - Serial: host = serial port path, port = baud rate
/// - Local: no host/port needed
/// - SSH only: credential_id (vault), key_path (private key file)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionParams {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Vault credential ID for SSH password/passphrase retrieval.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    /// Path to an SSH private key file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
}

/// Event emitter trait — abstracts Tauri event emission for testability.
///
/// Moved to the protocol level because both SSH and Telnet connections
/// need to emit output and status events to the frontend.
///
/// The real implementation uses `tauri::AppHandle::emit()`.
/// Tests can provide a mock implementation.
pub trait EventEmitter: Send + Sync + 'static {
    /// Emits terminal output data (base64 encoded) to the frontend.
    fn emit_output(&self, connection_id: &str, data: &str);
    /// Emits a connection status change to the frontend.
    fn emit_status(&self, connection_id: &str, payload: &ConnectionStatusPayload);
    /// Emits a custom event with a JSON payload to the frontend.
    fn emit_event(&self, event: &str, payload: &str);
}

/// Tauri-backed event emitter.
pub struct TauriEventEmitter {
    app: tauri::AppHandle,
}

impl TauriEventEmitter {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl EventEmitter for TauriEventEmitter {
    fn emit_output(&self, connection_id: &str, data: &str) {
        let event = format!("connection-output-{connection_id}");
        let _ = tauri::Emitter::emit(&self.app, &event, data);
    }

    fn emit_status(
        &self,
        connection_id: &str,
        payload: &ConnectionStatusPayload,
    ) {
        let event = format!("connection-status-{connection_id}");
        let _ = tauri::Emitter::emit(&self.app, &event, payload);
    }

    fn emit_event(&self, event: &str, payload: &str) {
        let _ = tauri::Emitter::emit(&self.app, event, payload);
    }
}

/// Errors that can occur during protocol operations.
///
/// Each variant provides a descriptive message. Implements `Serialize`
/// so errors can cross the Tauri IPC boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProtocolError {
    /// TCP/serial connection was refused by the remote host.
    ConnectionRefused(String),
    /// Authentication failed (wrong credentials, key rejected, etc.).
    AuthFailed(String),
    /// Connection attempt exceeded the timeout.
    Timeout(String),
    /// The communication channel was closed unexpectedly.
    ChannelClosed(String),
    /// An I/O error occurred during read/write operations.
    IoError(String),
    /// Invalid or missing connection parameters.
    InvalidParams(String),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionRefused(msg) => write!(f, "Connection refused: {msg}"),
            Self::AuthFailed(msg) => write!(f, "Authentication failed: {msg}"),
            Self::Timeout(msg) => write!(f, "Connection timed out: {msg}"),
            Self::ChannelClosed(msg) => write!(f, "Channel closed: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::InvalidParams(msg) => write!(f, "Invalid parameters: {msg}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

/// Connection status reported to the frontend via events.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error,
}

/// Event payload for connection status changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatusPayload {
    pub status: ConnectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Core protocol trait that all connection types must implement.
///
/// Designed to be object-safe and async. Each method takes `&mut self`
/// because protocol state changes during operations.
///
/// The read loop is NOT part of this trait — it's spawned separately
/// by the ConnectionManager after `connect()` succeeds.
#[async_trait]
#[allow(dead_code)]
pub trait Protocol: Send + Sync {
    /// Establish a connection using the given parameters.
    async fn connect(&mut self, params: ConnectionParams) -> Result<(), ProtocolError>;

    /// Send raw bytes to the remote end.
    async fn write(&mut self, data: &[u8]) -> Result<(), ProtocolError>;

    /// Notify the remote end of a terminal size change.
    async fn resize(&mut self, cols: u16, rows: u16) -> Result<(), ProtocolError>;

    /// Gracefully close the connection.
    async fn disconnect(&mut self) -> Result<(), ProtocolError>;

    /// Returns whether the connection is currently active.
    fn is_connected(&self) -> bool;

    /// Returns the protocol type identifier.
    fn protocol_type(&self) -> ProtocolType;
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // ProtocolType tests
    // ====================================================================

    #[test]
    fn protocol_type_serializes_lowercase() {
        let json = serde_json::to_string(&ProtocolType::Telnet).unwrap();
        assert_eq!(json, r#""telnet""#);
    }

    #[test]
    fn protocol_type_deserializes_lowercase() {
        let p: ProtocolType = serde_json::from_str(r#""ssh""#).unwrap();
        assert_eq!(p, ProtocolType::Ssh);
    }

    #[test]
    fn protocol_type_roundtrip_all_variants() {
        for variant in [
            ProtocolType::Ssh,
            ProtocolType::Telnet,
            ProtocolType::Serial,
            ProtocolType::Local,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: ProtocolType = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    // ====================================================================
    // ConnectionParams tests
    // ====================================================================

    #[test]
    fn connection_params_serializes_camel_case() {
        let params = ConnectionParams {
            host: Some("192.168.1.1".into()),
            port: Some(23),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let json = serde_json::to_string(&params).unwrap();
        assert!(json.contains("192.168.1.1"));
        assert!(json.contains("23"));
        // None fields with skip_serializing_if omit from JSON
    }

    #[test]
    fn connection_params_roundtrip() {
        let params = ConnectionParams {
            host: Some("router.local".into()),
            port: Some(2323),
            username: Some("admin".into()),
            cols: 120,
            rows: 40,
            credential_id: None,
            key_path: None,
        };
        let json = serde_json::to_string(&params).unwrap();
        let restored: ConnectionParams = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.host, Some("router.local".into()));
        assert_eq!(restored.port, Some(2323));
        assert_eq!(restored.username, Some("admin".into()));
        assert_eq!(restored.cols, 120);
        assert_eq!(restored.rows, 40);
    }

    #[test]
    fn connection_params_with_ssh_fields() {
        let params = ConnectionParams {
            host: Some("server.local".into()),
            port: Some(22),
            username: Some("root".into()),
            cols: 80,
            rows: 24,
            credential_id: Some("cred-uuid-123".into()),
            key_path: Some("/home/user/.ssh/id_rsa".into()),
        };
        let json = serde_json::to_string(&params).unwrap();
        assert!(json.contains("credentialId"));
        assert!(json.contains("cred-uuid-123"));
        assert!(json.contains("keyPath"));
        assert!(json.contains("id_rsa"));
    }

    #[test]
    fn connection_params_omits_none_ssh_fields() {
        let params = ConnectionParams {
            host: Some("host".into()),
            port: Some(23),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let json = serde_json::to_string(&params).unwrap();
        assert!(!json.contains("credentialId"));
        assert!(!json.contains("keyPath"));
    }

    // ====================================================================
    // ProtocolError tests
    // ====================================================================

    #[test]
    fn protocol_error_display_connection_refused() {
        let err = ProtocolError::ConnectionRefused("host unreachable".into());
        assert_eq!(err.to_string(), "Connection refused: host unreachable");
    }

    #[test]
    fn protocol_error_display_auth_failed() {
        let err = ProtocolError::AuthFailed("bad password".into());
        assert_eq!(err.to_string(), "Authentication failed: bad password");
    }

    #[test]
    fn protocol_error_display_timeout() {
        let err = ProtocolError::Timeout("30s exceeded".into());
        assert_eq!(err.to_string(), "Connection timed out: 30s exceeded");
    }

    #[test]
    fn protocol_error_display_channel_closed() {
        let err = ProtocolError::ChannelClosed("peer reset".into());
        assert_eq!(err.to_string(), "Channel closed: peer reset");
    }

    #[test]
    fn protocol_error_display_io_error() {
        let err = ProtocolError::IoError("broken pipe".into());
        assert_eq!(err.to_string(), "I/O error: broken pipe");
    }

    #[test]
    fn protocol_error_display_invalid_params() {
        let err = ProtocolError::InvalidParams("missing host".into());
        assert_eq!(err.to_string(), "Invalid parameters: missing host");
    }

    #[test]
    fn protocol_error_is_serializable() {
        let err = ProtocolError::ConnectionRefused("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("ConnectionRefused"));
        assert!(json.contains("test"));
    }

    #[test]
    fn protocol_error_is_clone() {
        let err = ProtocolError::Timeout("30s".into());
        let cloned = err.clone();
        assert_eq!(err, cloned);
    }

    // ====================================================================
    // ConnectionStatus tests
    // ====================================================================

    #[test]
    fn connection_status_serializes_lowercase() {
        let json = serde_json::to_string(&ConnectionStatus::Connected).unwrap();
        assert_eq!(json, r#""connected""#);
    }

    #[test]
    fn connection_status_all_variants_serialize() {
        for (variant, expected) in [
            (ConnectionStatus::Connecting, r#""connecting""#),
            (ConnectionStatus::Connected, r#""connected""#),
            (ConnectionStatus::Disconnected, r#""disconnected""#),
            (ConnectionStatus::Error, r#""error""#),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn connection_status_payload_omits_none_message() {
        let payload = ConnectionStatusPayload {
            status: ConnectionStatus::Connected,
            message: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(!json.contains("message"));
    }

    #[test]
    fn connection_status_payload_includes_message() {
        let payload = ConnectionStatusPayload {
            status: ConnectionStatus::Error,
            message: Some("connection lost".into()),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("connection lost"));
        assert!(json.contains(r#""error""#));
    }
}
