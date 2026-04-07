/// Template manager — CRUD for command templates + execution.
///
/// Manages saved templates on disk with variable extraction and
/// substitution. Provides built-in templates for common network
/// engineering tasks.
///
/// Storage layout:
/// ```text
/// ~/.config/putz/templates/
/// ├── templates-index.json   # Metadata index
/// ├── backup-config.txt      # Template files
/// ├── show-interfaces.txt
/// └── ...
/// ```
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use regex::Regex;
use uuid::Uuid;

use super::error::TemplateError;
use super::models::*;

/// Index filename for template metadata.
const INDEX_FILENAME: &str = "templates-index.json";

/// Maximum template name length.
const MAX_NAME_LENGTH: usize = 100;

/// Maximum template content size in bytes.
const MAX_CONTENT_SIZE: usize = 64_000;

/// Template manager — owns the template library.
///
/// Registered as Tauri managed state via `.manage(TemplateManager::new())`.
pub struct TemplateManager {
    /// On-disk template metadata.
    store: Mutex<TemplateStore>,
    /// Directory for template files.
    config_dir: PathBuf,
}

impl TemplateManager {
    /// Creates a new manager, loading templates from the default config dir.
    pub fn new() -> Self {
        let config_dir = default_templates_directory();
        let mut mgr = Self {
            store: Mutex::new(TemplateStore::default()),
            config_dir,
        };
        mgr.initialize();
        mgr
    }

