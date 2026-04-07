/// SSH port forwarding — local (-L), remote (-R), dynamic SOCKS5 (-D).
///
/// Manages TCP tunnels through an SSH connection. Each tunnel runs as
/// an independent tokio task with its own byte counters.
///
/// Architecture:
/// - `ForwardingManager` is Tauri managed state (like SftpManager)
/// - Local forward: bind local TCP → `direct-tcpip` channel → remote
/// - Remote forward: `tcpip_forward` request → server opens channels
/// - Dynamic: local SOCKS5 server → parse CONNECT → `direct-tcpip`
///
/// Security: local listeners bind `127.0.0.1` by default. Binding
/// `0.0.0.0` emits a security warning event to the frontend.
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::protocol::{
    ConnectionStatusPayload, EventEmitter, ProtocolError,
};

/// Maximum number of forwarding rules per SSH connection.
const MAX_FORWARDING_RULES: usize = 32;

/// Default bind address for local listeners (loopback only).
const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";

/// Buffer size for bidirectional relay (16 KB).
const RELAY_BUFFER_SIZE: usize = 16 * 1024;

/// SOCKS5 protocol version.
const SOCKS5_VERSION: u8 = 0x05;

/// SOCKS5 no-authentication method.
const SOCKS5_AUTH_NONE: u8 = 0x00;

/// SOCKS5 no acceptable methods.
const SOCKS5_AUTH_NO_ACCEPTABLE: u8 = 0xFF;

/// SOCKS5 CONNECT command.
const SOCKS5_CMD_CONNECT: u8 = 0x01;

/// SOCKS5 address type: IPv4.
const SOCKS5_ATYP_IPV4: u8 = 0x01;

/// SOCKS5 address type: domain name.
const SOCKS5_ATYP_DOMAIN: u8 = 0x03;

/// SOCKS5 address type: IPv6.
const SOCKS5_ATYP_IPV6: u8 = 0x04;

/// SOCKS5 reply: succeeded.
const SOCKS5_REPLY_SUCCESS: u8 = 0x00;

/// SOCKS5 reply: general failure.
#[allow(dead_code)] // Used in runtime SOCKS5 error paths
const SOCKS5_REPLY_FAILURE: u8 = 0x01;

/// SOCKS5 reply: command not supported.
const SOCKS5_REPLY_CMD_NOT_SUPPORTED: u8 = 0x07;

/// SOCKS5 reply: address type not supported.
const SOCKS5_REPLY_ATYP_NOT_SUPPORTED: u8 = 0x08;

// ── Types ────────────────────────────────────────────────────────

/// Type of port forwarding tunnel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardingType {
    /// Local forward (-L): local port → remote host:port via SSH.
    Local,
    /// Remote forward (-R): remote port → local host:port via SSH.
    Remote,
    /// Dynamic SOCKS5 proxy (-D): local SOCKS5 → SSH tunnel.
    Dynamic,
}

/// Current status of a forwarding tunnel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    /// Tunnel listener is starting up.
    Starting,
    /// Tunnel is actively listening for connections.
    Active,
    /// Tunnel has been stopped.
    Stopped,
    /// Tunnel encountered an error.
    Error,
}

/// Input for adding a forwarding rule via IPC.
///
/// Maps to the frontend `ForwardingRule` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardingRuleInput {
    /// Type of forwarding (local, remote, dynamic).
    pub forwarding_type: ForwardingType,
    /// Local port to bind (local/dynamic) or local port to connect to (remote).
    pub local_port: u16,
    /// Remote host to connect to (local forward) or bind on (remote forward).
    /// Not used for dynamic forwarding.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_host: Option<String>,
    /// Remote port to connect to (local forward) or bind on (remote forward).
    /// Not used for dynamic forwarding.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    /// Bind address for the local listener (default: "127.0.0.1").
    /// Setting to "0.0.0.0" binds all interfaces (security warning).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_address: Option<String>,
}

/// Runtime status of a forwarding tunnel reported to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardingStatus {
    /// Unique tunnel identifier.
    pub id: String,
    /// SSH connection this tunnel belongs to.
    pub connection_id: String,
    /// Type of forwarding.
    pub forwarding_type: ForwardingType,
    /// Local port the listener is bound to.
    pub local_port: u16,
    /// Remote host (for local/remote forwarding).
    pub remote_host: Option<String>,
    /// Remote port (for local/remote forwarding).
    pub remote_port: Option<u16>,
    /// Bind address for the local listener.
    pub bind_address: String,
    /// Total bytes transmitted through this tunnel.
    pub bytes_tx: u64,
    /// Total bytes received through this tunnel.
    pub bytes_rx: u64,
    /// Number of active relay connections.
    pub active_connections: u32,
    /// Current tunnel status.
    pub status: TunnelStatus,
    /// Error message if status is Error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Internal state for an active forwarding tunnel.
struct ActiveTunnel {
    /// Forwarding rule input.
    rule: ForwardingRuleInput,
    /// SSH connection this tunnel belongs to.
    connection_id: String,
    /// Bind address used.
    bind_address: String,
    /// Bytes transmitted counter (shared with relay tasks).
    bytes_tx: Arc<AtomicU64>,
    /// Bytes received counter (shared with relay tasks).
    bytes_rx: Arc<AtomicU64>,
    /// Active relay connection count.
    active_connections: Arc<AtomicU64>,
    /// Current status.
    status: TunnelStatus,
    /// Error message if any.
    error: Option<String>,
    /// Handle to the listener task (for cancellation).
    listener_task: Option<tokio::task::JoinHandle<()>>,
}

