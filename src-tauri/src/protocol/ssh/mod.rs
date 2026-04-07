/// SSH protocol connection — secure shell access via the `russh` crate.
///
/// Implements the `Protocol` trait using `russh::client` for async SSH2.
/// Handles authentication (password, public key, SSH agent), host key
/// verification, PTY allocation, and interactive shell sessions.
///
/// Architecture:
/// - On `connect_with_emitter()`: SSH connect → host key verify → auth → PTY → shell → read loop
/// - Read loop: channel output → base64 → Tauri events
/// - Write: channel input
/// - Resize: channel window change request
/// - Disconnect: close channel + session gracefully
pub mod auth;
pub mod forwarding;
pub mod known_hosts;
pub mod proxy;
#[allow(dead_code)] // Runtime-only module; called from SshHandler callbacks
pub mod x11;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use russh::client;
use russh::keys::key::PublicKey;
use russh::{ChannelMsg, Disconnect};

use super::{
    ConnectionParams, ConnectionStatus, ConnectionStatusPayload, EventEmitter,
    Protocol, ProtocolError, ProtocolType,
};

/// Default SSH port (RFC 4253).
const DEFAULT_SSH_PORT: u16 = 22;

/// Connection timeout in seconds.
const CONNECT_TIMEOUT_SECS: u64 = 30;

/// Keepalive interval in seconds.
const KEEPALIVE_INTERVAL_SECS: u64 = 60;

/// Maximum number of missed keepalives before disconnect.
const KEEPALIVE_MAX_MISSED: usize = 3;

/// Terminal type requested in PTY allocation.
const TERMINAL_TYPE: &str = "xterm-256color";

/// An SSH protocol connection.
///
/// Manages the lifecycle of an SSH session including authentication,
/// PTY allocation, and interactive shell I/O.
///
/// Architecture: The SSH channel is stored behind `Arc<TokioMutex>` so
/// both the read loop (which reads via `channel.wait()`) and write/resize
/// operations can share it. The read loop holds the lock briefly per
/// iteration, then releases it for write/resize to acquire.
pub struct SshConnection {
    /// SSH session handle (None when disconnected).
    /// Used for authentication and session-level operations.
    session: Option<client::Handle<SshHandler>>,
    /// SSH channel for the interactive shell, shared with the read loop.
    /// Protected by mutex so write/resize can interleave with reads.
    channel: Option<Arc<tokio::sync::Mutex<russh::Channel<client::Msg>>>>,
    /// Whether the connection is currently active.
    connected: Arc<AtomicBool>,
    /// Handle to the read loop task (for cancellation on disconnect).
    read_task: Option<tokio::task::JoinHandle<()>>,
    /// Current terminal dimensions.
    cols: u16,
    rows: u16,
    /// Jump host session handles kept alive for tunneled connections.
    /// These are the intermediate SSH sessions in a jump host chain.
    /// Disconnected when this connection closes.
    jump_sessions: Vec<client::Handle<SshHandler>>,
}

impl SshConnection {
    /// Creates a new disconnected SshConnection.
    pub fn new() -> Self {
        Self {
            session: None,
            channel: None,
            connected: Arc::new(AtomicBool::new(false)),
            read_task: None,
            cols: 80,
            rows: 24,
            jump_sessions: Vec::new(),
        }
    }

    /// Returns a clone of the SSH session handle for opening additional channels.
    ///
    /// Used by SFTP to open a subsystem channel on the same SSH connection.
    /// Returns `None` if the connection is not established.
    #[allow(dead_code)]
    pub fn session_handle(
        &self,
    ) -> Option<&client::Handle<SshHandler>> {
        self.session.as_ref()
    }

    /// Returns a mutable reference to the SSH session handle.
    ///
    /// Used by ConnectionManager to open additional channels (e.g., SFTP).
    pub fn session_handle_mut(
        &mut self,
    ) -> Option<&mut client::Handle<SshHandler>> {
        self.session.as_mut()
    }

    /// Takes ownership of the SSH session handle, leaving `None`.
    ///
    /// Used by the jump host proxy to extract the handle for lifecycle
    /// management without disconnecting the SSH session.
    pub fn take_session_handle(
        &mut self,
    ) -> Option<client::Handle<SshHandler>> {
        self.session.take()
    }

    /// Sets the jump host session handles for lifecycle management.
    ///
    /// These handles are kept alive so the tunneled channels remain open.
    /// They are disconnected when this connection closes.
    pub fn set_jump_sessions(
        &mut self,
        sessions: Vec<client::Handle<SshHandler>>,
    ) {
        self.jump_sessions = sessions;
    }

