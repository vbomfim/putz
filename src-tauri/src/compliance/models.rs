/// Change window compliance data models.
///
/// These types are serialized to/from JSON for persistence (change_windows.json)
/// and cross the IPC boundary to the React frontend.
///
/// A change window defines a time period during which dangerous commands
/// (like `configure terminal`, `write mem`, `commit`) are allowed.
/// Outside these windows, users get a warning before proceeding.
use serde::{Deserialize, Serialize};

/// A single maintenance/change window definition.
///
/// Defines when dangerous commands are permitted for a group of devices.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWindow {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// Human-readable name (e.g., "Weekend Maintenance").
    pub name: String,
    /// Day-of-week range: 0 = Sunday, 6 = Saturday.
    /// Empty means all days.
    #[serde(default)]
    pub days: Vec<u8>,
    /// Start hour (0–23) in local time.
    pub start_hour: u8,
    /// End hour (0–23) in local time.
    /// If end < start, the window wraps past midnight.
    pub end_hour: u8,
    /// Device group patterns this window applies to.
    /// Empty means all devices.
    #[serde(default)]
    pub device_groups: Vec<String>,
    /// Whether this window is currently enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Result of checking a command against the change window policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWindowCheckResult {
    /// Whether the command is allowed right now.
    pub allowed: bool,
    /// Human-readable reason for the decision.
    pub reason: String,
    /// Name of the active window (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_name: Option<String>,
}

/// Top-level configuration persisted to change_windows.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWindowConfig {
    /// Schema version for forward compatibility.
    pub version: u32,
    /// Defined change windows.
    pub windows: Vec<ChangeWindow>,
    /// Commands considered dangerous (matched case-insensitively).
    pub dangerous_commands: Vec<String>,
}

impl Default for ChangeWindowConfig {
    fn default() -> Self {
        Self {
            version: 1,
            windows: Vec::new(),
            dangerous_commands: vec![
                "configure terminal".into(),
                "conf t".into(),
                "commit".into(),
                "write mem".into(),
                "write memory".into(),
                "copy run start".into(),
                "copy running-config startup-config".into(),
            ],
        }
    }
}

/// Input DTO for creating or updating a change window via IPC.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChangeWindowInput {
    /// If provided, updates existing window. If omitted, creates new.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub days: Vec<u8>,
    pub start_hour: u8,
    pub end_hour: u8,
    #[serde(default)]
    pub device_groups: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_window_serializes_camel_case() {
        let window = ChangeWindow {
            id: "test-id".into(),
            name: "Weekend Maintenance".into(),
            days: vec![0, 6],
            start_hour: 22,
            end_hour: 6,
            device_groups: vec!["core-routers".into()],
            enabled: true,
        };
        let json = serde_json::to_string(&window).unwrap();
        assert!(json.contains("startHour"));
        assert!(json.contains("endHour"));
        assert!(json.contains("deviceGroups"));
    }

    #[test]
    fn change_window_roundtrip() {
        let window = ChangeWindow {
            id: "abc-123".into(),
            name: "Nightly Window".into(),
            days: vec![1, 2, 3, 4, 5],
            start_hour: 2,
            end_hour: 5,
            device_groups: vec![],
            enabled: true,
        };
        let json = serde_json::to_string(&window).unwrap();
        let restored: ChangeWindow = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, window);
    }

    #[test]
    fn change_window_defaults() {
        let json = r#"{"id":"id","name":"Test","startHour":0,"endHour":6}"#;
        let window: ChangeWindow = serde_json::from_str(json).unwrap();
        assert!(window.days.is_empty());
        assert!(window.device_groups.is_empty());
        assert!(window.enabled);
    }

    #[test]
    fn check_result_serializes_correctly() {
        let result = ChangeWindowCheckResult {
            allowed: false,
            reason: "Outside maintenance window".into(),
            window_name: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"allowed\":false"));
        assert!(!json.contains("windowName"));
    }

    #[test]
    fn check_result_with_window_name() {
        let result = ChangeWindowCheckResult {
            allowed: true,
            reason: "Within maintenance window".into(),
            window_name: Some("Weekend Maintenance".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("windowName"));
        assert!(json.contains("Weekend Maintenance"));
    }

    #[test]
    fn config_default_has_dangerous_commands() {
        let config = ChangeWindowConfig::default();
        assert_eq!(config.version, 1);
        assert!(config.windows.is_empty());
        assert!(config.dangerous_commands.contains(&"configure terminal".to_string()));
        assert!(config.dangerous_commands.contains(&"conf t".to_string()));
        assert!(config.dangerous_commands.contains(&"commit".to_string()));
        assert!(config.dangerous_commands.contains(&"write mem".to_string()));
        assert!(config.dangerous_commands.contains(&"copy run start".to_string()));
    }

    #[test]
    fn config_roundtrip() {
        let config = ChangeWindowConfig {
            version: 1,
            windows: vec![ChangeWindow {
                id: "w1".into(),
                name: "Test".into(),
                days: vec![6],
                start_hour: 22,
                end_hour: 6,
                device_groups: vec![],
                enabled: true,
            }],
            dangerous_commands: vec!["conf t".into()],
        };
        let json = serde_json::to_string_pretty(&config).unwrap();
        let restored: ChangeWindowConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.windows.len(), 1);
        assert_eq!(restored.windows[0].name, "Test");
    }

    #[test]
    fn set_change_window_input_deserializes() {
        let json = r#"{"name":"New Window","days":[0,6],"startHour":22,"endHour":6}"#;
        let input: SetChangeWindowInput = serde_json::from_str(json).unwrap();
        assert!(input.id.is_none());
        assert_eq!(input.name, "New Window");
        assert_eq!(input.days, vec![0, 6]);
        assert_eq!(input.start_hour, 22);
        assert_eq!(input.end_hour, 6);
        assert!(input.enabled);
    }

    #[test]
    fn set_change_window_input_with_id() {
        let json = r#"{"id":"abc","name":"Updated","days":[],"startHour":0,"endHour":6,"enabled":false}"#;
        let input: SetChangeWindowInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.id, Some("abc".into()));
        assert!(!input.enabled);
    }
}
