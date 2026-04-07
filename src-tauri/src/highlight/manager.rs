/// Highlight manager — handles CRUD, persistence, and built-in presets.
///
/// Persistence:
/// - Stores highlight sets in `~/.config/putz/highlights.json` (platform-appropriate)
/// - Atomic writes: write to temp file, then rename
/// - Auto-backup: rotates 5 backups before each write
///
/// Built-in presets:
/// - Cisco IOS, Linux Syslog, Junos, General Networking
/// - Injected on first load if not present
/// - Cannot be deleted (guarded by is_builtin flag)
///
/// Thread safety: Inner state is behind `Mutex<HighlightStore>`.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use directories::ProjectDirs;

use super::error::HighlightError;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Highlights file name.
const HIGHLIGHTS_FILE: &str = "highlights.json";

/// Maximum number of highlight sets allowed.
const MAX_SETS: usize = 100;

/// Highlight manager holding the in-memory store and config directory path.
pub struct HighlightManager {
    store: Mutex<HighlightStore>,
    config_dir: PathBuf,
}

impl HighlightManager {
    /// Creates a new HighlightManager, loading from disk if available.
    ///
    /// Injects built-in presets on first load.
    pub fn new() -> Self {
        let config_dir = Self::resolve_config_dir();
        let mut store = Self::load_from_disk(&config_dir);
        Self::inject_builtin_presets(&mut store);
        let mgr = Self {
            store: Mutex::new(store),
            config_dir,
        };
        // Persist the injected presets
        let _ = mgr.save_to_disk();
        mgr
    }

