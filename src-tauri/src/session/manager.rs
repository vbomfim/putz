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
use std::sync::Mutex;

use directories::ProjectDirs;

use super::error::SessionError;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Sessions file name.
const SESSIONS_FILE: &str = "sessions.json";

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
        }

        Ok(())
    }

    /// Returns the current ISO 8601 timestamp.
    fn now_iso8601() -> String {
        // Use std::time to avoid adding chrono dependency
        let now = std::time::SystemTime::now();
        let duration = now
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = duration.as_secs();

        // Convert to simple ISO 8601 format
        // This is approximate but sufficient for ordering and display
        let days = secs / 86400;
        let remaining = secs % 86400;
        let hours = remaining / 3600;
        let minutes = (remaining % 3600) / 60;
        let seconds = remaining % 60;

        // Calculate year/month/day from days since epoch (1970-01-01)
        let (year, month, day) = days_to_ymd(days);

        format!(
            "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z"
        )
    }

    // ─── CRUD: Sessions ────────────────────────────────────────

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
            color_scheme: input.color_scheme,
            auto_log: input.auto_log,
            jump_host_id: input.jump_host_id,
            created_at: now.clone(),
            updated_at: now,
        };

        let mut store = self.store.lock().unwrap();

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
        let store = self.store.lock().unwrap();
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

        let mut store = self.store.lock().unwrap();

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
        if let Some(color_scheme) = input.color_scheme {
            session.color_scheme = Some(color_scheme);
        }
        if let Some(auto_log) = input.auto_log {
            session.auto_log = Some(auto_log);
        }
        if let Some(jump_host_id) = input.jump_host_id {
            session.jump_host_id = Some(jump_host_id);
        }
        session.updated_at = Self::now_iso8601();

        self.save_to_disk(&store)?;
        Ok(())
    }

    /// Deletes a session profile by ID.
    pub fn delete_session(&self, id: &str) -> Result<(), SessionError> {
        validation::validate_uuid(id)?;
        let mut store = self.store.lock().unwrap();
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
        let store = self.store.lock().unwrap();
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
            color_scheme: original.color_scheme,
            auto_log: original.auto_log,
            jump_host_id: original.jump_host_id,
        };

        self.create_session(input)
    }

    /// Moves a session to a different folder.
    pub fn move_session(&self, input: MoveSessionInput) -> Result<(), SessionError> {
        validation::validate_uuid(&input.id)?;

        let mut store = self.store.lock().unwrap();

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
        let mut store = self.store.lock().unwrap();

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
        let mut store = self.store.lock().unwrap();

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
        let store = self.store.lock().unwrap();
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

        let store = self.store.lock().unwrap();
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
        let store = self.store.lock().unwrap();
        let json = serde_json::to_string_pretty(&*store)?;
        Ok(json)
    }

    /// Imports sessions and folders from a JSON string.
    ///
    /// Merges imported data into the existing store. Imported sessions
    /// get new UUIDs to avoid conflicts. Name collisions get "(imported)" suffix.
    pub fn import(&self, data: &str) -> Result<usize, SessionError> {
        let imported_store: SessionStore = serde_json::from_str(data)?;
        let mut store = self.store.lock().unwrap();

        let mut count = 0;

        // Import folders — remap IDs to avoid conflicts
        let mut folder_id_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        folder_id_map.insert("root".into(), "root".into());

        for folder in &imported_store.folders {
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
                color_scheme: session.color_scheme.clone(),
                auto_log: session.auto_log,
                jump_host_id: session.jump_host_id.clone(),
                created_at: session.created_at.clone(),
                updated_at: now.clone(),
            });
            count += 1;
        }

        self.save_to_disk(&store)?;
        Ok(count)
    }
}

/// Converts days since Unix epoch to (year, month, day).
fn days_to_ymd(total_days: u64) -> (u64, u64, u64) {
    // Algorithm from Howard Hinnant's date algorithms
    let z = total_days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
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
            color_scheme: None,
            auto_log: None,
            jump_host_id: None,
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
                color_scheme: None,
                auto_log: None,
                jump_host_id: None,
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
                color_scheme: None,
                auto_log: None,
                jump_host_id: None,
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
    fn now_iso8601_is_valid_format() {
        let ts = SessionManager::now_iso8601();
        // Should match YYYY-MM-DDTHH:MM:SSZ pattern
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 20); // "2024-01-01T00:00:00Z"
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
    }

    // ─── days_to_ymd ───────────────────────────────────────────

    #[test]
    fn days_to_ymd_epoch() {
        // 1970-01-01
        let (y, m, d) = days_to_ymd(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn days_to_ymd_known_date() {
        // 2024-01-01 = 19723 days since epoch
        let (y, m, d) = days_to_ymd(19723);
        assert_eq!((y, m, d), (2024, 1, 1));
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
