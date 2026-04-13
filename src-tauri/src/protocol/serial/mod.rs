/// Serial protocol connection — direct serial port access.
///
/// Implements the `Protocol` trait for serial port communication.
/// Used for console connections to network equipment (Cisco, Juniper, etc.)
/// and embedded devices.
///
/// Architecture:
/// - On `connect()`: open serial port → clone for read → spawn OS thread
/// - Read thread: blocking reads → Tauri events (`connection-output-{id}`)
/// - Write: raw bytes to serial port (no protocol encoding)
/// - Resize: no-op (serial has no terminal size concept)
/// - Send break: serial break signal (Ctrl+Break equivalent)
pub mod config;
pub mod scanner;

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;

use super::telnet::EventEmitter;
use super::{
    ConnectionParams, ConnectionStatus, ConnectionStatusPayload, Protocol, ProtocolError,
    ProtocolType,
};
use config::SerialConfig;

/// Read buffer size for serial port reads.
const READ_BUFFER_SIZE: usize = 1024;

/// Serial port read timeout in milliseconds.
///
/// Short timeout allows the read loop to check the `connected` flag
/// periodically and detect disconnection promptly.
const READ_TIMEOUT_MS: u64 = 100;

/// A serial port connection.
///
/// Manages the lifecycle of a serial port with a background read thread.
/// Thread-safe — the write handle is shared between Protocol methods
/// and can be accessed concurrently.
pub struct SerialConnection {
    /// Write handle to the serial port (None when disconnected).
    writer: Option<Arc<StdMutex<Box<dyn serialport::SerialPort>>>>,
    /// Whether the connection is currently active.
    connected: Arc<AtomicBool>,
    /// Handle to the read thread (for cleanup on disconnect).
    /// Wrapped in Arc<StdMutex> so SerialConnection is naturally
    /// Send + Sync without unsafe impls.
    read_thread: Arc<StdMutex<Option<std::thread::JoinHandle<()>>>>,
    /// Serial configuration used for this connection.
    config: SerialConfig,
}

impl SerialConnection {
    /// Creates a new disconnected SerialConnection.
    pub fn new() -> Self {
        Self {
            writer: None,
            connected: Arc::new(AtomicBool::new(false)),
            read_thread: Arc::new(StdMutex::new(None)),
            config: SerialConfig::default(),
        }
    }

    /// Connects to a serial port and starts the read loop.
    ///
    /// This is the main entry point — it takes an EventEmitter to
    /// decouple from Tauri for testing.
    pub fn connect_with_emitter(
        &mut self,
        config: SerialConfig,
        connection_id: String,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<(), ProtocolError> {
        config.validate().map_err(ProtocolError::InvalidParams)?;

        self.config = config.clone();

        // Emit connecting status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connecting,
                message: Some(format!("Opening {}...", config.port)),
            },
        );

        // Open the serial port
        let port = serialport::new(&config.port, config.baud_rate)
            .data_bits(config.data_bits.into())
            .parity(config.parity.into())
            .stop_bits(config.stop_bits.into())
            .flow_control(config.flow_control.into())
            .timeout(Duration::from_millis(READ_TIMEOUT_MS))
            .open()
            .map_err(|e| map_serial_error(&config.port, e))?;

        // Clone for read thread — shares the underlying OS file descriptor
        let reader = port
            .try_clone()
            .map_err(|e| ProtocolError::IoError(format!("Failed to clone serial port: {e}")))?;

        let writer = Arc::new(StdMutex::new(port));
        self.writer = Some(writer);
        self.connected.store(true, Ordering::SeqCst);

        // Emit connected status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connected,
                message: None,
            },
        );

        // Spawn the blocking read loop on an OS thread
        let connected_flag = self.connected.clone();
        let read_thread = std::thread::Builder::new()
            .name(format!("serial-read-{}", &connection_id[..8]))
            .spawn(move || {
                read_loop(reader, connection_id, emitter, connected_flag);
            })
            .map_err(|e| ProtocolError::IoError(format!("Failed to spawn read thread: {e}")))?;

        self.read_thread.lock().unwrap().replace(read_thread);
        Ok(())
    }

    /// Sends a break signal on the serial port.
    ///
    /// A serial break is a sustained low-level signal used by some
    /// equipment (Cisco routers) to enter ROM monitor mode.
    #[allow(dead_code)]
    pub fn send_break(&self) -> Result<(), ProtocolError> {
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| ProtocolError::ChannelClosed("Not connected".into()))?;

        let port = writer
            .lock()
            .map_err(|e| ProtocolError::IoError(format!("Lock poisoned: {e}")))?;

        port.set_break()
            .map_err(|e| ProtocolError::IoError(format!("Failed to set break: {e}")))?;

        // Hold break for ~300ms (standard break duration)
        std::thread::sleep(Duration::from_millis(300));

        port.clear_break()
            .map_err(|e| ProtocolError::IoError(format!("Failed to clear break: {e}")))?;

        Ok(())
    }

    /// Returns a clone of the writer handle for external use.
    ///
    /// Used by ConnectionManager to run blocking send_break on
    /// a tokio spawn_blocking thread.
    pub fn writer_handle(&self) -> Option<Arc<StdMutex<Box<dyn serialport::SerialPort>>>> {
        self.writer.clone()
    }

    /// Returns the serial configuration.
    #[allow(dead_code)]
    pub fn serial_config(&self) -> &SerialConfig {
        &self.config
    }
}