    /// Connects to an SSH server with event emission support.
    ///
    /// This is the main entry point for SSH connections. Steps:
    /// 1. Parse and validate connection parameters
    /// 2. Create russh client config with security settings
    /// 3. Connect via TCP with timeout
    /// 4. Host key verification (known_hosts check + user prompt)
    /// 5. Authentication (SSH agent → public key → password)
    /// 6. Request PTY with xterm-256color
    /// 7. Request interactive shell
    /// 8. Spawn read loop for channel output
    pub async fn connect_with_emitter(
        &mut self,
        params: ConnectionParams,
        connection_id: String,
        emitter: Arc<dyn EventEmitter>,
        vault_password: Option<String>,
    ) -> Result<(), ProtocolError> {
        let host = params.host.as_deref().ok_or_else(|| {
            ProtocolError::InvalidParams("host is required for SSH".into())
        })?;

        if host.is_empty() {
            return Err(ProtocolError::InvalidParams(
                "host cannot be empty".into(),
            ));
        }

        let port = params.port.unwrap_or(DEFAULT_SSH_PORT);
        let username =
            params.username.as_deref().unwrap_or("root").to_string();
        self.cols = params.cols;
        self.rows = params.rows;

        // Emit connecting status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connecting,
                message: Some(format!(
                    "Connecting to {host}:{port} as {username}..."
                )),
            },
        );

        // Build russh client config with explicit security settings.
        // We pin specific algorithms to prevent downgrade attacks.
        // HMAC-SHA1 variants are excluded per modern hardening guidance.
        let preferred = russh::Preferred {
            kex: std::borrow::Cow::Borrowed(&[
                russh::kex::CURVE25519,
                russh::kex::CURVE25519_PRE_RFC_8731,
                russh::kex::DH_G16_SHA512,
                russh::kex::DH_G14_SHA256,
                russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
                russh::kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
            ]),
            key: std::borrow::Cow::Borrowed(&[
                russh::keys::key::ED25519,
                russh::keys::key::ECDSA_SHA2_NISTP256,
                russh::keys::key::ECDSA_SHA2_NISTP521,
                russh::keys::key::RSA_SHA2_256,
                russh::keys::key::RSA_SHA2_512,
            ]),
            cipher: std::borrow::Cow::Borrowed(&[
                russh::cipher::CHACHA20_POLY1305,
                russh::cipher::AES_256_GCM,
                russh::cipher::AES_256_CTR,
                russh::cipher::AES_128_CTR,
            ]),
            mac: std::borrow::Cow::Borrowed(&[
                russh::mac::HMAC_SHA512_ETM,
                russh::mac::HMAC_SHA256_ETM,
                russh::mac::HMAC_SHA512,
                russh::mac::HMAC_SHA256,
                // HMAC-SHA1 variants deliberately excluded
            ]),
            compression: std::borrow::Cow::Borrowed(&[
                russh::compression::NONE,
            ]),
        };

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(
                KEEPALIVE_INTERVAL_SECS * (KEEPALIVE_MAX_MISSED as u64 + 1),
            )),
            keepalive_interval: Some(std::time::Duration::from_secs(
                KEEPALIVE_INTERVAL_SECS,
            )),
            keepalive_max: KEEPALIVE_MAX_MISSED,
            preferred,
            ..Default::default()
        });

        // Create the handler with host key verification support
        let known_hosts_path = known_hosts::default_known_hosts_path();
        let handler = SshHandler::new(
            connection_id.clone(),
            host.to_string(),
            port,
            emitter.clone(),
            known_hosts_path,
        );

        // Connect with timeout
        let addr = format!("{host}:{port}");
        let session = tokio::time::timeout(
            std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS),
            client::connect(config, &addr, handler),
        )
        .await
        .map_err(|_| {
            ProtocolError::Timeout(format!(
                "SSH connection to {addr} timed out after \
                 {CONNECT_TIMEOUT_SECS}s"
            ))
        })?
        .map_err(|e| {
            ProtocolError::ConnectionRefused(format!(
                "SSH connection to {addr} failed: {e}"
            ))
        })?;

        let mut handle = session;

        // Authenticate
        let auth_result = auth::authenticate(
            &mut handle,
            &username,
            &params,
            vault_password,
            &connection_id,
            emitter.clone(),
        )
        .await;

        if let Err(e) = auth_result {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "auth failed", "en")
                .await;
            return Err(e);
        }

        // Open a session channel
        let channel = handle.channel_open_session().await.map_err(|e| {
            ProtocolError::ChannelClosed(format!(
                "Failed to open SSH channel: {e}"
            ))
        })?;

        let _channel_id = channel.id();

        // Request PTY
        channel
            .request_pty(
                false,
                TERMINAL_TYPE,
                self.cols as u32,
                self.rows as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| {
                ProtocolError::ChannelClosed(format!(
                    "Failed to request PTY: {e}"
                ))
            })?;

        // Request interactive shell
        channel.request_shell(false).await.map_err(|e| {
            ProtocolError::ChannelClosed(format!(
                "Failed to request shell: {e}"
            ))
        })?;

        self.session = Some(handle);
        let channel = Arc::new(tokio::sync::Mutex::new(channel));
        self.channel = Some(channel.clone());
        self.connected.store(true, Ordering::SeqCst);

        // Emit connected status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connected,
                message: None,
            },
        );

        // Spawn read loop
        let connected_flag = self.connected.clone();
        let read_task = tokio::spawn(ssh_read_loop(
            channel,
            connection_id,
            emitter,
            connected_flag,
        ));
        self.read_task = Some(read_task);

        Ok(())
    }

    /// Connects to an SSH server over an existing async stream.
    ///
    /// Used for jump host support: the stream is a `direct-tcpip` channel
    /// from a jump host, forwarding to the target. Uses
    /// `russh::client::connect_stream()` instead of TCP connect.
    ///
    /// Steps are identical to `connect_with_emitter()` except step 3
    /// (TCP connect) is replaced by stream-based connect.
    pub async fn connect_with_emitter_over_stream<S>(
        &mut self,
        stream: S,
        params: ConnectionParams,
        connection_id: String,
        emitter: Arc<dyn EventEmitter>,
        vault_password: Option<String>,
    ) -> Result<(), ProtocolError>
    where
        S: tokio::io::AsyncRead
            + tokio::io::AsyncWrite
            + Unpin
            + Send
            + 'static,
    {
        let host = params.host.as_deref().ok_or_else(|| {
            ProtocolError::InvalidParams(
                "host is required for SSH".into(),
            )
        })?;

        if host.is_empty() {
            return Err(ProtocolError::InvalidParams(
                "host cannot be empty".into(),
            ));
        }

        let port = params.port.unwrap_or(DEFAULT_SSH_PORT);
        let username =
            params.username.as_deref().unwrap_or("root").to_string();
        self.cols = params.cols;
        self.rows = params.rows;

        // Emit connecting status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connecting,
                message: Some(format!(
                    "Connecting to {host}:{port} as {username} \
                     (through tunnel)..."
                )),
            },
        );

        // Build russh client config (same security settings)
        let preferred = russh::Preferred {
            kex: std::borrow::Cow::Borrowed(&[
                russh::kex::CURVE25519,
                russh::kex::CURVE25519_PRE_RFC_8731,
                russh::kex::DH_G16_SHA512,
                russh::kex::DH_G14_SHA256,
                russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
                russh::kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
            ]),
            key: std::borrow::Cow::Borrowed(&[
                russh::keys::key::ED25519,
                russh::keys::key::ECDSA_SHA2_NISTP256,
                russh::keys::key::ECDSA_SHA2_NISTP521,
                russh::keys::key::RSA_SHA2_256,
                russh::keys::key::RSA_SHA2_512,
            ]),
            cipher: std::borrow::Cow::Borrowed(&[
                russh::cipher::CHACHA20_POLY1305,
                russh::cipher::AES_256_GCM,
                russh::cipher::AES_256_CTR,
                russh::cipher::AES_128_CTR,
            ]),
            mac: std::borrow::Cow::Borrowed(&[
                russh::mac::HMAC_SHA512_ETM,
                russh::mac::HMAC_SHA256_ETM,
                russh::mac::HMAC_SHA512,
                russh::mac::HMAC_SHA256,
            ]),
            compression: std::borrow::Cow::Borrowed(&[
                russh::compression::NONE,
            ]),
        };

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(
                KEEPALIVE_INTERVAL_SECS
                    * (KEEPALIVE_MAX_MISSED as u64 + 1),
            )),
            keepalive_interval: Some(
                std::time::Duration::from_secs(
                    KEEPALIVE_INTERVAL_SECS,
                ),
            ),
            keepalive_max: KEEPALIVE_MAX_MISSED,
            preferred,
            ..Default::default()
        });

        // Create handler (host key verification still applies)
        let known_hosts_path =
            known_hosts::default_known_hosts_path();
        let handler = SshHandler::new(
            connection_id.clone(),
            host.to_string(),
            port,
            emitter.clone(),
            known_hosts_path,
        );

        // Connect SSH over the tunneled stream (no TCP timeout needed
        // — the stream is already established through the jump host)
        let session = client::connect_stream(
            config, stream, handler,
        )
        .await
        .map_err(|e| {
            ProtocolError::ConnectionRefused(format!(
                "SSH connection to {host}:{port} through tunnel \
                 failed: {e}"
            ))
        })?;

        let mut handle = session;

        // Authenticate (same as direct connection)
        let auth_result = auth::authenticate(
            &mut handle,
            &username,
            &params,
            vault_password,
            &connection_id,
            emitter.clone(),
        )
        .await;

        if let Err(e) = auth_result {
            let _ = handle
                .disconnect(
                    Disconnect::ByApplication,
                    "auth failed",
                    "en",
                )
                .await;
            return Err(e);
        }

        // Open session channel, request PTY and shell
        let channel =
            handle.channel_open_session().await.map_err(|e| {
                ProtocolError::ChannelClosed(format!(
                    "Failed to open SSH channel: {e}"
                ))
            })?;

        channel
            .request_pty(
                false,
                TERMINAL_TYPE,
                self.cols as u32,
                self.rows as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| {
                ProtocolError::ChannelClosed(format!(
                    "Failed to request PTY: {e}"
                ))
            })?;

        channel.request_shell(false).await.map_err(|e| {
            ProtocolError::ChannelClosed(format!(
                "Failed to request shell: {e}"
            ))
        })?;

        self.session = Some(handle);
        let channel = Arc::new(tokio::sync::Mutex::new(channel));
        self.channel = Some(channel.clone());
        self.connected.store(true, Ordering::SeqCst);

        // Emit connected status
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connected,
                message: None,
            },
        );

        // Spawn read loop
        let connected_flag = self.connected.clone();
        let read_task = tokio::spawn(ssh_read_loop(
            channel,
            connection_id,
            emitter,
            connected_flag,
        ));
        self.read_task = Some(read_task);

        Ok(())
    }

    /// Writes data to the SSH channel.
    pub async fn write_bytes(
        &self,
        data: &[u8],
    ) -> Result<(), ProtocolError> {
        let channel = self.channel.as_ref().ok_or_else(|| {
            ProtocolError::ChannelClosed(
                "SSH session not connected".into(),
            )
        })?;

        let ch = channel.lock().await;
        ch.data(data).await.map_err(|e| {
            ProtocolError::IoError(format!("SSH write failed: {e}"))
        })?;

        Ok(())
    }

    /// Sends a window size change to the SSH channel.
    pub async fn send_resize(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ProtocolError> {
        self.cols = cols;
        self.rows = rows;

        let channel = self.channel.as_ref().ok_or_else(|| {
            ProtocolError::ChannelClosed(
                "SSH session not connected".into(),
            )
        })?;

        let ch = channel.lock().await;
        ch.window_change(cols as u32, rows as u32, 0, 0)
            .await
            .map_err(|e| {
                ProtocolError::IoError(format!(
                    "SSH resize failed: {e}"
                ))
            })?;

        Ok(())
    }

    /// Disconnects the SSH session gracefully.
    pub async fn close(&mut self) -> Result<(), ProtocolError> {
        // Abort the read task
        if let Some(task) = self.read_task.take() {
            task.abort();
        }

        // Close the SSH session
        if let Some(session) = self.session.take() {
            let _ = session
                .disconnect(
                    Disconnect::ByApplication,
                    "user disconnect",
                    "en",
                )
                .await;
        }

        // Close jump host sessions (reverse order — innermost first)
        for session in self.jump_sessions.drain(..).rev() {
            let _ = session
                .disconnect(
                    Disconnect::ByApplication,
                    "jump host cleanup",
                    "en",
                )
                .await;
        }

        self.channel = None;
        self.connected.store(false, Ordering::SeqCst);
        Ok(())
    }
}

