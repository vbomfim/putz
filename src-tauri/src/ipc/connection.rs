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
use crate::protocol::serial::config::{
    SerialConfig, SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits,
};
use crate::protocol::serial::scanner;
use crate::protocol::ProtocolType;
use crate::session::SessionManager;
use crate::vault::VaultManager;

/// Validates a serial port path against OS-specific allowlists.
///
/// Prevents path traversal and arbitrary file access by restricting
/// serial port paths to known device patterns.
fn validate_serial_port_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Serial port path is required".into());
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: /dev/ttyS*, /dev/ttyUSB*, /dev/ttyACM*, /dev/ttyAMA*,
        //        /dev/serial/*
        let valid = path.starts_with("/dev/ttyS")
            || path.starts_with("/dev/ttyUSB")
            || path.starts_with("/dev/ttyACM")
            || path.starts_with("/dev/ttyAMA")
            || path.starts_with("/dev/serial/");
        if !valid {
            return Err(format!(
                "Invalid serial port path: {path}. \
                 Expected /dev/tty{{S,USB,ACM,AMA}}* or /dev/serial/*"
            ));
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: /dev/tty.* or /dev/cu.*
        let valid = path.starts_with("/dev/tty.") || path.starts_with("/dev/cu.");
        if !valid {
            return Err(format!(
                "Invalid serial port path: {path}. \
                 Expected /dev/tty.* or /dev/cu.*"
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: COM1..COM256 (case-insensitive)
        let upper = path.to_uppercase();
        let valid = upper.starts_with("COM") && upper[3..].parse::<u16>().is_ok();
        if !valid {
            return Err(format!(
                "Invalid serial port path: {path}. \
                 Expected COM1..COM256"
            ));
        }
    }

    // Reject path traversal regardless of OS
    if path.contains("..") {
        return Err(format!(
            "Invalid serial port path: {path}. \
             Path traversal is not allowed."
        ));
    }

    Ok(())
}

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
    /// Vault credential ID for SSH password/passphrase retrieval.
    pub credential_id: Option<String>,
    /// Path to an SSH private key file.
    pub key_path: Option<String>,
    /// Session ID of the jump host to tunnel through (SSH only).
    /// When set, resolves the jump host chain and tunnels the
    /// connection through intermediate SSH hops.
    pub jump_host_id: Option<String>,
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
/// For SSH connections, retrieves credentials from VaultManager in Rust
/// (never via the frontend) using the optional `credentialId`.
/// For serial connections, uses serial-specific fields from the input.
/// For other protocols, uses host/port as before.
#[tauri::command]
pub async fn connection_open(
    app: AppHandle,
    state: State<'_, ConnectionManager>,
    vault: State<'_, VaultManager>,
    sessions: State<'_, SessionManager>,
    input: ConnectionOpenInput,
) -> Result<String, String> {
    if input.protocol == ProtocolType::Serial {
        // Build SerialConfig from the input fields
        let serial_port = input.host.unwrap_or_default();

        // Validate port path against OS-specific allowlist
        validate_serial_port_path(&serial_port)?;

        let config = SerialConfig {
            port: serial_port,
            baud_rate: input.baud_rate.unwrap_or(9600),
            data_bits: input.data_bits.unwrap_or(SerialDataBits::Eight),
            parity: input.parity.unwrap_or(SerialParity::None),
            stop_bits: input.stop_bits.unwrap_or(SerialStopBits::One),
            flow_control: input.flow_control.unwrap_or(SerialFlowControl::None),
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
        credential_id: input.credential_id.clone(),
        key_path: input.key_path.clone(),
    };

    // For SSH, pass vault reference so auth can retrieve credentials
    // server-side. Vault is cheaply wrapped since Tauri already
    // stores it in an Arc internally.
    match input.protocol {
        ProtocolType::Ssh => {
            // Retrieve the password from vault before connecting,
            // so the async connection doesn't need owned VaultManager.
            let vault_password = if let Some(ref cred_id) = input.credential_id {
                vault
                    .get_for_session(cred_id)
                    .ok()
                    .map(|c| c.secret.clone())
            } else {
                None
            };

            // Check for jump host — resolve chain and tunnel
            if let Some(ref jump_host_id) = input.jump_host_id {
                if !jump_host_id.is_empty() {
                    let hops = crate::protocol::ssh::proxy::resolve_jump_chain(
                        jump_host_id,
                        &sessions,
                        &vault,
                    )
                    .map_err(|e| e.to_string())?;

                    return state
                        .open_ssh_through_jump_hosts(params, app, vault_password, hops)
                        .await
                        .map_err(|e| e.to_string());
                }
            }

            state
                .open_ssh_with_password(params, app, vault_password)
                .await
                .map_err(|e| e.to_string())
        }
        _ => state
            .open(params, input.protocol, app)
            .await
            .map_err(|e| e.to_string()),
    }
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
    state.close(&connection_id).await.map_err(|e| e.to_string())
}

/// Lists all available serial ports on the system.
///
/// Returns port info including name, description, manufacturer,
/// serial number, and type (USB/PCI/Bluetooth).
#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<scanner::SerialPortInfo>, String> {
    scanner::list_serial_ports()
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
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
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
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
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
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
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
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.host, Some("/dev/ttyUSB0".into()));
        assert_eq!(input.baud_rate, Some(115200));
        assert_eq!(input.data_bits, Some(SerialDataBits::Seven));
        assert_eq!(input.parity, Some(SerialParity::Even));
        assert_eq!(input.stop_bits, Some(SerialStopBits::Two));
        assert_eq!(input.flow_control, Some(SerialFlowControl::Hardware));
    }

    #[test]
    fn connection_open_input_serial_defaults() {
        let json = r#"{
            "host": "COM3",
            "protocol": "serial",
            "cols": 80,
            "rows": 24
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
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

    // ── Serial port path validation tests ──────────────────────────

    #[test]
    fn validate_rejects_empty_path() {
        assert!(super::validate_serial_port_path("").is_err());
    }

    #[test]
    fn validate_rejects_path_traversal() {
        assert!(super::validate_serial_port_path("/dev/../etc/passwd").is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validate_accepts_linux_ttyusb() {
        assert!(super::validate_serial_port_path("/dev/ttyUSB0").is_ok());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validate_accepts_linux_ttyacm() {
        assert!(super::validate_serial_port_path("/dev/ttyACM0").is_ok());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validate_accepts_linux_serial() {
        assert!(super::validate_serial_port_path("/dev/serial/by-id/usb-FTDI").is_ok());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validate_rejects_arbitrary_linux_path() {
        assert!(super::validate_serial_port_path("/dev/sda1").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_accepts_macos_cu() {
        assert!(super::validate_serial_port_path("/dev/cu.usbserial-1420").is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_accepts_macos_tty() {
        assert!(super::validate_serial_port_path("/dev/tty.usbserial-1420").is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_rejects_arbitrary_macos_path() {
        assert!(super::validate_serial_port_path("/dev/disk0").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn validate_accepts_windows_com() {
        assert!(super::validate_serial_port_path("COM3").is_ok());
        assert!(super::validate_serial_port_path("com10").is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn validate_rejects_non_com_windows() {
        assert!(super::validate_serial_port_path("C:\\Windows\\system32").is_err());
    }

    #[test]
    fn base64_decode_valid_data() {
        use base64::Engine;
        let original = b"hello world";
        let encoded = base64::engine::general_purpose::STANDARD.encode(original);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn base64_decode_invalid_data_returns_error() {
        use base64::Engine;
        let result = base64::engine::general_purpose::STANDARD.decode("not-valid-base64!!!");
        assert!(result.is_err());
    }

    // ── QA Guardian — IPC deserialization edge case tests ────────────

    /// [EDGE] ConnectionOpenInput with serial partial fields.
    #[test]
    fn connection_open_input_serial_partial() {
        let json = r#"{
            "host": "/dev/ttyUSB0",
            "protocol": "serial",
            "cols": 80,
            "rows": 24,
            "baudRate": 115200
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.baud_rate, Some(115200));
        // Other serial fields default to None
        assert_eq!(input.data_bits, None);
        assert_eq!(input.parity, None);
        assert_eq!(input.stop_bits, None);
        assert_eq!(input.flow_control, None);
    }

    /// [EDGE] ConnectionOpenInput with all serial enum variants.
    #[test]
    fn connection_open_input_serial_all_enum_combos() {
        // Test odd parity + software flow control (less common combo)
        let json = r#"{
            "host": "COM5",
            "protocol": "serial",
            "cols": 80,
            "rows": 24,
            "baudRate": 38400,
            "dataBits": "five",
            "parity": "odd",
            "stopBits": "one",
            "flowControl": "software"
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.data_bits, Some(SerialDataBits::Five));
        assert_eq!(input.parity, Some(SerialParity::Odd));
        assert_eq!(input.stop_bits, Some(SerialStopBits::One));
        assert_eq!(input.flow_control, Some(SerialFlowControl::Software));
    }

    /// [EDGE] ConnectionOpenInput with invalid serial enum variant
    /// in baud_rate field type.
    #[test]
    fn connection_open_input_invalid_baud_type() {
        let json = r#"{
            "host": "COM3",
            "protocol": "serial",
            "cols": 80,
            "rows": 24,
            "baudRate": "fast"
        }"#;
        let result = serde_json::from_str::<super::ConnectionOpenInput>(json);
        assert!(result.is_err(), "Should reject string baud rate");
    }

    /// [EDGE] ConnectionOpenInput with invalid protocol variant.
    #[test]
    fn connection_open_input_invalid_protocol() {
        let json = r#"{
            "protocol": "bluetooth",
            "cols": 80,
            "rows": 24
        }"#;
        let result = serde_json::from_str::<super::ConnectionOpenInput>(json);
        assert!(result.is_err(), "Should reject unknown protocol");
    }

    /// [CONTRACT] All ProtocolError variants produce non-empty strings.
    #[test]
    fn all_protocol_error_variants_have_display() {
        let errors = vec![
            ProtocolError::ConnectionRefused("refused".into()),
            ProtocolError::AuthFailed("auth".into()),
            ProtocolError::Timeout("timeout".into()),
            ProtocolError::ChannelClosed("closed".into()),
            ProtocolError::IoError("io".into()),
            ProtocolError::InvalidParams("params".into()),
        ];
        for err in errors {
            let msg = err.to_string();
            assert!(!msg.is_empty(), "Display should not be empty");
        }
    }

    // ── Jump host IPC tests ─────────────────────────────────────────

    /// [CONTRACT] ConnectionOpenInput with jump_host_id deserializes.
    #[test]
    fn connection_open_input_with_jump_host_id() {
        let json = r#"{
            "host": "10.0.1.1",
            "port": 22,
            "protocol": "ssh",
            "username": "admin",
            "cols": 80,
            "rows": 24,
            "jumpHostId": "550e8400-e29b-41d4-a716-446655440000"
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(
            input.jump_host_id,
            Some("550e8400-e29b-41d4-a716-446655440000".into())
        );
    }

    /// [CONTRACT] ConnectionOpenInput without jump_host_id defaults to None.
    #[test]
    fn connection_open_input_without_jump_host_id() {
        let json = r#"{
            "host": "10.0.1.1",
            "port": 22,
            "protocol": "ssh",
            "cols": 80,
            "rows": 24
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.jump_host_id, None);
    }

    /// [CONTRACT] ConnectionOpenInput jump_host_id coexists with credential_id.
    #[test]
    fn connection_open_input_jump_host_with_credential() {
        let json = r#"{
            "host": "10.0.1.1",
            "port": 22,
            "protocol": "ssh",
            "username": "admin",
            "cols": 80,
            "rows": 24,
            "credentialId": "cred-abc",
            "jumpHostId": "jump-uuid"
        }"#;
        let input: super::ConnectionOpenInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.credential_id, Some("cred-abc".into()));
        assert_eq!(input.jump_host_id, Some("jump-uuid".into()));
    }
}
