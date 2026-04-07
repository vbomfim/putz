/// Session manager — handles CRUD, persistence, search, import/export.
///
/// Persistence:
/// - Stores sessions in `~/.config/putz/sessions.json` (platform-appropriate)
/// - Atomic writes: write to temp file, then rename
/// - Auto-backup: rotates 5 backups before each write
/// - File permissions: 0600 on Unix
///
/// Thread safety: Inner state is behind `Mutex<SessionStore>`.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use directories::ProjectDirs;

use super::error::SessionError;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Sessions file name.
const SESSIONS_FILE: &str = "sessions.json";

/// Maximum number of session profiles allowed.
const MAX_SESSIONS: usize = 10_000;

/// Maximum number of folders allowed.
const MAX_FOLDERS: usize = 1_000;

/// Maximum import payload size in bytes (10 MB).
const MAX_IMPORT_SIZE: usize = 10 * 1024 * 1024;

/// Session manager holding the in-memory store and config directory path.
pub struct SessionManager {
    store: Mutex<SessionStore>,
    config_dir: PathBuf,
}

impl SessionManager {
    /// Creates a new SessionManager, loading from disk if available.
    ///
    /// If the sessions file is corrupted, attempts to load from backups.
    /// If all backups fail, starts with an empty store.
    pub fn new() -> Self {
        let config_dir = Self::resolve_config_dir();
        let store = Self::load_from_disk(&config_dir);
        Self {
            store: Mutex::new(store),
            config_dir,
        }
    }

