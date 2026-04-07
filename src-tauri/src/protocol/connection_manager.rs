/// Connection manager — manages active protocol connections.
///
/// Routes IPC commands to the correct protocol connection.
/// Supports multiple protocol types (Telnet, Serial) via an enum
/// wrapper that dispatches to the correct implementation.
///
/// Thread-safe via `Arc<tokio::sync::Mutex<>>` since protocol
/// operations are async.
///
/// Uses `Connection` enum for protocol dispatch so each protocol
/// handles its own write/resize/close semantics natively.
use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use super::serial::config::SerialConfig;
use super::serial::SerialConnection;
use super::ssh::SshConnection;
use super::telnet::negotiation::{build_naws_subnegotiation, escape_iac};
use super::telnet::TelnetConnection;
use super::{
    ConnectionParams, EventEmitter, Protocol, ProtocolError, ProtocolType,
    TauriEventEmitter,
};
use crate::vault::VaultManager;

/// Maximum number of concurrent protocol connections.
const MAX_CONNECTIONS: usize = 64;

/// Protocol-specific connection wrapper.
///
/// Each variant owns a concrete connection implementation.
/// The enum dispatches to protocol-specific methods while allowing
/// the ConnectionManager to store heterogeneous connections
/// in a single HashMap.
enum ProtocolConnection {
    Telnet(TelnetConnection),
    Ssh(SshConnection),
    Serial(SerialConnection),
}

impl ProtocolConnection {
    fn is_connected(&self) -> bool {
        match self {
            Self::Telnet(c) => c.is_connected(),
            Self::Ssh(c) => c.is_connected(),
            Self::Serial(c) => c.is_connected(),
        }
    }

