/// Auto-login manager — pattern-based automatic authentication.
///
/// Manages auto-login profiles stored in `~/.config/putz/autologin.json`.
/// Provides pattern matching against terminal output to drive login sequences.
///
/// Thread-safe via `Mutex<AutoLoginStore>`.
use std::collections::HashMap;
use std::sync::Mutex;

use regex::Regex;

use super::error::AutoLoginError;
use super::models::{
    AutoLoginProfile, BuiltinPatterns, LoginAction, LoginStep, SetAutoLoginInput,
};

/// In-memory store for auto-login profiles.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct AutoLoginStore {
    version: u32,
    profiles: Vec<AutoLoginProfile>,
}

impl Default for AutoLoginStore {
    fn default() -> Self {
        Self {
            version: 1,
            profiles: Vec::new(),
        }
    }
}

/// Tracks the progress of an active login sequence for a connection.
struct LoginState {
    /// The login steps being executed.
    steps: Vec<LoginStep>,
    /// Index of the current step being waited on.
    current_step: usize,
    /// Accumulated output buffer for pattern matching.
    output_buffer: String,
}

/// Thread-safe auto-login manager.
pub struct AutoLoginManager {
    store: Mutex<AutoLoginStore>,
    /// Active login states keyed by connection ID.
    active_logins: Mutex<HashMap<String, LoginState>>,
    /// Path to the autologin.json file.
    file_path: Option<std::path::PathBuf>,
}

impl AutoLoginManager {
    /// Creates a new manager, loading profiles from disk.
    pub fn new() -> Self {
        let file_path = Self::storage_path();
        let store = file_path
            .as_ref()
            .and_then(|path| {
                if path.exists() {
                    std::fs::read_to_string(path)
                        .ok()
                        .and_then(|data| serde_json::from_str(&data).ok())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        Self {
            store: Mutex::new(store),
            active_logins: Mutex::new(HashMap::new()),
            file_path,
        }
    }

    /// Creates a new manager with no disk persistence (for testing).
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        Self {
            store: Mutex::new(AutoLoginStore::default()),
            active_logins: Mutex::new(HashMap::new()),
            file_path: None,
        }
    }

    /// Returns the storage file path.
    fn storage_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|d| d.join("putz").join("autologin.json"))
    }

    /// Saves the store to disk.
    fn save_to_disk(&self, store: &AutoLoginStore) -> Result<(), AutoLoginError> {
        if let Some(path) = &self.file_path {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let json = serde_json::to_string_pretty(store)
                .map_err(|e| AutoLoginError::IoError(format!("Serialize failed: {e}")))?;
            std::fs::write(path, json)?;
        }
        Ok(())
    }

    /// Gets the auto-login profile for a session.
    pub fn get_profile(&self, session_id: &str) -> Result<AutoLoginProfile, AutoLoginError> {
        let store = self
            .store
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        store
            .profiles
            .iter()
            .find(|p| p.session_id == session_id)
            .cloned()
            .ok_or_else(|| AutoLoginError::NotFound(session_id.into()))
    }

    /// Sets (creates or updates) an auto-login profile.
    pub fn set_profile(&self, input: SetAutoLoginInput) -> Result<(), AutoLoginError> {
        if input.session_id.trim().is_empty() {
            return Err(AutoLoginError::InvalidInput("session_id is empty".into()));
        }

        // Validate custom steps if provided
        for (i, step) in input.steps.iter().enumerate() {
            if step.expect.trim().is_empty() {
                return Err(AutoLoginError::InvalidInput(format!(
                    "step {i}: expect pattern is empty"
                )));
            }
            // Validate regex compiles
            Regex::new(&step.expect)
                .map_err(|e| AutoLoginError::PatternError(format!("step {i}: {e}")))?;
        }

        let profile = AutoLoginProfile {
            session_id: input.session_id.trim().to_string(),
            enabled: input.enabled,
            device_type: input.device_type,
            steps: input.steps,
            username: input.username,
            credential_id: input.credential_id,
        };

        let mut store = self
            .store
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        if let Some(existing) = store
            .profiles
            .iter_mut()
            .find(|p| p.session_id == profile.session_id)
        {
            *existing = profile;
        } else {
            store.profiles.push(profile);
        }

        self.save_to_disk(&store)?;
        Ok(())
    }

    /// Deletes an auto-login profile.
    pub fn delete_profile(&self, session_id: &str) -> Result<(), AutoLoginError> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        let before = store.profiles.len();
        store.profiles.retain(|p| p.session_id != session_id);

        if store.profiles.len() == before {
            return Err(AutoLoginError::NotFound(session_id.into()));
        }

