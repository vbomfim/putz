/// Change window manager — handles CRUD, persistence, and window checking.
///
/// Architecture:
/// - **Config file** (`change_windows.json`): stores window definitions and
///   dangerous command patterns
/// - Thread safety: config behind `Mutex<ChangeWindowConfig>`
///
/// Persistence follows the same pattern as VaultManager:
/// - Atomic writes: write to temp file, then rename
/// - File permissions: 0600 on Unix
///
/// Time checking uses the `chrono` crate for local time evaluation.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use chrono::Local;
use directories::ProjectDirs;

use super::error::ComplianceError;
use super::models::*;

/// Config file name.
const CONFIG_FILE: &str = "change_windows.json";

/// Maximum number of change windows.
const MAX_WINDOWS: usize = 100;

/// Maximum length for window name.
const MAX_NAME_LENGTH: usize = 200;

/// Change window manager holding the config and providing check logic.
pub struct ChangeWindowManager {
    config: Mutex<ChangeWindowConfig>,
    config_dir: PathBuf,
}

impl ChangeWindowManager {
    /// Creates a new ChangeWindowManager with platform-appropriate config dir.
    pub fn new() -> Self {
        let config_dir = Self::resolve_config_dir();
        let config = Self::load_from_disk(&config_dir);
        Self {
            config: Mutex::new(config),
            config_dir,
        }
    }

