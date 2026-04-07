/// Telnet protocol connection — TCP-based terminal access via RFC 854.
///
/// Implements the `Protocol` trait using `tokio::net::TcpStream`.
/// Handles IAC negotiation, NAWS window size, and TTYPE terminal type.
///
/// Architecture:
/// - On `connect()`: TCP connect → split stream → spawn read task
/// - Read task: parse IAC sequences, emit clean data via Tauri events
/// - Write: send raw bytes (with IAC escaping) to TCP stream
/// - Resize: send NAWS subnegotiation
pub mod negotiation;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};

use super::{
    ConnectionParams, ConnectionStatus, ConnectionStatusPayload, Protocol,
    ProtocolError, ProtocolType,
};
use negotiation::{
    build_naws_subnegotiation, escape_iac, parse_telnet, ParserState,
};

/// Connection timeout in seconds.
const CONNECT_TIMEOUT_SECS: u64 = 30;

/// Read buffer size for TCP reads.
const READ_BUFFER_SIZE: usize = 4096;

/// Default Telnet port (RFC 854).
const DEFAULT_TELNET_PORT: u16 = 23;

/// Handle for sending data to a Telnet connection.
///
/// The write half is behind an `Arc<TokioMutex>` so it can be shared
/// between the IPC write handler and the read loop (which sends
/// negotiation responses).
type WriteHandle = Arc<TokioMutex<tokio::net::tcp::OwnedWriteHalf>>;

/// A Telnet protocol connection.
///
/// Manages the lifecycle of a TCP connection with Telnet option
/// negotiation. Thread-safe — the write handle is shared between
/// the Protocol methods and the read loop task.
pub struct TelnetConnection {
    /// Write half of the TCP stream (None when disconnected).
    writer: Option<WriteHandle>,
    /// Whether the connection is currently active.
    /// Shared with the read loop via `Arc<AtomicBool>` so EOF/error
    /// in the read task immediately reflects in `is_connected()`.
    connected: Arc<AtomicBool>,
    /// Handle to the read loop task (for cancellation on disconnect).
    read_task: Option<tokio::task::JoinHandle<()>>,
    /// Current terminal dimensions (for NAWS).
    cols: u16,
    rows: u16,
}

impl TelnetConnection {
    /// Creates a new disconnected TelnetConnection.
    pub fn new() -> Self {
        Self {
            writer: None,
            connected: Arc::new(AtomicBool::new(false)),
            read_task: None,
            cols: 80,
            rows: 24,
        }
    }
}

// Re-export EventEmitter from the protocol level for backward compatibility.
pub use super::EventEmitter;

impl TelnetConnection {
    /// Connects to a Telnet server and starts the read loop.
    ///
    /// This is the main entry point — it takes an EventEmitter to
    /// decouple from Tauri for testing.
    pub async fn connect_with_emitter(
        &mut self,
        params: ConnectionParams,
        connection_id: String,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<(), ProtocolError> {
        let host = params
            .host
            .as_deref()
            .ok_or_else(|| ProtocolError::InvalidParams("host is required".into()))?;

        if host.is_empty() {
            return Err(ProtocolError::InvalidParams(
                "host cannot be empty".into(),
            ));
        }

        let port = params.port.unwrap_or(DEFAULT_TELNET_PORT);
        self.cols = params.cols;
        self.rows = params.rows;

        // Emit connecting status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connecting,
                message: Some(format!("Connecting to {host}:{port}...")),
            },
        );

        // TCP connect with timeout
        let addr = format!("{host}:{port}");
        let stream = timeout(
            Duration::from_secs(CONNECT_TIMEOUT_SECS),
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| {
            ProtocolError::Timeout(format!(
                "Connection to {addr} timed out after {CONNECT_TIMEOUT_SECS}s"
            ))
        })?
        .map_err(|e| {
            ProtocolError::ConnectionRefused(format!(
                "Failed to connect to {addr}: {e}"
            ))
        })?;

