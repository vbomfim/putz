/// Credential vault data models.
///
/// These types are serialized to/from JSON for persistence (vault-index.json)
/// and cross the IPC boundary to the React frontend.
///
/// SECURITY:
/// - `CredentialMeta` contains NO secrets — safe for listing and indexing.
/// - `Credential` contains the secret — only used for the editor IPC and
///   backend-only `get_for_session`.
/// - `KeyringEntry` is serialized into the OS keychain — never persisted to disk.
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// The type of credential stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    Password,
    KeyPassphrase,
}

/// Metadata for a stored credential — NO secrets.
///
/// Persisted to vault-index.json and returned by `vault_list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMeta {
    pub id: String,
    pub name: String,
    pub username: String,
    pub credential_type: CredentialType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// ISO 8601 timestamp when this credential expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Number of days between credential rotations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_days: Option<u32>,
}

/// Full credential including the secret.
///
/// SECURITY: This type contains the plaintext secret. It must:
/// - Only be returned via `vault_get` IPC (for the editor) or `get_for_session` (Rust-only)
/// - Never be logged, serialized to disk, or included in error messages
/// - Be zeroized when no longer needed
/// - Custom `Debug` impl masks the secret field as `[REDACTED]`
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    pub meta: CredentialMeta,
    pub secret: String,
}

impl fmt::Debug for Credential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credential")
            .field("meta", &self.meta)
            .field("secret", &"[REDACTED]")
            .finish()
    }
}

impl Drop for Credential {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

/// What gets stored in the OS keychain, serialized as JSON.
///
/// The keychain entry key is the credential UUID, scoped to service "putz".
/// Custom `Debug` impl masks the secret field as `[REDACTED]`.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct KeyringEntry {
    pub username: String,
    pub secret: String,
    pub credential_type: CredentialType,
}

impl fmt::Debug for KeyringEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyringEntry")
            .field("username", &self.username)
            .field("secret", &"[REDACTED]")
            .field("credential_type", &self.credential_type)
            .finish()
    }
}

impl Drop for KeyringEntry {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

/// Top-level vault index persisted to vault-index.json.
///
/// Contains only metadata — NO secrets. Secrets live in the OS keychain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultIndex {
    pub version: u32,
    pub credentials: Vec<CredentialMeta>,
}

impl Default for VaultIndex {
    fn default() -> Self {
        Self {
            version: 1,
            credentials: Vec::new(),
        }
    }
}

/// Input DTO for creating or updating a credential via IPC.
///
/// If `id` is provided, it's an update. Otherwise, a new credential is created.
/// Custom `Debug` impl masks the secret field as `[REDACTED]`.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCredentialInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub username: String,
    pub secret: String,
    pub credential_type: CredentialType,
    /// ISO 8601 timestamp when this credential expires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// Number of days between credential rotations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_days: Option<u32>,
}

impl fmt::Debug for SetCredentialInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SetCredentialInput")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("username", &self.username)
            .field("secret", &"[REDACTED]")
            .field("credential_type", &self.credential_type)
            .field("expires_at", &self.expires_at)
            .field("rotation_days", &self.rotation_days)
            .finish()
    }
}

impl Drop for SetCredentialInput {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_type_serializes_snake_case() {
        let json = serde_json::to_string(&CredentialType::Password).unwrap();
        assert_eq!(json, r#""password""#);
    }

