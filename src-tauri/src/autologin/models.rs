/// Auto-login data models.
///
/// These types are serialized to/from JSON for persistence and IPC.
///
/// SECURITY:
/// - `LoginStep.send` may contain `${password}` — this is a VARIABLE REFERENCE,
///   not the actual password. Substitution happens at runtime from vault.
/// - Never log resolved variable values.
use serde::{Deserialize, Serialize};

/// A single login step: wait for a pattern, then send a response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStep {
    /// Regex pattern to match against terminal output (e.g., `"[Uu]sername:"`).
    pub expect: String,
    /// Text to send when pattern matches. Supports variables: `${username}`, `${password}`.
    pub send: String,
    /// Timeout in milliseconds before giving up on this step (default: 10000).
    #[serde(default = "default_timeout")]
    pub timeout_ms: u32,
}

fn default_timeout() -> u32 {
    10_000
}

/// Built-in device type with pre-configured login patterns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceType {
    CiscoIos,
    JunosOs,
    Linux,
    Custom,
}

/// A complete auto-login profile for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLoginProfile {
    /// Session ID this profile belongs to.
    pub session_id: String,
    /// Whether auto-login is enabled for this session.
    pub enabled: bool,
    /// Device type — determines built-in patterns or custom steps.
    pub device_type: DeviceType,
    /// Custom login steps (used when device_type is Custom, or to override).
    #[serde(default)]
    pub steps: Vec<LoginStep>,
    /// Username variable value — if empty, falls back to session username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Credential ID for `${password}` substitution (from vault).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
}

/// Input DTO for setting an auto-login profile.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAutoLoginInput {
    /// Session ID.
    pub session_id: String,
    /// Whether auto-login is enabled.
    pub enabled: bool,
    /// Device type.
    pub device_type: DeviceType,
    /// Custom login steps.
    #[serde(default)]
    pub steps: Vec<LoginStep>,
    /// Username override.
    pub username: Option<String>,
    /// Credential ID.
    pub credential_id: Option<String>,
}

/// Result of processing terminal output against auto-login patterns.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LoginAction {
    /// No pattern matched — continue buffering.
    None,
    /// A pattern matched — send this text to the terminal.
    /// Note: the `send` value has variables already substituted.
    Send(String),
    /// Login sequence completed successfully (prompt detected).
    Complete,
    /// Login failed (too many attempts or error pattern matched).
    #[allow(dead_code)]
    Failed(String),
}

/// Built-in pattern sets for common network devices.
pub struct BuiltinPatterns;

impl BuiltinPatterns {
    /// Returns the default login steps for Cisco IOS devices.
    pub fn cisco_ios() -> Vec<LoginStep> {
        vec![
            LoginStep {
                expect: r"(?i)(username|login)\s*:".into(),
                send: "${username}".into(),
                timeout_ms: 15_000,
            },
            LoginStep {
                expect: r"(?i)password\s*:".into(),
                send: "${password}".into(),
                timeout_ms: 10_000,
            },
            LoginStep {
                expect: r"[>#]\s*$".into(),
                send: String::new(), // Don't send anything — login complete
                timeout_ms: 10_000,
            },
        ]
    }

    /// Returns the default login steps for Juniper Junos devices.
    pub fn junos() -> Vec<LoginStep> {
        vec![
            LoginStep {
                expect: r"(?i)login\s*:".into(),
                send: "${username}".into(),
                timeout_ms: 15_000,
            },
            LoginStep {
                expect: r"(?i)password\s*:".into(),
                send: "${password}".into(),
                timeout_ms: 10_000,
            },
            LoginStep {
                expect: r"[%>]\s*$".into(),
                send: String::new(),
                timeout_ms: 10_000,
            },
        ]
    }

    /// Returns the default login steps for Linux systems.
    pub fn linux() -> Vec<LoginStep> {
        vec![
            LoginStep {
                expect: r"(?i)(login|username)\s*:".into(),
                send: "${username}".into(),
                timeout_ms: 15_000,
            },
            LoginStep {
                expect: r"(?i)password\s*:".into(),
                send: "${password}".into(),
                timeout_ms: 10_000,
            },
            LoginStep {
                expect: r"[$#]\s*$".into(),
                send: String::new(),
                timeout_ms: 10_000,
            },
        ]
    }

