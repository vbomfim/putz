/// SSH jump host (ProxyJump) support — tunnel SSH through intermediate hops.
///
/// Implements SSH proxy/jump host chains where each hop connects via
/// `direct-tcpip` channel forwarding. Supports single and multi-hop
/// chains (A → B → C → target) with independent authentication per hop.
///
/// Architecture:
/// 1. `resolve_jump_chain()` walks `jump_host_id` references through
///    SessionManager to build an ordered list of hops.
/// 2. `connect_through_jump_hosts()` iterates the chain:
///    - SSH connect to hop (TCP or tunneled stream)
///    - Open `direct-tcpip` channel to the next hop
///    - Use channel stream as transport for the next SSH connection
/// 3. The final `SshConnection` stores intermediate handles for cleanup.
///
/// Security:
/// - Each hop authenticates independently (different credentials via vault)
/// - Agent forwarding is NOT enabled by default
/// - Vault passwords are resolved at the IPC layer — never passed from frontend
use std::sync::Arc;

use russh::client;

use super::SshHandler;
use crate::protocol::{
    ConnectionParams, ConnectionStatus, ConnectionStatusPayload, EventEmitter, ProtocolError,
};
use crate::session::models::Protocol;
use crate::session::SessionManager;
use crate::vault::VaultManager;

/// Maximum number of allowed jump host hops to prevent infinite chains.
const MAX_HOPS: usize = 10;

/// Represents one hop in a jump host chain.
///
/// Contains all the information needed to establish an SSH connection
/// to this intermediate host and tunnel through it.
#[derive(Debug, Clone)]
pub struct JumpHostHop {
    /// Session profile ID for this hop.
    pub session_id: String,
    /// Display name (for progress events).
    pub name: String,
    /// Hostname or IP address.
    pub host: String,
    /// SSH port.
    pub port: u16,
    /// SSH username.
    pub username: String,
    /// Vault credential ID for password/passphrase retrieval.
    pub credential_id: Option<String>,
    /// Pre-resolved vault password (resolved at IPC layer).
    pub vault_password: Option<String>,
    /// Path to SSH private key file.
    pub key_path: Option<String>,
}

/// Resolves the jump host chain from a session's `jump_host_id`.
///
/// Walks the chain by following `jump_host_id` references:
/// `target.jump_host_id → hop1, hop1.jump_host_id → hop2, ...`
///
/// Returns hops in connection order: `[first_hop, second_hop, ...]`
/// where `first_hop` is the one we connect to via TCP.
///
/// # Errors
/// - `InvalidParams` if a session is not found, not SSH, or chain exceeds MAX_HOPS
/// - `InvalidParams` if a circular reference is detected
pub fn resolve_jump_chain(
    target_jump_host_id: &str,
    session_manager: &SessionManager,
    vault: &VaultManager,
) -> Result<Vec<JumpHostHop>, ProtocolError> {
    let mut chain = Vec::new();
    let mut current_id = target_jump_host_id.to_string();
    let mut seen_ids = Vec::new();

    loop {
        // Circular reference detection
        if seen_ids.contains(&current_id) {
            return Err(ProtocolError::InvalidParams(format!(
                "Circular jump host chain detected at session '{current_id}'"
            )));
        }
        seen_ids.push(current_id.clone());

        // Max hops check
        if chain.len() >= MAX_HOPS {
            return Err(ProtocolError::InvalidParams(format!(
                "Jump host chain exceeds maximum of {MAX_HOPS} hops"
            )));
        }

        // Look up the session profile
        let profile = session_manager.get_session(&current_id).map_err(|e| {
            ProtocolError::InvalidParams(format!("Jump host session '{current_id}' not found: {e}"))
        })?;

        // Validate it's an SSH session
        if profile.protocol != Protocol::Ssh {
            return Err(ProtocolError::InvalidParams(format!(
                "Jump host '{}' must use SSH protocol, found {:?}",
                profile.name, profile.protocol
            )));
        }

        // Validate host is present
        let host = profile.host.as_deref().ok_or_else(|| {
            ProtocolError::InvalidParams(format!(
                "Jump host '{}' has no host configured",
                profile.name
            ))
        })?;

        if host.is_empty() {
            return Err(ProtocolError::InvalidParams(format!(
                "Jump host '{}' has an empty host",
                profile.name
            )));
        }

        // Resolve vault password for this hop
        let vault_password = if let Some(ref cred_id) = profile.credential_id {
            vault
                .get_for_session(cred_id)
                .ok()
                .map(|c| c.secret.clone())
        } else {
            None
        };

        chain.push(JumpHostHop {
            session_id: profile.id.clone(),
            name: profile.name.clone(),
            host: host.to_string(),
            port: profile.port.unwrap_or(22),
            username: profile.username.unwrap_or_else(|| "root".to_string()),
            credential_id: profile.credential_id.clone(),
            vault_password,
            key_path: None, // Key path not stored in session profile
        });

        // Check if this hop also has a jump host (multi-hop)
        match profile.jump_host_id {
            Some(ref next_id) if !next_id.is_empty() => {
                current_id = next_id.clone();
            }
            _ => break,
        }
    }

    // Reverse so first_hop (the one we TCP-connect to) is at index 0
    chain.reverse();
    Ok(chain)
}

