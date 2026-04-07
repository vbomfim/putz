/// Connection manager — manages active protocol connections.
///
/// Routes IPC commands to the correct protocol connection.
/// Supports multiple protocol types (Telnet, Serial) via an enum
/// wrapper that dispatches to the correct implementation.
///
/// Thread-safe via `Arc<tokio::sync::Mutex<>>` since protocol
/// operations are async.
use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use super::serial::config::SerialConfig;
use super::serial::SerialConnection;
use super::telnet::{EventEmitter, TauriEventEmitter, TelnetConnection};
use super::{ConnectionParams, Protocol, ProtocolError, ProtocolType};

/// Maximum number of concurrent protocol connections.
const MAX_CONNECTIONS: usize = 64;

/// Wrapper enum for protocol connection types.
///
/// Each variant owns a concrete connection implementation.
/// The enum dispatches to protocol-specific methods while allowing
/// the ConnectionManager to store heterogeneous connections
/// in a single HashMap.
enum ProtocolConnection {
    Telnet(TelnetConnection),
    Serial(SerialConnection),
}

impl ProtocolConnection {
    /// Writes data to the connection using protocol-specific encoding.
    async fn write(&mut self, data: &[u8]) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(conn) => conn.write(data).await,
            Self::Serial(conn) => conn.write(data).await,
        }
    }

    /// Resizes the terminal (protocol-specific behavior).
    async fn resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(conn) => conn.resize(cols, rows).await,
            Self::Serial(conn) => conn.resize(cols, rows).await,
        }
    }

    /// Closes the connection.
    async fn close(&mut self) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(conn) => conn.close().await,
            Self::Serial(conn) => conn.disconnect().await,
        }
    }

    /// Returns whether the connection is currently active.
    fn is_connected(&self) -> bool {
        match self {
            Self::Telnet(conn) => conn.is_connected(),
            Self::Serial(conn) => conn.is_connected(),
        }
    }

    /// Sends a serial break signal (serial connections only).
    fn send_break(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Serial(conn) => conn.send_break(),
            _ => Err(ProtocolError::InvalidParams(
                "Break signal is only supported for serial connections"
                    .into(),
            )),
        }
    }
}

/// Manages all active protocol connections.
///
/// Accessed from Tauri IPC command handlers. Uses `tokio::sync::Mutex`
/// because protocol operations are async.
pub struct ConnectionManager {
    connections: Arc<TokioMutex<HashMap<String, ProtocolConnection>>>,
}

impl ConnectionManager {
    /// Creates a new empty connection manager.
    pub fn new() -> Self {
        Self {
            connections: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    /// Opens a new protocol connection.
    ///
    /// Returns the generated connection ID on success.
    pub async fn open(
        &self,
        params: ConnectionParams,
        protocol: ProtocolType,
        app: tauri::AppHandle,
    ) -> Result<String, ProtocolError> {
        self.open_with_emitter(
            params,
            protocol,
            Arc::new(TauriEventEmitter::new(app)),
        )
        .await
    }

    /// Opens a connection with a custom event emitter (for testing).
    pub async fn open_with_emitter(
        &self,
        params: ConnectionParams,
        protocol: ProtocolType,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, ProtocolError> {
        // Check connection limit
        {
            let conns = self.connections.lock().await;
            if conns.len() >= MAX_CONNECTIONS {
                return Err(ProtocolError::InvalidParams(format!(
                    "Maximum connections reached ({MAX_CONNECTIONS})"
                )));
            }
        }

        let connection_id = Uuid::new_v4().to_string();

        match protocol {
            ProtocolType::Telnet => {
                let mut conn = TelnetConnection::new();
                conn.connect_with_emitter(
                    params,
                    connection_id.clone(),
                    emitter,
                )
                .await?;

                let mut conns = self.connections.lock().await;
                conns.insert(
                    connection_id.clone(),
                    ProtocolConnection::Telnet(conn),
                );
            }
            ProtocolType::Serial => {
                let config = build_serial_config(&params)?;
                let mut conn = SerialConnection::new();
                conn.connect_with_emitter(
                    config,
                    connection_id.clone(),
                    emitter,
                )?;

                let mut conns = self.connections.lock().await;
                conns.insert(
                    connection_id.clone(),
                    ProtocolConnection::Serial(conn),
                );
            }
            ProtocolType::Ssh => {
                return Err(ProtocolError::InvalidParams(
                    "SSH protocol not yet implemented".into(),
                ));
            }
            ProtocolType::Local => {
                return Err(ProtocolError::InvalidParams(
                    "Local sessions use PTY, not ConnectionManager"
                        .into(),
                ));
            }
        }

        Ok(connection_id)
    }

    /// Opens a serial connection with explicit serial configuration.
    ///
    /// Unlike `open()`, this takes a `SerialConfig` directly instead of
    /// mapping from `ConnectionParams`. Used by IPC when serial-specific
    /// parameters (data bits, parity, etc.) are provided.
    pub async fn open_serial(
        &self,
        config: SerialConfig,
        app: tauri::AppHandle,
    ) -> Result<String, ProtocolError> {
        self.open_serial_with_emitter(
            config,
            Arc::new(TauriEventEmitter::new(app)),
        )
        .await
    }

    /// Opens a serial connection with explicit config and custom emitter.
    pub async fn open_serial_with_emitter(
        &self,
        config: SerialConfig,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, ProtocolError> {
        {
            let conns = self.connections.lock().await;
            if conns.len() >= MAX_CONNECTIONS {
                return Err(ProtocolError::InvalidParams(format!(
                    "Maximum connections reached ({MAX_CONNECTIONS})"
                )));
            }
        }

        let connection_id = Uuid::new_v4().to_string();
        let mut conn = SerialConnection::new();
        conn.connect_with_emitter(
            config,
            connection_id.clone(),
            emitter,
        )?;

        let mut conns = self.connections.lock().await;
        conns.insert(
            connection_id.clone(),
            ProtocolConnection::Serial(conn),
        );

        Ok(connection_id)
    }

    /// Writes data to an active connection.
    ///
    /// Protocol-specific encoding (e.g., IAC escaping for Telnet)
    /// is handled internally by each protocol implementation.
    pub async fn write(
        &self,
        connection_id: &str,
        data: &[u8],
    ) -> Result<(), ProtocolError> {
        let mut conns = self.connections.lock().await;
        let conn = conns.get_mut(connection_id).ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Connection not found: {connection_id}"
            ))
        })?;

        if !conn.is_connected() {
            return Err(ProtocolError::ChannelClosed(
                "Connection is closed".into(),
            ));
        }

        conn.write(data).await
    }

