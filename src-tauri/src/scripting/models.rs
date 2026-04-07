/// Data models for the scripting engine.
///
/// Defines script metadata, storage format, execution results,
/// and IPC input/output types. All models use camelCase serialization
/// for frontend compatibility.
use serde::{Deserialize, Serialize};

/// Metadata for a saved script. Stored in `scripts-index.json`.
/// The actual script content lives in a separate `.js` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptMeta {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// User-facing display name.
    pub name: String,
    /// Optional description of what the script does.
    pub description: String,
    /// Filename on disk (e.g., `backup-config.js`).
    pub filename: String,
    /// Whether this script runs automatically on session connect.
    pub is_login_script: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-modified timestamp.
    pub updated_at: String,
}

/// On-disk storage format for the script index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStore {
    /// All saved script metadata entries.
    pub scripts: Vec<ScriptMeta>,
    /// Schema version for future migrations.
    pub version: u32,
}

impl Default for ScriptStore {
    fn default() -> Self {
        Self {
            scripts: Vec::new(),
            version: 1,
        }
    }
}

/// Severity level for script log entries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Informational messages from `putz.log()`.
    Info,
    /// Warning messages.
    Warn,
    /// Error messages (script errors, timeouts).
    Error,
    /// Terminal output captured by the engine.
    Output,
}

/// A single log entry from script execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLogEntry {
    /// ISO 8601 timestamp of the log entry.
    pub timestamp: String,
    /// Severity level.
    pub level: LogLevel,
    /// Log message content.
    pub message: String,
}

/// Status of a script execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ScriptStatus {
    /// Script is queued but not yet started.
    Pending,
    /// Script is currently executing.
    Running,
    /// Script completed successfully.
    Completed,
    /// Script failed with an error.
    Failed,
    /// Script was manually stopped by the user.
    Stopped,
}

/// Result of a script execution, returned by `script_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRunResult {
    /// Unique run identifier.
    pub run_id: String,
    /// ID of the script that was run.
    pub script_id: String,
    /// ID of the session it ran against.
    pub session_id: String,
    /// Current execution status.
    pub status: ScriptStatus,
    /// Log output from the script.
    pub output: Vec<ScriptLogEntry>,
    /// ISO 8601 start timestamp.
    pub started_at: String,
    /// ISO 8601 completion timestamp (None if still running).
    pub finished_at: Option<String>,
    /// Error message if status is Failed.
    pub error: Option<String>,
}

/// IPC input for saving a script (create or update).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScriptInput {
    /// Script ID for updates; None for new scripts.
    pub id: Option<String>,
    /// User-facing display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// JavaScript source code.
    pub content: String,
    /// Whether this is a login script.
    pub is_login_script: Option<bool>,
}

/// IPC input for running a script against a single session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunScriptInput {
    /// ID of the script to run.
    pub script_id: String,
    /// ID of the target session (PTY or connection).
    pub session_id: String,
}

/// IPC input for running a script across multiple sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMultiInput {
    /// ID of the script to run.
    pub script_id: String,
    /// IDs of target sessions.
    pub session_ids: Vec<String>,
}

/// Full script data returned by `script_get` (metadata + content).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptWithContent {
    /// Script metadata.
    pub meta: ScriptMeta,
    /// JavaScript source code.
    pub content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_meta_serializes_camel_case() {
        let meta = ScriptMeta {
            id: "abc-123".into(),
            name: "Backup Config".into(),
            description: "Backs up router config".into(),
            filename: "backup-config.js".into(),
            is_login_script: false,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("isLoginScript"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
    }

    #[test]
    fn script_meta_roundtrip() {
        let meta = ScriptMeta {
            id: "abc-123".into(),
            name: "Test Script".into(),
            description: "A test".into(),
            filename: "test.js".into(),
            is_login_script: true,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-02T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let restored: ScriptMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "abc-123");
        assert_eq!(restored.name, "Test Script");
        assert!(restored.is_login_script);
    }

    #[test]
    fn script_store_default_is_empty() {
        let store = ScriptStore::default();
        assert!(store.scripts.is_empty());
        assert_eq!(store.version, 1);
    }

    #[test]
    fn script_store_roundtrip() {
        let store = ScriptStore {
            scripts: vec![ScriptMeta {
                id: "s1".into(),
                name: "Script 1".into(),
                description: "".into(),
                filename: "script-1.js".into(),
                is_login_script: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            }],
            version: 1,
        };
        let json = serde_json::to_string(&store).unwrap();
        let restored: ScriptStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.scripts.len(), 1);
        assert_eq!(restored.scripts[0].name, "Script 1");
    }

    #[test]
    fn log_level_serializes_lowercase() {
        let json = serde_json::to_string(&LogLevel::Info).unwrap();
        assert_eq!(json, r#""info""#);
    }

    #[test]
    fn log_level_all_variants() {
        for (variant, expected) in [
            (LogLevel::Info, r#""info""#),
            (LogLevel::Warn, r#""warn""#),
            (LogLevel::Error, r#""error""#),
            (LogLevel::Output, r#""output""#),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn script_status_serializes_lowercase() {
        for (variant, expected) in [
            (ScriptStatus::Pending, r#""pending""#),
            (ScriptStatus::Running, r#""running""#),
            (ScriptStatus::Completed, r#""completed""#),
            (ScriptStatus::Failed, r#""failed""#),
            (ScriptStatus::Stopped, r#""stopped""#),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn script_log_entry_serializes() {
        let entry = ScriptLogEntry {
            timestamp: "2024-01-01T00:00:00Z".into(),
            level: LogLevel::Info,
            message: "Hello world".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("Hello world"));
        assert!(json.contains(r#""info""#));
    }

    #[test]
    fn script_run_result_omits_none_fields() {
        let result = ScriptRunResult {
            run_id: "r1".into(),
            script_id: "s1".into(),
            session_id: "sess-1".into(),
            status: ScriptStatus::Running,
            output: vec![],
            started_at: "2024-01-01T00:00:00Z".into(),
            finished_at: None,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("runId"));
        assert!(json.contains("scriptId"));
        assert!(json.contains("sessionId"));
        assert!(json.contains("startedAt"));
    }

    #[test]
    fn save_script_input_deserializes() {
        let json = r#"{
            "name": "Test",
            "content": "putz.send('show version');",
            "isLoginScript": true
        }"#;
        let input: SaveScriptInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "Test");
        assert!(input.id.is_none());
        assert_eq!(input.is_login_script, Some(true));
    }

    #[test]
    fn run_script_input_deserializes() {
        let json = r#"{
            "scriptId": "s1",
            "sessionId": "sess-1"
        }"#;
        let input: RunScriptInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.script_id, "s1");
        assert_eq!(input.session_id, "sess-1");
    }

    #[test]
    fn run_multi_input_deserializes() {
        let json = r#"{
            "scriptId": "s1",
            "sessionIds": ["sess-1", "sess-2", "sess-3"]
        }"#;
        let input: RunMultiInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.script_id, "s1");
        assert_eq!(input.session_ids.len(), 3);
    }

    #[test]
    fn script_with_content_serializes() {
        let swc = ScriptWithContent {
            meta: ScriptMeta {
                id: "s1".into(),
                name: "Test".into(),
                description: "".into(),
                filename: "test.js".into(),
                is_login_script: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            },
            content: "putz.log('hello');".into(),
        };
        let json = serde_json::to_string(&swc).unwrap();
        assert!(json.contains("putz.log"));
        assert!(json.contains("meta"));
        assert!(json.contains("content"));
    }
}