#[async_trait]
impl Protocol for SshConnection {
    async fn connect(
        &mut self,
        _params: ConnectionParams,
    ) -> Result<(), ProtocolError> {
        Err(ProtocolError::InvalidParams(
            "Use connect_with_emitter() for SSH connections".into(),
        ))
    }

    async fn write(
        &mut self,
        data: &[u8],
    ) -> Result<(), ProtocolError> {
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
        ProtocolType::Ssh
    }
}

/// SSH client handler — implements russh callback interface.
///
/// Handles host key verification, authentication banners, and
/// server-initiated channel opens (forwarded-tcpip, X11).
/// Data reception is handled via channel reads in the read loop,
/// not through the Handler trait.
pub struct SshHandler {
    connection_id: String,
    host: String,
    port: u16,
    emitter: Arc<dyn EventEmitter>,
    known_hosts_path: std::path::PathBuf,
    /// Reference to the forwarding manager for handling
    /// server-initiated forwarded-tcpip channels (-R).
    forwarding_manager: Option<Arc<forwarding::ForwardingManager>>,
    /// X11 forwarding state for handling server-initiated X11 channels.
    x11_state: Option<Arc<x11::X11State>>,
}

impl SshHandler {
    fn new(
        connection_id: String,
        host: String,
        port: u16,
        emitter: Arc<dyn EventEmitter>,
        known_hosts_path: std::path::PathBuf,
    ) -> Self {
        Self {
            connection_id,
            host,
            port,
            emitter,
            known_hosts_path,
            forwarding_manager: None,
            x11_state: None,
        }
    }