// ── ForwardingManager ────────────────────────────────────────────

/// Manages SSH port forwarding tunnels.
///
/// Thread-safe via `TokioMutex`. Stored as Tauri managed state.
/// Each tunnel is identified by a UUID and associated with an SSH
/// connection_id.
pub struct ForwardingManager {
    tunnels: Arc<TokioMutex<HashMap<String, ActiveTunnel>>>,
}

impl ForwardingManager {
    /// Creates a new empty forwarding manager.
    pub fn new() -> Self {
        Self {
            tunnels: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    /// Validates a forwarding rule input.
    pub fn validate_rule(
        rule: &ForwardingRuleInput,
    ) -> Result<(), ProtocolError> {
        if rule.local_port == 0 {
            return Err(ProtocolError::InvalidParams(
                "Local port must be non-zero".into(),
            ));
        }

        match rule.forwarding_type {
            ForwardingType::Local => {
                if rule.remote_host.is_none()
                    || rule
                        .remote_host
                        .as_deref()
                        .map_or(true, str::is_empty)
                {
                    return Err(ProtocolError::InvalidParams(
                        "Remote host is required for local forwarding"
                            .into(),
                    ));
                }
                if rule.remote_port.is_none()
                    || rule.remote_port == Some(0)
                {
                    return Err(ProtocolError::InvalidParams(
                        "Remote port is required for local forwarding"
                            .into(),
                    ));
                }
            }
            ForwardingType::Remote => {
                if rule.remote_host.is_none()
                    || rule
                        .remote_host
                        .as_deref()
                        .map_or(true, str::is_empty)
                {
                    return Err(ProtocolError::InvalidParams(
                        "Remote host is required for remote forwarding"
                            .into(),
                    ));
                }
                if rule.remote_port.is_none()
                    || rule.remote_port == Some(0)
                {
                    return Err(ProtocolError::InvalidParams(
                        "Remote port is required for remote forwarding"
                            .into(),
                    ));
                }
            }
            ForwardingType::Dynamic => {
                // Dynamic forwarding only needs local_port
            }
        }

        // Validate bind address format if provided
        if let Some(ref addr) = rule.bind_address {
            if !addr.is_empty() {
                addr.parse::<std::net::IpAddr>().map_err(|_| {
                    ProtocolError::InvalidParams(format!(
                        "Invalid bind address: {addr}"
                    ))
                })?;
            }
        }

        Ok(())
    }

    /// Returns the effective bind address for a rule.
    pub fn effective_bind_address(
        rule: &ForwardingRuleInput,
    ) -> String {
        rule.bind_address
            .as_deref()
            .filter(|a| !a.is_empty())
            .unwrap_or(DEFAULT_BIND_ADDRESS)
            .to_string()
    }

    /// Checks if the bind address is non-loopback (security concern).
    pub fn is_all_interfaces_bind(addr: &str) -> bool {
        addr == "0.0.0.0" || addr == "::"
    }

    /// Adds a local forwarding rule (-L).
    ///
    /// Binds a local TCP listener and spawns a task that accepts
    /// connections and opens `direct-tcpip` channels via ConnectionManager.
    pub async fn add_local_forward(
        &self,
        connection_id: String,
        rule: ForwardingRuleInput,
        conn_manager: Arc<crate::protocol::connection_manager::ConnectionManager>,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, ProtocolError> {
        Self::validate_rule(&rule)?;

        let tunnel_count = {
            let tunnels = self.tunnels.lock().await;
            tunnels
                .values()
                .filter(|t| t.connection_id == connection_id)
                .count()
        };
        if tunnel_count >= MAX_FORWARDING_RULES {
            return Err(ProtocolError::InvalidParams(format!(
                "Maximum forwarding rules reached ({MAX_FORWARDING_RULES})"
            )));
        }

        let bind_addr = Self::effective_bind_address(&rule);
        let local_port = rule.local_port;
        let remote_host =
            rule.remote_host.clone().unwrap_or_default();
        let remote_port = rule.remote_port.unwrap_or(0);

        // Emit security warning for all-interfaces bind
        if Self::is_all_interfaces_bind(&bind_addr) {
            let payload = serde_json::json!({
                "connectionId": connection_id,
                "bindAddress": bind_addr,
                "localPort": local_port,
                "warning": "Forwarding rule binds to all interfaces. \
                            This exposes the tunnel to the network.",
            });
            emitter.emit_event(
                "forwarding-security-warning",
                &payload.to_string(),
            );
        }

        // Bind the local TCP listener
        let bind_target = format!("{bind_addr}:{local_port}");
        let listener = TcpListener::bind(&bind_target)
            .await
            .map_err(|e| {
                ProtocolError::IoError(format!(
                    "Failed to bind {bind_target}: {e}"
                ))
            })?;

        let tunnel_id = Uuid::new_v4().to_string();
        let bytes_tx = Arc::new(AtomicU64::new(0));
        let bytes_rx = Arc::new(AtomicU64::new(0));
        let active_conns = Arc::new(AtomicU64::new(0));

        // Spawn the accept loop
        let tx = bytes_tx.clone();
        let rx = bytes_rx.clone();
        let conns = active_conns.clone();
        let tid = tunnel_id.clone();
        let cid = connection_id.clone();

        let listener_task = tokio::spawn(local_forward_accept_loop(
            listener,
            conn_manager,
            cid.clone(),
            remote_host.clone(),
            remote_port,
            tx,
            rx,
            conns,
            tid,
            emitter,
        ));

        let tunnel = ActiveTunnel {
            rule,
            connection_id: connection_id.clone(),
            bind_address: bind_addr,
            bytes_tx,
            bytes_rx,
            active_connections: active_conns,
            status: TunnelStatus::Active,
            error: None,
            listener_task: Some(listener_task),
        };

        let mut tunnels = self.tunnels.lock().await;
        tunnels.insert(tunnel_id.clone(), tunnel);

        Ok(tunnel_id)
    }

    /// Adds a remote forwarding rule (-R).
    ///
    /// Requests the SSH server to listen on a remote port and forward
    /// connections back to a local address.
    pub async fn add_remote_forward(
        &self,
        connection_id: String,
        rule: ForwardingRuleInput,
        conn_manager: &crate::protocol::connection_manager::ConnectionManager,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, ProtocolError> {
        Self::validate_rule(&rule)?;

        let tunnel_count = {
            let tunnels = self.tunnels.lock().await;
            tunnels
                .values()
                .filter(|t| t.connection_id == connection_id)
                .count()
        };
        if tunnel_count >= MAX_FORWARDING_RULES {
            return Err(ProtocolError::InvalidParams(format!(
                "Maximum forwarding rules reached ({MAX_FORWARDING_RULES})"
            )));
        }

        let remote_host =
            rule.remote_host.clone().unwrap_or_default();
        let remote_port = rule.remote_port.unwrap_or(0) as u32;
        let bind_addr = Self::effective_bind_address(&rule);

        // Request the server to forward a port via ConnectionManager
        let actual_port = conn_manager
            .request_tcpip_forward(
                &connection_id,
                &remote_host,
                remote_port,
            )
            .await?;

        let tunnel_id = Uuid::new_v4().to_string();
        let bytes_tx = Arc::new(AtomicU64::new(0));
        let bytes_rx = Arc::new(AtomicU64::new(0));
        let active_conns = Arc::new(AtomicU64::new(0));

        // Emit status event
        let payload = serde_json::json!({
            "tunnelId": tunnel_id,
            "connectionId": connection_id,
            "type": "remote",
            "remotePort": actual_port,
            "status": "active",
        });
        emitter.emit_event(
            "forwarding-status",
            &payload.to_string(),
        );

        let mut updated_rule = rule;
        if actual_port != remote_port {
            updated_rule.remote_port = Some(actual_port as u16);
        }

        let tunnel = ActiveTunnel {
            rule: updated_rule,
            connection_id: connection_id.clone(),
            bind_address: bind_addr,
            bytes_tx,
            bytes_rx,
            active_connections: active_conns,
            status: TunnelStatus::Active,
            error: None,
            listener_task: None, // Remote forward: server manages the listener
        };

        let mut tunnels = self.tunnels.lock().await;
        tunnels.insert(tunnel_id.clone(), tunnel);

        Ok(tunnel_id)
    }

    /// Adds a dynamic SOCKS5 forwarding rule (-D).
    ///
    /// Binds a local SOCKS5 proxy server that tunnels connections
    /// through the SSH session via ConnectionManager.
    pub async fn add_dynamic_forward(
        &self,
        connection_id: String,
        rule: ForwardingRuleInput,
        conn_manager: Arc<crate::protocol::connection_manager::ConnectionManager>,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, ProtocolError> {
        Self::validate_rule(&rule)?;

        let tunnel_count = {
            let tunnels = self.tunnels.lock().await;
            tunnels
                .values()
                .filter(|t| t.connection_id == connection_id)
                .count()
        };
        if tunnel_count >= MAX_FORWARDING_RULES {
            return Err(ProtocolError::InvalidParams(format!(
                "Maximum forwarding rules reached ({MAX_FORWARDING_RULES})"
            )));
        }

        let bind_addr = Self::effective_bind_address(&rule);
        let local_port = rule.local_port;

        if Self::is_all_interfaces_bind(&bind_addr) {
            let payload = serde_json::json!({
                "connectionId": connection_id,
                "bindAddress": bind_addr,
                "localPort": local_port,
                "warning": "SOCKS5 proxy binds to all interfaces. \
                            This exposes the tunnel to the network.",
            });
            emitter.emit_event(
                "forwarding-security-warning",
                &payload.to_string(),
            );
        }

        let bind_target = format!("{bind_addr}:{local_port}");
        let listener = TcpListener::bind(&bind_target)
            .await
            .map_err(|e| {
                ProtocolError::IoError(format!(
                    "Failed to bind SOCKS5 proxy on {bind_target}: {e}"
                ))
            })?;

        let tunnel_id = Uuid::new_v4().to_string();
        let bytes_tx = Arc::new(AtomicU64::new(0));
        let bytes_rx = Arc::new(AtomicU64::new(0));
        let active_conns = Arc::new(AtomicU64::new(0));

        let tx = bytes_tx.clone();
        let rx = bytes_rx.clone();
        let conns = active_conns.clone();
        let tid = tunnel_id.clone();
        let cid = connection_id.clone();

        let listener_task =
            tokio::spawn(socks5_accept_loop(
                listener,
                conn_manager,
                cid,
                tx,
                rx,
                conns,
                tid,
                emitter,
            ));

        let tunnel = ActiveTunnel {
            rule,
            connection_id: connection_id.clone(),
            bind_address: bind_addr,
            bytes_tx,
            bytes_rx,
            active_connections: active_conns,
            status: TunnelStatus::Active,
            error: None,
            listener_task: Some(listener_task),
        };

        let mut tunnels = self.tunnels.lock().await;
        tunnels.insert(tunnel_id.clone(), tunnel);

        Ok(tunnel_id)
    }

    /// Removes a forwarding tunnel by ID.
    ///
    /// Aborts the listener task and cleans up resources.
    pub async fn remove(
        &self,
        tunnel_id: &str,
    ) -> Result<(), ProtocolError> {
        let mut tunnels = self.tunnels.lock().await;
        let tunnel = tunnels.remove(tunnel_id).ok_or_else(|| {
            ProtocolError::InvalidParams(format!(
                "Forwarding tunnel not found: {tunnel_id}"
            ))
        })?;

        if let Some(task) = tunnel.listener_task {
            task.abort();
        }

        Ok(())
    }

    /// Removes all forwarding tunnels for a connection.
    ///
    /// Called when an SSH connection is closed.
    #[allow(dead_code)] // Called from connection teardown at runtime
    pub async fn remove_all_for_connection(
        &self,
        connection_id: &str,
    ) {
        let mut tunnels = self.tunnels.lock().await;
        let ids: Vec<String> = tunnels
            .iter()
            .filter(|(_, t)| t.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect();

        for id in ids {
            if let Some(tunnel) = tunnels.remove(&id) {
                if let Some(task) = tunnel.listener_task {
                    task.abort();
                }
            }
        }
    }

    /// Lists all forwarding tunnels for a connection.
    pub async fn list(
        &self,
        connection_id: &str,
    ) -> Vec<ForwardingStatus> {
        let tunnels = self.tunnels.lock().await;
        tunnels
            .iter()
            .filter(|(_, t)| t.connection_id == connection_id)
            .map(|(id, t)| ForwardingStatus {
                id: id.clone(),
                connection_id: t.connection_id.clone(),
                forwarding_type: t.rule.forwarding_type,
                local_port: t.rule.local_port,
                remote_host: t.rule.remote_host.clone(),
                remote_port: t.rule.remote_port,
                bind_address: t.bind_address.clone(),
                bytes_tx: t.bytes_tx.load(Ordering::Relaxed),
                bytes_rx: t.bytes_rx.load(Ordering::Relaxed),
                active_connections: t
                    .active_connections
                    .load(Ordering::Relaxed)
                    as u32,
                status: t.status,
                error: t.error.clone(),
            })
            .collect()
    }

    /// Gets status of all tunnels across all connections.
    pub async fn list_all(&self) -> Vec<ForwardingStatus> {
        let tunnels = self.tunnels.lock().await;
        tunnels
            .iter()
            .map(|(id, t)| ForwardingStatus {
                id: id.clone(),
                connection_id: t.connection_id.clone(),
                forwarding_type: t.rule.forwarding_type,
                local_port: t.rule.local_port,
                remote_host: t.rule.remote_host.clone(),
                remote_port: t.rule.remote_port,
                bind_address: t.bind_address.clone(),
                bytes_tx: t.bytes_tx.load(Ordering::Relaxed),
                bytes_rx: t.bytes_rx.load(Ordering::Relaxed),
                active_connections: t
                    .active_connections
                    .load(Ordering::Relaxed)
                    as u32,
                status: t.status,
                error: t.error.clone(),
            })
            .collect()
    }

    /// Handles an incoming remote-forwarded connection from the server.
    ///
    /// Called by `SshHandler::server_channel_open_forwarded_tcpip`.
    /// Connects to the local target and relays data bidirectionally.
    pub async fn handle_remote_forward_channel(
        &self,
        channel: russh::Channel<russh::client::Msg>,
        connected_address: &str,
        connected_port: u32,
    ) {
        // Find the matching tunnel
        let tunnel_info = {
            let tunnels = self.tunnels.lock().await;
            tunnels
                .iter()
                .find(|(_, t)| {
                    t.rule.forwarding_type == ForwardingType::Remote
                        && t.rule
                            .remote_host
                            .as_deref()
                            .map_or(false, |h| {
                                h == connected_address
                            })
                        && t.rule.remote_port
                            == Some(connected_port as u16)
                })
                .map(|(_, t)| {
                    (
                        t.rule.local_port,
                        t.bind_address.clone(),
                        t.bytes_tx.clone(),
                        t.bytes_rx.clone(),
                        t.active_connections.clone(),
                    )
                })
        };

        let Some((
            local_port,
            bind_addr,
            bytes_tx,
            bytes_rx,
            active_conns,
        )) = tunnel_info
        else {
            return;
        };

        // Connect to the local target
        let local_addr =
            format!("{bind_addr}:{local_port}");
        let tcp_stream =
            match tokio::net::TcpStream::connect(&local_addr).await
            {
                Ok(s) => s,
                Err(_) => return,
            };

        active_conns.fetch_add(1, Ordering::Relaxed);

        tokio::spawn(relay_channel_to_tcp(
            channel,
            tcp_stream,
            bytes_tx,
            bytes_rx,
            active_conns,
        ));
    }
}

// ── Accept Loops ─────────────────────────────────────────────────

/// Accept loop for local port forwarding (-L).
///
/// Listens for incoming TCP connections and opens a `direct-tcpip`
/// SSH channel for each via ConnectionManager, then relays data.
async fn local_forward_accept_loop(
    listener: TcpListener,
    conn_manager: Arc<crate::protocol::connection_manager::ConnectionManager>,
    connection_id: String,
    remote_host: String,
    remote_port: u16,
    bytes_tx: Arc<AtomicU64>,
    bytes_rx: Arc<AtomicU64>,
    active_conns: Arc<AtomicU64>,
    _tunnel_id: String,
    _emitter: Arc<dyn EventEmitter>,
) {
    loop {
        let (tcp_stream, peer_addr) = match listener.accept().await
        {
            Ok(conn) => conn,
            Err(_) => break, // Listener closed
        };

        let mgr = conn_manager.clone();
        let host = remote_host.clone();
        let cid = connection_id.clone();
        let tx = bytes_tx.clone();
        let rx = bytes_rx.clone();
        let conns = active_conns.clone();

        conns.fetch_add(1, Ordering::Relaxed);

        tokio::spawn(async move {
            let channel = match mgr
                .open_direct_tcpip_channel(
                    &cid,
                    &host,
                    remote_port as u32,
                    &peer_addr.ip().to_string(),
                    peer_addr.port() as u32,
                )
                .await
            {
                Ok(ch) => ch,
                Err(_) => {
                    conns.fetch_sub(1, Ordering::Relaxed);
                    return;
                }
            };

            relay_channel_to_tcp(channel, tcp_stream, tx, rx, conns)
                .await;
        });
    }
}

/// Accept loop for SOCKS5 dynamic forwarding (-D).
///
/// Accepts SOCKS5 connections, performs the handshake, then opens
/// a `direct-tcpip` channel for each CONNECT request via ConnectionManager.
async fn socks5_accept_loop(
    listener: TcpListener,
    conn_manager: Arc<crate::protocol::connection_manager::ConnectionManager>,
    connection_id: String,
    bytes_tx: Arc<AtomicU64>,
    bytes_rx: Arc<AtomicU64>,
    active_conns: Arc<AtomicU64>,
    _tunnel_id: String,
    _emitter: Arc<dyn EventEmitter>,
) {
    loop {
        let (tcp_stream, peer_addr) = match listener.accept().await
        {
            Ok(conn) => conn,
            Err(_) => break,
        };

        let mgr = conn_manager.clone();
        let cid = connection_id.clone();
        let tx = bytes_tx.clone();
        let rx = bytes_rx.clone();
        let conns = active_conns.clone();

        conns.fetch_add(1, Ordering::Relaxed);

        tokio::spawn(async move {
            if let Err(_) = handle_socks5_client(
                tcp_stream, mgr, &cid, peer_addr, tx, rx, &conns,
            )
            .await
            {
                conns.fetch_sub(1, Ordering::Relaxed);
            }
        });
    }
}

/// Handles a single SOCKS5 client connection.
///
/// Performs the SOCKS5 handshake (no-auth, CONNECT only),
/// then opens a `direct-tcpip` channel via ConnectionManager and relays data.
async fn handle_socks5_client(
    mut stream: tokio::net::TcpStream,
    conn_manager: Arc<crate::protocol::connection_manager::ConnectionManager>,
    connection_id: &str,
    peer_addr: SocketAddr,
    bytes_tx: Arc<AtomicU64>,
    bytes_rx: Arc<AtomicU64>,
    active_conns: &Arc<AtomicU64>,
) -> Result<(), ProtocolError> {
    // Phase 1: Method negotiation
    let (dest_host, dest_port) =
        socks5_handshake(&mut stream).await?;

    // Phase 2: Open direct-tcpip channel via ConnectionManager
    let channel = conn_manager
        .open_direct_tcpip_channel(
            connection_id,
            &dest_host,
            dest_port as u32,
            &peer_addr.ip().to_string(),
            peer_addr.port() as u32,
        )
        .await
        .map_err(|e| {
            ProtocolError::IoError(format!(
                "Failed to open SSH tunnel to {dest_host}:{dest_port}: {e}"
            ))
        })?;

    // Send SOCKS5 success reply
    let reply = [
        SOCKS5_VERSION,
        SOCKS5_REPLY_SUCCESS,
        0x00, // reserved
        SOCKS5_ATYP_IPV4,
        0, 0, 0, 0, // bind address (0.0.0.0)
        0, 0, // bind port (0)
    ];
    stream.write_all(&reply).await.map_err(|e| {
        ProtocolError::IoError(format!(
            "SOCKS5 reply write failed: {e}"
        ))
    })?;

    // Phase 3: Relay data
    let conns_clone = active_conns.clone();
    relay_channel_to_tcp(
        channel,
        stream,
        bytes_tx,
        bytes_rx,
        conns_clone,
    )
    .await;

    Ok(())
}

/// Performs the SOCKS5 handshake and returns the destination
/// host and port from the CONNECT request.
///
/// Supports: no-auth method, CONNECT command, IPv4/IPv6/domain.
pub async fn socks5_handshake(
    stream: &mut tokio::net::TcpStream,
) -> Result<(String, u16), ProtocolError> {
    // Read version + method count
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await.map_err(|e| {
        ProtocolError::IoError(format!(
            "SOCKS5 header read failed: {e}"
        ))
    })?;

    if header[0] != SOCKS5_VERSION {
        return Err(ProtocolError::InvalidParams(format!(
            "Unsupported SOCKS version: {}",
            header[0]
        )));
    }

    let method_count = header[1] as usize;
    if method_count == 0 || method_count > 255 {
        return Err(ProtocolError::InvalidParams(
            "Invalid SOCKS5 method count".into(),
        ));
    }

    // Read methods
    let mut methods = vec![0u8; method_count];
    stream.read_exact(&mut methods).await.map_err(|e| {
        ProtocolError::IoError(format!(
            "SOCKS5 methods read failed: {e}"
        ))
    })?;

    // Check for no-auth method
    if !methods.contains(&SOCKS5_AUTH_NONE) {
        let reply = [SOCKS5_VERSION, SOCKS5_AUTH_NO_ACCEPTABLE];
        let _ = stream.write_all(&reply).await;
        return Err(ProtocolError::AuthFailed(
            "SOCKS5: no acceptable authentication method".into(),
        ));
    }

    // Reply: use no-auth
    let reply = [SOCKS5_VERSION, SOCKS5_AUTH_NONE];
    stream.write_all(&reply).await.map_err(|e| {
        ProtocolError::IoError(format!(
            "SOCKS5 auth reply failed: {e}"
        ))
    })?;

    // Read request header: VER CMD RSV ATYP
    let mut req_header = [0u8; 4];
    stream
        .read_exact(&mut req_header)
        .await
        .map_err(|e| {
            ProtocolError::IoError(format!(
                "SOCKS5 request read failed: {e}"
            ))
        })?;

    if req_header[0] != SOCKS5_VERSION {
        return Err(ProtocolError::InvalidParams(
            "SOCKS5 request version mismatch".into(),
        ));
    }

    if req_header[1] != SOCKS5_CMD_CONNECT {
        // Only CONNECT is supported
        let reply = [
            SOCKS5_VERSION,
            SOCKS5_REPLY_CMD_NOT_SUPPORTED,
            0x00,
            SOCKS5_ATYP_IPV4,
            0, 0, 0, 0,
            0, 0,
        ];
        let _ = stream.write_all(&reply).await;
        return Err(ProtocolError::InvalidParams(format!(
            "SOCKS5 command not supported: {}",
            req_header[1]
        )));
    }

    // Parse destination address
    let dest_host = match req_header[3] {
        SOCKS5_ATYP_IPV4 => {
            let mut addr = [0u8; 4];
            stream.read_exact(&mut addr).await.map_err(|e| {
                ProtocolError::IoError(format!(
                    "SOCKS5 IPv4 read failed: {e}"
                ))
            })?;
            format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3])
        }
        SOCKS5_ATYP_DOMAIN => {
            let mut len_buf = [0u8; 1];
            stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| {
                    ProtocolError::IoError(format!(
                        "SOCKS5 domain length read failed: {e}"
                    ))
                })?;
            let len = len_buf[0] as usize;
            if len == 0 {
                return Err(ProtocolError::InvalidParams(
                    "SOCKS5 empty domain name".into(),
                ));
            }
            let mut domain = vec![0u8; len];
            stream
                .read_exact(&mut domain)
                .await
                .map_err(|e| {
                    ProtocolError::IoError(format!(
                        "SOCKS5 domain read failed: {e}"
                    ))
                })?;
            String::from_utf8(domain).map_err(|_| {
                ProtocolError::InvalidParams(
                    "SOCKS5 invalid domain encoding".into(),
                )
            })?
        }
        SOCKS5_ATYP_IPV6 => {
            let mut addr = [0u8; 16];
            stream.read_exact(&mut addr).await.map_err(|e| {
                ProtocolError::IoError(format!(
                    "SOCKS5 IPv6 read failed: {e}"
                ))
            })?;
            let ipv6 = std::net::Ipv6Addr::from(addr);
            ipv6.to_string()
        }
        atyp => {
            let reply = [
                SOCKS5_VERSION,
                SOCKS5_REPLY_ATYP_NOT_SUPPORTED,
                0x00,
                SOCKS5_ATYP_IPV4,
                0, 0, 0, 0,
                0, 0,
            ];
            let _ = stream.write_all(&reply).await;
            return Err(ProtocolError::InvalidParams(format!(
                "SOCKS5 address type not supported: {atyp}"
            )));
        }
    };

    // Read destination port (2 bytes, big-endian)
    let mut port_buf = [0u8; 2];
    stream
        .read_exact(&mut port_buf)
        .await
        .map_err(|e| {
            ProtocolError::IoError(format!(
                "SOCKS5 port read failed: {e}"
            ))
        })?;
    let dest_port = u16::from_be_bytes(port_buf);

    Ok((dest_host, dest_port))
}

// ── Relay ────────────────────────────────────────────────────────

/// Bidirectional relay between an SSH channel and a TCP stream.
///
/// Uses `tokio::select!` to concurrently read from both sides.
/// Updates byte counters atomically for status reporting.
async fn relay_channel_to_tcp(
    mut channel: russh::Channel<russh::client::Msg>,
    mut tcp_stream: tokio::net::TcpStream,
    bytes_tx: Arc<AtomicU64>,
    bytes_rx: Arc<AtomicU64>,
    active_conns: Arc<AtomicU64>,
) {
    let (mut tcp_read, mut tcp_write) =
        tcp_stream.split();
    let mut tcp_buf = vec![0u8; RELAY_BUFFER_SIZE];

    loop {
        tokio::select! {
            // TCP → SSH channel
            result = tcp_read.read(&mut tcp_buf) => {
                match result {
                    Ok(0) | Err(_) => break, // TCP closed
                    Ok(n) => {
                        bytes_tx.fetch_add(n as u64, Ordering::Relaxed);
                        if channel.data(&tcp_buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            // SSH channel → TCP
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        let len = data.len();
                        bytes_rx.fetch_add(len as u64, Ordering::Relaxed);
                        if tcp_write.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | None => break,
                    _ => {} // Ignore other messages
                }
            }
        }
    }

    // Clean up
    let _ = tcp_write.shutdown().await;
    let _ = channel.eof().await;
    active_conns.fetch_sub(1, Ordering::Relaxed);
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── ForwardingType serialization ─────────────────────────────

    #[test]
    fn forwarding_type_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ForwardingType::Local).unwrap(),
            r#""local""#
        );
        assert_eq!(
            serde_json::to_string(&ForwardingType::Remote).unwrap(),
            r#""remote""#
        );
        assert_eq!(
            serde_json::to_string(&ForwardingType::Dynamic).unwrap(),
            r#""dynamic""#
        );
    }

    #[test]
    fn forwarding_type_deserializes_lowercase() {
        let t: ForwardingType =
            serde_json::from_str(r#""local""#).unwrap();
        assert_eq!(t, ForwardingType::Local);
    }

    #[test]
    fn forwarding_type_roundtrip() {
        for variant in [
            ForwardingType::Local,
            ForwardingType::Remote,
            ForwardingType::Dynamic,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: ForwardingType =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    // ── TunnelStatus serialization ───────────────────────────────

    #[test]
    fn tunnel_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&TunnelStatus::Active).unwrap(),
            r#""active""#
        );
        assert_eq!(
            serde_json::to_string(&TunnelStatus::Stopped).unwrap(),
            r#""stopped""#
        );
    }

    #[test]
    fn tunnel_status_roundtrip() {
        for variant in [
            TunnelStatus::Starting,
            TunnelStatus::Active,
            TunnelStatus::Stopped,
            TunnelStatus::Error,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let restored: TunnelStatus =
                serde_json::from_str(&json).unwrap();
            assert_eq!(variant, restored);
        }
    }

    // ── ForwardingRuleInput serialization ─────────────────────────

    #[test]
    fn rule_input_local_forward_serializes() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("db.internal".into()),
            remote_port: Some(5432),
            bind_address: None,
        };
        let json = serde_json::to_string(&rule).unwrap();
        assert!(json.contains("\"forwardingType\":\"local\""));
        assert!(json.contains("\"localPort\":8080"));
        assert!(json.contains("\"remoteHost\":\"db.internal\""));
        assert!(json.contains("\"remotePort\":5432"));
        // bind_address should be omitted (None + skip_serializing_if)
        assert!(!json.contains("bindAddress"));
    }

