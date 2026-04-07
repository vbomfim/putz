/// Data models for the command template engine.
///
/// Defines template metadata, storage format, and IPC types.
/// All models use camelCase serialization for frontend compatibility.
use serde::{Deserialize, Serialize};

/// A variable placeholder extracted from a template.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVariable {
    /// Variable name (e.g., "hostname" from {{hostname}}).
    pub name: String,
    /// Optional default value.
    pub default_value: String,
}

/// Metadata for a saved command template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMeta {
    /// Unique identifier (UUID v4).
    pub id: String,
    /// User-facing display name.
    pub name: String,
    /// Optional description of what the template does.
    pub description: String,
    /// Whether this is a built-in template (cannot be deleted).
    pub is_builtin: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last-modified timestamp.
    pub updated_at: String,
}

/// Full template data (metadata + content) returned by `template_get`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateWithContent {
    /// Template metadata.
    pub meta: TemplateMeta,
    /// Template content with {{variable}} placeholders.
    pub content: String,
    /// Extracted variables from the template content.
    pub variables: Vec<TemplateVariable>,
}

/// On-disk storage format for the template index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStore {
    /// All saved template metadata entries.
    pub templates: Vec<TemplateMeta>,
    /// Schema version for future migrations.
    pub version: u32,
}

impl Default for TemplateStore {
    fn default() -> Self {
        Self {
            templates: Vec::new(),
            version: 1,
        }
    }
}

/// IPC input for creating or updating a template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplateInput {
    /// Template ID for updates; None for new templates.
    pub id: Option<String>,
    /// User-facing display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Template content with {{variable}} placeholders.
    pub content: String,
}

/// IPC input for executing a template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTemplateInput {
    /// ID of the template to execute.
    pub template_id: String,
    /// Variable values to substitute (name → value map).
    pub variables: std::collections::HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_meta_serializes_camel_case() {
        let meta = TemplateMeta {
            id: "abc-123".into(),
            name: "Backup Config".into(),
            description: "Backs up router config".into(),
            is_builtin: false,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("isBuiltin"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
    }

    #[test]
    fn template_meta_roundtrip() {
        let meta = TemplateMeta {
            id: "abc-123".into(),
            name: "Test Template".into(),
            description: "A test".into(),
            is_builtin: true,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-02T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let restored: TemplateMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "abc-123");
        assert_eq!(restored.name, "Test Template");
        assert!(restored.is_builtin);
    }

    #[test]
    fn template_store_default_is_empty() {
        let store = TemplateStore::default();
        assert!(store.templates.is_empty());
        assert_eq!(store.version, 1);
    }

    #[test]
    fn template_store_roundtrip() {
        let store = TemplateStore {
            templates: vec![TemplateMeta {
                id: "t1".into(),
                name: "Template 1".into(),
                description: "".into(),
                is_builtin: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            }],
            version: 1,
        };
        let json = serde_json::to_string(&store).unwrap();
        let restored: TemplateStore = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.templates.len(), 1);
        assert_eq!(restored.templates[0].name, "Template 1");
    }

    #[test]
    fn template_variable_serializes() {
        let var = TemplateVariable {
            name: "hostname".into(),
            default_value: "R1".into(),
        };
        let json = serde_json::to_string(&var).unwrap();
        assert!(json.contains("hostname"));
        assert!(json.contains("defaultValue"));
    }

    #[test]
    fn save_template_input_deserializes() {
        let json = r#"{
            "name": "Test",
            "content": "show ip interface {{interface}}"
        }"#;
        let input: SaveTemplateInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "Test");
        assert!(input.id.is_none());
    }

    #[test]
    fn execute_template_input_deserializes() {
        let json = r#"{
            "templateId": "t1",
            "variables": {"hostname": "R1", "interface": "Gi0/0"}
        }"#;
        let input: ExecuteTemplateInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.template_id, "t1");
        assert_eq!(input.variables.len(), 2);
        assert_eq!(input.variables.get("hostname").unwrap(), "R1");
    }

    #[test]
    fn template_with_content_serializes() {
        let twc = TemplateWithContent {
            meta: TemplateMeta {
                id: "t1".into(),
                name: "Test".into(),
                description: "".into(),
                is_builtin: false,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
            },
            content: "show ip route {{vrf}}".into(),
            variables: vec![TemplateVariable {
                name: "vrf".into(),
                default_value: "".into(),
            }],
        };
        let json = serde_json::to_string(&twc).unwrap();
        assert!(json.contains("show ip route"));
        assert!(json.contains("meta"));
        assert!(json.contains("variables"));
    }
}
