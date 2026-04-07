/// Highlight data models for the keyword highlighting engine.
///
/// These types are serialized to/from JSON for persistence (highlights.json)
/// and cross the IPC boundary to the React frontend.
use serde::{Deserialize, Serialize};

/// How a highlight pattern is matched against terminal output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MatchType {
    /// Case-sensitive exact substring match.
    Exact,
    /// Case-insensitive exact substring match.
    ExactInsensitive,
    /// Wildcard pattern using `*` and `?`.
    Wildcard,
    /// Regular expression pattern.
    Regex,
}

/// A single highlight rule defining a pattern and its visual style.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRule {
    /// Unique rule identifier (UUID v4).
    pub id: String,
    /// Pattern string to match (exact text, wildcard, or regex).
    pub pattern: String,
    /// How the pattern is matched.
    pub match_type: MatchType,
    /// Foreground color as hex (e.g., "#FF5555").
    pub foreground_color: String,
    /// Background color as hex, or empty for transparent.
    #[serde(default)]
    pub background_color: String,
    /// Whether matched text should be bold.
    #[serde(default)]
    pub bold: bool,
    /// Whether matched text should be underlined.
    #[serde(default)]
    pub underline: bool,
    /// Priority for overlap resolution (higher wins, 0–999).
    #[serde(default)]
    pub priority: u16,
}

/// A named collection of highlight rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSet {
    /// Unique set identifier (UUID v4).
    pub id: String,
    /// Human-readable name for this set.
    pub name: String,
    /// Optional description.
    #[serde(default)]
    pub description: String,
    /// Ordered list of highlight rules.
    pub rules: Vec<HighlightRule>,
    /// Whether this is a built-in preset (cannot be deleted).
    #[serde(default)]
    pub is_builtin: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-modified timestamp.
    pub updated_at: String,
}

/// Top-level store serialized to highlights.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightStore {
    pub version: u32,
    pub sets: Vec<HighlightSet>,
}

impl Default for HighlightStore {
    fn default() -> Self {
        Self {
            version: 1,
            sets: Vec::new(),
        }
    }
}

/// Input DTO for creating a new highlight set (no id, timestamps auto-generated).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHighlightSetInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub rules: Vec<CreateHighlightRuleInput>,
}

/// Input DTO for a single rule within a create/update set request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHighlightRuleInput {
    pub pattern: String,
    pub match_type: MatchType,
    pub foreground_color: String,
    #[serde(default)]
    pub background_color: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub priority: u16,
}

/// Input DTO for updating an existing highlight set (partial — only non-None fields apply).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHighlightSetInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub rules: Option<Vec<CreateHighlightRuleInput>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_type_serializes_lowercase() {
        let json = serde_json::to_string(&MatchType::Exact).unwrap();
        assert_eq!(json, r#""exact""#);
    }

    #[test]
    fn match_type_exact_insensitive_serializes() {
        let json = serde_json::to_string(&MatchType::ExactInsensitive).unwrap();
        assert_eq!(json, r#""exactinsensitive""#);
    }

    #[test]
    fn match_type_wildcard_serializes() {
        let json = serde_json::to_string(&MatchType::Wildcard).unwrap();
        assert_eq!(json, r#""wildcard""#);
    }

    #[test]
    fn match_type_regex_serializes() {
        let json = serde_json::to_string(&MatchType::Regex).unwrap();
        assert_eq!(json, r#""regex""#);
    }

    #[test]
    fn match_type_roundtrip() {
        let mt = MatchType::Regex;
        let json = serde_json::to_string(&mt).unwrap();
        let restored: MatchType = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, MatchType::Regex);
    }

    #[test]
    fn highlight_rule_serializes_camel_case() {
        let rule = HighlightRule {
            id: "rule-1".into(),
            pattern: "ERROR".into(),
            match_type: MatchType::Exact,
            foreground_color: "#FF5555".into(),
            background_color: String::new(),
            bold: true,
            underline: false,
            priority: 100,
        };
        let json = serde_json::to_string(&rule).unwrap();
        assert!(json.contains("matchType"));
        assert!(json.contains("foregroundColor"));
        assert!(json.contains("backgroundColor"));
    }

    #[test]
    fn highlight_rule_defaults() {
        let json = r##"{
            "id": "r1",
            "pattern": "test",
            "matchType": "exact",
            "foregroundColor": "#FF0000"
        }"##;
        let rule: HighlightRule = serde_json::from_str(json).unwrap();
        assert_eq!(rule.background_color, "");
        assert!(!rule.bold);
        assert!(!rule.underline);
        assert_eq!(rule.priority, 0);
    }

    #[test]
    fn highlight_rule_roundtrip() {
        let rule = HighlightRule {
            id: "rule-1".into(),
            pattern: r"\d+\.\d+\.\d+\.\d+".into(),
            match_type: MatchType::Regex,
            foreground_color: "#8BE9FD".into(),
            background_color: "#1A1A2E".into(),
            bold: false,
            underline: true,
            priority: 50,
        };
        let json = serde_json::to_string(&rule).unwrap();
        let restored: HighlightRule = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "rule-1");
        assert_eq!(restored.pattern, r"\d+\.\d+\.\d+\.\d+");
        assert_eq!(restored.match_type, MatchType::Regex);
        assert!(restored.underline);
        assert_eq!(restored.priority, 50);
    }

    #[test]
    fn highlight_set_serializes_camel_case() {
        let set = HighlightSet {
            id: "set-1".into(),
            name: "Cisco IOS".into(),
            description: "Cisco IOS syslog patterns".into(),
            rules: vec![],
            is_builtin: true,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&set).unwrap();
        assert!(json.contains("isBuiltin"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
    }

    #[test]
    fn highlight_set_roundtrip() {
        let set = HighlightSet {
            id: "set-1".into(),
            name: "Test Set".into(),
            description: "A test highlight set".into(),
            rules: vec![HighlightRule {
                id: "r1".into(),
                pattern: "ERROR".into(),
                match_type: MatchType::Exact,
                foreground_color: "#FF5555".into(),
                background_color: String::new(),
                bold: true,
                underline: false,
                priority: 100,
            }],
            is_builtin: false,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&set).unwrap();
        let restored: HighlightSet = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.name, "Test Set");
        assert_eq!(restored.rules.len(), 1);
        assert_eq!(restored.rules[0].pattern, "ERROR");
    }

    #[test]
    fn highlight_store_default_is_empty() {
        let store = HighlightStore::default();
        assert_eq!(store.version, 1);
        assert!(store.sets.is_empty());
    }

    #[test]
    fn highlight_store_roundtrip() {
        let store = HighlightStore {
            version: 1,
            sets: vec![HighlightSet {
                id: "s1".into(),
                name: "Test".into(),
                description: String::new(),
                rules: vec![],
                is_builtin: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            }],
        };
        let json = serde_json::to_string_pretty(&store).unwrap();
        let restored: HighlightStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.sets.len(), 1);
    }

    #[test]
    fn create_highlight_set_input_deserializes() {
        let json = r##"{
            "name": "My Rules",
            "rules": [{
                "pattern": "ERROR",
                "matchType": "exact",
                "foregroundColor": "#FF0000"
            }]
        }"##;
        let input: CreateHighlightSetInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "My Rules");
        assert_eq!(input.description, "");
        assert_eq!(input.rules.len(), 1);
    }

    #[test]
    fn update_highlight_set_input_partial() {
        let json = r#"{"name": "Updated Name"}"#;
        let input: UpdateHighlightSetInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, Some("Updated Name".into()));
        assert!(input.description.is_none());
        assert!(input.rules.is_none());
    }
}
