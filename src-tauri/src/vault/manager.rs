/// Vault manager — handles CRUD, persistence, and keychain integration.
///
/// Architecture:
/// - **Vault index** (`vault-index.json`): stores credential metadata (NO secrets)
/// - **OS Keychain**: stores secrets via the `KeyringBackend` trait
/// - Thread safety: metadata behind `Mutex<VaultIndex>`
///
/// Persistence follows the same pattern as SessionManager:
/// - Atomic writes: write to temp file, then rename
/// - Backup rotation: keeps 5 rotating backups
/// - File permissions: 0600 on Unix
///
/// SECURITY:
/// - `get_for_session()` is Rust-only — NOT exposed via IPC
/// - Secrets never written to vault-index.json
/// - Secrets never logged
/// - Secret strings zeroized via Drop impls on model types
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use directories::ProjectDirs;
use zeroize::Zeroizing;

use super::error::VaultError;
use super::keyring::KeyringBackend;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Vault index file name.
const VAULT_INDEX_FILE: &str = "vault-index.json";

/// Maximum number of stored credentials.
const MAX_CREDENTIALS: usize = 1_000;

/// Vault manager holding the metadata index and keyring backend.
pub struct VaultManager {
    index: Mutex<VaultIndex>,
    keyring: Box<dyn KeyringBackend>,
    config_dir: PathBuf,
}

impl VaultManager {
    /// Creates a new VaultManager with the OS keyring backend.
    pub fn new() -> Self {
        let config_dir = Self::resolve_config_dir();
        let index = Self::load_from_disk(&config_dir);
        Self {
            index: Mutex::new(index),
            keyring: Box::new(super::keyring::OsKeyring),
            config_dir,
        }
    }

    /// Creates a VaultManager with a custom keyring backend and config dir (for testing).
    #[cfg(test)]
    pub fn with_backend(keyring: Box<dyn KeyringBackend>, config_dir: PathBuf) -> Self {
        let index = Self::load_from_disk(&config_dir);
        Self {
            index: Mutex::new(index),
            keyring,
            config_dir,
        }
    }

    /// Resolves the platform-appropriate config directory.
    ///
    /// Panics if the platform doesn't support standard directories
    /// (e.g., no HOME on Unix, no APPDATA on Windows). This is fail-fast
    /// by design — the vault cannot function without a stable config path.
    fn resolve_config_dir() -> PathBuf {
        ProjectDirs::from("com", "putz", "putz")
            .expect("Failed to resolve config directory: HOME or APPDATA not set")
            .config_dir()
            .to_path_buf()
    }

