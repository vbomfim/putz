/// Keyring abstraction — OS-native credential storage.
///
/// Provides a trait `KeyringBackend` so the vault manager can be tested
/// without requiring actual OS keychain access (which needs Touch ID,
/// Windows Hello, etc. and won't work in CI).
///
/// SECURITY:
/// - All secrets are stored via the OS keychain (macOS Keychain, Windows
///   Credential Manager, Linux libsecret/kwallet).
/// - Service namespace is "putz" to avoid collisions.
/// - Secrets are zeroized in memory after use via Drop impls on model types.
use super::error::VaultError;

/// Trait abstracting OS keychain operations for testability.
///
/// Implementations must be Send + Sync for use behind Tauri's managed state.
pub trait KeyringBackend: Send + Sync {
    /// Stores a JSON-serialized entry in the keychain.
    fn store(&self, id: &str, entry_json: &str) -> Result<(), VaultError>;

    /// Retrieves a JSON-serialized entry from the keychain.
    fn retrieve(&self, id: &str) -> Result<String, VaultError>;

    /// Deletes an entry from the keychain.
    fn delete(&self, id: &str) -> Result<(), VaultError>;
}

/// Real OS keychain backend using the `keyring` crate.
///
/// Each credential is stored under service "putz" with the credential UUID as the key.
pub struct OsKeyring;

impl OsKeyring {
    /// The service name used for all keyring entries.
    const SERVICE: &'static str = "putz";

    /// Creates a keyring::Entry scoped to the "putz" service.
    fn entry(id: &str) -> Result<keyring::Entry, VaultError> {
        keyring::Entry::new(Self::SERVICE, id).map_err(|e| {
            VaultError::KeyringUnavailable(format!("Failed to create keyring entry: {e}"))
        })
    }

    /// Maps a keyring error to the appropriate VaultError variant.
    fn map_keyring_error(err: keyring::Error) -> VaultError {
        match err {
            keyring::Error::NoEntry => {
                VaultError::NotFound("Credential not found in keychain".into())
            }
            keyring::Error::NoStorageAccess(_) => {
                VaultError::AccessDenied("Keychain access denied by OS".into())
            }
            keyring::Error::PlatformFailure(_) => {
                VaultError::KeyringUnavailable("Keychain platform failure".into())
            }
            _ => VaultError::KeyringUnavailable(format!("Keychain error: {err}")),
        }
    }
}

impl KeyringBackend for OsKeyring {
    fn store(&self, id: &str, entry_json: &str) -> Result<(), VaultError> {
        let entry = Self::entry(id)?;
        entry
            .set_password(entry_json)
            .map_err(Self::map_keyring_error)
    }

    fn retrieve(&self, id: &str) -> Result<String, VaultError> {
        let entry = Self::entry(id)?;
        entry.get_password().map_err(Self::map_keyring_error)
    }

    fn delete(&self, id: &str) -> Result<(), VaultError> {
        let entry = Self::entry(id)?;
        entry
            .delete_credential()
            .map_err(Self::map_keyring_error)
    }
}

/// In-memory mock keyring for unit testing.
///
/// Stores entries in a `HashMap` behind a `Mutex` so tests don't need
/// OS keychain access.
#[cfg(test)]
pub mod mock {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    pub struct MockKeyring {
        entries: Mutex<HashMap<String, String>>,
        /// When true, all operations return AccessDenied (simulates locked keychain).
        pub force_error: Mutex<bool>,
    }

    impl MockKeyring {
        pub fn new() -> Self {
            Self {
                entries: Mutex::new(HashMap::new()),
                force_error: Mutex::new(false),
            }
        }

        /// Sets whether operations should fail with AccessDenied.
        #[allow(dead_code)]
        pub fn set_force_error(&self, force: bool) {
            *self.force_error.lock().unwrap() = force;
        }

        /// Returns the number of stored entries.
        #[allow(dead_code)]
        pub fn entry_count(&self) -> usize {
            self.entries.lock().unwrap().len()
        }
    }

    impl KeyringBackend for MockKeyring {
        fn store(&self, id: &str, entry_json: &str) -> Result<(), VaultError> {
            if *self.force_error.lock().unwrap() {
                return Err(VaultError::AccessDenied("Mock: access denied".into()));
            }
            self.entries
                .lock()
                .unwrap()
                .insert(id.to_string(), entry_json.to_string());
            Ok(())
        }

        fn retrieve(&self, id: &str) -> Result<String, VaultError> {
            if *self.force_error.lock().unwrap() {
                return Err(VaultError::AccessDenied("Mock: access denied".into()));
            }
            self.entries
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or_else(|| VaultError::NotFound(id.into()))
        }

        fn delete(&self, id: &str) -> Result<(), VaultError> {
            if *self.force_error.lock().unwrap() {
                return Err(VaultError::AccessDenied("Mock: access denied".into()));
            }
            self.entries
                .lock()
                .unwrap()
                .remove(id)
                .ok_or_else(|| VaultError::NotFound(id.into()))?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::MockKeyring;
    use super::*;

    #[test]
    fn mock_keyring_store_and_retrieve() {
        let kr = MockKeyring::new();
        kr.store("id1", r#"{"test":"value"}"#).unwrap();
        let result = kr.retrieve("id1").unwrap();
        assert_eq!(result, r#"{"test":"value"}"#);
    }

    #[test]
    fn mock_keyring_retrieve_not_found() {
        let kr = MockKeyring::new();
        let result = kr.retrieve("nonexistent");
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            VaultError::NotFound(_)
        ));
    }

    #[test]
    fn mock_keyring_delete() {
        let kr = MockKeyring::new();
        kr.store("id1", "data").unwrap();
        kr.delete("id1").unwrap();
        assert!(kr.retrieve("id1").is_err());
    }

    #[test]
    fn mock_keyring_delete_not_found() {
        let kr = MockKeyring::new();
        let result = kr.delete("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn mock_keyring_overwrite() {
        let kr = MockKeyring::new();
        kr.store("id1", "original").unwrap();
        kr.store("id1", "updated").unwrap();
        assert_eq!(kr.retrieve("id1").unwrap(), "updated");
    }

    #[test]
    fn mock_keyring_force_error() {
        let kr = MockKeyring::new();
        kr.set_force_error(true);

        assert!(kr.store("id1", "data").is_err());
        assert!(kr.retrieve("id1").is_err());
        assert!(kr.delete("id1").is_err());
    }

    #[test]
    fn mock_keyring_entry_count() {
        let kr = MockKeyring::new();
        assert_eq!(kr.entry_count(), 0);
        kr.store("a", "1").unwrap();
        kr.store("b", "2").unwrap();
        assert_eq!(kr.entry_count(), 2);
        kr.delete("a").unwrap();
        assert_eq!(kr.entry_count(), 1);
    }
}