    #[test]
    fn rule_input_dynamic_forward_serializes() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Dynamic,
            local_port: 1080,
            remote_host: None,
            remote_port: None,
            bind_address: None,
        };
        let json = serde_json::to_string(&rule).unwrap();
        assert!(json.contains("\"forwardingType\":\"dynamic\""));
        assert!(json.contains("\"localPort\":1080"));
        assert!(!json.contains("remoteHost"));
        assert!(!json.contains("remotePort"));
    }

    #[test]
    fn rule_input_deserializes_from_frontend_json() {
        let json = r#"{
            "forwardingType": "local",
            "localPort": 3306,
            "remoteHost": "mysql.internal",
            "remotePort": 3306
        }"#;
        let rule: ForwardingRuleInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(rule.forwarding_type, ForwardingType::Local);
        assert_eq!(rule.local_port, 3306);
        assert_eq!(
            rule.remote_host,
            Some("mysql.internal".into())
        );
        assert_eq!(rule.remote_port, Some(3306));
        assert_eq!(rule.bind_address, None);
    }

    #[test]
    fn rule_input_with_bind_address() {
        let json = r#"{
            "forwardingType": "local",
            "localPort": 8080,
            "remoteHost": "web.internal",
            "remotePort": 80,
            "bindAddress": "0.0.0.0"
        }"#;
        let rule: ForwardingRuleInput =
            serde_json::from_str(json).unwrap();
        assert_eq!(
            rule.bind_address,
            Some("0.0.0.0".into())
        );
    }

    // ── ForwardingStatus serialization ───────────────────────────

    #[test]
    fn forwarding_status_serializes_camel_case() {
        let status = ForwardingStatus {
            id: "tunnel-1".into(),
            connection_id: "conn-1".into(),
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("db.internal".into()),
            remote_port: Some(5432),
            bind_address: "127.0.0.1".into(),
            bytes_tx: 1024,
            bytes_rx: 2048,
            active_connections: 2,
            status: TunnelStatus::Active,
            error: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"bytesTx\":1024"));
        assert!(json.contains("\"bytesRx\":2048"));
        assert!(json.contains("\"activeConnections\":2"));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn forwarding_status_with_error() {
        let status = ForwardingStatus {
            id: "tunnel-1".into(),
            connection_id: "conn-1".into(),
            forwarding_type: ForwardingType::Dynamic,
            local_port: 1080,
            remote_host: None,
            remote_port: None,
            bind_address: "127.0.0.1".into(),
            bytes_tx: 0,
            bytes_rx: 0,
            active_connections: 0,
            status: TunnelStatus::Error,
            error: Some("port in use".into()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"error\":\"port in use\""));
        assert!(json.contains("\"status\":\"error\""));
    }

    // ── Validation tests ─────────────────────────────────────────

    #[test]
    fn validate_rejects_zero_local_port() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 0,
            remote_host: Some("host".into()),
            remote_port: Some(80),
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("non-zero"));
    }

    #[test]
    fn validate_local_requires_remote_host() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: None,
            remote_port: Some(80),
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Remote host"));
    }

    #[test]
    fn validate_local_rejects_empty_remote_host() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("".into()),
            remote_port: Some(80),
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
    }

    #[test]
    fn validate_local_requires_remote_port() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("host".into()),
            remote_port: None,
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Remote port"));
    }

    #[test]
    fn validate_local_rejects_zero_remote_port() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("host".into()),
            remote_port: Some(0),
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
    }

    #[test]
    fn validate_remote_requires_remote_host() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Remote,
            local_port: 3000,
            remote_host: None,
            remote_port: Some(3000),
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
    }

    #[test]
    fn validate_remote_requires_remote_port() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Remote,
            local_port: 3000,
            remote_host: Some("0.0.0.0".into()),
            remote_port: None,
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
    }

    #[test]
    fn validate_dynamic_only_needs_local_port() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Dynamic,
            local_port: 1080,
            remote_host: None,
            remote_port: None,
            bind_address: None,
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_ok());
    }

    #[test]
    fn validate_rejects_invalid_bind_address() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Dynamic,
            local_port: 1080,
            remote_host: None,
            remote_port: None,
            bind_address: Some("not-an-ip".into()),
        };
        let result = ForwardingManager::validate_rule(&rule);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid bind address"));
    }

    #[test]
    fn validate_accepts_valid_bind_addresses() {
        for addr in ["127.0.0.1", "0.0.0.0", "::1", "::"] {
            let rule = ForwardingRuleInput {
                forwarding_type: ForwardingType::Dynamic,
                local_port: 1080,
                remote_host: None,
                remote_port: None,
                bind_address: Some(addr.into()),
            };
            assert!(
                ForwardingManager::validate_rule(&rule).is_ok(),
                "Should accept bind address: {addr}"
            );
        }
    }

    #[test]
    fn validate_valid_local_forward() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("db.internal".into()),
            remote_port: Some(5432),
            bind_address: None,
        };
        assert!(ForwardingManager::validate_rule(&rule).is_ok());
    }

    #[test]
    fn validate_valid_remote_forward() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Remote,
            local_port: 3000,
            remote_host: Some("0.0.0.0".into()),
            remote_port: Some(8080),
            bind_address: None,
        };
        assert!(ForwardingManager::validate_rule(&rule).is_ok());
    }

    // ── Bind address helpers ─────────────────────────────────────

    #[test]
    fn effective_bind_address_defaults_to_loopback() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("h".into()),
            remote_port: Some(80),
            bind_address: None,
        };
        assert_eq!(
            ForwardingManager::effective_bind_address(&rule),
            "127.0.0.1"
        );
    }

    #[test]
    fn effective_bind_address_uses_provided() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("h".into()),
            remote_port: Some(80),
            bind_address: Some("0.0.0.0".into()),
        };
        assert_eq!(
            ForwardingManager::effective_bind_address(&rule),
            "0.0.0.0"
        );
    }

    #[test]
    fn effective_bind_address_ignores_empty_string() {
        let rule = ForwardingRuleInput {
            forwarding_type: ForwardingType::Local,
            local_port: 8080,
            remote_host: Some("h".into()),
            remote_port: Some(80),
            bind_address: Some("".into()),
        };
        assert_eq!(
            ForwardingManager::effective_bind_address(&rule),
            "127.0.0.1"
        );
    }

    #[test]
    fn is_all_interfaces_detects_ipv4_wildcard() {
        assert!(ForwardingManager::is_all_interfaces_bind(
            "0.0.0.0"
        ));
    }

    #[test]
    fn is_all_interfaces_detects_ipv6_wildcard() {
        assert!(ForwardingManager::is_all_interfaces_bind("::"));
    }

    #[test]
    fn is_all_interfaces_rejects_loopback() {
        assert!(!ForwardingManager::is_all_interfaces_bind(
            "127.0.0.1"
        ));
        assert!(!ForwardingManager::is_all_interfaces_bind("::1"));
    }

    // ── ForwardingManager state tests ────────────────────────────

    #[tokio::test]
    async fn new_manager_has_no_tunnels() {
        let mgr = ForwardingManager::new();
        let list = mgr.list("any-id").await;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn list_all_empty() {
        let mgr = ForwardingManager::new();
        let all = mgr.list_all().await;
        assert!(all.is_empty());
    }

    #[tokio::test]
    async fn remove_nonexistent_returns_error() {
        let mgr = ForwardingManager::new();
        let result = mgr.remove("nonexistent").await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("not found"));
    }

    #[tokio::test]
    async fn remove_all_for_connection_handles_empty() {
        let mgr = ForwardingManager::new();
        // Should not panic
        mgr.remove_all_for_connection("no-such-conn").await;
    }
}