    /// Returns the default steps for a given device type.
    pub fn for_device(device_type: &DeviceType) -> Vec<LoginStep> {
        match device_type {
            DeviceType::CiscoIos => Self::cisco_ios(),
            DeviceType::JunosOs => Self::junos(),
            DeviceType::Linux => Self::linux(),
            DeviceType::Custom => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_step_serializes_camel_case() {
        let step = LoginStep {
            expect: "Username:".into(),
            send: "${username}".into(),
            timeout_ms: 5000,
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("timeoutMs"));
        assert!(!json.contains("timeout_ms"));
    }

    #[test]
    fn login_step_defaults_timeout() {
        let json = r#"{"expect":"Password:","send":"${password}"}"#;
        let step: LoginStep = serde_json::from_str(json).unwrap();
        assert_eq!(step.timeout_ms, 10_000);
    }

    #[test]
    fn device_type_serializes_snake_case() {
        let json = serde_json::to_string(&DeviceType::CiscoIos).unwrap();
        assert_eq!(json, r#""cisco_ios""#);
    }

    #[test]
    fn device_type_roundtrip() {
        let dt = DeviceType::JunosOs;
        let json = serde_json::to_string(&dt).unwrap();
        let restored: DeviceType = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, DeviceType::JunosOs);
    }

    #[test]
    fn auto_login_profile_serializes_camel_case() {
        let profile = AutoLoginProfile {
            session_id: "s1".into(),
            enabled: true,
            device_type: DeviceType::CiscoIos,
            steps: vec![],
            username: Some("admin".into()),
            credential_id: Some("cred-1".into()),
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(json.contains("sessionId"));
        assert!(json.contains("deviceType"));
        assert!(json.contains("credentialId"));
    }

    #[test]
    fn auto_login_profile_roundtrip() {
        let profile = AutoLoginProfile {
            session_id: "abc".into(),
            enabled: true,
            device_type: DeviceType::Linux,
            steps: vec![LoginStep {
                expect: "login:".into(),
                send: "${username}".into(),
                timeout_ms: 5000,
            }],
            username: None,
            credential_id: None,
        };
        let json = serde_json::to_string(&profile).unwrap();
        let restored: AutoLoginProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.session_id, "abc");
        assert_eq!(restored.device_type, DeviceType::Linux);
        assert_eq!(restored.steps.len(), 1);
    }

    #[test]
    fn set_auto_login_input_deserializes() {
        let json = r#"{"sessionId":"s1","enabled":true,"deviceType":"cisco_ios","credentialId":"c1"}"#;
        let input: SetAutoLoginInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.session_id, "s1");
        assert!(input.enabled);
        assert_eq!(input.device_type, DeviceType::CiscoIos);
    }

    #[test]
    fn login_action_send_serializes() {
        let action = LoginAction::Send("admin\n".into());
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("send"));
    }

    #[test]
    fn login_action_none_serializes() {
        let action = LoginAction::None;
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("none"));
    }

    #[test]
    fn builtin_cisco_ios_has_three_steps() {
        let steps = BuiltinPatterns::cisco_ios();
        assert_eq!(steps.len(), 3);
        assert!(steps[0].expect.contains("username"));
        assert!(steps[1].expect.contains("password"));
    }

    #[test]
    fn builtin_junos_has_three_steps() {
        let steps = BuiltinPatterns::junos();
        assert_eq!(steps.len(), 3);
        assert!(steps[0].expect.contains("login"));
    }

    #[test]
    fn builtin_linux_has_three_steps() {
        let steps = BuiltinPatterns::linux();
        assert_eq!(steps.len(), 3);
    }

    #[test]
    fn builtin_custom_returns_empty() {
        let steps = BuiltinPatterns::for_device(&DeviceType::Custom);
        assert!(steps.is_empty());
    }

    #[test]
    fn builtin_for_device_routes_correctly() {
        assert_eq!(
            BuiltinPatterns::for_device(&DeviceType::CiscoIos).len(),
            BuiltinPatterns::cisco_ios().len()
        );
    }
}