    /// Sets the forwarding manager for remote forward callbacks.
    #[allow(dead_code)] // Called during SSH connection setup at runtime
    pub fn set_forwarding_manager(
        &mut self,
        mgr: Arc<forwarding::ForwardingManager>,
    ) {
        self.forwarding_manager = Some(mgr);
    }

    /// Sets the X11 forwarding state for X11 channel callbacks.
    #[allow(dead_code)] // Called during SSH connection setup at runtime
    pub fn set_x11_state(&mut self, state: Arc<x11::X11State>) {
        self.x11_state = Some(state);
    }
}

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// Verify the server's host key against known_hosts.
    ///
    /// Known keys are accepted. Unknown keys are REJECTED (emits event
    /// for the frontend to prompt the user — true TOFU requires user
    /// consent, not auto-accept). Changed keys are also rejected with
    /// a MITM warning event.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint =
            known_hosts::fingerprint_key(server_public_key);
        let key_type = known_hosts::key_type_name(server_public_key);

        match known_hosts::check_known_host(
            &self.known_hosts_path,
            &self.host,
            self.port,
            server_public_key,
        ) {
            known_hosts::HostKeyStatus::Known => Ok(true),
            known_hosts::HostKeyStatus::Unknown => {
                // First connection — emit event for user verification.
                // Do NOT auto-accept: the connection will fail with
                // "server key not accepted", and the user must accept
                // via the HostKeyDialog to add it to known_hosts.
                let payload = serde_json::json!({
                    "host": self.host,
                    "port": self.port,
                    "keyType": key_type,
                    "fingerprint": fingerprint,
                    "action": "new",
                });
                let event = format!(
                    "connection-hostkey-{}",
                    self.connection_id
                );
                self.emitter
                    .emit_event(&event, &payload.to_string());

                // Reject — user must explicitly accept unknown keys
                // through the frontend dialog (future IPC command).
                Ok(false)
            }
            known_hosts::HostKeyStatus::Changed {
                expected_fingerprint,
            } => {
                // MITM WARNING — key changed!
                let payload = serde_json::json!({
                    "host": self.host,
                    "port": self.port,
                    "keyType": key_type,
                    "fingerprint": fingerprint,
                    "expectedFingerprint": expected_fingerprint,
                    "action": "changed",
                });
                let event = format!(
                    "connection-hostkey-warning-{}",
                    self.connection_id
                );
                self.emitter
                    .emit_event(&event, &payload.to_string());

                Ok(false)
            }
        }
    }

    /// Handles server-initiated forwarded-tcpip channels (remote forwarding -R).
    ///
    /// The SSH server opens this channel when a client connects to a
    /// remotely-forwarded port. We relay it to the local target.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(ref mgr) = self.forwarding_manager {
            let mgr = mgr.clone();
            let addr = connected_address.to_string();
            tokio::spawn(async move {
                mgr.handle_remote_forward_channel(
                    channel,
                    &addr,
                    connected_port,
                )
                .await;
            });
        }
        Ok(())
    }

    /// Handles server-initiated X11 channels.
    ///
    /// The SSH server opens this channel when an X11 application on the
    /// remote side tries to connect to the display. We relay it to the
    /// local X server.
    async fn server_channel_open_x11(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(ref state) = self.x11_state {
            let display = state.display_number;
            let channels = state.active_channels.clone();
            let bytes = state.bytes_relayed.clone();
            tokio::spawn(async move {
                x11::handle_x11_channel(
                    channel, display, channels, bytes,
                )
                .await;
            });
        }
        Ok(())
    }
}