        // Enable TCP keepalive — detects dead connections in ~90s
        let sock_ref = socket2::SockRef::from(&stream);
        let keepalive = socket2::TcpKeepalive::new()
            .with_time(Duration::from_secs(60))
            .with_interval(Duration::from_secs(10));
        // Note: with_retries() is not available on all platforms (macOS).
        // On Linux, the default retry count (typically 9) is acceptable.
        let _ = sock_ref.set_tcp_keepalive(&keepalive);

        // Split stream into read/write halves
        let (read_half, write_half) = stream.into_split();
        let writer = Arc::new(TokioMutex::new(write_half));
        self.writer = Some(writer.clone());
        self.connected.store(true, Ordering::SeqCst);

        // Emit connected status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connected,
                message: None,
            },
        );

        // Spawn the read loop
        let cols = self.cols;
        let rows = self.rows;
        let connected_flag = self.connected.clone();
        let read_task = tokio::spawn(read_loop(
            read_half,
            writer.clone(),
            connection_id,
            emitter,
            cols,
            rows,
            connected_flag,
        ));
        self.read_task = Some(read_task);

        Ok(())
    }

    /// Writes raw bytes to the Telnet connection (with IAC escaping).
    #[allow(dead_code)]
    pub async fn write_bytes(&self, data: &[u8]) -> Result<(), ProtocolError> {
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| ProtocolError::ChannelClosed("not connected".into()))?;

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

    /// Returns a clone of the write handle for use outside the HashMap lock.
    ///
    /// The `Arc<TokioMutex<OwnedWriteHalf>>` can be cloned cheaply
    /// (just incrementing the reference count) and used independently
    /// of the HashMap lock.
    pub fn write_handle(&self) -> Option<WriteHandle> {
        self.writer.clone()
    }

    /// Sends a NAWS update to the remote server.
    #[allow(dead_code)]
    pub async fn send_resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        self.cols = cols;
        self.rows = rows;

        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| ProtocolError::ChannelClosed("not connected".into()))?;

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

    /// Disconnects from the Telnet server.
    pub async fn close(&mut self) -> Result<(), ProtocolError> {
        // Abort the read task
        if let Some(task) = self.read_task.take() {
            task.abort();
        }

        // Shutdown the writer
        if let Some(writer) = self.writer.take() {
            let mut w = writer.lock().await;
            let _ = w.shutdown().await;
        }

        self.connected.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[async_trait]
impl Protocol for TelnetConnection {
    async fn connect(
        &mut self,
        _params: ConnectionParams,
    ) -> Result<(), ProtocolError> {
        // This method satisfies the trait but real connections should use
        // connect_with_emitter() which takes the event emitter.
        Err(ProtocolError::InvalidParams(
            "Use connect_with_emitter() for real connections".into(),
        ))
    }

    async fn write(&mut self, data: &[u8]) -> Result<(), ProtocolError> {
        self.write_bytes(data).await
    }

    async fn resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        self.send_resize(cols, rows).await
    }

    async fn disconnect(&mut self) -> Result<(), ProtocolError> {
        self.close().await
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    fn protocol_type(&self) -> ProtocolType {
        ProtocolType::Telnet
    }
}

/// Background read loop — reads from TCP, parses Telnet, emits events.
///
/// Runs as a tokio task. On EOF or error, emits a disconnect status event
/// and sets the `connected` flag to `false` via `Arc<AtomicBool>`.
/// Negotiation responses are sent back through the shared write handle.
async fn read_loop(
    mut reader: tokio::net::tcp::OwnedReadHalf,
    writer: WriteHandle,
    connection_id: String,
    emitter: Arc<dyn EventEmitter>,
    cols: u16,
    rows: u16,
    connected: Arc<AtomicBool>,
) {
    let mut buf = [0u8; READ_BUFFER_SIZE];
    let mut parser_state = ParserState::Data;
    let b64_engine = base64::engine::general_purpose::STANDARD;

    loop {
        match reader.read(&mut buf).await {
            Ok(0) => {
                // EOF — connection closed by remote
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some("Connection closed by remote host".into()),
                    },
                );
                break;
            }
            Ok(n) => {
                let result =
                    parse_telnet(&buf[..n], &mut parser_state, cols, rows);

                // Send negotiation responses back to server
                if !result.responses.is_empty() {
                    let mut w = writer.lock().await;
                    if w.write_all(&result.responses).await.is_err() {
                        break;
                    }
                    let _ = w.flush().await;
                }

                // Emit clean data to frontend (base64 encoded, same as PTY)
                if !result.data.is_empty() {
                    let encoded = b64_engine.encode(&result.data);
                    emitter.emit_output(&connection_id, &encoded);
                }
            }
            Err(e) => {
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Error,
                        message: Some(format!("Read error: {e}")),
                    },
                );
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::test_utils::MockEmitter;

    // ====================================================================
    // TelnetConnection unit tests
    // ====================================================================

    #[test]
    fn new_connection_is_disconnected() {
        let conn = TelnetConnection::new();
        assert!(!conn.is_connected());
        assert!(conn.writer.is_none());
        assert!(conn.read_task.is_none());
    }

    #[test]
    fn protocol_type_is_telnet() {
        let conn = TelnetConnection::new();
        assert_eq!(conn.protocol_type(), ProtocolType::Telnet);
    }

    #[test]
    fn new_connection_has_default_dimensions() {
        let conn = TelnetConnection::new();
        assert_eq!(conn.cols, 80);
        assert_eq!(conn.rows, 24);
    }

    #[tokio::test]
    async fn write_when_disconnected_returns_error() {
        let conn = TelnetConnection::new();
        let result = conn.write_bytes(b"hello").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not connected"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn resize_when_disconnected_returns_error() {
        let mut conn = TelnetConnection::new();
        let result = conn.send_resize(120, 40).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not connected"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn disconnect_when_already_disconnected_succeeds() {
        let mut conn = TelnetConnection::new();
        let result = conn.close().await;
        assert!(result.is_ok());
        assert!(!conn.is_connected());
    }

    #[tokio::test]
    async fn connect_with_missing_host_returns_error() {
        let mut conn = TelnetConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: None,
            port: Some(23),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = conn
            .connect_with_emitter(params, "test-id".into(), emitter)
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("host"));
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn connect_with_empty_host_returns_error() {
        let mut conn = TelnetConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("".into()),
            port: Some(23),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = conn
            .connect_with_emitter(params, "test-id".into(), emitter)
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("empty"));
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn connect_to_unreachable_host_returns_error() {
        let mut conn = TelnetConnection::new();
        let emitter = Arc::new(MockEmitter::new());
        let params = ConnectionParams {
            host: Some("192.0.2.1".into()), // RFC 5737 TEST-NET — not routable
            port: Some(9999),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        // Use a very short timeout approach: this will fail with connection
        // refused or timeout. Either way it should be an error.
        let result = conn
            .connect_with_emitter(params, "test-id".into(), emitter.clone())
            .await;
        assert!(result.is_err());

        // Verify connecting status was emitted
        let statuses = emitter.statuses.lock().unwrap();
        assert!(!statuses.is_empty());
        assert_eq!(statuses[0].1.status, ConnectionStatus::Connecting);
    }

    #[tokio::test]
    async fn protocol_trait_connect_without_emitter_returns_error() {
        let mut conn = TelnetConnection::new();
        let params = ConnectionParams {
            host: Some("localhost".into()),
            port: Some(23),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = Protocol::connect(&mut conn, params).await;
        assert!(result.is_err());
    }

    // ====================================================================
    // Integration test with mock TCP server
    // ====================================================================

    #[tokio::test]
    async fn connect_to_local_tcp_server() {
        // Start a mock TCP server
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        // Server task: accept connection, send some data, close
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            // Send a simple Telnet negotiation + data
            let greeting = b"Welcome to test server\r\n";
            stream.write_all(greeting).await.unwrap();
            stream.flush().await.unwrap();
            // Keep connection alive briefly for client to read
            tokio::time::sleep(Duration::from_millis(200)).await;
            // Close
            let _ = stream.shutdown().await;
        });

        let emitter = Arc::new(MockEmitter::new());
        let mut conn = TelnetConnection::new();

        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let result = conn
            .connect_with_emitter(params, "test-conn".into(), emitter.clone())
            .await;
        assert!(result.is_ok());
        assert!(conn.is_connected());

        // Wait for the read loop to process the greeting
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Check that output was emitted
        let outputs = emitter.outputs.lock().unwrap();
        assert!(
            !outputs.is_empty(),
            "Expected output events from server greeting"
        );

        // Check statuses
        let statuses = emitter.statuses.lock().unwrap();
        assert!(statuses.len() >= 2); // Connecting + Connected
        assert_eq!(statuses[0].1.status, ConnectionStatus::Connecting);
        assert_eq!(statuses[1].1.status, ConnectionStatus::Connected);

        // Clean up
        conn.close().await.unwrap();
        assert!(!conn.is_connected());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn write_to_connected_server() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let n = stream.read(&mut buf).await.unwrap();
            // Verify we received "hello" (no IAC escaping needed)
            assert_eq!(&buf[..n], b"hello");
            let _ = stream.shutdown().await;
        });

        let emitter = Arc::new(MockEmitter::new());
        let mut conn = TelnetConnection::new();

        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        conn.connect_with_emitter(params, "test-write".into(), emitter)
            .await
            .unwrap();

        // Write data
        conn.write_bytes(b"hello").await.unwrap();

        conn.close().await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn resize_sends_naws_to_server() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let n = stream.read(&mut buf).await.unwrap();
            // Should receive NAWS subnegotiation
            // IAC SB NAWS <cols_hi> <cols_lo> <rows_hi> <rows_lo> IAC SE
            assert!(n >= 9);
            assert_eq!(buf[0], 255); // IAC
            assert_eq!(buf[1], 250); // SB
            assert_eq!(buf[2], 31); // NAWS
            let _ = stream.shutdown().await;
        });

        let emitter = Arc::new(MockEmitter::new());
        let mut conn = TelnetConnection::new();

        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        conn.connect_with_emitter(params, "test-resize".into(), emitter)
            .await
            .unwrap();

        // Send resize
        conn.send_resize(120, 40).await.unwrap();
        assert_eq!(conn.cols, 120);
        assert_eq!(conn.rows, 40);

        conn.close().await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn server_negotiation_gets_responded() {
        let listener =
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            // Send: IAC DO TTYPE, IAC WILL ECHO, IAC WILL SGA
            let negotiation = [
                255, 253, 24, // IAC DO TTYPE
                255, 251, 1, // IAC WILL ECHO
                255, 251, 3, // IAC WILL SGA
            ];
            stream.write_all(&negotiation).await.unwrap();
            stream.flush().await.unwrap();

            // Read the client's responses
            let mut buf = [0u8; 1024];
            tokio::time::sleep(Duration::from_millis(100)).await;
            let n = stream.read(&mut buf).await.unwrap();

            // Should contain: IAC WILL TTYPE, IAC DO ECHO, IAC DO SGA
            let response = &buf[..n];
            // Verify IAC WILL TTYPE (255, 251, 24)
            assert!(
                response.windows(3).any(|w| w == [255, 251, 24]),
                "Expected WILL TTYPE in response"
            );
            // Verify IAC DO ECHO (255, 253, 1)
            assert!(
                response.windows(3).any(|w| w == [255, 253, 1]),
                "Expected DO ECHO in response"
            );
            // Verify IAC DO SGA (255, 253, 3)
            assert!(
                response.windows(3).any(|w| w == [255, 253, 3]),
                "Expected DO SGA in response"
            );

            let _ = stream.shutdown().await;
        });

        let emitter = Arc::new(MockEmitter::new());
        let mut conn = TelnetConnection::new();

        let params = ConnectionParams {
            host: Some("127.0.0.1".into()),
            port: Some(port),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        conn.connect_with_emitter(params, "test-nego".into(), emitter)
            .await
            .unwrap();

        // Wait for negotiation to complete
        tokio::time::sleep(Duration::from_millis(300)).await;

        conn.close().await.unwrap();
        server.await.unwrap();
    }
}
