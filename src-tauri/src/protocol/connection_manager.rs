/// Connection manager — manages active protocol connections.
///
/// Routes IPC commands to the correct protocol connection.
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
/// Each variant handles its own I/O semantics:
/// - Telnet: IAC escaping, NAWS subnegotiation
/// - SSH: channel data, window change messages
enum Connection {
    Telnet(TelnetConnection),
    Ssh(SshConnection),
}

impl Connection {
    fn is_connected(&self) -> bool {
        match self {
            Connection::Telnet(c) => c.is_connected(),
            Connection::Ssh(c) => c.is_connected(),
        }
    }

    /// Writes data using protocol-specific semantics.
    async fn write(&self, data: &[u8]) -> Result<(), ProtocolError> {
        match self {
            Connection::Telnet(c) => {
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
            Connection::Ssh(c) => c.write_bytes(data).await,
        }
    }

    /// Resizes terminal using protocol-specific semantics.
    async fn resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        match self {
            Connection::Telnet(c) => {
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
            Connection::Ssh(c) => c.send_resize(cols, rows).await,
        }
    }

    /// Closes the connection using protocol-specific semantics.
    async fn close(&mut self) -> Result<(), ProtocolError> {
        match self {
            Connection::Telnet(c) => c.close().await,
            Connection::Ssh(c) => c.close().await,
        }
    }
}

/// Manages all active protocol connections.
///
/// Accessed from Tauri IPC command handlers. Uses `tokio::sync::Mutex`
/// because protocol operations are async.
pub struct ConnectionManager {
    connections: Arc<TokioMutex<HashMap<String, Connection>>>,
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
            Connection::Ssh(conn),
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
                    Connection::Telnet(conn),
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
            ProtocolType::Serial => {
                return Err(ProtocolError::InvalidParams(
                    "Serial protocol not yet implemented".into(),
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

    /// Writes data to an active connection.
    ///
    /// Delegates to protocol-specific write semantics:
    /// - Telnet: IAC escaping + raw TCP write
    /// - SSH: channel data message
    pub async fn write(
        &self,
        connection_id: &str,
        data: &[u8],
    ) -> Result<(), ProtocolError> {
        let conns = self.connections.lock().await;
        let conn = conns.get(connection_id).ok_or_else(|| {
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
        let mut conn = conns.remove(connection_id).ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Connection not found: {connection_id}"
            ))
        })?;

        conn.close().await
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
    async fn open_serial_returns_not_implemented() {
        let mgr = ConnectionManager::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("/dev/ttyS0".into()),
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
                ProtocolType::Serial,
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

    // ── Integration test with mock TCP server ─────────────────────────

    #[tokio::test]
    async fn open_telnet_connection_to_local_server() {
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

        mgr.close(&conn_id).await.unwrap();
        server.await.unwrap();
    }

    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;
}