    #[test]
    fn credential_type_key_passphrase_serializes() {
        let json = serde_json::to_string(&CredentialType::KeyPassphrase).unwrap();
        assert_eq!(json, r#""key_passphrase""#);
    }

    #[test]
    fn credential_type_deserializes_snake_case() {
        let ct: CredentialType = serde_json::from_str(r#""password""#).unwrap();
        assert_eq!(ct, CredentialType::Password);
    }

    #[test]
    fn credential_type_roundtrip() {
        let ct = CredentialType::KeyPassphrase;
        let json = serde_json::to_string(&ct).unwrap();
        let restored: CredentialType = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, CredentialType::KeyPassphrase);
    }

    #[test]
    fn credential_meta_serializes_camel_case() {
        let meta = CredentialMeta {
            id: "test-id".into(),
            name: "DC1 Admin".into(),
            username: "admin".into(),
            credential_type: CredentialType::Password,
            last_used: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            expires_at: None,
            rotation_days: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("credentialType"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
        // last_used is None → should be omitted
        assert!(!json.contains("lastUsed"));
    }

    #[test]
    fn credential_meta_includes_last_used_when_some() {
        let meta = CredentialMeta {
            id: "test-id".into(),
            name: "Test".into(),
            username: "user".into(),
            credential_type: CredentialType::Password,
            last_used: Some("2024-06-15T10:30:00Z".into()),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            expires_at: None,
            rotation_days: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("lastUsed"));
        assert!(json.contains("2024-06-15T10:30:00Z"));
    }

    #[test]
    fn credential_meta_roundtrip() {
        let meta = CredentialMeta {
            id: "abc-123".into(),
            name: "My Credential".into(),
            username: "root".into(),
            credential_type: CredentialType::KeyPassphrase,
            last_used: Some("2024-06-01T12:00:00Z".into()),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-06-01T12:00:00Z".into(),
            expires_at: None,
            rotation_days: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let restored: CredentialMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "abc-123");
        assert_eq!(restored.name, "My Credential");
        assert_eq!(restored.credential_type, CredentialType::KeyPassphrase);
    }

    #[test]
    fn credential_serializes_with_secret() {
        let cred = Credential {
            meta: CredentialMeta {
                id: "c1".into(),
                name: "Test".into(),
                username: "admin".into(),
                credential_type: CredentialType::Password,
                last_used: None,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
                expires_at: None,
                rotation_days: None,
            },
            secret: "hunter2".into(),
        };
        let json = serde_json::to_string(&cred).unwrap();
        assert!(json.contains("secret"));
        assert!(json.contains("hunter2"));
    }

    #[test]
    fn vault_index_default_is_empty() {
        let index = VaultIndex::default();
        assert_eq!(index.version, 1);
        assert!(index.credentials.is_empty());
    }

    #[test]
    fn vault_index_roundtrip() {
        let index = VaultIndex {
            version: 1,
            credentials: vec![CredentialMeta {
                id: "c1".into(),
                name: "Test Cred".into(),
                username: "admin".into(),
                credential_type: CredentialType::Password,
                last_used: None,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
                expires_at: None,
                rotation_days: None,
            }],
        };
        let json = serde_json::to_string_pretty(&index).unwrap();
        let restored: VaultIndex = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.credentials.len(), 1);
        assert_eq!(restored.credentials[0].name, "Test Cred");
    }

    #[test]
    fn keyring_entry_roundtrip() {
        let entry = KeyringEntry {
            username: "admin".into(),
            secret: "s3cret".into(),
            credential_type: CredentialType::Password,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let restored: KeyringEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.username, "admin");
        assert_eq!(restored.secret, "s3cret");
        assert_eq!(restored.credential_type, CredentialType::Password);
    }

    #[test]
    fn set_credential_input_deserializes_create() {
        let json = r#"{"name":"Test","username":"admin","secret":"pass","credentialType":"password"}"#;
        let input: SetCredentialInput = serde_json::from_str(json).unwrap();
        assert!(input.id.is_none());
        assert_eq!(input.name, "Test");
        assert_eq!(input.credential_type, CredentialType::Password);
    }

    #[test]
    fn set_credential_input_deserializes_update() {
        let json = r#"{"id":"abc-123","name":"Updated","username":"root","secret":"newpass","credentialType":"key_passphrase"}"#;
        let input: SetCredentialInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.id, Some("abc-123".into()));
        assert_eq!(input.name, "Updated");
        assert_eq!(input.credential_type, CredentialType::KeyPassphrase);
    }

    #[test]
    fn credential_meta_no_secret_field() {
        // CredentialMeta must NEVER have a "secret" field — verify by serialization
        let meta = CredentialMeta {
            id: "id".into(),
            name: "name".into(),
            username: "user".into(),
            credential_type: CredentialType::Password,
            last_used: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            expires_at: None,
            rotation_days: None,
        };
        let json = serde_json::to_string(&meta).unwrap();
        // The JSON must not contain a "secret" key (credential_type: "password" is fine)
        assert!(!json.contains(r#""secret""#));
    }

    // ─── Custom Debug impls mask secrets ──────────────────────

    #[test]
    fn credential_debug_masks_secret() {
        let cred = Credential {
            meta: CredentialMeta {
                id: "c1".into(),
                name: "Test".into(),
                username: "admin".into(),
                credential_type: CredentialType::Password,
                last_used: None,
                created_at: "2024-01-01T00:00:00Z".into(),
                updated_at: "2024-01-01T00:00:00Z".into(),
                expires_at: None,
                rotation_days: None,
            },
            secret: "super_secret_password".into(),
        };
        let debug_str = format!("{:?}", cred);
        assert!(debug_str.contains("[REDACTED]"));
        assert!(!debug_str.contains("super_secret_password"));
    }

    #[test]
    fn keyring_entry_debug_masks_secret() {
        let entry = KeyringEntry {
            username: "admin".into(),
            secret: "keyring_secret_value".into(),
            credential_type: CredentialType::Password,
        };
        let debug_str = format!("{:?}", entry);
        assert!(debug_str.contains("[REDACTED]"));
        assert!(!debug_str.contains("keyring_secret_value"));
    }

    #[test]
    fn set_credential_input_debug_masks_secret() {
        let input = SetCredentialInput {
            id: None,
            name: "Test".into(),
            username: "user".into(),
            secret: "input_secret_value".into(),
            credential_type: CredentialType::Password,
            expires_at: None,
            rotation_days: None,
        };
        let debug_str = format!("{:?}", input);
        assert!(debug_str.contains("[REDACTED]"));
        assert!(!debug_str.contains("input_secret_value"));
        // Other fields should still be visible
        assert!(debug_str.contains("Test"));
        assert!(debug_str.contains("user"));
    }
}
