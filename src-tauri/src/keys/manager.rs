/// SSH key manager — handles CRUD, generation, import, and persistence.
///
/// Architecture:
/// - **Key index** (`keys/index.json`): stores key metadata (NO private keys)
/// - **Key files** (`keys/{id}.key`): private keys in PEM format, 0600 perms
/// - Thread safety: metadata behind `Mutex<SSHKeyIndex>`
///
/// SECURITY:
/// - Private keys NEVER cross the IPC boundary — only metadata and public keys
/// - Private key files written with 0600 permissions
/// - Key generation uses OS CSPRNG (`OsRng`)
/// - Passphrases handled via Credential Vault, never stored in index
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use directories::ProjectDirs;
use russh_keys::PublicKeyBase64;

use super::error::KeyError;
use super::models::*;
use super::validation;

/// Maximum number of backup files to keep.
const MAX_BACKUPS: u32 = 5;

/// Key index file name.
const KEY_INDEX_FILE: &str = "index.json";

/// Keys subdirectory name.
const KEYS_DIR: &str = "keys";

/// Maximum number of stored keys.
const MAX_KEYS: usize = 500;

/// SSH key manager holding the metadata index.
pub struct KeyManager {
    index: Mutex<SSHKeyIndex>,
    keys_dir: PathBuf,
}

impl KeyManager {
    /// Creates a new KeyManager with the default config directory.
    pub fn new() -> Self {
        let keys_dir = Self::resolve_keys_dir();
        let index = Self::load_from_disk(&keys_dir);
        Self {
            index: Mutex::new(index),
            keys_dir,
        }
    }

    /// Creates a KeyManager with a custom keys directory (for testing).
    #[cfg(test)]
    pub fn with_dir(keys_dir: PathBuf) -> Self {
        let index = Self::load_from_disk(&keys_dir);
        Self {
            index: Mutex::new(index),
            keys_dir,
        }
    }

    /// Resolves the platform-appropriate keys directory.
    fn resolve_keys_dir() -> PathBuf {
        ProjectDirs::from("com", "putz", "putz")
            .expect("Failed to resolve config directory: HOME or APPDATA not set")
            .config_dir()
            .join(KEYS_DIR)
    }