#[async_trait]
impl Protocol for SerialConnection {
    async fn connect(&mut self, _params: ConnectionParams) -> Result<(), ProtocolError> {
        // Serial connections use connect_with_emitter() instead.
        // This is here to satisfy the Protocol trait.
        Err(ProtocolError::InvalidParams(
            "Use connect_with_emitter() for serial connections".into(),
        ))
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), ProtocolError> {
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| ProtocolError::ChannelClosed("Not connected".into()))?;

        let mut port = writer
            .lock()
            .map_err(|e| ProtocolError::IoError(format!("Lock poisoned: {e}")))?;

        port.write_all(data)
            .map_err(|e| ProtocolError::IoError(format!("Write failed: {e}")))?;

        port.flush()
            .map_err(|e| ProtocolError::IoError(format!("Flush failed: {e}")))?;

        Ok(())
    }

    async fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), ProtocolError> {
        // Serial connections have no terminal size concept — no-op.
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ProtocolError> {
        self.connected.store(false, Ordering::SeqCst);

        // Drop the writer to close the port
        self.writer.take();

        // Wait for the read thread to finish
        if let Some(handle) = self.read_thread.lock().unwrap().take() {
            // The read thread should exit quickly once connected is false
            // and the port is closed
            let _ = handle.join();
        }

        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    fn protocol_type(&self) -> ProtocolType {
        ProtocolType::Serial
    }
}

/// Blocking read loop that runs on an OS thread.
///
/// Reads data from the serial port and emits it as base64-encoded
/// events via the EventEmitter. Exits when the connected flag is
/// set to false or when the port returns an error.
fn read_loop(
    mut reader: Box<dyn serialport::SerialPort>,
    connection_id: String,
    emitter: Arc<dyn EventEmitter>,
    connected: Arc<AtomicBool>,
) {
    let mut buf = [0u8; READ_BUFFER_SIZE];

    loop {
        if !connected.load(Ordering::SeqCst) {
            break;
        }

        match reader.read(&mut buf) {
            Ok(0) => {
                // EOF — port closed
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some("Serial port closed".into()),
                    },
                );
                break;
            }
            Ok(n) => {
                let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                emitter.emit_output(&connection_id, &data);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                // Read timeout — normal for serial with timeout set.
                // Just loop again to check the connected flag.
                continue;
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::BrokenPipe
                    || e.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                // USB adapter disconnected or port forcibly closed
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some("Serial port disconnected (USB adapter removed?)".into()),
                    },
                );
                break;
            }
            Err(e) => {
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Error,
                        message: Some(format!("Serial read error: {e}")),
                    },
                );
                break;
            }
        }
    }
}