    /// Writes data using protocol-specific semantics.
    async fn write(&mut self, data: &[u8]) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(c) => {
                let writer = c.write_handle().ok_or_else(|| {
                    ProtocolError::ChannelClosed("not connected".into())
                })?;
                let escaped = escape_iac(data);
                let mut w = writer.lock().await;
                w.write_all(&escaped)
                    .await
                    .map_err(|e| ProtocolError::IoError(e.to_string()))?;
                w.flush()
                    .await
                    .map_err(|e| ProtocolError::IoError(e.to_string()))?;
                Ok(())
            }
            Self::Ssh(c) => c.write_bytes(data).await,
            Self::Serial(c) => c.write(data).await,
        }
    }

    /// Resizes terminal using protocol-specific semantics.
    async fn resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(c) => {
                let writer = c.write_handle().ok_or_else(|| {
                    ProtocolError::ChannelClosed("not connected".into())
                })?;
                let mut naws_msg = Vec::new();
                build_naws_subnegotiation(cols, rows, &mut naws_msg);
                let mut w = writer.lock().await;
                w.write_all(&naws_msg)
                    .await
                    .map_err(|e| ProtocolError::IoError(e.to_string()))?;
                w.flush()
                    .await
                    .map_err(|e| ProtocolError::IoError(e.to_string()))?;
                Ok(())
            }
            Self::Ssh(c) => c.send_resize(cols, rows).await,
            Self::Serial(conn) => conn.resize(cols, rows).await,
        }
    }

    /// Closes the connection using protocol-specific semantics.
    async fn close(&mut self) -> Result<(), ProtocolError> {
        match self {
            Self::Telnet(c) => c.close().await,
            Self::Ssh(c) => c.close().await,
            Self::Serial(conn) => conn.disconnect().await,
        }
    }

    /// Returns a clone of the serial writer handle (serial connections only).
    ///
    /// Used by ConnectionManager to run blocking operations (send_break)
    /// on a separate thread via tokio::task::spawn_blocking.
    fn serial_writer_handle(
        &self,
    ) -> Result<
        Arc<std::sync::Mutex<Box<dyn serialport::SerialPort>>>,
        ProtocolError,
    > {
        match self {
            Self::Serial(conn) => {
                conn.writer_handle().ok_or_else(|| {
                    ProtocolError::ChannelClosed(
                        "Not connected".into(),
                    )
                })
            }
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

    /// Opens an SSH connection with a pre-resolved vault password.
    ///
    /// The IPC layer retrieves the password from VaultManager before
    /// calling this, avoiding the need to pass VaultManager across
    /// async boundaries.
    pub async fn open_ssh_with_password(
        &self,
        params: ConnectionParams,
        app: tauri::AppHandle,
        vault_password: Option<String>,
    ) -> Result<String, ProtocolError> {
        self.open_ssh_with_emitter(
            params,
            Arc::new(TauriEventEmitter::new(app)),
            vault_password,
        )
        .await
    }

    /// Opens an SSH connection with a custom emitter (for testing).
    async fn open_ssh_with_emitter(
        &self,
        params: ConnectionParams,
        emitter: Arc<dyn EventEmitter>,
        vault_password: Option<String>,
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

        let mut conn = SshConnection::new();
        conn.connect_with_emitter(
            params,
            connection_id.clone(),
            emitter,
            vault_password,
        )
        .await?;

        let mut conns = self.connections.lock().await;
        conns.insert(
            connection_id.clone(),
            ProtocolConnection::Ssh(conn),
        );

        Ok(connection_id)
    }

    /// Opens a connection with VaultManager access (for SSH auth).
    #[allow(dead_code)]
    pub async fn open_with_vault(
        &self,
        params: ConnectionParams,
        protocol: ProtocolType,
        app: tauri::AppHandle,
        vault: Arc<VaultManager>,
    ) -> Result<String, ProtocolError> {
        match protocol {
            ProtocolType::Ssh => {
                // Extract password from vault before async
                let vault_password =
                    if let Some(ref cred_id) = params.credential_id
                    {
                        vault
                            .get_for_session(cred_id)
                            .ok()
                            .map(|c| c.secret.clone())
                    } else {
                        None
                    };
                self.open_ssh_with_emitter(
                    params,
                    Arc::new(TauriEventEmitter::new(app)),
                    vault_password,
                )
                .await
            }
            _ => self
                .open_with_emitter(
                    params,
                    protocol,
                    Arc::new(TauriEventEmitter::new(app)),
                )
                .await,
        }
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
                // SSH connections should use open_ssh_with_password()
                // or open_ssh_with_emitter() which accept a pre-resolved
                // vault password. This path is kept for backwards
                // compatibility with tests that don't use vault.
                return self
                    .open_ssh_with_emitter(
                        params, emitter, None,
                    )
                    .await;
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
    /// Delegates to protocol-specific write semantics:
    /// - Telnet: IAC escaping + raw TCP write
    /// - SSH: channel data message
    /// - Serial: raw byte write
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
    /// Delegates to protocol-specific resize semantics:
    /// - Telnet: NAWS subnegotiation
    /// - SSH: channel window change message
    /// - Serial: no-op
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
    /// Uses `spawn_blocking` to avoid blocking the tokio runtime
    /// during the 300ms break duration.
    pub async fn send_break(
        &self,
        connection_id: &str,
    ) -> Result<(), ProtocolError> {
        // Get the writer handle and drop the CM lock before blocking
        let writer = {
            let conns = self.connections.lock().await;
            let conn = conns.get(connection_id).ok_or_else(|| {
                ProtocolError::ChannelClosed(format!(
                    "Connection not found: {connection_id}"
                ))
            })?;
            conn.serial_writer_handle()?
        };
        // CM lock is dropped here — safe to block

        tokio::task::spawn_blocking(move || {
            use std::time::Duration;

            let port = writer.lock().map_err(|e| {
                ProtocolError::IoError(format!(
                    "Lock poisoned: {e}"
                ))
            })?;

            port.set_break().map_err(|e| {
                ProtocolError::IoError(format!(
                    "Failed to set break: {e}"
                ))
            })?;

            // Hold break for ~300ms (standard break duration)
            std::thread::sleep(Duration::from_millis(300));

            port.clear_break().map_err(|e| {
                ProtocolError::IoError(format!(
                    "Failed to clear break: {e}"
                ))
            })?;

            Ok(())
        })
        .await
        .map_err(|e| {
            ProtocolError::IoError(format!(
                "Break task failed: {e}"
            ))
        })?
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

    /// Opens an SFTP subsystem channel on an existing SSH connection.
    ///
    /// Returns a `russh::ChannelStream` suitable for initializing
    /// `russh_sftp::client::SftpSession`. The channel is opened on
    /// the SSH session and the "sftp" subsystem is requested.
    ///
    /// Must be called while holding no other locks on SftpManager to
    /// avoid deadlock. The returned stream is fully independent.
    pub async fn open_sftp_channel(
        &self,
        connection_id: &str,
    ) -> Result<russh::ChannelStream<russh::client::Msg>, ProtocolError> {
        let mut conns = self.connections.lock().await;
        let conn = conns.get_mut(connection_id).ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Connection not found: {connection_id}"
            ))
        })?;

        if !conn.is_connected() {
            return Err(ProtocolError::ChannelClosed(
                "SSH connection is not active".into(),
            ));
        }

        match conn {
            ProtocolConnection::Ssh(ssh_conn) => {
                let session = ssh_conn
                    .session_handle_mut()
                    .ok_or_else(|| {
                        ProtocolError::ChannelClosed(
                            "SSH session not connected".into(),
                        )
                    })?;

                // Open a new session channel for SFTP
                let channel = session
                    .channel_open_session()
                    .await
                    .map_err(|e| {
                        ProtocolError::ChannelClosed(format!(
                            "Failed to open SFTP channel: {e}"
                        ))
                    })?;

                // Request the "sftp" subsystem
                channel
                    .request_subsystem(true, "sftp")
                    .await
                    .map_err(|e| {
                        ProtocolError::ChannelClosed(format!(
                            "Failed to request SFTP subsystem: {e}"
                        ))
                    })?;

                Ok(channel.into_stream())
            }
            _ => Err(ProtocolError::InvalidParams(
                "SFTP is only supported for SSH connections"
                    .into(),
            )),
        }
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
    async fn open_ssh_to_unreachable_host_returns_error() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("192.0.2.1".into()), // TEST-NET — unreachable
            port: Some(22),
            username: Some("test".into()),
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = mgr
            .open_with_emitter(
                params,
                ProtocolType::Ssh,
                emitter,
            )
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
            credential_id: None,
            key_path: None,
        };
        let result = mgr
            .open_with_emitter(
                params,
                ProtocolType::Local,
                emitter,
            )
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
            credential_id: None,
            key_path: None,
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
            credential_id: None,
            key_path: None,
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
            credential_id: None,
            key_path: None,
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
            credential_id: None,
            key_path: None,
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
            credential_id: None,
            key_path: None,
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
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(
                params,
                ProtocolType::Telnet,
                emitter,
            )
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
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(
                params,
                ProtocolType::Telnet,
                emitter,
            )
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

    // ── QA Guardian — Integration & edge case tests ─────────────────

    /// [EDGE] Double close on same connection returns error.
    #[tokio::test]
    async fn double_close_returns_error() {
        use tokio::io::AsyncWriteExt;

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"OK\r\n").await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(200))
                .await;
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        // First close succeeds
        assert!(mgr.close(&conn_id).await.is_ok());

        // Second close should fail — connection already removed
        let result = mgr.close(&conn_id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not found"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }

        server.await.unwrap();
    }

    /// [EDGE] write to closed connection returns error.
    #[tokio::test]
    async fn write_to_closed_connection_returns_error() {
        use tokio::io::AsyncWriteExt;

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"OK\r\n").await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(200))
                .await;
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        mgr.close(&conn_id).await.unwrap();

        let result = mgr.write(&conn_id, b"data").await;
        assert!(result.is_err());

        server.await.unwrap();
    }

    /// [EDGE] build_serial_config with max u16 port casts to u32.
    #[test]
    fn build_serial_config_max_port_cast() {
        let params = ConnectionParams {
            host: Some("COM3".into()),
            port: Some(u16::MAX),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let config = build_serial_config(&params).unwrap();
        assert_eq!(config.baud_rate, u16::MAX as u32);
    }

    /// [EDGE] build_serial_config with port=0 maps to baud=0.
    #[test]
    fn build_serial_config_zero_port_maps_to_zero_baud() {
        let params = ConnectionParams {
            host: Some("COM3".into()),
            port: Some(0),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let config = build_serial_config(&params).unwrap();
        // Port 0 maps to baud 0 — validation will catch this later
        assert_eq!(config.baud_rate, 0);
    }

    /// [EDGE] send_break on nonexistent connection returns proper error.
    #[tokio::test]
    async fn send_break_nonexistent_error_message() {
        let mgr = ConnectionManager::new();
        let result = mgr.send_break("ghost-id-123").await;
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not found"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    /// [INTEGRATION] send_break on a telnet connection returns InvalidParams.
    #[tokio::test]
    async fn send_break_on_telnet_returns_invalid_params() {
        use tokio::io::AsyncWriteExt;

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"OK\r\n").await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(500))
                .await;
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        let result = mgr.send_break(&conn_id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("serial"));
            }
            other => {
                panic!("Expected InvalidParams, got: {other:?}")
            }
        }

        mgr.close(&conn_id).await.unwrap();
        server.await.unwrap();
    }

    /// [EDGE] connection count tracks correctly after failed opens.
    #[tokio::test]
    async fn count_unchanged_after_failed_open() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());

        assert_eq!(mgr.count().await, 0);

        // Attempt to open a nonexistent serial port — should fail
        let config = SerialConfig {
            port: "/dev/ttyNONEXISTENT_COUNT".into(),
            ..SerialConfig::default()
        };
        let _ = mgr.open_serial_with_emitter(config, emitter).await;

        // Count should still be 0 after failed open
        assert_eq!(mgr.count().await, 0);
    }

    /// [EDGE] is_connected returns false after close.
    #[tokio::test]
    async fn is_connected_false_after_close() {
        use tokio::io::AsyncWriteExt;

        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"OK\r\n").await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(200))
                .await;
        });

        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let conn_id = mgr
            .open_with_emitter(params, ProtocolType::Telnet, emitter)
            .await
            .unwrap();

        assert!(mgr.is_connected(&conn_id).await);

        mgr.close(&conn_id).await.unwrap();

        // Should be false — connection removed
        assert!(!mgr.is_connected(&conn_id).await);

        server.await.unwrap();
    }
}
