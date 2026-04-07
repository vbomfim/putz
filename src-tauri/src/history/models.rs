/// Command history data models.
///
/// These types are serialized to/from JSON for the IPC boundary.
/// SQLite handles persistence internally via the manager.
use serde::{Deserialize, Serialize};

/// A single command history entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEntry {
    /// Unique row ID from SQLite.
    pub id: i64,
    /// Session display name (e.g., "DC1-Router" or "Terminal 3").
    pub session_name: String,
    /// Remote host (IP/hostname) — empty for local sessions.
    pub host: String,
    /// The command that was executed.
    pub command: String,
    /// ISO 8601 timestamp when the command was recorded.
    pub timestamp: String,
    /// Unique session identifier (tab/connection UUID).
    pub session_id: String,
}

/// Input DTO for adding a command to history.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddCommandInput {
    /// Session display name.
    pub session_name: String,
    /// Remote host (IP/hostname) — empty for local sessions.
    pub host: String,
    /// The command text.
    pub command: String,
    /// Session UUID.
    pub session_id: String,
}

/// Input DTO for searching command history.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryInput {
    /// Search query (substring match on command text).
    pub query: String,
    /// Optional: restrict to a specific session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Maximum results to return (default: 50, max: 500).
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    50
}

/// Input DTO for getting recent commands.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRecentInput {
    /// Session UUID to get history for.
    pub session_id: String,
    /// Maximum results to return (default: 50, max: 500).
    #[serde(default = "default_limit")]
    pub limit: u32,
}

/// Maximum number of entries stored before auto-pruning.
pub const MAX_HISTORY_ENTRIES: u32 = 100_000;

/// Maximum search result limit.
pub const MAX_SEARCH_LIMIT: u32 = 500;

/// Default search result limit.
#[allow(dead_code)]
pub const DEFAULT_SEARCH_LIMIT: u32 = 50;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_entry_serializes_camel_case() {
        let entry = CommandEntry {
            id: 1,
            session_name: "Router1".into(),
            host: "10.0.0.1".into(),
            command: "show ip route".into(),
            timestamp: "2024-06-15T10:30:00Z".into(),
            session_id: "abc-123".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("sessionName"));
        assert!(json.contains("sessionId"));
        // Should NOT contain snake_case
        assert!(!json.contains("session_name"));
        assert!(!json.contains("session_id"));
    }

    #[test]
    fn command_entry_roundtrip() {
        let entry = CommandEntry {
            id: 42,
            session_name: "DC1 Core".into(),
            host: "192.168.1.1".into(),
            command: "show version".into(),
            timestamp: "2024-01-01T00:00:00Z".into(),
            session_id: "sess-456".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let restored: CommandEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, 42);
        assert_eq!(restored.command, "show version");
        assert_eq!(restored.host, "192.168.1.1");
    }

    #[test]
    fn add_command_input_deserializes() {
        let json = r#"{"sessionName":"Test","host":"10.0.0.1","command":"ls","sessionId":"s1"}"#;
        let input: AddCommandInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.session_name, "Test");
        assert_eq!(input.command, "ls");
    }

    #[test]
    fn search_history_input_defaults_limit() {
        let json = r#"{"query":"show"}"#;
        let input: SearchHistoryInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.limit, 50);
        assert!(input.session_id.is_none());
    }

    #[test]
    fn search_history_input_with_session_filter() {
        let json = r#"{"query":"conf","sessionId":"s1","limit":100}"#;
        let input: SearchHistoryInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.session_id, Some("s1".into()));
        assert_eq!(input.limit, 100);
    }

    #[test]
    fn get_recent_input_defaults_limit() {
        let json = r#"{"sessionId":"abc"}"#;
        let input: GetRecentInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.limit, 50);
    }

    #[test]
    fn max_history_entries_is_100k() {
        assert_eq!(MAX_HISTORY_ENTRIES, 100_000);
    }
}