    /// Creates a ChangeWindowManager with a custom config dir (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let config = Self::load_from_disk(&config_dir);
        Self {
            config: Mutex::new(config),
            config_dir,
        }
    }

    /// Resolves the platform-appropriate config directory.
    fn resolve_config_dir() -> PathBuf {
        ProjectDirs::from("com", "putz", "putz")
            .expect("Failed to resolve config directory: HOME or APPDATA not set")
            .config_dir()
            .to_path_buf()
    }

    /// Loads config from disk, returning default if file doesn't exist.
    fn load_from_disk(config_dir: &Path) -> ChangeWindowConfig {
        let path = config_dir.join(CONFIG_FILE);
        if !path.exists() {
            return ChangeWindowConfig::default();
        }
        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => ChangeWindowConfig::default(),
        }
    }

    /// Acquires the config lock, mapping poison errors.
    fn lock_config(&self) -> Result<MutexGuard<'_, ChangeWindowConfig>, ComplianceError> {
        self.config
            .lock()
            .map_err(|e| ComplianceError::LockError(e.to_string()))
    }

    /// Persists the current config to disk.
    fn save_to_disk(&self, config: &ChangeWindowConfig) -> Result<(), ComplianceError> {
        fs::create_dir_all(&self.config_dir)?;
        let path = self.config_dir.join(CONFIG_FILE);
        let tmp_path = self.config_dir.join(".change_windows.json.tmp");

        let json = serde_json::to_string_pretty(config)?;
        fs::write(&tmp_path, &json)?;

        // Set restrictive permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600))?;
        }

        fs::rename(&tmp_path, &path)?;
        Ok(())
    }

    /// Checks whether a command is dangerous and whether it's within a change window.
    ///
    /// Returns `allowed: true` if:
    /// - The command is not dangerous, OR
    /// - The command is dangerous but we're within an active change window
    pub fn check_command(&self, command: &str) -> Result<ChangeWindowCheckResult, ComplianceError> {
        let config = self.lock_config()?;
        let trimmed = command.trim().to_lowercase();

        // Check if the command matches any dangerous pattern
        let is_dangerous = config
            .dangerous_commands
            .iter()
            .any(|dc| trimmed.starts_with(&dc.to_lowercase()));

        if !is_dangerous {
            return Ok(ChangeWindowCheckResult {
                allowed: true,
                reason: "Command is not restricted".into(),
                window_name: None,
            });
        }

        // Command is dangerous — check if we're within an active window
        let now = Local::now();
        let current_hour = now.hour();
        let current_weekday = now.weekday().num_days_from_sunday() as u8;

        for window in &config.windows {
            if !window.enabled {
                continue;
            }

            // Check day-of-week (empty days = all days)
            let day_matches = window.days.is_empty() || window.days.contains(&current_weekday);
            if !day_matches {
                continue;
            }

            // Check hour range
            let hour_matches = if window.start_hour <= window.end_hour {
                // Normal range: e.g., 09–17
                current_hour >= window.start_hour as u32 && current_hour < window.end_hour as u32
            } else {
                // Wrapping range: e.g., 22–06 (overnight)
                current_hour >= window.start_hour as u32 || current_hour < window.end_hour as u32
            };

            if hour_matches {
                return Ok(ChangeWindowCheckResult {
                    allowed: true,
                    reason: format!("Within change window: {}", window.name),
                    window_name: Some(window.name.clone()),
                });
            }
        }

        Ok(ChangeWindowCheckResult {
            allowed: false,
            reason: "Dangerous command outside any change window".into(),
            window_name: None,
        })
    }

    /// Returns whether any active change window is currently open.
    pub fn is_window_active(&self) -> Result<bool, ComplianceError> {
        let config = self.lock_config()?;
        let now = Local::now();
        let current_hour = now.hour();
        let current_weekday = now.weekday().num_days_from_sunday() as u8;

        for window in &config.windows {
            if !window.enabled {
                continue;
            }
            let day_matches = window.days.is_empty() || window.days.contains(&current_weekday);
            if !day_matches {
                continue;
            }
            let hour_matches = if window.start_hour <= window.end_hour {
                current_hour >= window.start_hour as u32 && current_hour < window.end_hour as u32
            } else {
                current_hour >= window.start_hour as u32 || current_hour < window.end_hour as u32
            };
            if hour_matches {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Lists all defined change windows.
    pub fn list(&self) -> Result<Vec<ChangeWindow>, ComplianceError> {
        let config = self.lock_config()?;
        Ok(config.windows.clone())
    }

    /// Lists the configured dangerous commands.
    pub fn list_dangerous_commands(&self) -> Result<Vec<String>, ComplianceError> {
        let config = self.lock_config()?;
        Ok(config.dangerous_commands.clone())
    }

    /// Creates or updates a change window.
    ///
    /// Returns the window ID (generated for new, echoed for updates).
    pub fn set(&self, input: SetChangeWindowInput) -> Result<String, ComplianceError> {
        Self::validate_name(&input.name)?;
        Self::validate_hours(input.start_hour, input.end_hour)?;
        Self::validate_days(&input.days)?;

        let mut config = self.lock_config()?;

        let id = if let Some(existing_id) = &input.id {
            // Update existing
            let window = config
                .windows
                .iter_mut()
                .find(|w| w.id == *existing_id)
                .ok_or_else(|| {
                    ComplianceError::InvalidInput(format!("Window not found: {existing_id}"))
                })?;
            window.name = input.name;
            window.days = input.days;
            window.start_hour = input.start_hour;
            window.end_hour = input.end_hour;
            window.device_groups = input.device_groups;
            window.enabled = input.enabled;
            existing_id.clone()
        } else {
            // Create new
            if config.windows.len() >= MAX_WINDOWS {
                return Err(ComplianceError::InvalidInput(format!(
                    "Maximum of {MAX_WINDOWS} change windows reached"
                )));
            }
            let id = uuid::Uuid::new_v4().to_string();
            config.windows.push(ChangeWindow {
                id: id.clone(),
                name: input.name,
                days: input.days,
                start_hour: input.start_hour,
                end_hour: input.end_hour,
                device_groups: input.device_groups,
                enabled: input.enabled,
            });
            id
        };

        self.save_to_disk(&config)?;
        Ok(id)
    }

    /// Deletes a change window by ID.
    pub fn delete(&self, id: &str) -> Result<(), ComplianceError> {
        let mut config = self.lock_config()?;
        let original_len = config.windows.len();
        config.windows.retain(|w| w.id != id);
        if config.windows.len() == original_len {
            return Err(ComplianceError::InvalidInput(format!(
                "Window not found: {id}"
            )));
        }
        self.save_to_disk(&config)?;
        Ok(())
    }

    /// Validates a window name.
    fn validate_name(name: &str) -> Result<(), ComplianceError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(ComplianceError::InvalidInput(
                "Window name cannot be empty".into(),
            ));
        }
        if trimmed.len() > MAX_NAME_LENGTH {
            return Err(ComplianceError::InvalidInput(format!(
                "Window name exceeds maximum length of {MAX_NAME_LENGTH} characters"
            )));
        }
        Ok(())
    }

    /// Validates hour values.
    fn validate_hours(start: u8, end: u8) -> Result<(), ComplianceError> {
        if start > 23 {
            return Err(ComplianceError::InvalidInput(
                "Start hour must be 0–23".into(),
            ));
        }
        if end > 23 {
            return Err(ComplianceError::InvalidInput(
                "End hour must be 0–23".into(),
            ));
        }
        Ok(())
    }

    /// Validates day-of-week values.
    fn validate_days(days: &[u8]) -> Result<(), ComplianceError> {
        for &day in days {
            if day > 6 {
                return Err(ComplianceError::InvalidInput(
                    "Day values must be 0–6 (Sunday–Saturday)".into(),
                ));
            }
        }
        Ok(())
    }
}