    /// Creates a HighlightManager with a custom config directory (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let mut store = Self::load_from_disk(&config_dir);
        Self::inject_builtin_presets(&mut store);
        let mgr = Self {
            store: Mutex::new(store),
            config_dir,
        };
        let _ = mgr.save_to_disk();
        mgr
    }

    /// Resolves the platform-appropriate config directory.
    fn resolve_config_dir() -> PathBuf {
        if let Some(proj_dirs) = ProjectDirs::from("com", "putz", "putz") {
            proj_dirs.config_dir().to_path_buf()
        } else {
            PathBuf::from(".")
        }
    }

    /// Acquires the internal mutex, returning a graceful error on poisoning.
    fn lock_store(&self) -> Result<MutexGuard<'_, HighlightStore>, HighlightError> {
        self.store
            .lock()
            .map_err(|e| HighlightError::LockError(format!("Highlight store mutex poisoned: {e}")))
    }

    // ─── CRUD Operations ─────────────────────────────────────

    /// Lists all highlight sets (summary: id, name, description, is_builtin, rule count).
    pub fn list_sets(&self) -> Result<Vec<HighlightSet>, HighlightError> {
        let store = self.lock_store()?;
        Ok(store.sets.clone())
    }

    /// Gets a single highlight set by ID.
    pub fn get_set(&self, id: &str) -> Result<HighlightSet, HighlightError> {
        let store = self.lock_store()?;
        store
            .sets
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| HighlightError::NotFound(id.into()))
    }

    /// Creates a new highlight set. Returns the generated UUID.
    pub fn create_set(&self, input: CreateHighlightSetInput) -> Result<String, HighlightError> {
        validation::validate_name(&input.name)?;
        validation::validate_description(&input.description)?;
        validation::validate_rules_count(input.rules.len())?;

        // Validate each rule
        for rule_input in &input.rules {
            validation::validate_pattern(&rule_input.pattern, &rule_input.match_type)?;
            validation::validate_hex_color(&rule_input.foreground_color)?;
            validation::validate_hex_color(&rule_input.background_color)?;
            validation::validate_priority(rule_input.priority)?;
        }

        let mut store = self.lock_store()?;

        // Check set limit
        if store.sets.len() >= MAX_SETS {
            return Err(HighlightError::InvalidInput(format!(
                "Maximum number of highlight sets ({MAX_SETS}) reached"
            )));
        }

        // Check duplicate name
        if store
            .sets
            .iter()
            .any(|s| s.name.eq_ignore_ascii_case(&input.name))
        {
            return Err(HighlightError::DuplicateName(input.name));
        }

        let now = Self::now_iso8601();
        let set_id = uuid::Uuid::new_v4().to_string();

        let rules: Vec<HighlightRule> = input
            .rules
            .into_iter()
            .map(|r| HighlightRule {
                id: uuid::Uuid::new_v4().to_string(),
                pattern: r.pattern,
                match_type: r.match_type,
                foreground_color: r.foreground_color,
                background_color: r.background_color,
                bold: r.bold,
                underline: r.underline,
                priority: r.priority,
            })
            .collect();

        let set = HighlightSet {
            id: set_id.clone(),
            name: input.name,
            description: input.description,
            rules,
            is_builtin: false,
            created_at: now.clone(),
            updated_at: now,
        };

        store.sets.push(set);
        drop(store);

        self.save_to_disk()?;
        Ok(set_id)
    }

    /// Updates an existing highlight set with partial fields.
    pub fn update_set(
        &self,
        id: &str,
        input: UpdateHighlightSetInput,
    ) -> Result<(), HighlightError> {
        if let Some(ref name) = input.name {
            validation::validate_name(name)?;
        }

        if let Some(ref description) = input.description {
            validation::validate_description(description)?;
        }

        if let Some(ref rules) = input.rules {
            validation::validate_rules_count(rules.len())?;
            for rule_input in rules {
                validation::validate_pattern(&rule_input.pattern, &rule_input.match_type)?;
                validation::validate_hex_color(&rule_input.foreground_color)?;
                validation::validate_hex_color(&rule_input.background_color)?;
                validation::validate_priority(rule_input.priority)?;
            }
        }

        let mut store = self.lock_store()?;

        let set = store
            .sets
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| HighlightError::NotFound(id.into()))?;

        if set.is_builtin {
            return Err(HighlightError::BuiltinProtected(set.name.clone()));
        }

        // Check duplicate name (excluding self)
        if let Some(ref new_name) = input.name {
            if store
                .sets
                .iter()
                .any(|s| s.id != id && s.name.eq_ignore_ascii_case(new_name))
            {
                return Err(HighlightError::DuplicateName(new_name.clone()));
            }
        }

        // Re-borrow mutably after the duplicate check
        let set = store
            .sets
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| HighlightError::NotFound(id.into()))?;

        if let Some(name) = input.name {
            set.name = name;
        }
        if let Some(description) = input.description {
            set.description = description;
        }
        if let Some(rule_inputs) = input.rules {
            set.rules = rule_inputs
                .into_iter()
                .map(|r| HighlightRule {
                    id: uuid::Uuid::new_v4().to_string(),
                    pattern: r.pattern,
                    match_type: r.match_type,
                    foreground_color: r.foreground_color,
                    background_color: r.background_color,
                    bold: r.bold,
                    underline: r.underline,
                    priority: r.priority,
                })
                .collect();
        }
        set.updated_at = Self::now_iso8601();

        drop(store);
        self.save_to_disk()?;
        Ok(())
    }

    /// Deletes a highlight set by ID.
    pub fn delete_set(&self, id: &str) -> Result<(), HighlightError> {
        let mut store = self.lock_store()?;

        let idx = store
            .sets
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| HighlightError::NotFound(id.into()))?;

        if store.sets[idx].is_builtin {
            return Err(HighlightError::BuiltinProtected(
                store.sets[idx].name.clone(),
            ));
        }

        store.sets.remove(idx);
        drop(store);

        self.save_to_disk()?;
        Ok(())
    }

    // ─── Persistence ─────────────────────────────────────────

    /// Loads the highlight store from disk, returning default if missing.
    fn load_from_disk(config_dir: &Path) -> HighlightStore {
        let path = config_dir.join(HIGHLIGHTS_FILE);
        if !path.exists() {
            return HighlightStore::default();
        }

        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => HighlightStore::default(),
        }
    }

    /// Persists the in-memory store to disk with atomic write + backup rotation.
    fn save_to_disk(&self) -> Result<(), HighlightError> {
        let store = self.lock_store()?;

        // Ensure config directory exists
        fs::create_dir_all(&self.config_dir)?;

        let path = self.config_dir.join(HIGHLIGHTS_FILE);

        // Rotate backups
        if path.exists() {
            Self::rotate_backups(&path)?;
        }

        // Serialize
        let json = serde_json::to_string_pretty(&*store)?;

        // Atomic write: temp file → rename
        let tmp_path = self.config_dir.join("highlights.tmp");
        fs::write(&tmp_path, &json)?;
        fs::rename(&tmp_path, &path)?;

        // Set file permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            let _ = fs::set_permissions(&path, perms);
        }

        Ok(())
    }

    /// Rotates backup files (highlights.json.bak.1 → .bak.2, etc.).
    fn rotate_backups(path: &Path) -> Result<(), HighlightError> {
        for i in (1..MAX_BACKUPS).rev() {
            let from = path.with_extension(format!("json.bak.{i}"));
            let to = path.with_extension(format!("json.bak.{}", i + 1));
            if from.exists() {
                fs::rename(&from, &to)?;
            }
        }
        let bak1 = path.with_extension("json.bak.1");
        if path.exists() {
            fs::copy(path, &bak1)?;
        }
        Ok(())
    }

    /// Returns the current time as an ISO 8601 string.
    fn now_iso8601() -> String {
        let now = time::OffsetDateTime::now_utc();
        now.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
    }

    // ─── Built-in Presets ────────────────────────────────────

    /// Injects built-in presets if they're not already present.
    fn inject_builtin_presets(store: &mut HighlightStore) {
        let presets = Self::builtin_presets();
        for preset in presets {
            if !store
                .sets
                .iter()
                .any(|s| s.name == preset.name && s.is_builtin)
            {
                store.sets.push(preset);
            }
        }
    }

    /// Returns the list of built-in highlight presets.
    fn builtin_presets() -> Vec<HighlightSet> {
        let now = "2024-01-01T00:00:00Z".to_string();
        vec![
            Self::cisco_ios_preset(&now),
            Self::linux_syslog_preset(&now),
            Self::junos_preset(&now),
            Self::general_networking_preset(&now),
        ]
    }

    fn cisco_ios_preset(now: &str) -> HighlightSet {
        HighlightSet {
            id: "builtin-cisco-ios".into(),
            name: "Cisco IOS".into(),
            description: "Highlight patterns for Cisco IOS syslog and interface output".into(),
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
            rules: vec![
                HighlightRule {
                    id: "cisco-syslog".into(),
                    pattern: r"%.*-\d-.*".into(),
                    match_type: MatchType::Regex,
                    foreground_color: "#F1FA8C".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 50,
                },
                HighlightRule {
                    id: "cisco-up-up".into(),
                    pattern: "up/up".into(),
                    match_type: MatchType::Exact,
                    foreground_color: "#50FA7B".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 100,
                },
                HighlightRule {
                    id: "cisco-down-down".into(),
                    pattern: "down/down".into(),
                    match_type: MatchType::Exact,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 100,
                },
                HighlightRule {
                    id: "cisco-err-disabled".into(),
                    pattern: "err-disabled".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: true,
                    underline: false,
                    priority: 110,
                },
                HighlightRule {
                    id: "cisco-admin-down".into(),
                    pattern: "administratively down".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FFB86C".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 90,
                },
                HighlightRule {
                    id: "cisco-ip".into(),
                    pattern: r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}".into(),
                    match_type: MatchType::Regex,
                    foreground_color: "#8BE9FD".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 30,
                },
            ],
        }
    }

    fn linux_syslog_preset(now: &str) -> HighlightSet {
        HighlightSet {
            id: "builtin-linux-syslog".into(),
            name: "Linux Syslog".into(),
            description: "Highlight patterns for Linux syslog and journalctl output".into(),
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
            rules: vec![
                HighlightRule {
                    id: "syslog-critical".into(),
                    pattern: "CRITICAL".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: true,
                    underline: false,
                    priority: 120,
                },
                HighlightRule {
                    id: "syslog-error".into(),
                    pattern: "ERROR".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 100,
                },
                HighlightRule {
                    id: "syslog-warning".into(),
                    pattern: "WARNING".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#F1FA8C".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 80,
                },
                HighlightRule {
                    id: "syslog-info".into(),
                    pattern: "INFO".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#50FA7B".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 60,
                },
                HighlightRule {
                    id: "syslog-debug".into(),
                    pattern: "DEBUG".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#6272A4".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 40,
                },
            ],
        }
    }

    fn junos_preset(now: &str) -> HighlightSet {
        HighlightSet {
            id: "builtin-junos".into(),
            name: "Junos".into(),
            description: "Highlight patterns for Juniper Junos syslog and interface output".into(),
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
            rules: vec![
                HighlightRule {
                    id: "junos-critical".into(),
                    pattern: "CRITICAL".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: true,
                    underline: false,
                    priority: 120,
                },
                HighlightRule {
                    id: "junos-major".into(),
                    pattern: "MAJOR".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 100,
                },
                HighlightRule {
                    id: "junos-minor".into(),
                    pattern: "MINOR".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FFB86C".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 80,
                },
                HighlightRule {
                    id: "junos-up".into(),
                    pattern: "Up".into(),
                    match_type: MatchType::Exact,
                    foreground_color: "#50FA7B".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 60,
                },
                HighlightRule {
                    id: "junos-down".into(),
                    pattern: "Down".into(),
                    match_type: MatchType::Exact,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 60,
                },
            ],
        }
    }

    fn general_networking_preset(now: &str) -> HighlightSet {
        HighlightSet {
            id: "builtin-general-networking".into(),
            name: "General Networking".into(),
            description: "Common networking patterns: IPs, MACs, errors, warnings".into(),
            is_builtin: true,
            created_at: now.into(),
            updated_at: now.into(),
            rules: vec![
                HighlightRule {
                    id: "net-ip".into(),
                    pattern: r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}".into(),
                    match_type: MatchType::Regex,
                    foreground_color: "#8BE9FD".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 30,
                },
                HighlightRule {
                    id: "net-mac".into(),
                    pattern: r"[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}".into(),
                    match_type: MatchType::Regex,
                    foreground_color: "#BD93F9".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 30,
                },
                HighlightRule {
                    id: "net-error".into(),
                    pattern: "error".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#FF5555".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 100,
                },
                HighlightRule {
                    id: "net-warning".into(),
                    pattern: "warning".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#F1FA8C".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 80,
                },
                HighlightRule {
                    id: "net-success".into(),
                    pattern: "success".into(),
                    match_type: MatchType::ExactInsensitive,
                    foreground_color: "#50FA7B".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 60,
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a test HighlightManager with an isolated temp directory.
    fn test_manager() -> (HighlightManager, tempfile::TempDir) {
        let tmp = tempfile::TempDir::new().unwrap();
        let mgr = HighlightManager::with_config_dir(tmp.path().to_path_buf());
        (mgr, tmp)
    }

    // ─── Built-in presets ──────────────────────────────────────

    #[test]
    fn new_manager_has_builtin_presets() {
        let (mgr, _tmp) = test_manager();
        let sets = mgr.list_sets().unwrap();
        assert!(sets.len() >= 4, "Should have at least 4 built-in presets");

        let names: Vec<&str> = sets.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Cisco IOS"));
        assert!(names.contains(&"Linux Syslog"));
        assert!(names.contains(&"Junos"));
        assert!(names.contains(&"General Networking"));
    }

    #[test]
    fn builtin_presets_are_marked_builtin() {
        let (mgr, _tmp) = test_manager();
        let sets = mgr.list_sets().unwrap();
        for set in &sets {
            if set.name == "Cisco IOS" {
                assert!(set.is_builtin);
            }
        }
    }

    #[test]
    fn cisco_ios_preset_has_rules() {
        let (mgr, _tmp) = test_manager();
        let set = mgr.get_set("builtin-cisco-ios").unwrap();
        assert!(!set.rules.is_empty());
        assert!(set.rules.iter().any(|r| r.pattern == "up/up"));
        assert!(set.rules.iter().any(|r| r.pattern == "down/down"));
        assert!(set.rules.iter().any(|r| r.pattern == "err-disabled"));
    }

    // ─── CRUD operations ──────────────────────────────────────

    #[test]
    fn create_set_returns_uuid() {
        let (mgr, _tmp) = test_manager();
        let input = CreateHighlightSetInput {
            name: "My Custom Set".into(),
            description: "Test set".into(),
            rules: vec![CreateHighlightRuleInput {
                pattern: "ERROR".into(),
                match_type: MatchType::Exact,
                foreground_color: "#FF0000".into(),
                background_color: String::new(),
                bold: false,
                underline: false,
                priority: 100,
            }],
        };
        let id = mgr.create_set(input).unwrap();
        assert!(!id.is_empty());
        // Verify it's a valid UUID
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn create_and_get_set() {
        let (mgr, _tmp) = test_manager();
        let input = CreateHighlightSetInput {
            name: "Test Set".into(),
            description: "A test".into(),
            rules: vec![CreateHighlightRuleInput {
                pattern: "WARNING".into(),
                match_type: MatchType::ExactInsensitive,
                foreground_color: "#FFFF00".into(),
                background_color: "#000000".into(),
                bold: true,
                underline: true,
                priority: 50,
            }],
        };
        let id = mgr.create_set(input).unwrap();
        let set = mgr.get_set(&id).unwrap();

        assert_eq!(set.name, "Test Set");
        assert_eq!(set.description, "A test");
        assert!(!set.is_builtin);
        assert_eq!(set.rules.len(), 1);
        assert_eq!(set.rules[0].pattern, "WARNING");
        assert!(set.rules[0].bold);
        assert!(set.rules[0].underline);
        assert_eq!(set.rules[0].priority, 50);
    }

    #[test]
    fn get_set_not_found() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.get_set("nonexistent");
        assert!(matches!(result, Err(HighlightError::NotFound(_))));
    }

    #[test]
    fn update_set_name() {
        let (mgr, _tmp) = test_manager();
        let id = mgr
            .create_set(CreateHighlightSetInput {
                name: "Original".into(),
                description: String::new(),
                rules: vec![],
            })
            .unwrap();

        mgr.update_set(
            &id,
            UpdateHighlightSetInput {
                name: Some("Renamed".into()),
                description: None,
                rules: None,
            },
        )
        .unwrap();

        let set = mgr.get_set(&id).unwrap();
        assert_eq!(set.name, "Renamed");
    }

    #[test]
    fn update_set_rules() {
        let (mgr, _tmp) = test_manager();
        let id = mgr
            .create_set(CreateHighlightSetInput {
                name: "Updateable".into(),
                description: String::new(),
                rules: vec![],
            })
            .unwrap();

        mgr.update_set(
            &id,
            UpdateHighlightSetInput {
                name: None,
                description: None,
                rules: Some(vec![
                    CreateHighlightRuleInput {
                        pattern: "ERROR".into(),
                        match_type: MatchType::Exact,
                        foreground_color: "#FF0000".into(),
                        background_color: String::new(),
                        bold: false,
                        underline: false,
                        priority: 100,
                    },
                    CreateHighlightRuleInput {
                        pattern: "OK".into(),
                        match_type: MatchType::Exact,
                        foreground_color: "#00FF00".into(),
                        background_color: String::new(),
                        bold: false,
                        underline: false,
                        priority: 50,
                    },
                ]),
            },
        )
        .unwrap();

        let set = mgr.get_set(&id).unwrap();
        assert_eq!(set.rules.len(), 2);
    }

    #[test]
    fn update_builtin_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.update_set(
            "builtin-cisco-ios",
            UpdateHighlightSetInput {
                name: Some("Hacked".into()),
                description: None,
                rules: None,
            },
        );
        assert!(matches!(result, Err(HighlightError::BuiltinProtected(_))));
    }

    #[test]
    fn update_not_found() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.update_set(
            "nonexistent",
            UpdateHighlightSetInput {
                name: Some("Name".into()),
                description: None,
                rules: None,
            },
        );
        assert!(matches!(result, Err(HighlightError::NotFound(_))));
    }

    #[test]
    fn delete_set() {
        let (mgr, _tmp) = test_manager();
        let id = mgr
            .create_set(CreateHighlightSetInput {
                name: "To Delete".into(),
                description: String::new(),
                rules: vec![],
            })
            .unwrap();

        mgr.delete_set(&id).unwrap();
        assert!(matches!(mgr.get_set(&id), Err(HighlightError::NotFound(_))));
    }

    #[test]
    fn delete_builtin_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.delete_set("builtin-cisco-ios");
        assert!(matches!(result, Err(HighlightError::BuiltinProtected(_))));
    }

    #[test]
    fn delete_not_found() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.delete_set("nonexistent");
        assert!(matches!(result, Err(HighlightError::NotFound(_))));
    }

    // ─── Validation integration ────────────────────────────────

    #[test]
    fn create_set_invalid_name_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "".into(),
            description: String::new(),
            rules: vec![],
        });
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    #[test]
    fn create_set_duplicate_name_rejected() {
        let (mgr, _tmp) = test_manager();
        mgr.create_set(CreateHighlightSetInput {
            name: "Unique Name".into(),
            description: String::new(),
            rules: vec![],
        })
        .unwrap();

        let result = mgr.create_set(CreateHighlightSetInput {
            name: "unique name".into(), // case-insensitive duplicate
            description: String::new(),
            rules: vec![],
        });
        assert!(matches!(result, Err(HighlightError::DuplicateName(_))));
    }

    #[test]
    fn create_set_invalid_color_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "Bad Color".into(),
            description: String::new(),
            rules: vec![CreateHighlightRuleInput {
                pattern: "test".into(),
                match_type: MatchType::Exact,
                foreground_color: "red".into(), // invalid
                background_color: String::new(),
                bold: false,
                underline: false,
                priority: 0,
            }],
        });
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    #[test]
    fn create_set_invalid_regex_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "Bad Regex".into(),
            description: String::new(),
            rules: vec![CreateHighlightRuleInput {
                pattern: "[invalid".into(),
                match_type: MatchType::Regex,
                foreground_color: "#FF0000".into(),
                background_color: String::new(),
                bold: false,
                underline: false,
                priority: 0,
            }],
        });
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    #[test]
    fn create_set_invalid_priority_rejected() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "Bad Priority".into(),
            description: String::new(),
            rules: vec![CreateHighlightRuleInput {
                pattern: "test".into(),
                match_type: MatchType::Exact,
                foreground_color: "#FF0000".into(),
                background_color: String::new(),
                bold: false,
                underline: false,
                priority: 1000,
            }],
        });
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    // ─── Persistence ──────────────────────────────────────────

    #[test]
    fn persistence_survives_reload() {
        let tmp = tempfile::TempDir::new().unwrap();
        let config_dir = tmp.path().to_path_buf();

        // Create a set with the first manager
        let id = {
            let mgr = HighlightManager::with_config_dir(config_dir.clone());
            mgr.create_set(CreateHighlightSetInput {
                name: "Persistent Set".into(),
                description: "Should survive reload".into(),
                rules: vec![CreateHighlightRuleInput {
                    pattern: "PERSIST".into(),
                    match_type: MatchType::Exact,
                    foreground_color: "#00FF00".into(),
                    background_color: String::new(),
                    bold: false,
                    underline: false,
                    priority: 10,
                }],
            })
            .unwrap()
        };

        // Reload from disk
        let mgr2 = HighlightManager::with_config_dir(config_dir);
        let set = mgr2.get_set(&id).unwrap();
        assert_eq!(set.name, "Persistent Set");
        assert_eq!(set.rules.len(), 1);
        assert_eq!(set.rules[0].pattern, "PERSIST");
    }

    #[test]
    fn highlights_file_created_on_disk() {
        let tmp = tempfile::TempDir::new().unwrap();
        let _mgr = HighlightManager::with_config_dir(tmp.path().to_path_buf());
        let path = tmp.path().join(HIGHLIGHTS_FILE);
        assert!(path.exists(), "highlights.json should exist on disk");
    }

    #[test]
    fn update_set_duplicate_name_rejected() {
        let (mgr, _tmp) = test_manager();
        let id1 = mgr
            .create_set(CreateHighlightSetInput {
                name: "Set One".into(),
                description: String::new(),
                rules: vec![],
            })
            .unwrap();
        mgr.create_set(CreateHighlightSetInput {
            name: "Set Two".into(),
            description: String::new(),
            rules: vec![],
        })
        .unwrap();

        let result = mgr.update_set(
            &id1,
            UpdateHighlightSetInput {
                name: Some("Set Two".into()),
                description: None,
                rules: None,
            },
        );
        assert!(matches!(result, Err(HighlightError::DuplicateName(_))));
    }

    #[test]
    fn create_set_description_too_long_rejected() {
        let (mgr, _tmp) = test_manager();
        let long_desc = "a".repeat(2001);
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "Desc Test".into(),
            description: long_desc,
            rules: vec![],
        });
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    #[test]
    fn update_set_description_too_long_rejected() {
        let (mgr, _tmp) = test_manager();
        let id = mgr
            .create_set(CreateHighlightSetInput {
                name: "Desc Update Test".into(),
                description: String::new(),
                rules: vec![],
            })
            .unwrap();
        let result = mgr.update_set(
            &id,
            UpdateHighlightSetInput {
                name: None,
                description: Some("b".repeat(2001)),
                rules: None,
            },
        );
        assert!(matches!(result, Err(HighlightError::InvalidInput(_))));
    }

    #[test]
    fn create_set_valid_description_accepted() {
        let (mgr, _tmp) = test_manager();
        let desc = "a".repeat(2000);
        let result = mgr.create_set(CreateHighlightSetInput {
            name: "Valid Desc".into(),
            description: desc,
            rules: vec![],
        });
        assert!(result.is_ok());
    }
}