    /// Acquires the internal mutex, returning a graceful error on poisoning.
    fn lock_index(&self) -> Result<MutexGuard<'_, VaultIndex>, VaultError> {
        self.index
            .lock()
            .map_err(|e| VaultError::LockError(format!("Vault index mutex poisoned: {e}")))
    }

    /// Loads the vault index from disk, with backup fallback.
    fn load_from_disk(config_dir: &Path) -> VaultIndex {
        let path = config_dir.join(VAULT_INDEX_FILE);

        // Try main file first
        if let Ok(index) = Self::read_index(&path) {
            return index;
        }

        // Try backups (1 through MAX_BACKUPS)
        for i in 1..=MAX_BACKUPS {
            let backup_path = config_dir.join(format!("vault-index.backup.{i}.json"));
            if let Ok(index) = Self::read_index(&backup_path) {
                eprintln!(
                    "Warning: Loaded vault index from backup {i}. \
                     Main file was corrupted or missing."
                );
                return index;
            }
        }

        // All failed — start fresh
        VaultIndex::default()
    }

    /// Reads and parses a VaultIndex from a JSON file.
    fn read_index(path: &Path) -> Result<VaultIndex, VaultError> {
        let content = fs::read_to_string(path)?;
        let index: VaultIndex = serde_json::from_str(&content)?;
        Ok(index)
    }

    /// Saves the current index to disk with backup rotation and atomic write.
    fn save_to_disk(&self, index: &VaultIndex) -> Result<(), VaultError> {
        fs::create_dir_all(&self.config_dir)?;

        let path = self.config_dir.join(VAULT_INDEX_FILE);

        // Rotate backups before writing
        self.rotate_backups()?;

        // Serialize
        let json = serde_json::to_string_pretty(index)?;

        // Atomic write: write to temp file, then rename
        let temp_path = self.config_dir.join("vault-index.tmp.json");
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

    /// Rotates backup files (vault-index.backup.5 → deleted, 4→5, ..., current→1).
    fn rotate_backups(&self) -> Result<(), VaultError> {
        let path = self.config_dir.join(VAULT_INDEX_FILE);

        // Remove oldest backup
        let oldest = self
            .config_dir
            .join(format!("vault-index.backup.{MAX_BACKUPS}.json"));
        let _ = fs::remove_file(&oldest);

        // Shift backups: N-1 → N
        for i in (1..MAX_BACKUPS).rev() {
            let from = self.config_dir.join(format!("vault-index.backup.{i}.json"));
            let to = self
                .config_dir
                .join(format!("vault-index.backup.{}.json", i + 1));
            let _ = fs::rename(&from, &to);
        }

        // Copy current → backup.1
        if path.exists() {
            let backup_1 = self.config_dir.join("vault-index.backup.1.json");
            let _ = fs::copy(&path, &backup_1);

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

    // ─── CRUD Operations ───────────────────────────────────────

    /// Lists all credential metadata (NO secrets).
    pub fn list(&self) -> Result<Vec<CredentialMeta>, VaultError> {
        let index = self.lock_index()?;
        Ok(index.credentials.clone())
    }

    /// Gets a full credential (including secret) by ID.
    ///
    /// Used by the `vault_get` IPC command for the credential editor.
    pub fn get(&self, id: &str) -> Result<Credential, VaultError> {
        validation::validate_uuid(id)?;

        let index = self.lock_index()?;
        let meta = index
            .credentials
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| VaultError::NotFound(id.into()))?;
        drop(index); // Release lock before keyring I/O

        // Retrieve secret from keychain (zeroized when dropped)
        let entry_json = Zeroizing::new(self.keyring.retrieve(id)?);
        let entry: KeyringEntry = serde_json::from_str(&entry_json)
            .map_err(|e| VaultError::ParseError(format!("Keyring entry corrupt: {e}")))?;

        Ok(Credential {
            meta,
            secret: entry.secret.clone(),
        })
    }

    /// Gets a full credential for backend protocol use.
    ///
    /// SECURITY: This method is Rust-only — NOT exposed as an IPC command.
    /// It also updates the `last_used` timestamp.
    pub fn get_for_session(&self, id: &str) -> Result<Credential, VaultError> {
        validation::validate_uuid(id)?;

        // Update last_used timestamp
        let mut index = self.lock_index()?;
        let meta = index
            .credentials
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| VaultError::NotFound(id.into()))?;

        meta.last_used = Some(Self::now_iso8601());
        let meta_clone = meta.clone();
        self.save_to_disk(&index)?;
        drop(index);

        // Retrieve secret from keychain (zeroized when dropped)
        let entry_json = Zeroizing::new(self.keyring.retrieve(id)?);
        let entry: KeyringEntry = serde_json::from_str(&entry_json)
            .map_err(|e| VaultError::ParseError(format!("Keyring entry corrupt: {e}")))?;

        Ok(Credential {
            meta: meta_clone,
            secret: entry.secret.clone(),
        })
    }

    /// Creates or updates a credential.
    ///
    /// If `input.id` is `Some`, updates the existing credential.
    /// If `input.id` is `None`, creates a new one with a generated UUID.
    ///
    /// Returns the credential ID.
    pub fn set(&self, input: SetCredentialInput) -> Result<String, VaultError> {
        validation::validate_credential_name(&input.name)?;
        validation::validate_credential_username(&input.username)?;
        validation::validate_secret(&input.secret)?;

        let now = Self::now_iso8601();

        // Build keyring entry (zeroized when dropped)
        let keyring_entry = KeyringEntry {
            username: input.username.clone(),
            secret: input.secret.clone(),
            credential_type: input.credential_type.clone(),
        };
        let entry_json = Zeroizing::new(serde_json::to_string(&keyring_entry)?);

        let mut index = self.lock_index()?;

        // Determine ID and validate existence for updates
        let (id, is_update) = if let Some(ref existing_id) = input.id {
            validation::validate_uuid(existing_id)?;
            if !index.credentials.iter().any(|c| c.id == *existing_id) {
                return Err(VaultError::NotFound(existing_id.clone()));
            }
            (existing_id.clone(), true)
        } else {
            if index.credentials.len() >= MAX_CREDENTIALS {
                return Err(VaultError::InvalidInput(format!(
                    "Maximum number of credentials ({MAX_CREDENTIALS}) reached"
                )));
            }
            (uuid::Uuid::new_v4().to_string(), false)
        };

        // Store secret in keychain BEFORE mutating index.
        // If keyring fails, index remains unchanged.
        self.keyring.store(&id, &entry_json)?;

        // Now safe to mutate index — keyring succeeded
        if is_update {
            let meta = index
                .credentials
                .iter_mut()
                .find(|c| c.id == id)
                .expect("existence validated above");
            meta.name = input.name.clone();
            meta.username = input.username.clone();
            meta.credential_type = input.credential_type.clone();
            meta.updated_at = now;
            meta.expires_at = input.expires_at.clone();
            meta.rotation_days = input.rotation_days;
        } else {
            let meta = CredentialMeta {
                id: id.clone(),
                name: input.name.clone(),
                username: input.username.clone(),
                credential_type: input.credential_type.clone(),
                last_used: None,
                created_at: now.clone(),
                updated_at: now,
                expires_at: input.expires_at.clone(),
                rotation_days: input.rotation_days,
            };
            index.credentials.push(meta);
        }

        // Persist index to disk
        self.save_to_disk(&index)?;

        Ok(id)
    }

    /// Deletes a credential from both the index and the keychain.
    pub fn delete(&self, id: &str) -> Result<(), VaultError> {
        validation::validate_uuid(id)?;

        let mut index = self.lock_index()?;
        let pos = index
            .credentials
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| VaultError::NotFound(id.into()))?;

        index.credentials.remove(pos);

        // Delete from keychain (best-effort — index is source of truth)
        let keyring_result = self.keyring.delete(id);

        // Persist index regardless of keyring result
        self.save_to_disk(&index)?;

        // Surface keyring errors after index is saved
        keyring_result?;

        Ok(())
    }

    /// Returns credentials that expire within the given number of days.
    ///
    /// Checks `expires_at` field against the current UTC time plus `days_ahead`.
    /// Credentials without an `expires_at` value are excluded.
    pub fn check_expiring(&self, days_ahead: u32) -> Result<Vec<CredentialMeta>, VaultError> {
        let index = self.lock_index()?;
        let now = chrono::Utc::now();
        let threshold = now + chrono::Duration::days(days_ahead as i64);

        let expiring: Vec<CredentialMeta> = index
            .credentials
            .iter()
            .filter(|c| {
                if let Some(ref expires_at) = c.expires_at {
                    // Parse ISO 8601 timestamp
                    if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(expires_at) {
                        return expires <= threshold;
                    }
                }
                false
            })
            .cloned()
            .collect();

        Ok(expiring)
    }
}