    /// Creates a manager with a custom config directory (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let mut mgr = Self {
            store: Mutex::new(TemplateStore::default()),
            config_dir,
        };
        mgr.initialize();
        mgr
    }

    /// Initializes the manager: ensures config dir exists, loads index, seeds built-ins.
    fn initialize(&mut self) {
        if let Err(e) = fs::create_dir_all(&self.config_dir) {
            eprintln!("[TemplateManager] Failed to create config dir: {e}");
            return;
        }
        let store = Self::load_store(&self.config_dir);
        let mut store = store;

        // Seed built-in templates if not already present
        for (name, description, content) in builtin_templates() {
            let already_exists = store.templates.iter().any(|t| t.is_builtin && t.name == name);
            if already_exists {
                continue;
            }
            let id = Uuid::new_v4().to_string();
            let now = now_iso8601();
            let filename = slugify(&name) + ".txt";

            // Write content file
            let path = self.config_dir.join(&filename);
            if let Err(e) = fs::write(&path, &content) {
                eprintln!("[TemplateManager] Failed to write built-in template: {e}");
                continue;
            }

            store.templates.push(TemplateMeta {
                id,
                name: name.to_string(),
                description: description.to_string(),
                is_builtin: true,
                created_at: now.clone(),
                updated_at: now,
            });
        }

        // Save the updated store
        let _ = Self::save_store(&self.config_dir, &store);
        self.store = Mutex::new(store);
    }

    // ── CRUD operations ────────────────────────────────────────

    /// Lists all saved templates (metadata only).
    pub fn list(&self) -> Vec<TemplateMeta> {
        self.lock_store()
            .map(|s| s.templates.clone())
            .unwrap_or_default()
    }

    /// Gets template metadata + content + extracted variables by ID.
    pub fn get(&self, id: &str) -> Result<TemplateWithContent, TemplateError> {
        validate_id(id)?;
        let store = self.lock_store()?;
        let meta = store
            .templates
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| TemplateError::NotFound(id.into()))?
            .clone();
        drop(store);

        let content = self.read_content(&meta.name)?;
        let variables = extract_variables(&content);

        Ok(TemplateWithContent {
            meta,
            content,
            variables,
        })
    }

    /// Creates or updates a template. Returns the template ID.
    pub fn create(&self, input: SaveTemplateInput) -> Result<String, TemplateError> {
        validate_name(&input.name)?;
        validate_content(&input.content)?;

        let mut store = self.lock_store()?;
        let now = now_iso8601();

        if let Some(ref existing_id) = input.id {
            // Update existing
            validate_id(existing_id)?;
            let meta = store
                .templates
                .iter_mut()
                .find(|t| t.id == *existing_id)
                .ok_or_else(|| TemplateError::NotFound(existing_id.clone()))?;

            meta.name = input.name.clone();
            meta.description = input.description.unwrap_or_default();
            meta.updated_at = now;

            let filename = slugify(&meta.name) + ".txt";
            let path = self.config_dir.join(&filename);
            fs::write(&path, &input.content)?;

            let id = existing_id.clone();
            Self::save_store(&self.config_dir, &store)?;
            return Ok(id);
        }

        // Create new
        let id = Uuid::new_v4().to_string();
        let filename = slugify(&input.name) + ".txt";
        let path = self.config_dir.join(&filename);
        fs::write(&path, &input.content)?;

        store.templates.push(TemplateMeta {
            id: id.clone(),
            name: input.name,
            description: input.description.unwrap_or_default(),
            is_builtin: false,
            created_at: now.clone(),
            updated_at: now,
        });

        Self::save_store(&self.config_dir, &store)?;
        Ok(id)
    }

    /// Deletes a template by ID. Built-in templates cannot be deleted.
    pub fn delete(&self, id: &str) -> Result<(), TemplateError> {
        validate_id(id)?;
        let mut store = self.lock_store()?;

        let pos = store
            .templates
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| TemplateError::NotFound(id.into()))?;

        let meta = &store.templates[pos];
        if meta.is_builtin {
            return Err(TemplateError::CannotDeleteBuiltin(meta.name.clone()));
        }

        // Remove content file (best-effort)
        let filename = slugify(&meta.name) + ".txt";
        let path = self.config_dir.join(&filename);
        let _ = fs::remove_file(&path);

        store.templates.remove(pos);
        Self::save_store(&self.config_dir, &store)?;
        Ok(())
    }

    /// Executes a template by substituting variables. Returns the rendered text.
    pub fn execute(
        &self,
        input: ExecuteTemplateInput,
    ) -> Result<String, TemplateError> {
        let template = self.get(&input.template_id)?;
        let rendered = substitute_variables(&template.content, &input.variables);
        Ok(rendered)
    }

    // ── Internal helpers ───────────────────────────────────────

    /// Acquires the store mutex, returning an error if poisoned.
    fn lock_store(&self) -> Result<std::sync::MutexGuard<'_, TemplateStore>, TemplateError> {
        self.store.lock().map_err(|_| {
            TemplateError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Template store lock poisoned",
            ))
        })
    }

    /// Loads the template index from disk.
    fn load_store(config_dir: &PathBuf) -> TemplateStore {
        let path = config_dir.join(INDEX_FILENAME);
        match fs::read_to_string(&path) {
            Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
            Err(_) => TemplateStore::default(),
        }
    }

    /// Saves the template index to disk.
    fn save_store(config_dir: &PathBuf, store: &TemplateStore) -> Result<(), TemplateError> {
        let path = config_dir.join(INDEX_FILENAME);
        let json = serde_json::to_string_pretty(store)?;
        fs::write(&path, json)?;
        Ok(())
    }

    /// Reads template content from its file on disk.
    fn read_content(&self, name: &str) -> Result<String, TemplateError> {
        let filename = slugify(name) + ".txt";
        let path = self.config_dir.join(&filename);
        fs::read_to_string(&path).map_err(TemplateError::from)
    }
}

// ── Standalone functions ───────────────────────────────────────

/// Extracts {{variable}} placeholders from template content.
///
/// Returns unique variables in order of first appearance.
pub fn extract_variables(content: &str) -> Vec<TemplateVariable> {
    let re = Regex::new(r"\{\{(\w+)\}\}").expect("Invalid regex");
    let mut seen = std::collections::HashSet::new();
    let mut variables = Vec::new();

    for cap in re.captures_iter(content) {
        let name = cap[1].to_string();
        if seen.insert(name.clone()) {
            variables.push(TemplateVariable {
                name,
                default_value: String::new(),
            });
        }
    }

    variables
}

