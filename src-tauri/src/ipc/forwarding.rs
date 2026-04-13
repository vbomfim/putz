/// IPC commands for SSH port forwarding operations.
///
/// These are the Tauri command handlers for adding, removing, listing,
/// and querying status of forwarding tunnels on SSH connections.
///
/// Architecture: ForwardingManager is a separate Tauri managed state
/// (like SftpManager). It uses connection_id to look up the SSH
/// session handle via ConnectionManager.
use tauri::State;

use crate::protocol::connection_manager::ConnectionManager;
use crate::protocol::ssh::forwarding::{
    ForwardingManager, ForwardingRuleInput, ForwardingStatus, ForwardingType,
};

/// Adds a port forwarding rule to an active SSH connection.
///
/// Supports local (-L), remote (-R), and dynamic SOCKS5 (-D) forwarding.
/// Rules can be added to active sessions without disconnecting (ad-hoc).
///
/// Security: local listeners bind 127.0.0.1 by default. A security
/// warning event is emitted if bind_address is set to "0.0.0.0".
#[tauri::command]
pub async fn forwarding_add(
    app: tauri::AppHandle,
    conn_manager: State<'_, ConnectionManager>,
    fwd_manager: State<'_, ForwardingManager>,
    connection_id: String,
    rule: ForwardingRuleInput,
) -> Result<String, String> {
    let emitter = std::sync::Arc::new(crate::protocol::TauriEventEmitter::new(app));

    // Clone the ConnectionManager (cheap — inner state is Arc-wrapped).
    // Background tasks need an owned reference to open channels on-demand.
    let conn_mgr = conn_manager.inner().clone();

    match rule.forwarding_type {
        ForwardingType::Local => fwd_manager
            .add_local_forward(connection_id, rule, std::sync::Arc::new(conn_mgr), emitter)
            .await
            .map_err(|e| e.to_string()),
        ForwardingType::Remote => fwd_manager
            .add_remote_forward(connection_id, rule, &conn_mgr, emitter)
            .await
            .map_err(|e| e.to_string()),
        ForwardingType::Dynamic => fwd_manager
            .add_dynamic_forward(connection_id, rule, std::sync::Arc::new(conn_mgr), emitter)
            .await
            .map_err(|e| e.to_string()),
    }
}

/// Removes a forwarding tunnel by its ID.
///
/// Stops the listener and cleans up relay tasks.
#[tauri::command]
pub async fn forwarding_remove(
    fwd_manager: State<'_, ForwardingManager>,
    tunnel_id: String,
) -> Result<(), String> {
    fwd_manager
        .remove(&tunnel_id)
        .await
        .map_err(|e| e.to_string())
}

/// Lists all forwarding tunnels for an SSH connection.
///
/// Returns status information including byte counters and
/// active connection counts.
#[tauri::command]
pub async fn forwarding_list(
    fwd_manager: State<'_, ForwardingManager>,
    connection_id: String,
) -> Result<Vec<ForwardingStatus>, String> {
    Ok(fwd_manager.list(&connection_id).await)
}

/// Gets the status of all forwarding tunnels across all connections.
///
/// Used by the ForwardingPanel to display a global tunnel overview.
#[tauri::command]
pub async fn forwarding_status(
    fwd_manager: State<'_, ForwardingManager>,
) -> Result<Vec<ForwardingStatus>, String> {
    Ok(fwd_manager.list_all().await)
}

#[cfg(test)]
mod tests {
    use crate::protocol::ssh::forwarding::{ForwardingRuleInput, ForwardingType};
    use crate::protocol::ssh::x11::X11ForwardingConfig;

    #[test]
    fn rule_input_deserializes_local_forward() {
        let json = r#"{
            "forwardingType": "local",
            "localPort": 8080,
            "remoteHost": "db.internal",
            "remotePort": 5432
        }"#;
        let rule: ForwardingRuleInput = serde_json::from_str(json).unwrap();
        assert_eq!(rule.forwarding_type, ForwardingType::Local);
        assert_eq!(rule.local_port, 8080);
        assert_eq!(rule.remote_host, Some("db.internal".into()));
        assert_eq!(rule.remote_port, Some(5432));
    }

    #[test]
    fn rule_input_deserializes_dynamic_forward() {
        let json = r#"{
            "forwardingType": "dynamic",
            "localPort": 1080
        }"#;
        let rule: ForwardingRuleInput = serde_json::from_str(json).unwrap();
        assert_eq!(rule.forwarding_type, ForwardingType::Dynamic);
        assert_eq!(rule.local_port, 1080);
        assert_eq!(rule.remote_host, None);
    }

    #[test]
    fn rule_input_deserializes_remote_forward() {
        let json = r#"{
            "forwardingType": "remote",
            "localPort": 3000,
            "remoteHost": "0.0.0.0",
            "remotePort": 8080
        }"#;
        let rule: ForwardingRuleInput = serde_json::from_str(json).unwrap();
        assert_eq!(rule.forwarding_type, ForwardingType::Remote);
        assert_eq!(rule.local_port, 3000);
        assert_eq!(rule.remote_port, Some(8080));
    }

    #[test]
    fn rule_input_with_bind_address() {
        let json = r#"{
            "forwardingType": "local",
            "localPort": 8080,
            "remoteHost": "web.internal",
            "remotePort": 80,
            "bindAddress": "192.168.1.100"
        }"#;
        let rule: ForwardingRuleInput = serde_json::from_str(json).unwrap();
        assert_eq!(rule.bind_address, Some("192.168.1.100".into()));
    }

    #[test]
    fn rule_input_rejects_invalid_type() {
        let json = r#"{
            "forwardingType": "invalid",
            "localPort": 8080
        }"#;
        let result = serde_json::from_str::<ForwardingRuleInput>(json);
        assert!(result.is_err());
    }

    #[test]
    fn x11_config_deserializes() {
        let json = r#"{
            "enabled": true,
            "displayNumber": 10,
            "trusted": true
        }"#;
        let config: X11ForwardingConfig = serde_json::from_str(json).unwrap();
        assert!(config.enabled);
        assert_eq!(config.display_number, Some(10));
        assert!(config.trusted);
    }

    #[test]
    fn x11_config_defaults() {
        let json = r#"{
            "enabled": false,
            "trusted": false
        }"#;
        let config: X11ForwardingConfig = serde_json::from_str(json).unwrap();
        assert!(!config.enabled);
        assert_eq!(config.display_number, None);
        assert!(!config.trusted);
    }
}