// Import Timelike for hour() method and Datelike for weekday()
use chrono::{Datelike, Timelike};

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Helper: creates a manager with a temp dir and an always-open window.
    fn manager_with_window(
        start_hour: u8,
        end_hour: u8,
        days: Vec<u8>,
    ) -> (ChangeWindowManager, TempDir) {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        mgr.set(SetChangeWindowInput {
            id: None,
            name: "Test Window".into(),
            days,
            start_hour,
            end_hour,
            device_groups: vec![],
            enabled: true,
        })
        .unwrap();
        (mgr, tmp)
    }

    // ─── Default config ──────────────────────────────────────

    #[test]
    fn default_config_has_dangerous_commands() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let cmds = mgr.list_dangerous_commands().unwrap();
        assert!(cmds.contains(&"configure terminal".to_string()));
        assert!(cmds.contains(&"conf t".to_string()));
        assert!(cmds.contains(&"commit".to_string()));
        assert!(cmds.contains(&"write mem".to_string()));
        assert!(cmds.contains(&"copy run start".to_string()));
    }

    #[test]
    fn default_config_has_no_windows() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let windows = mgr.list().unwrap();
        assert!(windows.is_empty());
    }

    // ─── Command checking ────────────────────────────────────

    #[test]
    fn safe_command_always_allowed() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("show ip route").unwrap();
        assert!(result.allowed);
        assert_eq!(result.reason, "Command is not restricted");
    }

    #[test]
    fn dangerous_command_blocked_without_windows() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("configure terminal").unwrap();
        assert!(!result.allowed);
        assert!(result.reason.contains("Dangerous command"));
    }

    #[test]
    fn dangerous_command_case_insensitive() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("CONFIGURE TERMINAL").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn dangerous_command_with_whitespace() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("  conf t  ").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn dangerous_command_allowed_within_allday_window() {
        // Create a window that covers all hours and all days
        let (mgr, _tmp) = manager_with_window(0, 0, vec![]);
        // start == end means 24-hour window (handled as: 0 >= 0 || 0 < 0 → true for overnight)
        // Actually with start==end, the overnight branch fires (start > end is false since 0 == 0)
        // So it falls to start <= end: current_hour >= 0 && current_hour < 0 → false
        // Let's use 0–24, but hours max is 23.
        // Use overnight: start=0, end=23 covers 0..23 which is 23 hours
        // Better: let's use a window that covers current hour
        let now_hour = Local::now().hour() as u8;
        let (mgr, _tmp) = manager_with_window(
            now_hour,
            if now_hour == 23 { 0 } else { now_hour + 1 },
            vec![],
        );
        let result = mgr.check_command("conf t").unwrap();
        assert!(result.allowed);
        assert!(result.window_name.is_some());
    }

    #[test]
    fn write_mem_is_dangerous() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("write mem").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn copy_run_start_is_dangerous() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("copy run start").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn commit_is_dangerous() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.check_command("commit").unwrap();
        assert!(!result.allowed);
    }

    #[test]
    fn show_command_not_dangerous() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        for cmd in &[
            "show run",
            "show interfaces",
            "ping 10.0.0.1",
            "traceroute 8.8.8.8",
        ] {
            let result = mgr.check_command(cmd).unwrap();
            assert!(result.allowed, "Expected '{}' to be allowed", cmd);
        }
    }

    // ─── CRUD operations ─────────────────────────────────────

    #[test]
    fn create_window() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let id = mgr
            .set(SetChangeWindowInput {
                id: None,
                name: "Weekend".into(),
                days: vec![0, 6],
                start_hour: 22,
                end_hour: 6,
                device_groups: vec![],
                enabled: true,
            })
            .unwrap();
        assert!(!id.is_empty());
        let windows = mgr.list().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].name, "Weekend");
    }

    #[test]
    fn update_window() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let id = mgr
            .set(SetChangeWindowInput {
                id: None,
                name: "Original".into(),
                days: vec![],
                start_hour: 0,
                end_hour: 6,
                device_groups: vec![],
                enabled: true,
            })
            .unwrap();
        mgr.set(SetChangeWindowInput {
            id: Some(id.clone()),
            name: "Updated".into(),
            days: vec![1],
            start_hour: 2,
            end_hour: 4,
            device_groups: vec![],
            enabled: false,
        })
        .unwrap();
        let windows = mgr.list().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].name, "Updated");
        assert!(!windows[0].enabled);
    }

    #[test]
    fn delete_window() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let id = mgr
            .set(SetChangeWindowInput {
                id: None,
                name: "ToDelete".into(),
                days: vec![],
                start_hour: 0,
                end_hour: 6,
                device_groups: vec![],
                enabled: true,
            })
            .unwrap();
        mgr.delete(&id).unwrap();
        assert!(mgr.list().unwrap().is_empty());
    }

    #[test]
    fn delete_nonexistent_window_errors() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.delete("nonexistent");
        assert!(result.is_err());
    }

    // ─── Validation ──────────────────────────────────────────

    #[test]
    fn empty_name_rejected() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.set(SetChangeWindowInput {
            id: None,
            name: "".into(),
            days: vec![],
            start_hour: 0,
            end_hour: 6,
            device_groups: vec![],
            enabled: true,
        });
        assert!(result.is_err());
    }

    #[test]
    fn invalid_hour_rejected() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.set(SetChangeWindowInput {
            id: None,
            name: "Test".into(),
            days: vec![],
            start_hour: 25,
            end_hour: 6,
            device_groups: vec![],
            enabled: true,
        });
        assert!(result.is_err());
    }

    #[test]
    fn invalid_day_rejected() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let result = mgr.set(SetChangeWindowInput {
            id: None,
            name: "Test".into(),
            days: vec![7],
            start_hour: 0,
            end_hour: 6,
            device_groups: vec![],
            enabled: true,
        });
        assert!(result.is_err());
    }

    // ─── Persistence ─────────────────────────────────────────

    #[test]
    fn config_persists_to_disk() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        mgr.set(SetChangeWindowInput {
            id: None,
            name: "Persistent".into(),
            days: vec![1, 3, 5],
            start_hour: 22,
            end_hour: 6,
            device_groups: vec!["core".into()],
            enabled: true,
        })
        .unwrap();

        // Create a new manager from the same dir — should load persisted data
        let mgr2 = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        let windows = mgr2.list().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].name, "Persistent");
        assert_eq!(windows[0].days, vec![1, 3, 5]);
    }

    // ─── is_window_active ────────────────────────────────────

    #[test]
    fn no_windows_means_inactive() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        assert!(!mgr.is_window_active().unwrap());
    }

    #[test]
    fn disabled_window_not_active() {
        let tmp = TempDir::new().unwrap();
        let mgr = ChangeWindowManager::with_config_dir(tmp.path().to_path_buf());
        // Create a window that covers now but is disabled
        let now_hour = Local::now().hour() as u8;
        let id = mgr
            .set(SetChangeWindowInput {
                id: None,
                name: "Disabled".into(),
                days: vec![],
                start_hour: now_hour,
                end_hour: if now_hour == 23 { 0 } else { now_hour + 1 },
                device_groups: vec![],
                enabled: true,
            })
            .unwrap();
        // Disable it
        mgr.set(SetChangeWindowInput {
            id: Some(id),
            name: "Disabled".into(),
            days: vec![],
            start_hour: now_hour,
            end_hour: if now_hour == 23 { 0 } else { now_hour + 1 },
            device_groups: vec![],
            enabled: false,
        })
        .unwrap();
        assert!(!mgr.is_window_active().unwrap());
    }
}