/// Connects to a target through a chain of jump hosts.
///
/// For each hop in the chain:
/// 1. Establish SSH connection (via TCP for first hop, via tunnel for subsequent)
/// 2. Open a `direct-tcpip` channel to the next hop's host:port
/// 3. Use the channel stream as transport for the next SSH connection
///
/// Returns a connected `SshConnection` to the final target, along with
/// all intermediate SSH session handles (for lifecycle management).
///
/// # Progress Events
/// Emits `connection-status-{connection_id}` events:
/// - "Connecting hop 1 of N: HopName..."
/// - "Authenticating hop 1 of N: HopName..."
pub async fn connect_through_jump_hosts(
    hops: &[JumpHostHop],
    target_params: ConnectionParams,
    connection_id: String,
    emitter: Arc<dyn EventEmitter>,
    target_vault_password: Option<String>,
) -> Result<(super::SshConnection, Vec<client::Handle<SshHandler>>), ProtocolError> {
    if hops.is_empty() {
        return Err(ProtocolError::InvalidParams(
            "Jump host chain is empty".into(),
        ));
    }

    let total_hops = hops.len();
    let mut jump_sessions: Vec<client::Handle<SshHandler>> = Vec::new();

    // The current stream to use for the next connection.
    // None = use TCP (first hop), Some = use tunneled stream.
    let mut current_stream: Option<russh::ChannelStream<client::Msg>> = None;

    for (i, hop) in hops.iter().enumerate() {
        let hop_number = i + 1;

        // Emit progress: connecting to this hop
        emitter.emit_status(
            &connection_id,
            &ConnectionStatusPayload {
                status: ConnectionStatus::Connecting,
                message: Some(format!(
                    "Connecting hop {hop_number} of {}: {}...",
                    total_hops + 1,
                    hop.name
                )),
            },
        );

        // Build connection params for this hop
        let hop_params = ConnectionParams {
            host: Some(hop.host.clone()),
            port: Some(hop.port),
            username: Some(hop.username.clone()),
            cols: target_params.cols,
            rows: target_params.rows,
            credential_id: hop.credential_id.clone(),
            key_path: hop.key_path.clone(),
        };

        // Connect to this hop
        let mut hop_conn = super::SshConnection::new();

        match current_stream {
            None => {
                // First hop: connect via TCP
                hop_conn
                    .connect_with_emitter(
                        hop_params,
                        format!("{connection_id}-hop-{hop_number}"),
                        emitter.clone(),
                        hop.vault_password.clone(),
                    )
                    .await
                    .map_err(|e| {
                        ProtocolError::ConnectionRefused(format!(
                            "Jump host '{}' (hop {hop_number}): {e}",
                            hop.name
                        ))
                    })?;
            }
            Some(stream) => {
                // Subsequent hop: connect through tunnel
                hop_conn
                    .connect_with_emitter_over_stream(
                        stream,
                        hop_params,
                        format!("{connection_id}-hop-{hop_number}"),
                        emitter.clone(),
                        hop.vault_password.clone(),
                    )
                    .await
                    .map_err(|e| {
                        ProtocolError::ConnectionRefused(format!(
                            "Jump host '{}' (hop {hop_number}): {e}",
                            hop.name
                        ))
                    })?;
            }
        }

        // Open direct-tcpip channel to the next destination
        let next_host;
        let next_port;

        if i + 1 < hops.len() {
            // Next destination is the next hop
            next_host = hops[i + 1].host.clone();
            next_port = hops[i + 1].port as u32;
        } else {
            // Next destination is the final target
            next_host = target_params
                .host
                .as_deref()
                .ok_or_else(|| ProtocolError::InvalidParams("Target host is required".into()))?
                .to_string();
            next_port = target_params.port.unwrap_or(22) as u32;
        }

        // Get the session handle to open the channel
        let session_handle = hop_conn.session_handle().ok_or_else(|| {
            ProtocolError::ChannelClosed(format!("Jump host '{}' session not available", hop.name))
        })?;

        let channel = session_handle
            .channel_open_direct_tcpip(next_host, next_port, "127.0.0.1", 0)
            .await
            .map_err(|e| {
                ProtocolError::ChannelClosed(format!(
                    "Failed to open tunnel through '{}': {e}",
                    hop.name
                ))
            })?;

        current_stream = Some(channel.into_stream());

        // Extract the session handle for lifecycle management.
        // We take ownership via close_keep_session() which detaches
        // the handle without disconnecting.
        let handle = hop_conn.take_session_handle().ok_or_else(|| {
            ProtocolError::ChannelClosed(format!(
                "Failed to extract session handle from '{}'",
                hop.name
            ))
        })?;
        jump_sessions.push(handle);
    }

    // Connect the final target through the last tunnel
    emitter.emit_status(
        &connection_id,
        &ConnectionStatusPayload {
            status: ConnectionStatus::Connecting,
            message: Some(format!(
                "Connecting hop {} of {}: target...",
                total_hops + 1,
                total_hops + 1,
            )),
        },
    );

    let stream = current_stream.ok_or_else(|| {
        ProtocolError::ChannelClosed("No tunnel stream available for target".into())
    })?;

    let mut target_conn = super::SshConnection::new();
    target_conn
        .connect_with_emitter_over_stream(
            stream,
            target_params,
            connection_id,
            emitter,
            target_vault_password,
        )
        .await?;

    Ok((target_conn, jump_sessions))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // JumpHostHop tests
    // ====================================================================

    #[test]
    fn jump_host_hop_is_cloneable() {
        let hop = JumpHostHop {
            session_id: "sess-1".into(),
            name: "Bastion-1".into(),
            host: "10.0.0.1".into(),
            port: 22,
            username: "admin".into(),
            credential_id: Some("cred-1".into()),
            vault_password: Some("pass".into()),
            key_path: None,
        };
        let cloned = hop.clone();
        assert_eq!(cloned.session_id, "sess-1");
        assert_eq!(cloned.name, "Bastion-1");
        assert_eq!(cloned.host, "10.0.0.1");
        assert_eq!(cloned.port, 22);
        assert_eq!(cloned.username, "admin");
    }

    #[test]
    fn jump_host_hop_debug_format() {
        let hop = JumpHostHop {
            session_id: "s1".into(),
            name: "Test".into(),
            host: "host".into(),
            port: 22,
            username: "user".into(),
            credential_id: None,
            vault_password: None,
            key_path: None,
        };
        let debug = format!("{hop:?}");
        assert!(debug.contains("JumpHostHop"));
        assert!(debug.contains("Test"));
    }

    // ====================================================================
    // MAX_HOPS constant tests
    // ====================================================================

    #[test]
    fn max_hops_is_reasonable() {
        assert!(MAX_HOPS >= 3, "Should support at least 3 hops");
        assert!(MAX_HOPS <= 20, "Should not allow excessive hops");
    }

    // ====================================================================
    // connect_through_jump_hosts validation tests
    // ====================================================================

    #[tokio::test]
    async fn connect_through_empty_chain_returns_error() {
        let emitter = Arc::new(crate::protocol::test_utils::MockEmitter::new());
        let params = ConnectionParams {
            host: Some("target.local".into()),
            port: Some(22),
            username: Some("admin".into()),
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        let result =
            connect_through_jump_hosts(&[], params, "test-conn".into(), emitter, None).await;

        assert!(result.is_err());
        let err = match result {
            Err(e) => e,
            Ok(_) => panic!("Expected error"),
        };
        match err {
            ProtocolError::InvalidParams(msg) => {
                assert!(
                    msg.contains("empty"),
                    "Error should mention empty chain: {msg}"
                );
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn connect_emits_hop_progress_events() {
        let emitter = Arc::new(crate::protocol::test_utils::MockEmitter::new());
        let params = ConnectionParams {
            host: Some("target.local".into()),
            port: Some(22),
            username: Some("admin".into()),
            cols: 80,
            rows: 24,
            credential_id: None,
            key_path: None,
        };

        // This will fail at TCP connect, but we can verify the
        // progress event was emitted before the failure
        let hop = JumpHostHop {
            session_id: "hop-1".into(),
            name: "Bastion-1".into(),
            host: "192.0.2.1".into(), // RFC 5737 TEST-NET
            port: 22,
            username: "admin".into(),
            credential_id: None,
            vault_password: None,
            key_path: None,
        };

        let _ =
            connect_through_jump_hosts(&[hop], params, "test-conn".into(), emitter.clone(), None)
                .await;

        // Verify progress event was emitted
        let statuses = emitter.statuses.lock().unwrap();
        assert!(
            !statuses.is_empty(),
            "Should emit at least one status event"
        );
        let (conn_id, payload) = &statuses[0];
        assert_eq!(conn_id, "test-conn");
        assert_eq!(payload.status, ConnectionStatus::Connecting);
        assert!(
            payload.message.as_ref().unwrap().contains("Bastion-1"),
            "Progress message should contain hop name"
        );
        assert!(
            payload.message.as_ref().unwrap().contains("hop 1"),
            "Progress message should contain hop number"
        );
    }

    // ====================================================================
    // resolve_jump_chain tests (require SessionManager + VaultManager)
    // These test the chain resolution logic using real managers with
    // temp directories.
    // ====================================================================

    use crate::session::models::CreateSessionInput;

    fn setup_managers() -> (SessionManager, VaultManager, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.into_path();
        let sm = SessionManager::with_config_dir(path.clone());
        let vm = VaultManager::new();
        (sm, vm, path)
    }

    fn cleanup(path: &std::path::Path) {
        let _ = std::fs::remove_dir_all(path);
    }

    fn create_ssh_session(
        sm: &SessionManager,
        name: &str,
        host: &str,
        jump_host_id: Option<String>,
    ) -> String {
        let input = CreateSessionInput {
            name: name.to_string(),
            folder_id: "root".to_string(),
            protocol: Protocol::Ssh,
            host: Some(host.to_string()),
            port: Some(22),
            username: Some("admin".to_string()),
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id,
            auto_login: None,
            auto_login_device_type: None,
        };
        sm.create_session(input).unwrap()
    }

    #[test]
    fn resolve_single_hop_chain() {
        let (sm, vm, dir) = setup_managers();
        let bastion_id = create_ssh_session(&sm, "Bastion-1", "10.0.0.1", None);

        let chain = resolve_jump_chain(&bastion_id, &sm, &vm).unwrap();
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].name, "Bastion-1");
        assert_eq!(chain[0].host, "10.0.0.1");
        assert_eq!(chain[0].port, 22);
        assert_eq!(chain[0].username, "admin");

        cleanup(&dir);
    }

    #[test]
    fn resolve_multi_hop_chain() {
        let (sm, vm, dir) = setup_managers();

        // Create chain: Bastion-1 (no jump) → JumpBox-2 (jumps through Bastion-1)
        let bastion_id = create_ssh_session(&sm, "Bastion-1", "10.0.0.1", None);
        let jumpbox_id = create_ssh_session(&sm, "JumpBox-2", "10.0.1.1", Some(bastion_id.clone()));

        // Resolve from jumpbox (the last hop before target)
        let chain = resolve_jump_chain(&jumpbox_id, &sm, &vm).unwrap();

        // Chain should be [Bastion-1, JumpBox-2] (connection order)
        assert_eq!(chain.len(), 2);
        assert_eq!(chain[0].name, "Bastion-1");
        assert_eq!(chain[0].host, "10.0.0.1");
        assert_eq!(chain[1].name, "JumpBox-2");
        assert_eq!(chain[1].host, "10.0.1.1");

        cleanup(&dir);
    }

    #[test]
    fn resolve_three_hop_chain() {
        let (sm, vm, dir) = setup_managers();

        let hop1_id = create_ssh_session(&sm, "Hop-1", "10.0.0.1", None);
        let hop2_id = create_ssh_session(&sm, "Hop-2", "10.0.1.1", Some(hop1_id.clone()));
        let hop3_id = create_ssh_session(&sm, "Hop-3", "10.0.2.1", Some(hop2_id.clone()));

        let chain = resolve_jump_chain(&hop3_id, &sm, &vm).unwrap();

        assert_eq!(chain.len(), 3);
        assert_eq!(chain[0].name, "Hop-1");
        assert_eq!(chain[1].name, "Hop-2");
        assert_eq!(chain[2].name, "Hop-3");

        cleanup(&dir);
    }

    #[test]
    fn resolve_detects_circular_chain() {
        let (sm, vm, dir) = setup_managers();

        // Create two sessions that point to each other
        let id1 = create_ssh_session(&sm, "Loop-A", "10.0.0.1", None);
        let id2 = create_ssh_session(&sm, "Loop-B", "10.0.0.2", Some(id1.clone()));

        // Update Loop-A to point to Loop-B (creating a cycle)
        use crate::session::models::UpdateSessionInput;
        let update = UpdateSessionInput {
            name: None,
            folder_id: None,
            protocol: None,
            host: None,
            port: None,
            username: None,
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id: Some(id2.clone()),
            auto_login: None,
            auto_login_device_type: None,
        };
        sm.update_session(&id1, update).unwrap();

        let result = resolve_jump_chain(&id1, &sm, &vm);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(
                    msg.contains("Circular"),
                    "Error should mention circular: {msg}"
                );
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }

        cleanup(&dir);
    }

    #[test]
    fn resolve_rejects_non_ssh_jump_host() {
        let (sm, vm, dir) = setup_managers();

        // Create a Telnet session
        let input = CreateSessionInput {
            name: "Telnet-Host".to_string(),
            folder_id: "root".to_string(),
            protocol: Protocol::Telnet,
            host: Some("10.0.0.1".to_string()),
            port: Some(23),
            username: None,
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id: None,
            auto_login: None,
            auto_login_device_type: None,
        };
        let telnet_id = sm.create_session(input).unwrap();

        let result = resolve_jump_chain(&telnet_id, &sm, &vm);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(
                    msg.contains("SSH protocol"),
                    "Error should mention SSH requirement: {msg}"
                );
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }

        cleanup(&dir);
    }

    #[test]
    fn resolve_rejects_empty_host() {
        let (sm, vm, dir) = setup_managers();

        // Create with empty string host (SessionManager may accept
        // but proxy should reject at chain resolution)
        let input = CreateSessionInput {
            name: "Empty-Host".to_string(),
            folder_id: "root".to_string(),
            protocol: Protocol::Ssh,
            host: Some("".to_string()),
            port: Some(22),
            username: Some("admin".to_string()),
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id: None,
            auto_login: None,
            auto_login_device_type: None,
        };

        // SessionManager may reject empty host for SSH — if so,
        // the test validates the upstream guard
        match sm.create_session(input) {
            Ok(id) => {
                let result = resolve_jump_chain(&id, &sm, &vm);
                assert!(result.is_err(), "Should reject empty host");
                match result.unwrap_err() {
                    ProtocolError::InvalidParams(msg) => {
                        assert!(
                            msg.contains("empty"),
                            "Error should mention empty host: {msg}"
                        );
                    }
                    other => panic!("Expected InvalidParams, got: {other:?}"),
                }
            }
            Err(_) => {
                // SessionManager already rejects SSH without host —
                // this is the expected upstream guard, test passes
            }
        }

        cleanup(&dir);
    }

    #[test]
    fn resolve_rejects_nonexistent_session() {
        let (sm, vm, dir) = setup_managers();

        let result = resolve_jump_chain("550e8400-e29b-41d4-a716-446655440000", &sm, &vm);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::InvalidParams(msg) => {
                assert!(
                    msg.contains("not found"),
                    "Error should mention not found: {msg}"
                );
            }
            other => panic!("Expected InvalidParams, got: {other:?}"),
        }

        cleanup(&dir);
    }

    #[test]
    fn resolve_uses_default_port_and_username() {
        let (sm, vm, dir) = setup_managers();

        let input = CreateSessionInput {
            name: "Minimal".to_string(),
            folder_id: "root".to_string(),
            protocol: Protocol::Ssh,
            host: Some("10.0.0.1".to_string()),
            port: None,     // Should default to 22
            username: None, // Should default to "root"
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id: None,
            auto_login: None,
            auto_login_device_type: None,
        };
        let id = sm.create_session(input).unwrap();

        let chain = resolve_jump_chain(&id, &sm, &vm).unwrap();
        assert_eq!(chain[0].port, 22);
        assert_eq!(chain[0].username, "root");

        cleanup(&dir);
    }
}
