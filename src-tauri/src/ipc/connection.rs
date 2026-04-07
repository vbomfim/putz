/// IPC commands for protocol connection operations.
///
/// These are the Tauri command handlers for opening, writing to,
/// resizing, and closing protocol connections (Telnet, SSH, Serial).
///
/// Mirrors the PTY IPC pattern in terminal.rs but for remote connections.
/// Commands are async because protocol operations use tokio.
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::protocol::connection_manager::ConnectionManager;
use crate::protocol::ProtocolType;

/// Input DTO for the connection_open IPC command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionOpenInput {
    /// Hostname or IP address to connect to.
    pub host: Option<String>,
    /// Port number (defaults to protocol default).
    pub port: Option<u16>,
    /// Protocol to use for the connection.
    pub protocol: ProtocolType,
    /// Username for authentication (optional).
    pub username: Option<String>,
    /// Terminal width in columns.
    pub cols: u16,
    /// Terminal height in rows.
    pub rows: u16,
}

/// Opens a new protocol connection.
///
/// Returns the generated connection ID that identifies this connection
/// for all subsequent operations (write, resize, close).
#[tauri::command]
pub async fn connection_open(
    app: AppHandle,
    state: State<'_, ConnectionManager>,
    input: ConnectionOpenInput,
) -> Result<String, String> {
    let params = crate::protocol::ConnectionParams {
        host: input.host,
        port: input.port,
        username: input.username,
        cols: input.cols,
        rows: input.rows,
    };

    state
        .open(params, input.protocol, app)
        .await
        .map_err(|e| e.to_string())
}

/// Writes input bytes to an active connection.
#[tauri::command]
pub async fn connection_write(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .write(&connection_id, &data)
        .await
        .map_err(|e| e.to_string())
}

/// Resizes the terminal for an active connection.
///
/// Sends a NAWS update (Telnet) or equivalent to the remote server.
#[tauri::command]
pub async fn connection_resize(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .resize(&connection_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

/// Closes an active connection.
///
/// The read loop will detect the shutdown and emit a
/// `connection-status-{connectionId}` event with "disconnected" status.
#[tauri::command]
pub async fn connection_close(
    state: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<(), String> {
    state
        .close(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::protocol::ProtocolError;

    #[test]
    fn protocol_error_to_string_format() {
        let err = ProtocolError::ConnectionRefused("host down".into());
        let msg = err.to_string();
        assert!(msg.contains("host down"));
        assert!(msg.contains("refused"));
    }

    #[test]
    fn protocol_error_timeout_to_string() {
        let err = ProtocolError::Timeout("30s".into());
        let msg = err.to_string();
        assert!(msg.contains("30s"));
        assert!(msg.contains("timed out"));
    }

    #[test]
    fn connection_open_input_deserializes() {
        let json = r#"{
            "host": "192.168.1.1",
            "port": 23,
            "protocol": "telnet",
            "cols": 80,
            "rows": 24
        }"#;
        let input: super::ConnectionOpenInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(input.host, Some("192.168.1.1".into()));
        assert_eq!(input.port, Some(23));
        assert_eq!(input.cols, 80);
        assert_eq!(input.rows, 24);
    }

    #[test]
    fn connection_open_input_minimal() {
        let json = r#"{
            "protocol": "telnet",
            "cols": 80,
            "rows": 24
        }"#;
        let input: super::ConnectionOpenInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(input.host, None);
        assert_eq!(input.port, None);
        assert_eq!(input.username, None);
    }

    #[test]
    fn connection_open_input_with_username() {
        let json = r#"{
            "host": "switch.local",
            "port": 23,
            "protocol": "telnet",
            "username": "admin",
            "cols": 132,
            "rows": 43
        }"#;
        let input: super::ConnectionOpenInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(input.username, Some("admin".into()));
        assert_eq!(input.cols, 132);
        assert_eq!(input.rows, 43);
    }
}
