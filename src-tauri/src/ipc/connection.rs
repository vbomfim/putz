/// IPC commands for protocol connection operations.
///
/// These are the Tauri command handlers for opening, writing to,
/// resizing, and closing protocol connections (Telnet, SSH, Serial).
///
/// Mirrors the PTY IPC pattern in terminal.rs but for remote connections.
/// Commands are async because protocol operations use tokio.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::protocol::connection_manager::ConnectionManager;
use crate::protocol::serial::config::{
    SerialConfig, SerialDataBits, SerialFlowControl, SerialParity,
    SerialStopBits,
};
use crate::protocol::serial::scanner;
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
    // -- Serial-specific fields (only used when protocol = "serial") --
    /// Baud rate for serial connections (default: 9600).
    pub baud_rate: Option<u32>,
    /// Data bits for serial connections (default: "eight").
    pub data_bits: Option<SerialDataBits>,
    /// Parity for serial connections (default: "none").
    pub parity: Option<SerialParity>,
    /// Stop bits for serial connections (default: "one").
    pub stop_bits: Option<SerialStopBits>,
    /// Flow control for serial connections (default: "none").
    pub flow_control: Option<SerialFlowControl>,
}

/// Opens a new protocol connection.
///
/// Returns the generated connection ID that identifies this connection
/// for all subsequent operations (write, resize, close).
///
/// For serial connections, uses serial-specific fields from the input.
/// For other protocols, uses host/port as before.
#[tauri::command]
pub async fn connection_open(
    app: AppHandle,
    state: State<'_, ConnectionManager>,
    input: ConnectionOpenInput,
) -> Result<String, String> {
    if input.protocol == ProtocolType::Serial {
        // Build SerialConfig from the input fields
        let serial_port = input.host.unwrap_or_default();
        let config = SerialConfig {
            port: serial_port,
            baud_rate: input.baud_rate.unwrap_or(9600),
            data_bits: input.data_bits.unwrap_or(SerialDataBits::Eight),
            parity: input.parity.unwrap_or(SerialParity::None),
            stop_bits: input.stop_bits.unwrap_or(SerialStopBits::One),
            flow_control: input
                .flow_control
                .unwrap_or(SerialFlowControl::None),
        };

        return state
            .open_serial(config, app)
            .await
            .map_err(|e| e.to_string());
    }

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

/// Writes input data to an active connection.
///
/// Accepts data as a base64-encoded string for safe transport via IPC.
/// This matches the output direction (base64 events from backend).
#[tauri::command]
pub async fn connection_write(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    state
        .write(&connection_id, &bytes)
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

/// Lists all available serial ports on the system.
///
/// Returns port info including name, description, manufacturer,
/// serial number, and type (USB/PCI/Bluetooth).
#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<scanner::SerialPortInfo>, String> {
    Ok(scanner::list_serial_ports())
}

/// Sends a break signal on a serial connection.
///
/// A serial break is used by some equipment (Cisco routers) to
/// enter ROM monitor mode. Only valid for serial connections.
#[tauri::command]
pub async fn serial_send_break(
    state: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<(), String> {
    state
        .send_break(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::protocol::serial::config::{
        SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits,
    };
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
        // Serial fields should be None for non-serial connections
        assert_eq!(input.baud_rate, None);
        assert_eq!(input.data_bits, None);
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

    #[test]
    fn connection_open_input_serial_full() {
        let json = r#"{
            "host": "/dev/ttyUSB0",
            "protocol": "serial",
            "cols": 80,
            "rows": 24,
            "baudRate": 115200,
            "dataBits": "seven",
            "parity": "even",
            "stopBits": "two",
            "flowControl": "hardware"
        }"#;
        let input: super::ConnectionOpenInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(input.host, Some("/dev/ttyUSB0".into()));
        assert_eq!(input.baud_rate, Some(115200));
        assert_eq!(input.data_bits, Some(SerialDataBits::Seven));
        assert_eq!(input.parity, Some(SerialParity::Even));
        assert_eq!(input.stop_bits, Some(SerialStopBits::Two));
        assert_eq!(
            input.flow_control,
            Some(SerialFlowControl::Hardware)
        );
    }

    #[test]
    fn connection_open_input_serial_defaults() {
        let json = r#"{
            "host": "COM3",
            "protocol": "serial",
            "cols": 80,
            "rows": 24
        }"#;
        let input: super::ConnectionOpenInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(input.host, Some("COM3".into()));
        // All serial-specific fields default to None (will use 9600/8/N/1)
        assert_eq!(input.baud_rate, None);
        assert_eq!(input.data_bits, None);
        assert_eq!(input.parity, None);
        assert_eq!(input.stop_bits, None);
        assert_eq!(input.flow_control, None);
    }

    #[test]
    fn serial_list_ports_returns_ok() {
        let result = super::serial_list_ports();
        assert!(result.is_ok());
    }

    #[test]
    fn base64_decode_valid_data() {
        use base64::Engine;
        let original = b"hello world";
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(original);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn base64_decode_invalid_data_returns_error() {
        use base64::Engine;
        let result = base64::engine::general_purpose::STANDARD
            .decode("not-valid-base64!!!");
        assert!(result.is_err());
    }
}