/// Substitutes {{variable}} placeholders with provided values.
///
/// Variables not in the map are left as-is.
pub fn substitute_variables(content: &str, variables: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\{\{(\w+)\}\}").expect("Invalid regex");
    re.replace_all(content, |caps: &regex::Captures| {
        let name = &caps[1];
        variables
            .get(name)
            .cloned()
            .unwrap_or_else(|| format!("{{{{{name}}}}}"))
    })
    .into_owned()
}

/// Validates a template ID (must be a valid UUID v4 format or non-empty).
fn validate_id(id: &str) -> Result<(), TemplateError> {
    if id.trim().is_empty() {
        return Err(TemplateError::InvalidId("ID cannot be empty".into()));
    }
    Ok(())
}

/// Validates a template name.
fn validate_name(name: &str) -> Result<(), TemplateError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(TemplateError::InvalidName("Name cannot be empty".into()));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(TemplateError::InvalidName(format!(
            "Name exceeds maximum length of {MAX_NAME_LENGTH}"
        )));
    }
    Ok(())
}

/// Validates template content.
fn validate_content(content: &str) -> Result<(), TemplateError> {
    if content.trim().is_empty() {
        return Err(TemplateError::InvalidContent(
            "Content cannot be empty".into(),
        ));
    }
    if content.len() > MAX_CONTENT_SIZE {
        return Err(TemplateError::InvalidContent(format!(
            "Content exceeds maximum size of {MAX_CONTENT_SIZE} bytes"
        )));
    }
    Ok(())
}

/// Converts a name to a filesystem-safe slug.
fn slugify(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Returns the default templates directory.
fn default_templates_directory() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("putz")
        .join("templates")
}