#[cfg(test)]
mod tests {
    use super::super::keyring::mock::MockKeyring;
    use super::*;

    /// Creates a VaultManager with a temp directory and returns the dir handle.
    fn test_manager_with_dir() -> (VaultManager, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            VaultManager::with_backend(Box::new(MockKeyring::new()), dir.path().to_path_buf());
        (manager, dir)
    }

    fn sample_input() -> SetCredentialInput {
        SetCredentialInput {
            id: None,
            name: "DC1 Admin".into(),
            username: "admin".into(),
            secret: "hunter2".into(),
            credential_type: CredentialType::Password,
            expires_at: None,
            rotation_days: None,
        }
    }

    // ─── Create ────────────────────────────────────────────────

    #[test]
    fn create_credential_returns_uuid() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn create_credential_appears_in_list() {
        let (mgr, _dir) = test_manager_with_dir();
        mgr.set(sample_input()).unwrap();

        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "DC1 Admin");
        assert_eq!(list[0].username, "admin");
        assert_eq!(list[0].credential_type, CredentialType::Password);
    }

    #[test]
    fn create_credential_list_has_no_secrets() {
        let (mgr, _dir) = test_manager_with_dir();
        mgr.set(sample_input()).unwrap();

        let list = mgr.list().unwrap();
        let json = serde_json::to_string(&list).unwrap();
        // CredentialMeta must not contain a "secret" field
        assert!(!json.contains("hunter2"));
        assert!(!json.contains("secret"));
    }

    #[test]
    fn create_credential_stores_timestamps() {
        let (mgr, _dir) = test_manager_with_dir();
        mgr.set(sample_input()).unwrap();

        let list = mgr.list().unwrap();
        assert!(!list[0].created_at.is_empty());
        assert!(!list[0].updated_at.is_empty());
        assert!(list[0].last_used.is_none());
    }

    // ─── Read ──────────────────────────────────────────────────

    #[test]
    fn get_credential_returns_full_credential() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        let cred = mgr.get(&id).unwrap();
        assert_eq!(cred.meta.name, "DC1 Admin");
        assert_eq!(cred.secret, "hunter2");
    }

    #[test]
    fn get_credential_not_found() {
        let (mgr, _dir) = test_manager_with_dir();
        let result = mgr.get("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result.unwrap_err(), VaultError::NotFound(_)));
    }

    #[test]
    fn get_credential_invalid_uuid() {
        let (mgr, _dir) = test_manager_with_dir();
        let result = mgr.get("not-a-uuid");
        assert!(matches!(result.unwrap_err(), VaultError::InvalidInput(_)));
    }

    // ─── get_for_session ──────────────────────────────────────

    #[test]
    fn get_for_session_returns_credential() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        let cred = mgr.get_for_session(&id).unwrap();
        assert_eq!(cred.meta.name, "DC1 Admin");
        assert_eq!(cred.secret, "hunter2");
    }

    #[test]
    fn get_for_session_updates_last_used() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        // Initially, last_used is None
        let list = mgr.list().unwrap();
        assert!(list[0].last_used.is_none());

        // After get_for_session, last_used should be set
        mgr.get_for_session(&id).unwrap();
        let list = mgr.list().unwrap();
        assert!(list[0].last_used.is_some());
    }

    // ─── Update ────────────────────────────────────────────────

    #[test]
    fn update_credential_changes_fields() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        let update = SetCredentialInput {
            id: Some(id.clone()),
            name: "Updated Name".into(),
            username: "new_user".into(),
            secret: "new_secret".into(),
            credential_type: CredentialType::KeyPassphrase,
            expires_at: None,
            rotation_days: None,
        };
        let returned_id = mgr.set(update).unwrap();
        assert_eq!(returned_id, id);

        let cred = mgr.get(&id).unwrap();
        assert_eq!(cred.meta.name, "Updated Name");
        assert_eq!(cred.meta.username, "new_user");
        assert_eq!(cred.secret, "new_secret");
        assert_eq!(cred.meta.credential_type, CredentialType::KeyPassphrase);
    }

    #[test]
    fn update_nonexistent_credential_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let update = SetCredentialInput {
            id: Some("550e8400-e29b-41d4-a716-446655440000".into()),
            name: "Test".into(),
            username: "user".into(),
            secret: "pass".into(),
            credential_type: CredentialType::Password,
            expires_at: None,
            rotation_days: None,
        };
        let result = mgr.set(update);
        assert!(matches!(result.unwrap_err(), VaultError::NotFound(_)));
    }

    // ─── Delete ────────────────────────────────────────────────

    #[test]
    fn delete_credential_removes_from_list() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        mgr.delete(&id).unwrap();
        let list = mgr.list().unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn delete_credential_removes_from_keychain() {
        let (mgr, _dir) = test_manager_with_dir();
        let id = mgr.set(sample_input()).unwrap();

        mgr.delete(&id).unwrap();
        let result = mgr.get(&id);
        assert!(result.is_err());
    }

    #[test]
    fn delete_nonexistent_credential_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let result = mgr.delete("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result.unwrap_err(), VaultError::NotFound(_)));
    }

    // ─── Validation ────────────────────────────────────────────

    #[test]
    fn create_with_empty_name_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let mut input = sample_input();
        input.name = "".into();
        let result = mgr.set(input);
        assert!(matches!(result.unwrap_err(), VaultError::InvalidInput(_)));
    }

    #[test]
    fn create_with_empty_username_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let mut input = sample_input();
        input.username = "".into();
        let result = mgr.set(input);
        assert!(matches!(result.unwrap_err(), VaultError::InvalidInput(_)));
    }

    #[test]
    fn create_with_empty_secret_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let mut input = sample_input();
        input.secret = "".into();
        let result = mgr.set(input);
        assert!(matches!(result.unwrap_err(), VaultError::InvalidInput(_)));
    }

    #[test]
    fn create_with_long_name_fails() {
        let (mgr, _dir) = test_manager_with_dir();
        let mut input = sample_input();
        input.name = "a".repeat(201);
        let result = mgr.set(input);
        assert!(matches!(result.unwrap_err(), VaultError::InvalidInput(_)));
    }

    // ─── Persistence ───────────────────────────────────────────

    #[test]
    fn index_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().to_path_buf();

        // Create and save
        {
            let mgr = VaultManager::with_backend(Box::new(MockKeyring::new()), config_dir.clone());
            mgr.set(sample_input()).unwrap();
        }

        // Verify file exists
        let index_path = config_dir.join(VAULT_INDEX_FILE);
        assert!(index_path.exists());

        // Verify content has no secrets
        let content = fs::read_to_string(&index_path).unwrap();
        assert!(!content.contains("hunter2"));
        assert!(content.contains("DC1 Admin"));
    }

    #[test]
    fn index_loads_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().to_path_buf();

        // Create manager 1 and save a credential
        let mgr1 = VaultManager::with_backend(Box::new(MockKeyring::new()), config_dir.clone());
        mgr1.set(sample_input()).unwrap();

        // Create manager 2 from the same directory — should load the index
        let mgr2 = VaultManager::with_backend(Box::new(MockKeyring::new()), config_dir.clone());
        let list = mgr2.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "DC1 Admin");
    }

    #[test]
    fn backup_rotation_creates_backups() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().to_path_buf();
        let mgr = VaultManager::with_backend(Box::new(MockKeyring::new()), config_dir.clone());

        // Create two credentials to trigger two saves
        mgr.set(sample_input()).unwrap();
        let mut input2 = sample_input();
        input2.name = "Second".into();
        mgr.set(input2).unwrap();

        // Should have at least backup.1
        let backup_1 = config_dir.join("vault-index.backup.1.json");
        assert!(backup_1.exists());
    }

    #[cfg(unix)]
    #[test]
    fn index_file_has_restricted_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().to_path_buf();
        let mgr = VaultManager::with_backend(Box::new(MockKeyring::new()), config_dir.clone());
        mgr.set(sample_input()).unwrap();

        let index_path = config_dir.join(VAULT_INDEX_FILE);
        let perms = fs::metadata(&index_path).unwrap().permissions();
        assert_eq!(perms.mode() & 0o777, 0o600);
    }

    // ─── Resource limits ──────────────────────────────────────

    #[test]
    fn max_credentials_limit_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let mgr =
            VaultManager::with_backend(Box::new(MockKeyring::new()), dir.path().to_path_buf());

        // Directly inject MAX_CREDENTIALS items into the index
        {
            let mut index = mgr.lock_index().unwrap();
            for i in 0..MAX_CREDENTIALS {
                index.credentials.push(CredentialMeta {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: format!("Cred {i}"),
                    username: "user".into(),
                    credential_type: CredentialType::Password,
                    last_used: None,
                    created_at: "2024-01-01T00:00:00Z".into(),
                    updated_at: "2024-01-01T00:00:00Z".into(),
                    expires_at: None,
                    rotation_days: None,
                });
            }
        }

        // Trying to create one more should fail
        let result = mgr.set(sample_input());
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("Maximum"));
    }

    // ─── Multiple operations ──────────────────────────────────

    #[test]
    fn multiple_credentials_independent() {
        let (mgr, _dir) = test_manager_with_dir();

        let id1 = mgr.set(sample_input()).unwrap();

        let mut input2 = sample_input();
        input2.name = "Prod Server".into();
        input2.username = "root".into();
        input2.secret = "pr0d_p@ss".into();
        let id2 = mgr.set(input2).unwrap();

        assert_ne!(id1, id2);

        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 2);

        let cred1 = mgr.get(&id1).unwrap();
        assert_eq!(cred1.secret, "hunter2");

        let cred2 = mgr.get(&id2).unwrap();
        assert_eq!(cred2.secret, "pr0d_p@ss");

        // Delete one, other survives
        mgr.delete(&id1).unwrap();
        assert_eq!(mgr.list().unwrap().len(), 1);
        assert!(mgr.get(&id2).is_ok());
    }

    // ─── Keyring failure rollback ────────────────────────────────

    /// A keyring mock that always fails on store, used to test rollback behavior.
    struct FailingKeyring;

    impl KeyringBackend for FailingKeyring {
        fn store(&self, _id: &str, _entry_json: &str) -> Result<(), VaultError> {
            Err(VaultError::AccessDenied("Keychain locked".into()))
        }
        fn retrieve(&self, _id: &str) -> Result<String, VaultError> {
            Err(VaultError::NotFound("not stored".into()))
        }
        fn delete(&self, _id: &str) -> Result<(), VaultError> {
            Err(VaultError::NotFound("not stored".into()))
        }
    }

    #[test]
    fn set_keyring_failure_does_not_mutate_index() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = VaultManager::with_backend(Box::new(FailingKeyring), dir.path().to_path_buf());

        let result = mgr.set(sample_input());
        assert!(
            result.is_err(),
            "set() should fail when keyring is unavailable"
        );

        let list = mgr.list().unwrap();
        assert!(
            list.is_empty(),
            "index must remain empty after keyring failure"
        );
    }

    #[test]
    fn update_keyring_failure_does_not_mutate_index() {
        // First, create a credential with a working keyring
        let dir = tempfile::tempdir().unwrap();
        let working_mgr =
            VaultManager::with_backend(Box::new(MockKeyring::new()), dir.path().to_path_buf());
        let id = working_mgr.set(sample_input()).unwrap();
        let original = working_mgr.list().unwrap();
        assert_eq!(original.len(), 1);
        let original_name = original[0].name.clone();
        drop(working_mgr);

        // Now create a manager with a failing keyring pointing at the same dir
        let failing_mgr =
            VaultManager::with_backend(Box::new(FailingKeyring), dir.path().to_path_buf());

        let mut update = sample_input();
        update.id = Some(id);
        update.name = "Updated Name".into();
        let result = failing_mgr.set(update);
        assert!(
            result.is_err(),
            "update should fail when keyring is unavailable"
        );

        // Verify index was not mutated
        let list = failing_mgr.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(
            list[0].name, original_name,
            "name must not change after keyring failure"
        );
    }
}