    /// Acquires the internal mutex, returning a graceful error on poisoning.
    fn lock_index(&self) -> Result<MutexGuard<'_, SSHKeyIndex>, KeyError> {
        self.index
            .lock()
            .map_err(|e| KeyError::LockError(format!("Key index mutex poisoned: {e}")))
    }

    // ─── Persistence ───────────────────────────────────────────

    /// Loads the key index from disk, with backup fallback.
    fn load_from_disk(keys_dir: &Path) -> SSHKeyIndex {
        let path = keys_dir.join(KEY_INDEX_FILE);

        if let Ok(index) = Self::read_index(&path) {
            return index;
        }

        // Try backups
        for i in 1..=MAX_BACKUPS {
            let backup_path = keys_dir.join(format!("index.backup.{i}.json"));
            if let Ok(index) = Self::read_index(&backup_path) {
                eprintln!(
                    "Warning: Loaded key index from backup {i}. \
                     Main file was corrupted or missing."
                );
                return index;
            }
        }

        SSHKeyIndex::default()
    }

    /// Reads and parses an SSHKeyIndex from a JSON file.
    fn read_index(path: &Path) -> Result<SSHKeyIndex, KeyError> {
        let content = fs::read_to_string(path)?;
        let index: SSHKeyIndex = serde_json::from_str(&content)?;
        Ok(index)
    }

    /// Saves the current index to disk with backup rotation and atomic write.
    fn save_to_disk(&self, index: &SSHKeyIndex) -> Result<(), KeyError> {
        fs::create_dir_all(&self.keys_dir)?;

        let path = self.keys_dir.join(KEY_INDEX_FILE);

        // Rotate backups before writing
        self.rotate_backups()?;

        let json = serde_json::to_string_pretty(index)?;

        // Atomic write: temp file then rename
        let temp_path = self.keys_dir.join("index.tmp.json");
        fs::write(&temp_path, &json)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&temp_path, perms)?;
        }

        fs::rename(&temp_path, &path)?;

        Ok(())
    }

    /// Rotates backup files.
    fn rotate_backups(&self) -> Result<(), KeyError> {
        let path = self.keys_dir.join(KEY_INDEX_FILE);

        let oldest = self
            .keys_dir
            .join(format!("index.backup.{MAX_BACKUPS}.json"));
        let _ = fs::remove_file(&oldest);

        for i in (1..MAX_BACKUPS).rev() {
            let from = self.keys_dir.join(format!("index.backup.{i}.json"));
            let to = self.keys_dir.join(format!("index.backup.{}.json", i + 1));
            let _ = fs::rename(&from, &to);
        }

        if path.exists() {
            let backup_1 = self.keys_dir.join("index.backup.1.json");
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

    /// Returns the file path for a private key by ID.
    fn key_file_path(&self, id: &str) -> PathBuf {
        self.keys_dir.join(format!("{id}.key"))
    }

    /// Writes a private key file with 0600 permissions.
    ///
    /// SECURITY: Private key files must be readable only by the owner.
    fn write_key_file(&self, id: &str, content: &[u8]) -> Result<(), KeyError> {
        fs::create_dir_all(&self.keys_dir)?;

        let path = self.key_file_path(id);

        // Write to temp file first, then rename (atomic)
        let temp_path = self.keys_dir.join(format!("{id}.key.tmp"));
        fs::write(&temp_path, content)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&temp_path, perms)?;
        }

        fs::rename(&temp_path, &path)?;

        Ok(())
    }

    // ─── Cryptographic helpers ─────────────────────────────────

    /// Formats a public key's fingerprint in SHA256 format.
    ///
    /// Uses russh-keys' built-in fingerprint computation.
    fn format_fingerprint(key: &russh_keys::key::PublicKey) -> String {
        format!("SHA256:{}", key.fingerprint())
    }

    /// Encodes a public key in OpenSSH authorized_keys format.
    fn encode_public_key_openssh(key: &russh_keys::key::PublicKey) -> String {
        let b64 = key.public_key_base64();
        let key_type = key.name();
        format!("{key_type} {b64}")
    }

    /// Writes a private key to a PEM-encoded buffer.
    ///
    /// If a passphrase is provided, the key is encrypted.
    fn encode_private_key(
        key: &russh_keys::key::KeyPair,
        passphrase: Option<&str>,
    ) -> Result<Vec<u8>, KeyError> {
        let mut buf = Vec::new();
        match passphrase {
            Some(pass) => {
                russh_keys::encode_pkcs8_pem_encrypted(key, pass.as_bytes(), 100, &mut buf)
                    .map_err(|e| {
                        KeyError::CryptoError(format!("Failed to encode encrypted key: {e}"))
                    })?;
            }
            None => {
                russh_keys::encode_pkcs8_pem(key, &mut buf)
                    .map_err(|e| KeyError::CryptoError(format!("Failed to encode key: {e}")))?;
            }
        }
        Ok(buf)
    }

    // ─── CRUD Operations ───────────────────────────────────────

    /// Lists all key metadata (NO private keys).
    pub fn list(&self) -> Result<Vec<SSHKeyMeta>, KeyError> {
        let index = self.lock_index()?;
        Ok(index.keys.clone())
    }

    /// Gets a single key's public key in OpenSSH format.
    ///
    /// SECURITY: Only returns the public key — private key stays on disk.
    pub fn get_public_key(&self, id: &str) -> Result<String, KeyError> {
        validation::validate_uuid(id)?;
        let index = self.lock_index()?;
        let meta = index
            .keys
            .iter()
            .find(|k| k.id == id)
            .ok_or_else(|| KeyError::NotFound(id.into()))?;
        Ok(meta.public_key.clone())
    }

    /// Generates a new SSH key pair.
    ///
    /// SECURITY:
    /// - Uses OsRng (CSPRNG) for generation
    /// - Private key written to disk with 0600 permissions
    /// - Private key NEVER returned via IPC
    pub fn generate(&self, input: GenerateKeyInput) -> Result<SSHKeyMeta, KeyError> {
        validation::validate_key_name(&input.name)?;

        let mut index = self.lock_index()?;

        if index.keys.len() >= MAX_KEYS {
            return Err(KeyError::InvalidInput(format!(
                "Maximum number of keys ({MAX_KEYS}) reached"
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();

        // Generate key pair using russh-keys with OsRng
        let key_pair = match input.algorithm {
            KeyAlgorithm::Ed25519 => russh_keys::key::KeyPair::generate_ed25519(),
            KeyAlgorithm::Rsa4096 => russh_keys::key::KeyPair::generate_rsa(
                4096,
                russh_keys::key::SignatureHash::SHA2_256,
            )
            .ok_or_else(|| KeyError::CryptoError("Failed to generate RSA-4096 key".into()))?,
        };

        // Extract public key info
        let public_key = key_pair
            .clone_public_key()
            .map_err(|e| KeyError::CryptoError(format!("Failed to extract public key: {e}")))?;
        let fingerprint = Self::format_fingerprint(&public_key);
        let public_key_str = Self::encode_public_key_openssh(&public_key);

        // Encode private key to PEM format
        let passphrase_ref = input.passphrase.as_deref();
        let private_key_bytes = Self::encode_private_key(&key_pair, passphrase_ref)?;

        // Write private key to disk with 0600 permissions
        self.write_key_file(&id, &private_key_bytes)?;

        let meta = SSHKeyMeta {
            id: id.clone(),
            name: input.name.trim().to_string(),
            algorithm: input.algorithm,
            fingerprint,
            public_key: public_key_str,
            has_passphrase: input.passphrase.is_some(),
            passphrase_credential_id: None,
            imported_from: None,
            created_at: Self::now_iso8601(),
        };

        index.keys.push(meta.clone());
        self.save_to_disk(&index)?;

        Ok(meta)
    }

    /// Imports an existing SSH private key.
    ///
    /// Accepts OpenSSH format PEM-encoded private keys.
    ///
    /// SECURITY:
    /// - Validates PEM format before processing
    /// - Writes imported key to managed storage with 0600 permissions
    /// - Original file path recorded for reference only
    pub fn import(&self, input: ImportKeyInput) -> Result<SSHKeyMeta, KeyError> {
        validation::validate_key_name(&input.name)?;
        validation::validate_private_key_pem(&input.private_key_pem)?;

        let mut index = self.lock_index()?;

        if index.keys.len() >= MAX_KEYS {
            return Err(KeyError::InvalidInput(format!(
                "Maximum number of keys ({MAX_KEYS}) reached"
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();

        // Parse the private key
        let passphrase_ref = input.passphrase.as_deref();
        let key_pair = russh_keys::decode_secret_key(&input.private_key_pem, passphrase_ref)
            .map_err(|e| KeyError::CryptoError(format!("Failed to parse private key: {e}")))?;

        // Extract public key info
        let public_key = key_pair.clone_public_key().map_err(|e| {
            KeyError::CryptoError(format!(
                "Failed to extract public key from imported key: {e}"
            ))
        })?;
        let fingerprint = Self::format_fingerprint(&public_key);
        let public_key_str = Self::encode_public_key_openssh(&public_key);

        // Detect algorithm from the parsed key
        let algorithm = match public_key.name() {
            "ssh-ed25519" => KeyAlgorithm::Ed25519,
            _ => KeyAlgorithm::Rsa4096,
        };

        // Re-encode and store with consistent format
        let encoded = Self::encode_private_key(&key_pair, passphrase_ref)?;
        self.write_key_file(&id, &encoded)?;

        let meta = SSHKeyMeta {
            id: id.clone(),
            name: input.name.trim().to_string(),
            algorithm,
            fingerprint,
            public_key: public_key_str,
            has_passphrase: input.passphrase.is_some(),
            passphrase_credential_id: None,
            imported_from: None,
            created_at: Self::now_iso8601(),
        };

        index.keys.push(meta.clone());
        self.save_to_disk(&index)?;

        Ok(meta)
    }

    /// Deletes a key — removes from index and deletes the private key file.
    pub fn delete(&self, id: &str) -> Result<(), KeyError> {
        validation::validate_uuid(id)?;

        let mut index = self.lock_index()?;

        let pos = index
            .keys
            .iter()
            .position(|k| k.id == id)
            .ok_or_else(|| KeyError::NotFound(id.into()))?;

        index.keys.remove(pos);

        // Delete private key file (ignore error if already removed)
        let key_path = self.key_file_path(id);
        let _ = fs::remove_file(&key_path);

        self.save_to_disk(&index)?;

        Ok(())
    }

    /// Returns the path to the private key file for a key ID.
    ///
    /// SECURITY: This is for Rust-only use (SSH auth). The path is NOT
    /// exposed via IPC — the frontend never sees private key file locations.
    pub fn get_key_path(&self, id: &str) -> Result<PathBuf, KeyError> {
        validation::validate_uuid(id)?;
        let index = self.lock_index()?;

        if !index.keys.iter().any(|k| k.id == id) {
            return Err(KeyError::NotFound(id.into()));
        }

        let path = self.key_file_path(id);
        if !path.exists() {
            return Err(KeyError::IoError(format!(
                "Private key file missing for key {id}"
            )));
        }

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: creates a KeyManager with a temporary directory.
    fn test_manager() -> (KeyManager, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let manager = KeyManager::with_dir(dir.path().to_path_buf());
        (manager, dir)
    }

    // ─── List ────────────────────────────────────────────────

    #[test]
    fn list_empty_returns_empty_vec() {
        let (mgr, _dir) = test_manager();
        let keys = mgr.list().unwrap();
        assert!(keys.is_empty());
    }

    // ─── Generate Ed25519 ────────────────────────────────────

    #[test]
    fn generate_ed25519_creates_key() {
        let (mgr, _dir) = test_manager();
        let input = GenerateKeyInput {
            name: "Test Ed25519".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        };
        let meta = mgr.generate(input).unwrap();
        assert_eq!(meta.name, "Test Ed25519");
        assert_eq!(meta.algorithm, KeyAlgorithm::Ed25519);
        assert!(meta.fingerprint.starts_with("SHA256:"));
        assert!(meta.public_key.starts_with("ssh-ed25519 "));
        assert!(!meta.has_passphrase);
        assert!(!meta.id.is_empty());
    }

    #[test]
    fn generate_ed25519_persists_to_index() {
        let (mgr, _dir) = test_manager();
        let input = GenerateKeyInput {
            name: "Persisted".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        };
        mgr.generate(input).unwrap();

        let keys = mgr.list().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].name, "Persisted");
    }

    #[test]
    fn generate_ed25519_creates_key_file() {
        let (mgr, dir) = test_manager();
        let input = GenerateKeyInput {
            name: "File Test".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        };
        let meta = mgr.generate(input).unwrap();

        let key_path = dir.path().join(format!("{}.key", meta.id));
        assert!(key_path.exists());

        let content = fs::read_to_string(&key_path).unwrap();
        assert!(content.contains("PRIVATE KEY"));
    }

    #[cfg(unix)]
    #[test]
    fn generate_ed25519_key_file_has_0600_perms() {
        use std::os::unix::fs::PermissionsExt;

        let (mgr, dir) = test_manager();
        let input = GenerateKeyInput {
            name: "Perms Test".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        };
        let meta = mgr.generate(input).unwrap();

        let key_path = dir.path().join(format!("{}.key", meta.id));
        let perms = fs::metadata(&key_path).unwrap().permissions();
        assert_eq!(perms.mode() & 0o777, 0o600);
    }

    #[test]
    fn generate_ed25519_with_passphrase() {
        let (mgr, _dir) = test_manager();
        let input = GenerateKeyInput {
            name: "Passphrase Key".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: Some("my-passphrase".into()),
        };
        let meta = mgr.generate(input).unwrap();
        assert!(meta.has_passphrase);
    }

    // ─── Generate RSA-4096 ───────────────────────────────────

    #[test]
    fn generate_rsa4096_creates_key() {
        let (mgr, _dir) = test_manager();
        let input = GenerateKeyInput {
            name: "Test RSA".into(),
            algorithm: KeyAlgorithm::Rsa4096,
            passphrase: None,
        };
        let meta = mgr.generate(input).unwrap();
        assert_eq!(meta.algorithm, KeyAlgorithm::Rsa4096);
        assert!(meta.fingerprint.starts_with("SHA256:"));
        // RSA keys may use ssh-rsa or rsa-sha2-256 depending on hash algorithm
        assert!(
            meta.public_key.starts_with("ssh-rsa ") || meta.public_key.starts_with("rsa-sha2-256 "),
            "Expected RSA public key prefix, got: {}",
            &meta.public_key[..meta.public_key.len().min(20)]
        );
    }

    // ─── Fingerprint ─────────────────────────────────────────

    #[test]
    fn fingerprint_format_is_sha256_base64() {
        let (mgr, _dir) = test_manager();
        let input = GenerateKeyInput {
            name: "FP Test".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        };
        let meta = mgr.generate(input).unwrap();
        assert!(meta.fingerprint.starts_with("SHA256:"));
        // SHA256 hash = 32 bytes → base64 = 43 chars (without padding)
        let fp_b64 = meta.fingerprint.strip_prefix("SHA256:").unwrap();
        assert!(fp_b64.len() >= 40); // base64 of 32 bytes
    }

    #[test]
    fn two_different_keys_have_different_fingerprints() {
        let (mgr, _dir) = test_manager();
        let meta1 = mgr
            .generate(GenerateKeyInput {
                name: "Key 1".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();
        let meta2 = mgr
            .generate(GenerateKeyInput {
                name: "Key 2".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();
        assert_ne!(meta1.fingerprint, meta2.fingerprint);
    }

    // ─── Delete ──────────────────────────────────────────────

    #[test]
    fn delete_removes_key_from_index() {
        let (mgr, _dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "To Delete".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        mgr.delete(&meta.id).unwrap();
        assert!(mgr.list().unwrap().is_empty());
    }

    #[test]
    fn delete_removes_key_file() {
        let (mgr, dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "File Delete".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        let key_path = dir.path().join(format!("{}.key", meta.id));
        assert!(key_path.exists());

        mgr.delete(&meta.id).unwrap();
        assert!(!key_path.exists());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let (mgr, _dir) = test_manager();
        let result = mgr.delete("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result, Err(KeyError::NotFound(_))));
    }

    #[test]
    fn delete_invalid_uuid_returns_error() {
        let (mgr, _dir) = test_manager();
        let result = mgr.delete("not-a-uuid");
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    // ─── Get public key ──────────────────────────────────────

    #[test]
    fn get_public_key_returns_openssh_format() {
        let (mgr, _dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "PubKey Test".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        let pub_key = mgr.get_public_key(&meta.id).unwrap();
        assert!(pub_key.starts_with("ssh-ed25519 "));
    }

    #[test]
    fn get_public_key_nonexistent_returns_not_found() {
        let (mgr, _dir) = test_manager();
        let result = mgr.get_public_key("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result, Err(KeyError::NotFound(_))));
    }

    // ─── Get key path (Rust-only) ────────────────────────────

    #[test]
    fn get_key_path_returns_valid_path() {
        let (mgr, _dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "Path Test".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        let path = mgr.get_key_path(&meta.id).unwrap();
        assert!(path.exists());
        assert!(path.to_str().unwrap().ends_with(".key"));
    }

    #[test]
    fn get_key_path_nonexistent_returns_not_found() {
        let (mgr, _dir) = test_manager();
        let result = mgr.get_key_path("550e8400-e29b-41d4-a716-446655440000");
        assert!(matches!(result, Err(KeyError::NotFound(_))));
    }

    // ─── Validation ──────────────────────────────────────────

    #[test]
    fn generate_empty_name_rejected() {
        let (mgr, _dir) = test_manager();
        let result = mgr.generate(GenerateKeyInput {
            name: "".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    #[test]
    fn generate_name_with_path_separator_rejected() {
        let (mgr, _dir) = test_manager();
        let result = mgr.generate(GenerateKeyInput {
            name: "key/name".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    #[test]
    fn generate_trims_name_whitespace() {
        let (mgr, _dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "  My Key  ".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();
        assert_eq!(meta.name, "My Key");
    }

    // ─── Persistence roundtrip ───────────────────────────────

    #[test]
    fn index_persists_and_reloads() {
        let dir = tempfile::tempdir().unwrap();

        // Generate a key
        {
            let mgr = KeyManager::with_dir(dir.path().to_path_buf());
            mgr.generate(GenerateKeyInput {
                name: "Persist Test".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();
        }

        // Reload from disk
        let mgr2 = KeyManager::with_dir(dir.path().to_path_buf());
        let keys = mgr2.list().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].name, "Persist Test");
    }

    // ─── Max keys limit ──────────────────────────────────────

    #[test]
    fn max_keys_limit_rejects_above_500() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = KeyManager::with_dir(dir.path().to_path_buf());

        // Manually fill the index to max
        {
            let mut index = mgr.lock_index().unwrap();
            for i in 0..MAX_KEYS {
                index.keys.push(SSHKeyMeta {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: format!("Key {i}"),
                    algorithm: KeyAlgorithm::Ed25519,
                    fingerprint: format!("SHA256:fake{i}"),
                    public_key: format!("ssh-ed25519 fake{i}"),
                    has_passphrase: false,
                    passphrase_credential_id: None,
                    imported_from: None,
                    created_at: "2024-01-01T00:00:00Z".into(),
                });
            }
        }

        let result = mgr.generate(GenerateKeyInput {
            name: "One Too Many".into(),
            algorithm: KeyAlgorithm::Ed25519,
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
        assert!(result.unwrap_err().to_string().contains("500"));
    }

    // ─── Import ──────────────────────────────────────────────

    // Note: Import tests require valid key PEM data. We generate a key first,
    // then read the file to get valid PEM for import testing.

    #[test]
    fn import_rejects_empty_pem() {
        let (mgr, _dir) = test_manager();
        let result = mgr.import(ImportKeyInput {
            name: "Bad Import".into(),
            private_key_pem: "".into(),
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    #[test]
    fn import_rejects_non_pem_data() {
        let (mgr, _dir) = test_manager();
        let result = mgr.import(ImportKeyInput {
            name: "Bad Import".into(),
            private_key_pem: "not a key at all".into(),
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    #[test]
    fn import_valid_key_from_generated() {
        let (mgr, dir) = test_manager();

        // First generate a key so we have valid PEM
        let gen_meta = mgr
            .generate(GenerateKeyInput {
                name: "Source Key".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        // Read the generated key file
        let key_path = dir.path().join(format!("{}.key", gen_meta.id));
        let pem = fs::read_to_string(&key_path).unwrap();

        // Import the same PEM
        let import_meta = mgr
            .import(ImportKeyInput {
                name: "Imported Copy".into(),
                private_key_pem: pem,
                passphrase: None,
            })
            .unwrap();

        assert_eq!(import_meta.name, "Imported Copy");
        assert_eq!(import_meta.algorithm, KeyAlgorithm::Ed25519);
        assert!(import_meta.fingerprint.starts_with("SHA256:"));
        // Same key material → same fingerprint
        assert_eq!(import_meta.fingerprint, gen_meta.fingerprint);

        // Should now have 2 keys
        assert_eq!(mgr.list().unwrap().len(), 2);
    }

    #[test]
    fn import_empty_name_rejected() {
        let (mgr, _dir) = test_manager();
        let result = mgr.import(ImportKeyInput {
            name: "".into(),
            private_key_pem: "-----BEGIN OPENSSH PRIVATE KEY-----\ndata".into(),
            passphrase: None,
        });
        assert!(matches!(result, Err(KeyError::InvalidInput(_))));
    }

    // ─── Security: private key never in meta ─────────────────

    #[test]
    fn meta_serialization_has_no_private_key() {
        let (mgr, _dir) = test_manager();
        let meta = mgr
            .generate(GenerateKeyInput {
                name: "Security Test".into(),
                algorithm: KeyAlgorithm::Ed25519,
                passphrase: None,
            })
            .unwrap();

        let json = serde_json::to_string(&meta).unwrap();
        assert!(!json.contains("PRIVATE KEY"));
        assert!(!json.contains("privateKey"));
        assert!(!json.contains("private_key"));
    }
}