/// Returns the current time as an ISO 8601 string.
fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Returns built-in template definitions: (name, description, content).
fn builtin_templates() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "Backup Running Config",
            "Saves the running configuration to startup config",
            "enable\ncopy running-config startup-config\n\n",
        ),
        (
            "Show Interfaces",
            "Displays interface status and IP addresses",
            "show ip interface brief\nshow interfaces {{interface}}\n",
        ),
        (
            "Check BGP Neighbors",
            "Displays BGP neighbor summary and details",
            "show ip bgp summary\nshow ip bgp neighbors {{neighbor_ip}}\n",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_variables_finds_placeholders() {
        let content = "hostname {{hostname}}\ninterface {{interface}}\nip address {{ip}}";
        let vars = extract_variables(content);
        assert_eq!(vars.len(), 3);
        assert_eq!(vars[0].name, "hostname");
        assert_eq!(vars[1].name, "interface");
        assert_eq!(vars[2].name, "ip");
    }

    #[test]
    fn extract_variables_deduplicates() {
        let content = "{{hostname}} and {{hostname}} again";
        let vars = extract_variables(content);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].name, "hostname");
    }

    #[test]
    fn extract_variables_empty_for_no_placeholders() {
        let content = "show version\nshow ip route";
        let vars = extract_variables(content);
        assert!(vars.is_empty());
    }

    #[test]
    fn substitute_variables_replaces_all() {
        let content = "hostname {{hostname}}\ninterface {{interface}}";
        let mut vars = HashMap::new();
        vars.insert("hostname".to_string(), "R1".to_string());
        vars.insert("interface".to_string(), "Gi0/0".to_string());
        let result = substitute_variables(content, &vars);
        assert_eq!(result, "hostname R1\ninterface Gi0/0");
    }

    #[test]
    fn substitute_variables_preserves_unknown() {
        let content = "hostname {{hostname}}\nvrf {{vrf}}";
        let mut vars = HashMap::new();
        vars.insert("hostname".to_string(), "R1".to_string());
        let result = substitute_variables(content, &vars);
        assert_eq!(result, "hostname R1\nvrf {{vrf}}");
    }

    #[test]
    fn substitute_variables_empty_map() {
        let content = "show ip bgp {{neighbor}}";
        let vars = HashMap::new();
        let result = substitute_variables(content, &vars);
        assert_eq!(result, "show ip bgp {{neighbor}}");
    }

    #[test]
    fn slugify_converts_spaces() {
        assert_eq!(slugify("Backup Running Config"), "backup-running-config");
    }

    #[test]
    fn slugify_handles_special_chars() {
        assert_eq!(slugify("Show IP/BGP (v4)"), "show-ip-bgp-v4");
    }

    #[test]
    fn slugify_handles_multiple_dashes() {
        assert_eq!(slugify("test---name"), "test-name");
    }

    #[test]
    fn validate_name_rejects_empty() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn validate_name_rejects_too_long() {
        let long_name = "a".repeat(101);
        assert!(validate_name(&long_name).is_err());
    }

    #[test]
    fn validate_name_accepts_valid() {
        assert!(validate_name("Backup Config").is_ok());
    }

    #[test]
    fn validate_content_rejects_empty() {
        assert!(validate_content("").is_err());
        assert!(validate_content("   ").is_err());
    }

    #[test]
    fn validate_content_rejects_too_large() {
        let big = "a".repeat(MAX_CONTENT_SIZE + 1);
        assert!(validate_content(&big).is_err());
    }

    #[test]
    fn validate_content_accepts_valid() {
        assert!(validate_content("show version").is_ok());
    }

    #[test]
    fn validate_id_rejects_empty() {
        assert!(validate_id("").is_err());
        assert!(validate_id("   ").is_err());
    }

    #[test]
    fn validate_id_accepts_valid() {
        assert!(validate_id("abc-123").is_ok());
    }

    #[test]
    fn builtin_templates_not_empty() {
        let builtins = builtin_templates();
        assert_eq!(builtins.len(), 3);
    }

    // ── Integration tests with TemplateManager ──────────────

    #[test]
    fn manager_crud_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = TemplateManager::with_config_dir(dir.path().to_path_buf());

        // List should contain built-in templates
        let list = mgr.list();
        assert_eq!(list.len(), 3);
        assert!(list.iter().all(|t| t.is_builtin));

        // Create a new template
        let id = mgr
            .create(SaveTemplateInput {
                id: None,
                name: "My Template".into(),
                description: Some("Test template".into()),
                content: "hostname {{hostname}}".into(),
            })
            .unwrap();
        assert!(!id.is_empty());

        // List should now have 4
        let list = mgr.list();
        assert_eq!(list.len(), 4);

        // Get the template
        let tmpl = mgr.get(&id).unwrap();
        assert_eq!(tmpl.meta.name, "My Template");
        assert_eq!(tmpl.content, "hostname {{hostname}}");
        assert_eq!(tmpl.variables.len(), 1);
        assert_eq!(tmpl.variables[0].name, "hostname");

        // Delete the template
        mgr.delete(&id).unwrap();
        let list = mgr.list();
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn manager_cannot_delete_builtin() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = TemplateManager::with_config_dir(dir.path().to_path_buf());

        let list = mgr.list();
        let builtin = list.iter().find(|t| t.is_builtin).unwrap();

        let result = mgr.delete(&builtin.id);
        assert!(result.is_err());
    }

    #[test]
    fn manager_execute_substitutes_variables() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = TemplateManager::with_config_dir(dir.path().to_path_buf());

        let id = mgr
            .create(SaveTemplateInput {
                id: None,
                name: "Test Exec".into(),
                description: None,
                content: "interface {{interface}}\n ip address {{ip}} {{mask}}".into(),
            })
            .unwrap();

        let mut vars = HashMap::new();
        vars.insert("interface".to_string(), "Gi0/1".to_string());
        vars.insert("ip".to_string(), "10.0.0.1".to_string());
        vars.insert("mask".to_string(), "255.255.255.0".to_string());

        let result = mgr
            .execute(ExecuteTemplateInput {
                template_id: id,
                variables: vars,
            })
            .unwrap();

        assert_eq!(result, "interface Gi0/1\n ip address 10.0.0.1 255.255.255.0");
    }

    #[test]
    fn manager_get_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = TemplateManager::with_config_dir(dir.path().to_path_buf());

        let result = mgr.get("nonexistent-id");
        assert!(result.is_err());
    }
}