/// Background read loop — reads from SSH channel, emits events.
///
/// Runs as a tokio task. Acquires the channel lock briefly for each
/// `wait()` call, then releases it so write/resize can interleave.
async fn ssh_read_loop(
    channel: Arc<tokio::sync::Mutex<russh::Channel<client::Msg>>>,
    connection_id: String,
    emitter: Arc<dyn EventEmitter>,
    connected: Arc<AtomicBool>,
) {
    let b64_engine = base64::engine::general_purpose::STANDARD;

    loop {
        // Acquire lock briefly to read one message
        let msg = {
            let mut ch = channel.lock().await;
            ch.wait().await
        };

        match msg {
            Some(ChannelMsg::Data { data }) => {
                if !data.is_empty() {
                    let encoded = b64_engine.encode(&data[..]);
                    emitter.emit_output(&connection_id, &encoded);
                }
            }
            Some(ChannelMsg::ExtendedData { data, .. }) => {
                // stderr — emit as regular output for display
                if !data.is_empty() {
                    let encoded = b64_engine.encode(&data[..]);
                    emitter.emit_output(&connection_id, &encoded);
                }
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some(format!(
                            "Process exited with status {exit_status}"
                        )),
                    },
                );
                break;
            }
            Some(ChannelMsg::Eof) => {
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some(
                            "Connection closed by remote host".into(),
                        ),
                    },
                );
                break;
            }
            None => {
                connected.store(false, Ordering::SeqCst);
                emitter.emit_status(
                    &connection_id,
                    &ConnectionStatusPayload {
                        status: ConnectionStatus::Disconnected,
                        message: Some("SSH channel closed".into()),
                    },
                );
                break;
            }
            _ => {
                // Other messages (WindowAdjust, etc.) — ignore
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_connection_is_disconnected() {
        let conn = SshConnection::new();
        assert!(!conn.is_connected());
    }

    #[test]
    fn new_connection_has_default_dimensions() {
        let conn = SshConnection::new();
        assert_eq!(conn.cols, 80);
        assert_eq!(conn.rows, 24);
    }

    #[test]
    fn protocol_type_is_ssh() {
        let conn = SshConnection::new();
        assert_eq!(conn.protocol_type(), ProtocolType::Ssh);
    }

    #[tokio::test]
    async fn write_without_connection_returns_error() {
        let conn = SshConnection::new();
        let result = conn.write_bytes(b"test").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::ChannelClosed(msg) => {
                assert!(msg.contains("not connected"));
            }
            other => panic!("Expected ChannelClosed, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn resize_without_connection_returns_error() {
        let mut conn = SshConnection::new();
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
    async fn close_without_connection_succeeds() {
        let mut conn = SshConnection::new();
        let result = conn.close().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn connect_trait_method_returns_error() {
        let mut conn = SshConnection::new();
        let params = ConnectionParams {
            host: Some("localhost".into()),
            port: Some(22),
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
                assert!(msg.contains("connect_with_emitter"));
            }
            other => {
                panic!("Expected InvalidParams, got: {other:?}")
            }
        }
    }

    #[tokio::test]
    async fn connect_rejects_missing_host() {
        let mut conn = SshConnection::new();
        let emitter = Arc::new(
            crate::protocol::test_utils::MockEmitter::new(),
        );
        let params = ConnectionParams {
            host: None,
            port: Some(22),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = conn
            .connect_with_emitter(
                params,
                "test-id".into(),
                emitter,
                None,
            )
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("host is required"));
            }
            other => {
                panic!("Expected InvalidParams, got: {other:?}")
            }
        }
    }

    #[tokio::test]
    async fn connect_rejects_empty_host() {
        let mut conn = SshConnection::new();
        let emitter = Arc::new(
            crate::protocol::test_utils::MockEmitter::new(),
        );
        let params = ConnectionParams {
            host: Some("".into()),
            port: Some(22),
            username: None,
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };
        let result = conn
            .connect_with_emitter(
                params,
                "test-id".into(),
                emitter,
                None,
            )
            .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(msg.contains("empty"));
            }
            other => {
                panic!("Expected InvalidParams, got: {other:?}")
            }
        }
    }
}
