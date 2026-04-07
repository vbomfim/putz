/// Session data models for the session manager.
///
/// These types are serialized to/from JSON for persistence (sessions.json)
/// and cross the IPC boundary to the React frontend.
use serde::{Deserialize, Serialize};

/// Connection protocol for a session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ssh,
    Telnet,
    Serial,
    Local,
}

impl Protocol {
    /// Returns the default port for this protocol, if applicable.
    #[allow(dead_code)]
    pub fn default_port(&self) -> Option<u16> {
        match self {
            Protocol::Ssh => Some(22),
            Protocol::Telnet => Some(23),
            Protocol::Serial | Protocol::Local => None,
        }
    }
}

/// A saved session profile containing connection details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProfile {
    pub id: String,
    pub name: String,
    pub folder_id: String,
    pub protocol: Protocol,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_port: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_baud: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_data_bits: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_parity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_stop_bits: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_flow_control: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_log: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_host_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_login: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_login_device_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A folder for organizing session profiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFolder {
    pub id: String,
    pub name: String,
    pub parent_id: String,
    pub sort_order: i32,
    pub expanded: bool,
}

/// Top-level store serialized to sessions.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    pub version: u32,
    pub sessions: Vec<SessionProfile>,
    pub folders: Vec<SessionFolder>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self {
            version: 1,
            sessions: Vec::new(),
            folders: Vec::new(),
        }
    }
}

/// Tree node for the frontend session tree view.
///
/// A node is either a folder (with children) or a session (leaf).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SessionNode {
    #[serde(rename_all = "camelCase")]
    Folder {
        id: String,
        name: String,
        parent_id: String,
        sort_order: i32,
        expanded: bool,
        children: Vec<SessionNode>,
    },
    #[serde(rename_all = "camelCase")]
    Session {
        id: String,
        name: String,
        protocol: Protocol,
        host: Option<String>,
        port: Option<u16>,
        username: Option<String>,
    },
}

/// Input DTO for creating a new session (no id, timestamps auto-generated).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub name: String,
    #[serde(default = "default_folder_id")]
    pub folder_id: String,
    pub protocol: Protocol,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub credential_id: Option<String>,
    pub serial_port: Option<String>,
    pub serial_baud: Option<u32>,
    pub serial_data_bits: Option<String>,
    pub serial_parity: Option<String>,
    pub serial_stop_bits: Option<String>,
    pub serial_flow_control: Option<String>,
    pub color_scheme: Option<String>,
    pub auto_log: Option<bool>,
    pub jump_host_id: Option<String>,
    pub auto_login: Option<bool>,
    pub auto_login_device_type: Option<String>,
}

fn default_folder_id() -> String {
    "root".to_string()
}

/// Input DTO for updating a session (partial — only non-None fields apply).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionInput {
    pub name: Option<String>,
    pub folder_id: Option<String>,
    pub protocol: Option<Protocol>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub credential_id: Option<String>,
    pub serial_port: Option<String>,
    pub serial_baud: Option<u32>,
    pub serial_data_bits: Option<String>,
    pub serial_parity: Option<String>,
    pub serial_stop_bits: Option<String>,
    pub serial_flow_control: Option<String>,
    pub color_scheme: Option<String>,
    pub auto_log: Option<bool>,
    pub jump_host_id: Option<String>,
    pub auto_login: Option<bool>,
    pub auto_login_device_type: Option<String>,
}