    /// Resizes the terminal for an active connection.
    ///
    /// For Telnet, sends NAWS subnegotiation.
    /// For Serial, this is a no-op.
    pub async fn resize(
        &self,
        connection_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        let mut conns = self.connections.lock().await;
        let conn = conns.get_mut(connection_id).ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Connection not found: {connection_id}"
            ))
        })?;

        conn.resize(cols, rows).await
    }

    /// Closes an active connection and removes it from the manager.
    pub async fn close(
        &self,
        connection_id: &str,
    ) -> Result<(), ProtocolError> {
        let mut conns = self.connections.lock().await;
        let mut conn =
            conns.remove(connection_id).ok_or_else(|| {
                ProtocolError::ChannelClosed(format!(
                    "Connection not found: {connection_id}"
                ))
            })?;

        conn.close().await
    }

    /// Sends a serial break signal to a connection.
    ///
    /// Only valid for serial connections — returns an error for other types.
    pub async fn send_break(
        &self,
        connection_id: &str,
    ) -> Result<(), ProtocolError> {
        let conns = self.connections.lock().await;
        let conn = conns.get(connection_id).ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Connection not found: {connection_id}"
            ))
        })?;

        conn.send_break()
    }

    /// Returns whether a connection exists and is active.
    #[allow(dead_code)]
    pub async fn is_connected(&self, connection_id: &str) -> bool {
        let conns = self.connections.lock().await;
        conns
            .get(connection_id)
            .map(|c| c.is_connected())
            .unwrap_or(false)
    }

    /// Returns the number of active connections.
    #[allow(dead_code)]
    pub async fn count(&self) -> usize {
        self.connections.lock().await.len()
    }
}