/// Maps serialport crate errors to ProtocolError with helpful messages.
fn map_serial_error(port_path: &str, error: serialport::Error) -> ProtocolError {
    match error.kind {
        serialport::ErrorKind::NoDevice => {
            ProtocolError::ConnectionRefused(format!("Serial port not found: {port_path}"))
        }
        serialport::ErrorKind::InvalidInput => {
            ProtocolError::InvalidParams(format!("Invalid serial port parameters: {error}"))
        }
        serialport::ErrorKind::Io(io_kind) => match io_kind {
            std::io::ErrorKind::PermissionDenied => {
                #[cfg(target_os = "linux")]
                let hint = format!(
                    "Permission denied: {port_path}. \
                     Try: sudo usermod -a -G dialout $USER \
                     (then log out and back in)"
                );
                #[cfg(not(target_os = "linux"))]
                let hint = format!(
                    "Permission denied: {port_path}. \
                     Check that no other application is using this port."
                );
                ProtocolError::ConnectionRefused(hint)
            }
            std::io::ErrorKind::AddrInUse | std::io::ErrorKind::AlreadyExists => {
                ProtocolError::ConnectionRefused(format!(
                    "Port {port_path} is already in use by another application"
                ))
            }
            _ => ProtocolError::IoError(format!("Failed to open {port_path}: {error}")),
        },
        _ => ProtocolError::IoError(format!("Failed to open {port_path}: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::test_utils::MockEmitter;

    // ====================================================================
    // SerialConnection unit tests
    // ====================================================================

    #[test]
    fn new_connection_is_disconnected() {
        let conn = SerialConnection::new();
        assert!(!conn.is_connected());
    }

    #[test]
    fn new_connection_has_serial_protocol_type() {
        let conn = SerialConnection::new();
        assert_eq!(conn.protocol_type(), ProtocolType::Serial);
    }

    #[test]
    fn new_connection_has_default_config() {
        let conn = SerialConnection::new();
        assert_eq!(conn.serial_config().baud_rate, 9600);
    }

    #[tokio::test]
    async fn write_when_disconnected_returns_error() {
        let mut conn = SerialConnection::new();
        let result = conn.write(b"hello").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("Not connected"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn resize_is_noop() {
        let mut conn = SerialConnection::new();
        // Resize should succeed even when disconnected (it's a no-op)
        let result = conn.resize(120, 40).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn disconnect_when_not_connected_succeeds() {
        let mut conn = SerialConnection::new();
        let result = conn.disconnect().await;
        assert!(result.is_ok());
    }

    #[test]
    fn send_break_when_disconnected_returns_error() {
        let conn = SerialConnection::new();
        let result = conn.send_break();
        assert!(result.is_err());
    }

    // ====================================================================
    // connect_with_emitter validation tests
    // ====================================================================

    #[test]
    fn connect_rejects_empty_port() {
        let mut conn = SerialConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = SerialConfig::default(); // empty port
        let result = conn.connect_with_emitter(config, "test-id".into(), emitter);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("port"));
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    #[test]
    fn connect_rejects_zero_baud_rate() {
        let mut conn = SerialConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = SerialConfig {
            port: "/dev/ttyUSB0".into(),
            baud_rate: 0,
            ..Default::default()
        };
        let result = conn.connect_with_emitter(config, "test-id".into(), emitter);
        assert!(result.is_err());
    }

    #[test]
    fn connect_to_nonexistent_port_returns_error() {
        let mut conn = SerialConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = SerialConfig {
            port: "/dev/ttyNONEXISTENT99".into(),
            ..Default::default()
        };
        let result = conn.connect_with_emitter(config, "test-id".into(), emitter.clone());
        assert!(result.is_err());

        // Should have emitted connecting status before failing
        let statuses = emitter.statuses.lock().unwrap();
        assert!(
            !statuses.is_empty(),
            "Expected at least one status emission"
        );
        assert_eq!(statuses[0].1.status, ConnectionStatus::Connecting);
    }

    // ====================================================================
    // map_serial_error tests
    // ====================================================================

    #[test]
    fn map_error_no_device() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::NoDevice,
            description: "not found".into(),
        };
        let result = map_serial_error("/dev/ttyUSB0", err);
        match result {
            ProtocolError::ConnectionRefused(msg) => {
                assert!(msg.contains("not found"));
                assert!(msg.contains("/dev/ttyUSB0"));
            }
            other => {
                panic!("Expected ConnectionRefused, got: {other:?}")
            }
        }
    }

    #[test]
    fn map_error_invalid_input() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::InvalidInput,
            description: "bad baud".into(),
        };
        let result = map_serial_error("COM3", err);
        match result {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("Invalid"));
            }
            other => {
                panic!("Expected InvalidParams, got: {other:?}")
            }
        }
    }

    #[test]
    fn map_error_permission_denied() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied),
            description: "permission denied".into(),
        };
        let result = map_serial_error("/dev/ttyUSB0", err);
        match result {
            ProtocolError::ConnectionRefused(msg) => {
                assert!(msg.contains("Permission denied"));
            }
            other => {
                panic!("Expected ConnectionRefused, got: {other:?}")
            }
        }
    }

    #[test]
    fn map_error_port_in_use() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::Io(std::io::ErrorKind::AlreadyExists),
            description: "in use".into(),
        };
        let result = map_serial_error("COM3", err);
        match result {
            ProtocolError::ConnectionRefused(msg) => {
                assert!(msg.contains("already in use"));
            }
            other => {
                panic!("Expected ConnectionRefused, got: {other:?}")
            }
        }
    }

    #[test]
    fn map_error_generic_io() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::Io(std::io::ErrorKind::Other),
            description: "something failed".into(),
        };
        let result = map_serial_error("/dev/ttyS0", err);
        match result {
            ProtocolError::IoError(msg) => {
                assert!(msg.contains("/dev/ttyS0"));
            }
            other => panic!("Expected IoError, got: {other:?}"),
        }
    }

    // ====================================================================
    // QA Guardian — Edge case & integration tests
    // ====================================================================

    /// [EDGE] Protocol::connect() returns informative error directing
    /// users to connect_with_emitter().
    #[tokio::test]
    async fn protocol_connect_returns_informative_error() {
        let mut conn = SerialConnection::new();
        let params = ConnectionParams {
            host: Some("/dev/ttyUSB0".into()),
            port: None,
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = conn.connect(params).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(
                    msg.contains("connect_with_emitter"),
                    "Error should mention the correct method"
                );
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    /// [EDGE] Disconnect when already disconnected is idempotent.
    #[tokio::test]
    async fn disconnect_idempotent() {
        let mut conn = SerialConnection::new();
        // Disconnect twice — should not panic or error
        assert!(conn.disconnect().await.is_ok());
        assert!(conn.disconnect().await.is_ok());
        assert!(!conn.is_connected());
    }

    /// [EDGE] Write after disconnect returns ChannelClosed.
    #[tokio::test]
    async fn write_after_disconnect_returns_channel_closed() {
        let mut conn = SerialConnection::new();
        let _ = conn.disconnect().await;
        let result = conn.write(b"test").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(_) => {}
            other => {
                panic!("Expected ChannelClosed, got: {other:?}")
            }
        }
    }

    /// [EDGE] Resize when disconnected still succeeds (no-op).
    #[tokio::test]
    async fn resize_when_disconnected_succeeds() {
        let mut conn = SerialConnection::new();
        assert!(conn.resize(200, 50).await.is_ok());
    }

    /// [EDGE] Resize with extreme values succeeds (serial is no-op).
    #[tokio::test]
    async fn resize_with_extreme_values_succeeds() {
        let mut conn = SerialConnection::new();
        assert!(conn.resize(u16::MAX, u16::MAX).await.is_ok());
        assert!(conn.resize(0, 0).await.is_ok());
    }

    /// [EDGE] Send break with empty data returns not connected error.
    #[test]
    fn send_break_error_message_includes_not_connected() {
        let conn = SerialConnection::new();
        let result = conn.send_break();
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("Not connected"));
            }
            other => {
                panic!("Expected ChannelClosed, got: {other:?}")
            }
        }
    }

    /// [CONTRACT] serial_config() returns the default config for new connections.
    #[test]
    fn serial_config_returns_default_for_new() {
        let conn = SerialConnection::new();
        let config = conn.serial_config();
        assert_eq!(config.baud_rate, 9600);
        assert_eq!(config.data_bits, config::SerialDataBits::Eight);
        assert_eq!(config.parity, config::SerialParity::None);
        assert_eq!(config.stop_bits, config::SerialStopBits::One);
        assert_eq!(config.flow_control, config::SerialFlowControl::None);
    }

    /// [EDGE] connect_with_emitter emits Connecting status before failing.
    #[test]
    fn connect_emits_connecting_before_port_error() {
        let mut conn = SerialConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = config::SerialConfig {
            port: "/dev/ttyNONEXISTENT_QA".into(),
            ..Default::default()
        };
        let _ = conn.connect_with_emitter(config, "qa-test-id".into(), emitter.clone());

        let statuses = emitter.statuses.lock().unwrap();
        assert!(!statuses.is_empty());
        assert_eq!(statuses[0].1.status, ConnectionStatus::Connecting);
        // Should include port name in the connecting message
        if let Some(ref msg) = statuses[0].1.message {
            assert!(msg.contains("NONEXISTENT_QA"));
        }
    }

    /// [EDGE] map_serial_error for AddrInUse io error.
    #[test]
    fn map_error_addr_in_use() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::Io(std::io::ErrorKind::AddrInUse),
            description: "address in use".into(),
        };
        let result = map_serial_error("COM1", err);
        match result {
            ProtocolError::ConnectionRefused(msg) => {
                assert!(msg.contains("already in use"));
                assert!(msg.contains("COM1"));
            }
            other => {
                panic!("Expected ConnectionRefused, got: {other:?}")
            }
        }
    }

    /// [EDGE] map_serial_error for catch-all error kind.
    #[test]
    fn map_error_unknown_kind() {
        let err = serialport::Error {
            kind: serialport::ErrorKind::Unknown,
            description: "mystery error".into(),
        };
        let result = map_serial_error("/dev/ttyS0", err);
        match result {
            ProtocolError::IoError(msg) => {
                assert!(msg.contains("/dev/ttyS0"));
            }
            other => panic!("Expected IoError, got: {other:?}"),
        }
    }
}