    /// Creates a SessionManager with a custom config directory (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let store = Self::load_from_disk(&config_dir);
        Self {
            store: Mutex::new(store),
            config_dir,
        }
    }

    /// Resolves the platform-appropriate config directory.
    fn resolve_config_dir() -> PathBuf {
        if let Some(proj_dirs) = ProjectDirs::from("com", "putz", "putz") {
            proj_dirs.config_dir().to_path_buf()
        } else {
            // Fallback to current directory (should rarely happen)
            PathBuf::from(".")
        }
    }

    /// Acquires the internal mutex, returning a graceful error on poisoning.
    fn lock_store(&self) -> Result<MutexGuard<'_, SessionStore>, SessionError> {
        self.store.lock().map_err(|e| {
            SessionError::LockError(format!("Session store mutex poisoned: {e}"))
        })
    }

    /// Loads the session store from disk, with backup fallback.
    fn load_from_disk(config_dir: &Path) -> SessionStore {
        let path = config_dir.join(SESSIONS_FILE);

        // Try main file first
        if let Ok(store) = Self::read_store(&path) {
            return store;
        }

        // Try backups (1 through MAX_BACKUPS)
        for i in 1..=MAX_BACKUPS {
            let backup_path = config_dir.join(format!("sessions.backup.{i}.json"));
            if let Ok(store) = Self::read_store(&backup_path) {
                eprintln!(
                    "Warning: Loaded sessions from backup {i}. \
                     Main file was corrupted or missing."
                );
                return store;
            }
        }

        // All failed — start fresh
        SessionStore::default()
    }

    /// Reads and parses a SessionStore from a JSON file.
    fn read_store(path: &Path) -> Result<SessionStore, SessionError> {
        let content = fs::read_to_string(path)?;
        let store: SessionStore = serde_json::from_str(&content)?;
        Ok(store)
    }

    /// Saves the current store to disk with backup rotation and atomic write.
    fn save_to_disk(&self, store: &SessionStore) -> Result<(), SessionError> {
        // Ensure config directory exists
        fs::create_dir_all(&self.config_dir)?;

        let path = self.config_dir.join(SESSIONS_FILE);

        // Rotate backups before writing
        self.rotate_backups()?;

        // Serialize
        let json = serde_json::to_string_pretty(store)?;

        // Atomic write: write to temp file, then rename
        let temp_path = self.config_dir.join("sessions.tmp.json");
        fs::write(&temp_path, &json)?;

        // Set permissions before rename (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&temp_path, perms)?;
        }

        fs::rename(&temp_path, &path)?;

        Ok(())
    }

    /// Rotates backup files (sessions.backup.5 → deleted, 4→5, 3→4, 2→3, 1→2, current→1).
    fn rotate_backups(&self) -> Result<(), SessionError> {
        let path = self.config_dir.join(SESSIONS_FILE);

        // Remove oldest backup
        let oldest = self
            .config_dir
            .join(format!("sessions.backup.{MAX_BACKUPS}.json"));
        let _ = fs::remove_file(&oldest); // OK if doesn't exist

        // Shift backups: N-1 → N
        for i in (1..MAX_BACKUPS).rev() {
            let from = self
                .config_dir
                .join(format!("sessions.backup.{i}.json"));
            let to = self
                .config_dir
                .join(format!("sessions.backup.{}.json", i + 1));
            let _ = fs::rename(&from, &to); // OK if doesn't exist
        }

        // Copy current → backup.1
        if path.exists() {
            let backup_1 = self.config_dir.join("sessions.backup.1.json");
            let _ = fs::copy(&path, &backup_1);

            // Set permissions on backup file (Unix only)
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perms = fs::Permissions::from_mode(0o600);
                let _ = fs::set_permissions(&backup_1, perms);
            }
        }

        Ok(())
    }

    /// Returns the current ISO 8601 / RFC 3339 timestamp.
    fn now_iso8601() -> String {
        use time::format_description::well_known::Rfc3339;
        time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    }

    // ─── CRUD: Sessions ────────────────────────────────────────

    /// Validates protocol-specific required fields.
    ///
    /// - SSH and Telnet require a host.
    /// - Serial requires a serial_port.
    fn validate_protocol_fields(
        protocol: &Protocol,
        host: &Option<String>,
        serial_port: &Option<String>,
    ) -> Result<(), SessionError> {
        match protocol {
            Protocol::Ssh | Protocol::Telnet => {
                if host.as_ref().is_none_or(|h| h.trim().is_empty()) {
                    return Err(SessionError::InvalidInput(format!(
                        "{} sessions require a host",
                        if matches!(protocol, Protocol::Ssh) {
                            "SSH"
                        } else {
                            "Telnet"
                        }
                    )));
                }
            }
            Protocol::Serial => {
                if serial_port
                    .as_ref()
                    .is_none_or(|p| p.trim().is_empty())
                {
                    return Err(SessionError::InvalidInput(
                        "Serial sessions require a serial port".into(),
                    ));
                }
            }
            Protocol::Local => {} // No required fields
        }
        Ok(())
    }

    /// Creates a new session profile.
    pub fn create_session(
        &self,
        input: CreateSessionInput,
    ) -> Result<String, SessionError> {
        validation::validate_name(&input.name)?;
        if let Some(ref host) = input.host {
            validation::validate_host(host)?;
        }
        if let Some(port) = input.port {
            validation::validate_port(port)?;
        }
        if let Some(ref username) = input.username {
            validation::validate_username(username)?;
        }
        if let Some(ref serial_port) = input.serial_port {
            validation::validate_serial_port(serial_port)?;
        }
        Self::validate_protocol_fields(
            &input.protocol,
            &input.host,
            &input.serial_port,
        )?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now_iso8601();

        let profile = SessionProfile {
            id: id.clone(),
            name: input.name,
            folder_id: input.folder_id,
            protocol: input.protocol,
            host: input.host,
            port: input.port,
            username: input.username,
            credential_id: input.credential_id,
            serial_port: input.serial_port,
            serial_baud: input.serial_baud,
            serial_data_bits: input.serial_data_bits,
            serial_parity: input.serial_parity,
            serial_stop_bits: input.serial_stop_bits,
            serial_flow_control: input.serial_flow_control,
            color_scheme: input.color_scheme,
            auto_log: input.auto_log,
            jump_host_id: input.jump_host_id,
            auto_login: input.auto_login,
            auto_login_device_type: input.auto_login_device_type,
            created_at: now.clone(),
            updated_at: now,
        };

        let mut store = self.lock_store()?;

        // Enforce resource limit
        if store.sessions.len() >= MAX_SESSIONS {
            return Err(SessionError::LimitExceeded(format!(
                "Maximum number of sessions ({MAX_SESSIONS}) reached"
            )));
        }

        // Verify folder exists (unless root)
        if profile.folder_id != "root"
            && !store.folders.iter().any(|f| f.id == profile.folder_id)
        {
            return Err(SessionError::FolderNotFound(profile.folder_id.clone()));
        }

        store.sessions.push(profile);
        self.save_to_disk(&store)?;

        Ok(id)
    }

    /// Gets a session profile by ID.
    pub fn get_session(&self, id: &str) -> Result<SessionProfile, SessionError> {
        validation::validate_uuid(id)?;
        let store = self.lock_store()?;
        store
            .sessions
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| SessionError::NotFound(id.into()))
    }

    /// Updates an existing session profile with partial fields.
    pub fn update_session(
        &self,
        id: &str,
        input: UpdateSessionInput,
    ) -> Result<(), SessionError> {
        validation::validate_uuid(id)?;

        if let Some(ref name) = input.name {
            validation::validate_name(name)?;
        }
        if let Some(ref host) = input.host {
            validation::validate_host(host)?;
        }
        if let Some(port) = input.port {
            validation::validate_port(port)?;
        }
        if let Some(ref username) = input.username {
            validation::validate_username(username)?;
        }
        if let Some(ref serial_port) = input.serial_port {
            validation::validate_serial_port(serial_port)?;
        }

        let mut store = self.lock_store()?;

        // Verify target folder exists
        if let Some(ref folder_id) = input.folder_id {
            if folder_id != "root"
                && !store.folders.iter().any(|f| f.id == *folder_id)
            {
                return Err(SessionError::FolderNotFound(folder_id.clone()));
            }
        }

        let session = store
            .sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| SessionError::NotFound(id.into()))?;

        // Apply partial updates
        if let Some(name) = input.name {
            session.name = name;
        }
        if let Some(folder_id) = input.folder_id {
            session.folder_id = folder_id;
        }
        if let Some(protocol) = input.protocol {
            session.protocol = protocol;
        }
        if let Some(host) = input.host {
            session.host = Some(host);
        }
        if let Some(port) = input.port {
            session.port = Some(port);
        }
        if let Some(username) = input.username {
            session.username = Some(username);
        }
        if let Some(credential_id) = input.credential_id {
            session.credential_id = Some(credential_id);
        }
        if let Some(serial_port) = input.serial_port {
            session.serial_port = Some(serial_port);
        }
        if let Some(serial_baud) = input.serial_baud {
            session.serial_baud = Some(serial_baud);
        }
        if let Some(serial_data_bits) = input.serial_data_bits {
            session.serial_data_bits = Some(serial_data_bits);
        }
        if let Some(serial_parity) = input.serial_parity {
            session.serial_parity = Some(serial_parity);
        }
        if let Some(serial_stop_bits) = input.serial_stop_bits {
            session.serial_stop_bits = Some(serial_stop_bits);
        }
        if let Some(serial_flow_control) = input.serial_flow_control {
            session.serial_flow_control = Some(serial_flow_control);
        }
        if let Some(color_scheme) = input.color_scheme {
            session.color_scheme = Some(color_scheme);
        }
        if let Some(auto_log) = input.auto_log {
            session.auto_log = Some(auto_log);
        }
        if let Some(jump_host_id) = input.jump_host_id {
            session.jump_host_id = Some(jump_host_id);
        }
        if let Some(auto_login) = input.auto_login {
            session.auto_login = Some(auto_login);
        }
        if let Some(auto_login_device_type) = input.auto_login_device_type {
            session.auto_login_device_type = Some(auto_login_device_type);
        }

        // Validate protocol-specific fields after merge
        Self::validate_protocol_fields(
            &session.protocol,
            &session.host,
            &session.serial_port,
        )?;

        session.updated_at = Self::now_iso8601();

        self.save_to_disk(&store)?;
        Ok(())
    }

    /// Deletes a session profile by ID.
    pub fn delete_session(&self, id: &str) -> Result<(), SessionError> {
        validation::validate_uuid(id)?;
        let mut store = self.lock_store()?;
        let initial_len = store.sessions.len();
        store.sessions.retain(|s| s.id != id);
        if store.sessions.len() == initial_len {
            return Err(SessionError::NotFound(id.into()));
        }
        self.save_to_disk(&store)?;
        Ok(())
    }

    /// Duplicates a session with a new ID and "(copy)" suffix.
    pub fn duplicate_session(&self, id: &str) -> Result<String, SessionError> {
        validation::validate_uuid(id)?;
        let store = self.lock_store()?;
        let original = store
            .sessions
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| SessionError::NotFound(id.into()))?
            .clone();
        drop(store);

        let input = CreateSessionInput {
            name: format!("{} (copy)", original.name),
            folder_id: original.folder_id,
            protocol: original.protocol,
            host: original.host,
            port: original.port,
            username: original.username,
            credential_id: original.credential_id,
            serial_port: original.serial_port,
            serial_baud: original.serial_baud,
            serial_data_bits: original.serial_data_bits,
            serial_parity: original.serial_parity,
            serial_stop_bits: original.serial_stop_bits,
            serial_flow_control: original.serial_flow_control,
            color_scheme: original.color_scheme,
            auto_log: original.auto_log,
            jump_host_id: original.jump_host_id,
            auto_login: original.auto_login,
            auto_login_device_type: original.auto_login_device_type,
        };

        self.create_session(input)
    }

    /// Moves a session to a different folder.
    pub fn move_session(&self, input: MoveSessionInput) -> Result<(), SessionError> {
        validation::validate_uuid(&input.id)?;

        let mut store = self.lock_store()?;

        // Verify target folder exists
        if input.target_folder_id != "root"
            && !store.folders.iter().any(|f| f.id == input.target_folder_id)
        {
            return Err(SessionError::FolderNotFound(
                input.target_folder_id.clone(),
            ));
        }

        let session = store
            .sessions
            .iter_mut()
            .find(|s| s.id == input.id)
            .ok_or_else(|| SessionError::NotFound(input.id.clone()))?;

        session.folder_id = input.target_folder_id;
        session.updated_at = Self::now_iso8601();

        self.save_to_disk(&store)?;
        Ok(())
    }

    // ─── CRUD: Folders ─────────────────────────────────────────

    /// Creates a new folder.
    pub fn create_folder(
        &self,
        name: &str,
        parent_id: &str,
    ) -> Result<String, SessionError> {
        validation::validate_folder_name(name)?;

        let id = uuid::Uuid::new_v4().to_string();
        let mut store = self.lock_store()?;

        // Enforce resource limit
        if store.folders.len() >= MAX_FOLDERS {
            return Err(SessionError::LimitExceeded(format!(
                "Maximum number of folders ({MAX_FOLDERS}) reached"
            )));
        }

        // Verify parent exists (unless root)
        if parent_id != "root"
            && !store.folders.iter().any(|f| f.id == parent_id)
        {
            return Err(SessionError::FolderNotFound(parent_id.into()));
        }

        // Determine sort order (append to end)
        let max_order = store
            .folders
            .iter()
            .filter(|f| f.parent_id == parent_id)
            .map(|f| f.sort_order)
            .max()
            .unwrap_or(-1);

        let folder = SessionFolder {
            id: id.clone(),
            name: name.trim().to_string(),
            parent_id: parent_id.to_string(),
            sort_order: max_order + 1,
            expanded: false,
        };

        store.folders.push(folder);
        self.save_to_disk(&store)?;

        Ok(id)
    }

    /// Deletes a folder by ID. Fails if folder contains sessions or sub-folders.
    pub fn delete_folder(&self, id: &str) -> Result<(), SessionError> {
        validation::validate_uuid(id)?;
        let mut store = self.lock_store()?;

        // Check for child sessions
        if store.sessions.iter().any(|s| s.folder_id == id) {
            return Err(SessionError::FolderNotEmpty(id.into()));
        }

        // Check for sub-folders
        if store.folders.iter().any(|f| f.parent_id == id) {
            return Err(SessionError::FolderNotEmpty(id.into()));
        }

        let initial_len = store.folders.len();
        store.folders.retain(|f| f.id != id);
        if store.folders.len() == initial_len {
            return Err(SessionError::FolderNotFound(id.into()));
        }

        self.save_to_disk(&store)?;
        Ok(())
    }

    // ─── Tree building ─────────────────────────────────────────

    /// Builds a tree of SessionNodes for the frontend.
    pub fn list_tree(&self) -> Vec<SessionNode> {
        let store = match self.lock_store() {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        Self::build_children("root", &store)
    }

    /// Recursively builds children for a given parent_id.
    fn build_children(parent_id: &str, store: &SessionStore) -> Vec<SessionNode> {
        let mut children: Vec<SessionNode> = Vec::new();

        // Add folders (sorted by sort_order)
        let mut folders: Vec<&SessionFolder> = store
            .folders
            .iter()
            .filter(|f| f.parent_id == parent_id)
            .collect();
        folders.sort_by_key(|f| f.sort_order);

        for folder in folders {
            let folder_children = Self::build_children(&folder.id, store);
            children.push(SessionNode::Folder {
                id: folder.id.clone(),
                name: folder.name.clone(),
                parent_id: folder.parent_id.clone(),
                sort_order: folder.sort_order,
                expanded: folder.expanded,
                children: folder_children,
            });
        }

        // Add sessions (sorted by name)
        let mut sessions: Vec<&SessionProfile> = store
            .sessions
            .iter()
            .filter(|s| s.folder_id == parent_id)
            .collect();
        sessions.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        for session in sessions {
            children.push(SessionNode::Session {
                id: session.id.clone(),
                name: session.name.clone(),
                protocol: session.protocol.clone(),
                host: session.host.clone(),
                port: session.port,
                username: session.username.clone(),
            });
        }

        children
    }

    // ─── Search ────────────────────────────────────────────────

    /// Searches sessions by matching query against name, host, and username.
    ///
    /// Case-insensitive substring match. Returns all matching profiles.
    pub fn search(&self, query: &str) -> Vec<SessionProfile> {
        let query_lower = query.to_lowercase();
        if query_lower.is_empty() {
            return Vec::new();
        }

        let store = match self.lock_store() {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        store
            .sessions
            .iter()
            .filter(|s| {
                s.name.to_lowercase().contains(&query_lower)
                    || s.host
                        .as_deref()
                        .map(|h| h.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
                    || s.username
                        .as_deref()
                        .map(|u| u.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
            })
            .cloned()
            .collect()
    }

    // ─── Import / Export ───────────────────────────────────────

    /// Exports the entire session store as a JSON string.
    pub fn export(&self) -> Result<String, SessionError> {
        let store = self.lock_store()?;
        let json = serde_json::to_string_pretty(&*store)?;
        Ok(json)
    }

    /// Imports sessions and folders from a JSON string.
    ///
    /// Merges imported data into the existing store. Imported sessions
    /// get new UUIDs to avoid conflicts. Name collisions get "(imported)" suffix.
    /// Validates each imported item and enforces size/resource limits.
    pub fn import(&self, data: &str) -> Result<usize, SessionError> {
        // Enforce import size limit
        if data.len() > MAX_IMPORT_SIZE {
            return Err(SessionError::LimitExceeded(format!(
                "Import data exceeds maximum size of {} bytes",
                MAX_IMPORT_SIZE
            )));
        }

        let imported_store: SessionStore = serde_json::from_str(data)?;
        let mut store = self.lock_store()?;

        // Check resource limits before importing
        let total_sessions =
            store.sessions.len() + imported_store.sessions.len();
        if total_sessions > MAX_SESSIONS {
            return Err(SessionError::LimitExceeded(format!(
                "Import would exceed maximum sessions ({MAX_SESSIONS})"
            )));
        }
        let total_folders =
            store.folders.len() + imported_store.folders.len();
        if total_folders > MAX_FOLDERS {
            return Err(SessionError::LimitExceeded(format!(
                "Import would exceed maximum folders ({MAX_FOLDERS})"
            )));
        }

        let mut count = 0;

        // Import folders — remap IDs to avoid conflicts
        let mut folder_id_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        folder_id_map.insert("root".into(), "root".into());

        for folder in &imported_store.folders {
            // Validate each imported folder name
            if let Err(e) = validation::validate_folder_name(&folder.name) {
                eprintln!(
                    "Warning: Skipping imported folder '{}': {e}",
                    folder.name
                );
                continue;
            }

            let new_id = uuid::Uuid::new_v4().to_string();
            folder_id_map.insert(folder.id.clone(), new_id.clone());

            let parent_id = folder_id_map
                .get(&folder.parent_id)
                .cloned()
                .unwrap_or_else(|| "root".to_string());

            store.folders.push(SessionFolder {
                id: new_id,
                name: folder.name.clone(),
                parent_id,
                sort_order: folder.sort_order,
                expanded: folder.expanded,
            });
        }

        // Import sessions with new IDs
        let now = Self::now_iso8601();
        for session in &imported_store.sessions {
            // Validate imported session fields
            if let Err(e) = validation::validate_name(&session.name) {
                eprintln!(
                    "Warning: Skipping imported session '{}': {e}",
                    session.name
                );
                continue;
            }
            if let Some(ref host) = session.host {
                if let Err(e) = validation::validate_host(host) {
                    eprintln!(
                        "Warning: Skipping imported session '{}': {e}",
                        session.name
                    );
                    continue;
                }
            }
            if let Some(port) = session.port {
                if let Err(e) = validation::validate_port(port) {
                    eprintln!(
                        "Warning: Skipping imported session '{}': {e}",
                        session.name
                    );
                    continue;
                }
            }
            if let Some(ref username) = session.username {
                if let Err(e) = validation::validate_username(username) {
                    eprintln!(
                        "Warning: Skipping imported session '{}': {e}",
                        session.name
                    );
                    continue;
                }
            }
            if let Some(ref serial_port) = session.serial_port {
                if let Err(e) = validation::validate_serial_port(serial_port)
                {
                    eprintln!(
                        "Warning: Skipping imported session '{}': {e}",
                        session.name
                    );
                    continue;
                }
            }

            let new_id = uuid::Uuid::new_v4().to_string();

            let folder_id = folder_id_map
                .get(&session.folder_id)
                .cloned()
                .unwrap_or_else(|| "root".to_string());

            // Check name collision in target folder
            let name = if store
                .sessions
                .iter()
                .any(|s| s.folder_id == folder_id && s.name == session.name)
            {
                format!("{} (imported)", session.name)
            } else {
                session.name.clone()
            };

            store.sessions.push(SessionProfile {
                id: new_id,
                name,
                folder_id,
                protocol: session.protocol.clone(),
                host: session.host.clone(),
                port: session.port,
                username: session.username.clone(),
                credential_id: session.credential_id.clone(),
                serial_port: session.serial_port.clone(),
                serial_baud: session.serial_baud,
                serial_data_bits: session.serial_data_bits.clone(),
                serial_parity: session.serial_parity.clone(),
                serial_stop_bits: session.serial_stop_bits.clone(),
                serial_flow_control: session.serial_flow_control.clone(),
                color_scheme: session.color_scheme.clone(),
                auto_log: session.auto_log,
                jump_host_id: session.jump_host_id.clone(),
                auto_login: session.auto_login,
                auto_login_device_type: session.auto_login_device_type.clone(),
                created_at: session.created_at.clone(),
                updated_at: now.clone(),
            });
            count += 1;
        }

        self.save_to_disk(&store)?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Creates a temporary directory for test isolation.
    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "putz-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Cleans up a temporary directory.
    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn make_ssh_input(name: &str) -> CreateSessionInput {
        CreateSessionInput {
            name: name.into(),
            folder_id: "root".into(),
            protocol: Protocol::Ssh,
            host: Some("example.com".into()),
            port: Some(22),
            username: Some("admin".into()),
            credential_id: None,
            serial_port: None,
            serial_baud: None,
            serial_data_bits: None,
            serial_parity: None,
            serial_stop_bits: None,
            serial_flow_control: None,
            color_scheme: None,
            auto_log: None,
            jump_host_id: None,
            auto_login: None,
            auto_login_device_type: None,
        }
    }

    // ─── Create / Read ─────────────────────────────────────────

    #[test]
    fn create_and_get_session() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let id = mgr.create_session(make_ssh_input("My Server")).unwrap();
        let session = mgr.get_session(&id).unwrap();

        assert_eq!(session.name, "My Server");
        assert_eq!(session.protocol, Protocol::Ssh);
        assert_eq!(session.host, Some("example.com".into()));
        assert_eq!(session.port, Some(22));
        assert!(!session.created_at.is_empty());

        cleanup(&dir);
    }

    #[test]
    fn create_session_validates_name() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("");
        input.name = "".into();
        assert!(mgr.create_session(input).is_err());

        cleanup(&dir);
    }

    #[test]
    fn create_session_validates_host() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Server");
        input.host = Some("invalid host!".into());
        assert!(mgr.create_session(input).is_err());

        cleanup(&dir);
    }

    #[test]
    fn create_session_validates_port() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Server");
        input.port = Some(0);
        assert!(mgr.create_session(input).is_err());

        cleanup(&dir);
    }

    #[test]
    fn get_session_not_found() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let result = mgr.get_session("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result, Err(SessionError::NotFound(_))));

        cleanup(&dir);
    }

    #[test]
    fn get_session_invalid_uuid() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let result = mgr.get_session("not-a-uuid");
        assert!(matches!(result, Err(SessionError::InvalidInput(_))));

        cleanup(&dir);
    }

    // ─── Update ────────────────────────────────────────────────

    #[test]
    fn update_session_partial() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let id = mgr.create_session(make_ssh_input("Original")).unwrap();

        mgr.update_session(
            &id,
            UpdateSessionInput {
                name: Some("Updated".into()),
                host: Some("new-host.com".into()),
                folder_id: None,
                protocol: None,
                port: None,
                username: None,
                credential_id: None,
                serial_port: None,
                serial_baud: None,
                serial_data_bits: None,
                serial_parity: None,
                serial_stop_bits: None,
                serial_flow_control: None,
                color_scheme: None,
                auto_log: None,
                jump_host_id: None,
                auto_login: None,
                auto_login_device_type: None,
            },
        )
        .unwrap();

        let session = mgr.get_session(&id).unwrap();
        assert_eq!(session.name, "Updated");
        assert_eq!(session.host, Some("new-host.com".into()));
        // Port should remain unchanged
        assert_eq!(session.port, Some(22));

        cleanup(&dir);
    }

    #[test]
    fn update_session_not_found() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let result = mgr.update_session(
            "550e8400-e29b-41d4-a716-446655440000",
            UpdateSessionInput {
                name: Some("Test".into()),
                folder_id: None,
                protocol: None,
                host: None,
                port: None,
                username: None,
                credential_id: None,
                serial_port: None,
                serial_baud: None,
                serial_data_bits: None,
                serial_parity: None,
                serial_stop_bits: None,
                serial_flow_control: None,
                color_scheme: None,
                auto_log: None,
                jump_host_id: None,
                auto_login: None,
                auto_login_device_type: None,
            },
        );
        assert!(matches!(result, Err(SessionError::NotFound(_))));

        cleanup(&dir);
    }

    // ─── Delete ────────────────────────────────────────────────

    #[test]
    fn delete_session() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let id = mgr.create_session(make_ssh_input("To Delete")).unwrap();
        mgr.delete_session(&id).unwrap();

        let result = mgr.get_session(&id);
        assert!(matches!(result, Err(SessionError::NotFound(_))));

        cleanup(&dir);
    }

    #[test]
    fn delete_session_not_found() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let result =
            mgr.delete_session("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result, Err(SessionError::NotFound(_))));

        cleanup(&dir);
    }

    // ─── Duplicate ─────────────────────────────────────────────

    #[test]
    fn duplicate_session() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let id = mgr.create_session(make_ssh_input("Original")).unwrap();
        let dup_id = mgr.duplicate_session(&id).unwrap();

        assert_ne!(id, dup_id);
        let dup = mgr.get_session(&dup_id).unwrap();
        assert_eq!(dup.name, "Original (copy)");
        assert_eq!(dup.host, Some("example.com".into()));

        cleanup(&dir);
    }

    // ─── Move ──────────────────────────────────────────────────

    #[test]
    fn move_session_to_folder() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let folder_id = mgr.create_folder("Production", "root").unwrap();
        let session_id = mgr.create_session(make_ssh_input("Server")).unwrap();

        mgr.move_session(MoveSessionInput {
            id: session_id.clone(),
            target_folder_id: folder_id.clone(),
            sort_order: None,
        })
        .unwrap();

        let session = mgr.get_session(&session_id).unwrap();
        assert_eq!(session.folder_id, folder_id);

        cleanup(&dir);
    }

    #[test]
    fn move_session_to_nonexistent_folder() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let session_id = mgr.create_session(make_ssh_input("Server")).unwrap();
        let result = mgr.move_session(MoveSessionInput {
            id: session_id,
            target_folder_id: "550e8400-e29b-41d4-a716-446655440000".into(),
            sort_order: None,
        });
        assert!(matches!(result, Err(SessionError::FolderNotFound(_))));

        cleanup(&dir);
    }

    // ─── Folders ───────────────────────────────────────────────

    #[test]
    fn create_and_delete_folder() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let id = mgr.create_folder("Dev", "root").unwrap();
        mgr.delete_folder(&id).unwrap();

        // Verify folder is gone
        let tree = mgr.list_tree();
        assert!(tree.is_empty());

        cleanup(&dir);
    }

    #[test]
    fn delete_nonempty_folder_fails() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let folder_id = mgr.create_folder("Dev", "root").unwrap();
        let mut input = make_ssh_input("Server");
        input.folder_id = folder_id.clone();
        mgr.create_session(input).unwrap();

        let result = mgr.delete_folder(&folder_id);
        assert!(matches!(result, Err(SessionError::FolderNotEmpty(_))));

        cleanup(&dir);
    }

    #[test]
    fn create_nested_folder() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let parent_id = mgr.create_folder("Production", "root").unwrap();
        let child_id = mgr.create_folder("US-East", &parent_id).unwrap();

        let tree = mgr.list_tree();
        assert_eq!(tree.len(), 1);

        if let SessionNode::Folder { children, .. } = &tree[0] {
            assert_eq!(children.len(), 1);
            if let SessionNode::Folder { id, name, .. } = &children[0] {
                assert_eq!(*id, child_id);
                assert_eq!(name, "US-East");
            } else {
                panic!("Expected folder child");
            }
        } else {
            panic!("Expected folder");
        }

        cleanup(&dir);
    }

    // ─── Tree ──────────────────────────────────────────────────

    #[test]
    fn list_tree_empty() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let tree = mgr.list_tree();
        assert!(tree.is_empty());

        cleanup(&dir);
    }

    #[test]
    fn list_tree_with_sessions_and_folders() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let folder_id = mgr.create_folder("Servers", "root").unwrap();
        let mut input = make_ssh_input("Server A");
        input.folder_id = folder_id.clone();
        mgr.create_session(input).unwrap();

        mgr.create_session(make_ssh_input("Local Shell")).unwrap();

        let tree = mgr.list_tree();
        // Should have: 1 folder + 1 root-level session
        assert_eq!(tree.len(), 2);

        cleanup(&dir);
    }

    // ─── Search ────────────────────────────────────────────────

    #[test]
    fn search_by_name() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("Production DB")).unwrap();
        mgr.create_session(make_ssh_input("Staging DB")).unwrap();
        mgr.create_session(make_ssh_input("Dev Web")).unwrap();

        let results = mgr.search("DB");
        assert_eq!(results.len(), 2);

        cleanup(&dir);
    }

    #[test]
    fn search_by_host() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("Server 1")).unwrap();

        let results = mgr.search("example.com");
        assert_eq!(results.len(), 1);

        cleanup(&dir);
    }

    #[test]
    fn search_case_insensitive() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("MyServer")).unwrap();

        let results = mgr.search("myserver");
        assert_eq!(results.len(), 1);

        cleanup(&dir);
    }

    #[test]
    fn search_empty_query_returns_nothing() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("Server")).unwrap();

        let results = mgr.search("");
        assert!(results.is_empty());

        cleanup(&dir);
    }

    // ─── Import / Export ───────────────────────────────────────

    #[test]
    fn export_and_import() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("Server 1")).unwrap();
        mgr.create_session(make_ssh_input("Server 2")).unwrap();
        mgr.create_folder("Prod", "root").unwrap();

        let exported = mgr.export().unwrap();

        // Import into a fresh manager
        let dir2 = temp_dir();
        let mgr2 = SessionManager::with_config_dir(dir2.clone());
        let count = mgr2.import(&exported).unwrap();

        assert_eq!(count, 2);
        let tree = mgr2.list_tree();
        // Should have imported folder + 2 sessions
        assert!(!tree.is_empty());

        cleanup(&dir);
        cleanup(&dir2);
    }

    #[test]
    fn import_handles_name_collision() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        mgr.create_session(make_ssh_input("Server 1")).unwrap();

        // Export and re-import into same store
        let exported = mgr.export().unwrap();
        let count = mgr.import(&exported).unwrap();

        assert_eq!(count, 1);

        // Should have original + imported with "(imported)" suffix
        let results = mgr.search("Server 1");
        assert_eq!(results.len(), 2);
        assert!(results.iter().any(|s| s.name == "Server 1 (imported)"));

        cleanup(&dir);
    }

    #[test]
    fn import_invalid_json_fails() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let result = mgr.import("{{invalid json}}");
        assert!(matches!(result, Err(SessionError::ParseError(_))));

        cleanup(&dir);
    }

    // ─── Persistence ───────────────────────────────────────────

    #[test]
    fn persistence_survives_reload() {
        let dir = temp_dir();

        // Create and save
        let mgr = SessionManager::with_config_dir(dir.clone());
        let id = mgr.create_session(make_ssh_input("Persistent")).unwrap();
        drop(mgr);

        // Reload from disk
        let mgr2 = SessionManager::with_config_dir(dir.clone());
        let session = mgr2.get_session(&id).unwrap();
        assert_eq!(session.name, "Persistent");

        cleanup(&dir);
    }

    #[test]
    fn corrupted_file_loads_from_backup() {
        let dir = temp_dir();

        // Create two sessions so there are two writes — backup.1 will exist
        let mgr = SessionManager::with_config_dir(dir.clone());
        mgr.create_session(make_ssh_input("BackupTest")).unwrap();
        mgr.create_session(make_ssh_input("Second")).unwrap();
        drop(mgr);

        // Verify backup.1 exists (from the second write)
        assert!(dir.join("sessions.backup.1.json").exists());

        // Corrupt the main file
        fs::write(dir.join(SESSIONS_FILE), "{{corrupt}}").unwrap();

        // Reload should use backup.1 (which has the first session only)
        let mgr2 = SessionManager::with_config_dir(dir.clone());
        let results = mgr2.search("BackupTest");
        assert_eq!(results.len(), 1, "Should recover BackupTest from backup");

        cleanup(&dir);
    }

    #[test]
    fn missing_file_starts_fresh() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let tree = mgr.list_tree();
        assert!(tree.is_empty());

        cleanup(&dir);
    }

    #[test]
    fn backup_rotation() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        // Create 7 sessions to trigger 7 writes (7 backup rotations)
        for i in 0..7 {
            mgr.create_session(make_ssh_input(&format!("Server {i}")))
                .unwrap();
        }

        // Should have backups 1 through 5 (max)
        for i in 1..=5 {
            let backup =
                dir.join(format!("sessions.backup.{i}.json"));
            assert!(
                backup.exists(),
                "Backup {i} should exist"
            );
        }

        // Backup 6 should NOT exist
        assert!(!dir.join("sessions.backup.6.json").exists());

        cleanup(&dir);
    }

    #[test]
    fn file_permissions_on_unix() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let dir = temp_dir();
            let mgr = SessionManager::with_config_dir(dir.clone());
            mgr.create_session(make_ssh_input("PermTest")).unwrap();

            let path = dir.join(SESSIONS_FILE);
            let perms = fs::metadata(&path).unwrap().permissions();
            assert_eq!(perms.mode() & 0o777, 0o600);

            cleanup(&dir);
        }
    }

    // ─── Timestamp ─────────────────────────────────────────────

    #[test]
    fn now_iso8601_is_valid_rfc3339() {
        let ts = SessionManager::now_iso8601();
        // Should be valid RFC 3339 — ends with Z and contains T
        assert!(ts.ends_with('Z'));
        assert!(ts.contains('T'));
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        // Parse back with the time crate to verify
        use time::format_description::well_known::Rfc3339;
        assert!(
            time::OffsetDateTime::parse(&ts, &Rfc3339).is_ok(),
            "Timestamp '{}' should parse as RFC 3339",
            ts
        );
    }

    // ─── Protocol-specific validation ─────────────────────────

    #[test]
    fn ssh_session_requires_host() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("No Host SSH");
        input.host = None;
        let result = mgr.create_session(input);
        assert!(matches!(result, Err(SessionError::InvalidInput(_))));

        cleanup(&dir);
    }

    #[test]
    fn telnet_session_requires_host() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Telnet Server");
        input.protocol = Protocol::Telnet;
        input.host = None;
        let result = mgr.create_session(input);
        assert!(matches!(result, Err(SessionError::InvalidInput(_))));

        cleanup(&dir);
    }

    #[test]
    fn serial_session_requires_serial_port() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Serial Device");
        input.protocol = Protocol::Serial;
        input.host = None;
        input.serial_port = None;
        let result = mgr.create_session(input);
        assert!(matches!(result, Err(SessionError::InvalidInput(_))));

        cleanup(&dir);
    }

    #[test]
    fn serial_session_with_port_succeeds() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Serial Device");
        input.protocol = Protocol::Serial;
        input.host = None;
        input.serial_port = Some("/dev/ttyUSB0".into());
        let result = mgr.create_session(input);
        assert!(result.is_ok());

        cleanup(&dir);
    }

    #[test]
    fn local_session_needs_nothing() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Local Shell");
        input.protocol = Protocol::Local;
        input.host = None;
        let result = mgr.create_session(input);
        assert!(result.is_ok());

        cleanup(&dir);
    }

    // ─── Resource limits ──────────────────────────────────────

    #[test]
    fn import_rejects_oversized_payload() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let huge = "x".repeat(MAX_IMPORT_SIZE + 1);
        let result = mgr.import(&huge);
        assert!(matches!(result, Err(SessionError::LimitExceeded(_))));

        cleanup(&dir);
    }

    #[test]
    fn import_validates_session_names() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        // Import with an invalid session name (path traversal in name)
        let bad_data = r#"{"version":1,"sessions":[{
            "id":"abc","name":"../etc/passwd","folderId":"root",
            "protocol":"ssh","host":"example.com","port":22,
            "createdAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z"
        }],"folders":[]}"#;
        let count = mgr.import(bad_data).unwrap();
        // Session with path separator in name should be skipped
        assert_eq!(count, 0);

        cleanup(&dir);
    }

    // ─── Backup permissions ───────────────────────────────────

    #[test]
    fn backup_file_permissions_on_unix() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let dir = temp_dir();
            let mgr = SessionManager::with_config_dir(dir.clone());
            // Two writes to ensure backup.1 exists
            mgr.create_session(make_ssh_input("First")).unwrap();
            mgr.create_session(make_ssh_input("Second")).unwrap();

            let backup_path = dir.join("sessions.backup.1.json");
            assert!(backup_path.exists(), "backup.1 should exist");
            let perms = fs::metadata(&backup_path).unwrap().permissions();
            assert_eq!(
                perms.mode() & 0o777,
                0o600,
                "backup file should have 0600 permissions"
            );

            cleanup(&dir);
        }
    }

    // ─── Create session in folder ──────────────────────────────

    #[test]
    fn create_session_in_nonexistent_folder_fails() {
        let dir = temp_dir();
        let mgr = SessionManager::with_config_dir(dir.clone());

        let mut input = make_ssh_input("Server");
        input.folder_id = "550e8400-e29b-41d4-a716-446655440000".into();
        let result = mgr.create_session(input);
        assert!(matches!(result, Err(SessionError::FolderNotFound(_))));

        cleanup(&dir);
    }
}