/// Builds a `SerialConfig` from generic `ConnectionParams`.
///
/// Maps:
/// - `params.host` → serial port path
/// - `params.port` → baud rate (if provided as u16, cast to u32)
///
/// Uses defaults for data bits, parity, stop bits, and flow control.
fn build_serial_config(
    params: &ConnectionParams,
) -> Result<SerialConfig, ProtocolError> {
    let port = params
        .host
        .as_deref()
        .ok_or_else(|| {
            ProtocolError::InvalidParams(
                "Serial port path is required (set as host)".into(),
            )
        })?
        .to_string();

    let baud_rate = params.port.map(|p| p as u32).unwrap_or(9600);

    Ok(SerialConfig {
        port,
        baud_rate,
        ..SerialConfig::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::test_utils::MockEmitter;

    // ── Unit tests ────────────────────────────────────────────────────

    #[tokio::test]
    async fn new_manager_has_no_connections() {
        let mgr = ConnectionManager::new();
        assert_eq!(mgr.count().await, 0);
    }

    #[tokio::test]
    async fn open_ssh_returns_not_implemented() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("localhost".into()),
            port: Some(22),
            username: None,
            cols: 80,
            rows: 24,
        };
        let result = mgr
            .open_with_emitter(params, ProtocolType::Ssh, emitter)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_local_returns_error() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: None,
            port: None,
            username: None,
            cols: 80,
            rows: 24,
        };
        let result = mgr
            .open_with_emitter(params, ProtocolType::Local, emitter)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_serial_without_port_path_returns_error() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: None,
            port: None,
            username: None,
            cols: 80,
            rows: 24,
        };
        let result = mgr
            .open_with_emitter(params, ProtocolType::Serial, emitter)
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("port path"));
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn open_serial_with_nonexistent_port_returns_error() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("/dev/ttyNONEXISTENT99".into()),
            port: None,
            username: None,
            cols: 80,
            rows: 24,
        };
        let result = mgr
            .open_with_emitter(params, ProtocolType::Serial, emitter)
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn write_nonexistent_connection_returns_error() {
        let mgr = ConnectionManager::new();
        let result = mgr.write("nonexistent-id", b"hello").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not found"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn resize_nonexistent_connection_returns_error() {
        let mgr = ConnectionManager::new();
        let result = mgr.resize("nonexistent-id", 120, 40).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn close_nonexistent_connection_returns_error() {
        let mgr = ConnectionManager::new();
        let result = mgr.close("nonexistent-id").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn is_connected_returns_false_for_nonexistent() {
        let mgr = ConnectionManager::new();
        assert!(!mgr.is_connected("nonexistent-id").await);
    }

    #[tokio::test]
    async fn send_break_nonexistent_returns_error() {
        let mgr = ConnectionManager::new();
        let result = mgr.send_break("nonexistent-id").await;
        assert!(result.is_err());
    }

    // ── build_serial_config tests ────────────────────────────────────

    #[test]
    fn build_serial_config_maps_host_to_port() {
        let params = ConnectionParams {
            host: Some("/dev/ttyUSB0".into()),
            port: None,
            username: None,
            cols: 80,
            rows: 24,
        };
        let config = build_serial_config(&params).unwrap();
        assert_eq!(config.port, "/dev/ttyUSB0");
        assert_eq!(config.baud_rate, 9600); // default
    }

    #[test]
    fn build_serial_config_maps_port_to_baud_rate() {
        let params = ConnectionParams {
            host: Some("COM3".into()),
            port: Some(115), // Will be cast to u32 → 115
            username: None,
            cols: 80,
            rows: 24,
        };
        let config = build_serial_config(&params).unwrap();
        assert_eq!(config.baud_rate, 115);
    }

    #[test]
    fn build_serial_config_requires_host() {
        let params = ConnectionParams {
            host: None,
            port: None,
            username: None,
            cols: 80,
            rows: 24,
        };
        assert!(build_serial_config(&params).is_err());
    }

    // ── Integration test with mock TCP server (Telnet) ───────────────

    #[tokio::test]
    async fn open_telnet_connection_to_local_server() {
        use tokio::io::AsyncWriteExt;

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"Hello\r\n").await.unwrap();
            stream.flush().await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(200))
                .await;
            let _ = stream.shutdown().await;
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        assert!(mgr.is_connected(&conn_id).await);
        assert_eq!(mgr.count().await, 1);

        // Clean up
        mgr.close(&conn_id).await.unwrap();
        assert!(!mgr.is_connected(&conn_id).await);
        assert_eq!(mgr.count().await, 0);

        server.await.unwrap();
    }

    #[tokio::test]
    async fn write_and_resize_active_connection() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            loop {
                match tokio::time::timeout(
                    tokio::time::Duration::from_millis(500),
                    stream.read(&mut buf),
                )
                .await
                {
                    Ok(Ok(0)) | Err(_) => break,
                    Ok(Ok(_)) => continue,
                    Ok(Err(_)) => break,
                }
            }
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        // Write
        mgr.write(&conn_id, b"test data").await.unwrap();

        // Resize
        mgr.resize(&conn_id, 120, 40).await.unwrap();

        // Send break on telnet connection should fail
        let break_result = mgr.send_break(&conn_id).await;
        assert!(break_result.is_err());

        mgr.close(&conn_id).await.unwrap();
        server.await.unwrap();
    }

    // ── open_serial_with_emitter tests ──────────────────────────────

    #[tokio::test]
    async fn open_serial_with_emitter_validates_config() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = SerialConfig::default(); // empty port
        let result =
            mgr.open_serial_with_emitter(config, emitter).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_serial_with_emitter_nonexistent_port() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let config = SerialConfig {
            port: "/dev/ttyNONEXISTENT99".into(),
            ..SerialConfig::default()
        };
        let result =
            mgr.open_serial_with_emitter(config, emitter).await;
        assert!(result.is_err());
    }
}