/// Input DTO for moving a session to a different folder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct MoveSessionInput {
    pub id: String,
    pub target_folder_id: String,
    pub sort_order: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_default_port_ssh() {
        assert_eq!(Protocol::Ssh.default_port(), Some(22));
    }

    #[test]
    fn protocol_default_port_telnet() {
        assert_eq!(Protocol::Telnet.default_port(), Some(23));
    }

    #[test]
    fn protocol_default_port_serial() {
        assert_eq!(Protocol::Serial.default_port(), None);
    }

    #[test]
    fn protocol_default_port_local() {
        assert_eq!(Protocol::Local.default_port(), None);
    }

    #[test]
    fn protocol_serializes_lowercase() {
        let json = serde_json::to_string(&Protocol::Ssh).unwrap();
        assert_eq!(json, r#""ssh""#);
    }

    #[test]
    fn protocol_deserializes_lowercase() {
        let p: Protocol = serde_json::from_str(r#""telnet""#).unwrap();
        assert_eq!(p, Protocol::Telnet);
    }

    #[test]
    fn session_store_default_is_empty() {
        let store = SessionStore::default();
        assert_eq!(store.version, 1);
        assert!(store.sessions.is_empty());
        assert!(store.folders.is_empty());
    }

    #[test]
    fn session_profile_serializes_camel_case() {
        let profile = SessionProfile {
            id: "test-id".into(),
            name: "Test".into(),
            folder_id: "root".into(),
            protocol: Protocol::Ssh,
            host: Some("example.com".into()),
            port: Some(22),
            username: Some("admin".into()),
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
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(json.contains("folderId"));
        assert!(json.contains("createdAt"));
        // None fields should be omitted
        assert!(!json.contains("serialPort"));
        assert!(!json.contains("credentialId"));
        assert!(!json.contains("autoLogin"));
    }

    #[test]
    fn session_profile_roundtrip() {
        let profile = SessionProfile {
            id: "abc-123".into(),
            name: "My Server".into(),
            folder_id: "root".into(),
            protocol: Protocol::Ssh,
            host: Some("10.0.0.1".into()),
            port: Some(2222),
            username: Some("root".into()),
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: Some("dark".into()),
            auto_log: Some(true),
            jump_host_id: None,
            auto_login: None,
            auto_login_device_type: None,
            created_at: "2024-06-01T12:00:00Z".into(),
            updated_at: "2024-06-01T12:00:00Z".into(),
        };
        let json = serde_json::to_string(&profile).unwrap();
        let deserialized: SessionProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "abc-123");
        assert_eq!(deserialized.name, "My Server");
        assert_eq!(deserialized.host, Some("10.0.0.1".into()));
        assert_eq!(deserialized.port, Some(2222));
    }

    #[test]
    fn session_folder_serializes_camel_case() {
        let folder = SessionFolder {
            id: "folder-1".into(),
            name: "Production".into(),
            parent_id: "root".into(),
            sort_order: 0,
            expanded: true,
        };
        let json = serde_json::to_string(&folder).unwrap();
        assert!(json.contains("parentId"));
        assert!(json.contains("sortOrder"));
    }

    #[test]
    fn session_node_folder_serializes_with_type_tag() {
        let node = SessionNode::Folder {
            id: "f1".into(),
            name: "Dev".into(),
            parent_id: "root".into(),
            sort_order: 0,
            expanded: true,
            children: vec![],
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""type":"folder"#));
    }

    #[test]
    fn session_node_session_serializes_with_type_tag() {
        let node = SessionNode::Session {
            id: "s1".into(),
            name: "Server 1".into(),
            protocol: Protocol::Ssh,
            host: Some("10.0.0.1".into()),
            port: Some(22),
            username: Some("admin".into()),
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains(r#""type":"session"#));
    }

    #[test]
    fn create_session_input_defaults_folder_to_root() {
        let json = r#"{"name":"Test","protocol":"ssh"}"#;
        let input: CreateSessionInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.folder_id, "root");
    }

    #[test]
    fn session_store_roundtrip() {
        let store = SessionStore {
            version: 1,
            sessions: vec![SessionProfile {
                id: "s1".into(),
                name: "Test".into(),
                folder_id: "root".into(),
                protocol: Protocol::Local,
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
                jump_host_id: None,
                auto_login: None,
                auto_login_device_type: None,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            }],
            folders: vec![SessionFolder {
                id: "f1".into(),
                name: "Test Folder".into(),
                parent_id: "root".into(),
                sort_order: 0,
                expanded: false,
            }],
        };
        let json = serde_json::to_string_pretty(&store).unwrap();
        let restored: SessionStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.sessions.len(), 1);
        assert_eq!(restored.folders.len(), 1);
    }
}