        self.save_to_disk(&store)?;
        Ok(())
    }

    /// Starts an auto-login sequence for a connection.
    ///
    /// Resolves the login steps (built-in or custom) and initializes state.
    pub fn start_login(
        &self,
        connection_id: &str,
        session_id: &str,
    ) -> Result<bool, AutoLoginError> {
        let profile = self.get_profile(session_id)?;

        if !profile.enabled {
            return Ok(false);
        }

        let steps = if profile.steps.is_empty() {
            BuiltinPatterns::for_device(&profile.device_type)
        } else {
            profile.steps.clone()
        };

        if steps.is_empty() {
            return Ok(false);
        }

        let state = LoginState {
            steps,
            current_step: 0,
            output_buffer: String::new(),
        };

        let mut active = self
            .active_logins
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        active.insert(connection_id.to_string(), state);
        Ok(true)
    }

    /// Processes terminal output against the active login sequence.
    ///
    /// Returns a `LoginAction` indicating what to do next.
    ///
    /// `username` and `password` are the resolved values for variable substitution.
    pub fn process_output(
        &self,
        connection_id: &str,
        output: &str,
        username: &str,
        password: &str,
    ) -> Result<LoginAction, AutoLoginError> {
        let mut active = self
            .active_logins
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        let state = match active.get_mut(connection_id) {
            Some(s) => s,
            None => return Ok(LoginAction::None),
        };

        // Append output to buffer
        state.output_buffer.push_str(output);

        // Keep buffer manageable (last 4KB)
        if state.output_buffer.len() > 4096 {
            let start = state.output_buffer.len() - 4096;
            state.output_buffer = state.output_buffer[start..].to_string();
        }

        // Check if current step's pattern matches
        let current_step = state.current_step;
        if current_step >= state.steps.len() {
            // All steps complete
            active.remove(connection_id);
            return Ok(LoginAction::Complete);
        }

        let step = &state.steps[current_step];
        let pattern =
            Regex::new(&step.expect).map_err(|e| AutoLoginError::PatternError(e.to_string()))?;

        if pattern.is_match(&state.output_buffer) {
            // Pattern matched — determine what to send
            let send_text = &step.send;

            if send_text.is_empty() {
                // Empty send = login complete (prompt detected)
                active.remove(connection_id);
                return Ok(LoginAction::Complete);
            }

            // Substitute variables
            let resolved = send_text
                .replace("${username}", username)
                .replace("${password}", password);

            // Advance to next step
            state.current_step += 1;
            state.output_buffer.clear();

            // Append \r\n to send (simulates pressing Enter)
            let to_send = format!("{resolved}\r\n");
            return Ok(LoginAction::Send(to_send));
        }

        Ok(LoginAction::None)
    }

    /// Cancels an active login sequence.
    pub fn cancel_login(&self, connection_id: &str) -> Result<(), AutoLoginError> {
        let mut active = self
            .active_logins
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        active.remove(connection_id);
        Ok(())
    }

    /// Checks if a connection has an active login sequence.
    #[allow(dead_code)]
    pub fn is_login_active(&self, connection_id: &str) -> Result<bool, AutoLoginError> {
        let active = self
            .active_logins
            .lock()
            .map_err(|_| AutoLoginError::LockError("mutex poisoned".into()))?;

        Ok(active.contains_key(connection_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manager() -> AutoLoginManager {
        AutoLoginManager::new_in_memory()
    }

    fn make_cisco_profile(session_id: &str) -> SetAutoLoginInput {
        SetAutoLoginInput {
            session_id: session_id.into(),
            enabled: true,
            device_type: DeviceType::CiscoIos,
            steps: vec![], // Use built-in patterns
            username: Some("admin".into()),
            credential_id: Some("cred-1".into()),
        }
    }

    // ─── Profile CRUD ────────────────────────────────────────────────

    #[test]
    fn set_profile_creates_new() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        let profile = mgr.get_profile("s1").unwrap();
        assert_eq!(profile.session_id, "s1");
        assert!(profile.enabled);
        assert_eq!(profile.device_type, DeviceType::CiscoIos);
    }

    #[test]
    fn set_profile_updates_existing() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();

        let mut input = make_cisco_profile("s1");
        input.enabled = false;
        mgr.set_profile(input).unwrap();

        let profile = mgr.get_profile("s1").unwrap();
        assert!(!profile.enabled);
    }

    #[test]
    fn get_profile_not_found() {
        let mgr = make_manager();
        let result = mgr.get_profile("nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn delete_profile_removes() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.delete_profile("s1").unwrap();
        assert!(mgr.get_profile("s1").is_err());
    }

    #[test]
    fn delete_nonexistent_returns_error() {
        let mgr = make_manager();
        let result = mgr.delete_profile("nope");
        assert!(result.is_err());
    }

    #[test]
    fn set_profile_validates_empty_session_id() {
        let mgr = make_manager();
        let mut input = make_cisco_profile("");
        input.session_id = "".into();
        let result = mgr.set_profile(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("session_id"));
    }

    #[test]
    fn set_profile_validates_custom_step_patterns() {
        let mgr = make_manager();
        let input = SetAutoLoginInput {
            session_id: "s1".into(),
            enabled: true,
            device_type: DeviceType::Custom,
            steps: vec![LoginStep {
                expect: "[invalid".into(), // Bad regex
                send: "test".into(),
                timeout_ms: 5000,
            }],
            username: None,
            credential_id: None,
        };
        let result = mgr.set_profile(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Pattern"));
    }

    #[test]
    fn set_profile_validates_empty_expect() {
        let mgr = make_manager();
        let input = SetAutoLoginInput {
            session_id: "s1".into(),
            enabled: true,
            device_type: DeviceType::Custom,
            steps: vec![LoginStep {
                expect: "".into(),
                send: "test".into(),
                timeout_ms: 5000,
            }],
            username: None,
            credential_id: None,
        };
        let result = mgr.set_profile(input);
        assert!(result.is_err());
    }

    // ─── Login flow ──────────────────────────────────────────────────

    #[test]
    fn start_login_activates_sequence() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        let started = mgr.start_login("conn-1", "s1").unwrap();
        assert!(started);
        assert!(mgr.is_login_active("conn-1").unwrap());
    }

    #[test]
    fn start_login_disabled_profile_returns_false() {
        let mgr = make_manager();
        let mut input = make_cisco_profile("s1");
        input.enabled = false;
        mgr.set_profile(input).unwrap();
        let started = mgr.start_login("conn-1", "s1").unwrap();
        assert!(!started);
    }

    #[test]
    fn process_output_matches_username_prompt() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        let action = mgr
            .process_output("conn-1", "Username: ", "admin", "secret")
            .unwrap();
        match action {
            LoginAction::Send(text) => assert!(text.contains("admin")),
            _ => panic!("Expected LoginAction::Send, got {:?}", action),
        }
    }

    #[test]
    fn process_output_matches_password_prompt() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        // First: username prompt
        mgr.process_output("conn-1", "Username: ", "admin", "secret")
            .unwrap();

        // Second: password prompt
        let action = mgr
            .process_output("conn-1", "Password: ", "admin", "secret")
            .unwrap();
        match action {
            LoginAction::Send(text) => assert!(text.contains("secret")),
            _ => panic!("Expected LoginAction::Send, got {:?}", action),
        }
    }

    #[test]
    fn process_output_completes_on_prompt() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        // Username → Password → Prompt
        mgr.process_output("conn-1", "Username: ", "admin", "secret")
            .unwrap();
        mgr.process_output("conn-1", "Password: ", "admin", "secret")
            .unwrap();
        let action = mgr
            .process_output("conn-1", "Router#", "admin", "secret")
            .unwrap();

        assert!(matches!(action, LoginAction::Complete));
        assert!(!mgr.is_login_active("conn-1").unwrap());
    }

    #[test]
    fn process_output_no_active_login_returns_none() {
        let mgr = make_manager();
        let action = mgr
            .process_output("conn-99", "some output", "user", "pass")
            .unwrap();
        assert!(matches!(action, LoginAction::None));
    }

    #[test]
    fn process_output_no_match_returns_none() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        let action = mgr
            .process_output("conn-1", "Loading firmware...", "admin", "secret")
            .unwrap();
        assert!(matches!(action, LoginAction::None));
    }

    #[test]
    fn cancel_login_removes_state() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();
        mgr.cancel_login("conn-1").unwrap();
        assert!(!mgr.is_login_active("conn-1").unwrap());
    }

    #[test]
    fn output_buffer_is_trimmed() {
        let mgr = make_manager();
        mgr.set_profile(make_cisco_profile("s1")).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        // Send large output to trigger buffer trim
        let large_output = "x".repeat(5000);
        let action = mgr
            .process_output("conn-1", &large_output, "admin", "secret")
            .unwrap();
        assert!(matches!(action, LoginAction::None));
    }

    // ─── Custom steps ────────────────────────────────────────────────

    #[test]
    fn custom_steps_work() {
        let mgr = make_manager();
        let input = SetAutoLoginInput {
            session_id: "s1".into(),
            enabled: true,
            device_type: DeviceType::Custom,
            steps: vec![
                LoginStep {
                    expect: r"Enter code:".into(),
                    send: "12345".into(),
                    timeout_ms: 5000,
                },
                LoginStep {
                    expect: r">\s*$".into(),
                    send: String::new(),
                    timeout_ms: 5000,
                },
            ],
            username: None,
            credential_id: None,
        };
        mgr.set_profile(input).unwrap();
        mgr.start_login("conn-1", "s1").unwrap();

        let action = mgr
            .process_output("conn-1", "Enter code: ", "", "")
            .unwrap();
        match action {
            LoginAction::Send(text) => assert!(text.contains("12345")),
            _ => panic!("Expected Send"),
        }

        let action = mgr.process_output("conn-1", "device> ", "", "").unwrap();
        assert!(matches!(action, LoginAction::Complete));
    }
}
