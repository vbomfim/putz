/// SSH key data models.
///
/// These types are serialized to/from JSON for persistence (keys/index.json)
/// and cross the IPC boundary to the React frontend.
///
/// SECURITY:
/// - `SSHKeyMeta` contains NO private key material — safe for IPC listing.
/// - Private keys are NEVER loaded into these models — they stay on disk.
/// - Public keys and fingerprints are safe to expose to the frontend.
use serde::{Deserialize, Serialize};

/// Supported SSH key algorithms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KeyAlgorithm {
    #[serde(rename = "ed25519")]
    Ed25519,
    #[serde(rename = "rsa-4096")]
    Rsa4096,
}

impl std::fmt::Display for KeyAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ed25519 => write!(f, "ed25519"),
            Self::Rsa4096 => write!(f, "rsa-4096"),
        }
    }
}

/// Metadata for a stored SSH key — NO private key material.
///
/// Persisted to keys/index.json and returned by `key_list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SSHKeyMeta {
    pub id: String,
    pub name: String,
    pub algorithm: KeyAlgorithm,
    pub fingerprint: String,
    pub public_key: String,
    pub has_passphrase: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passphrase_credential_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_from: Option<String>,
    pub created_at: String,
}

/// Top-level key index persisted to keys/index.json.
///
/// Contains only metadata — NO private keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHKeyIndex {
    pub version: u32,
    pub keys: Vec<SSHKeyMeta>,
}

impl Default for SSHKeyIndex {
    fn default() -> Self {
        Self {
            version: 1,
            keys: Vec::new(),
        }
    }
}

/// Input DTO for generating a new SSH key via IPC.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyInput {
    pub name: String,
    pub algorithm: KeyAlgorithm,
    #[serde(default)]
    pub passphrase: Option<String>,
}

/// Input DTO for importing an existing SSH key via IPC.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportKeyInput {
    pub name: String,
    pub private_key_pem: String,
    #[serde(default)]
    pub passphrase: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── KeyAlgorithm ────────────────────────────────────────

    #[test]
    fn algorithm_serializes_kebab_case() {
        let json = serde_json::to_string(&KeyAlgorithm::Ed25519).unwrap();
        assert_eq!(json, r#""ed25519""#);
    }

    #[test]
    fn algorithm_rsa4096_serializes_kebab_case() {
        let json = serde_json::to_string(&KeyAlgorithm::Rsa4096).unwrap();
        assert_eq!(json, r#""rsa-4096""#);
    }

    #[test]
    fn algorithm_deserializes_kebab_case() {
        let alg: KeyAlgorithm = serde_json::from_str(r#""ed25519""#).unwrap();
        assert_eq!(alg, KeyAlgorithm::Ed25519);
    }

    #[test]
    fn algorithm_roundtrip() {
        let alg = KeyAlgorithm::Rsa4096;
        let json = serde_json::to_string(&alg).unwrap();
        let restored: KeyAlgorithm = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, KeyAlgorithm::Rsa4096);
    }

    #[test]
    fn algorithm_display() {
        assert_eq!(KeyAlgorithm::Ed25519.to_string(), "ed25519");
        assert_eq!(KeyAlgorithm::Rsa4096.to_string(), "rsa-4096");
    }

    // ─── SSHKeyMeta ──────────────────────────────────────────

    #[test]
    fn key_meta_serializes_camel_case() {
        let meta = SSHKeyMeta {
            id: "test-id".into(),
            name: "My Key".into(),
            algorithm: KeyAlgorithm::Ed25519,
            fingerprint: "SHA256:abc123".into(),
            public_key: "ssh-ed25519 AAAA...".into(),
            has_passphrase: false,
            passphrase_credential_id: None,
            imported_from: None,
            created_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("publicKey"));
        assert!(json.contains("hasPassphrase"));
        assert!(json.contains("createdAt"));
        // Optional None fields should be omitted
        assert!(!json.contains("passphraseCredentialId"));
        assert!(!json.contains("importedFrom"));
    }

    #[test]
    fn key_meta_includes_optional_fields_when_some() {
        let meta = SSHKeyMeta {
            id: "test-id".into(),
            name: "Imported Key".into(),
            algorithm: KeyAlgorithm::Rsa4096,
            fingerprint: "SHA256:def456".into(),
            public_key: "ssh-rsa AAAA...".into(),
            has_passphrase: true,
            passphrase_credential_id: Some("vault-id-123".into()),
            imported_from: Some("/home/user/.ssh/id_rsa".into()),
            created_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("passphraseCredentialId"));
        assert!(json.contains("vault-id-123"));
        assert!(json.contains("importedFrom"));
    }

    #[test]
    fn key_meta_roundtrip() {
        let meta = SSHKeyMeta {
            id: "abc-123".into(),
            name: "Test Key".into(),
            algorithm: KeyAlgorithm::Ed25519,
            fingerprint: "SHA256:test".into(),
            public_key: "ssh-ed25519 AAAA...".into(),
            has_passphrase: true,
            passphrase_credential_id: Some("cred-id".into()),
            imported_from: None,
            created_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let restored: SSHKeyMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "abc-123");
        assert_eq!(restored.name, "Test Key");
        assert_eq!(restored.algorithm, KeyAlgorithm::Ed25519);
        assert!(restored.has_passphrase);
        assert_eq!(restored.passphrase_credential_id, Some("cred-id".into()));
    }

    #[test]
    fn key_meta_no_private_key_field() {
        let meta = SSHKeyMeta {
            id: "id".into(),
            name: "name".into(),
            algorithm: KeyAlgorithm::Ed25519,
            fingerprint: "fp".into(),
            public_key: "pub".into(),
            has_passphrase: false,
            passphrase_credential_id: None,
            imported_from: None,
            created_at: "2024-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(!json.contains("privateKey"));
        assert!(!json.contains("private_key"));
    }

    // ─── SSHKeyIndex ─────────────────────────────────────────

    #[test]
    fn key_index_default_is_empty() {
        let index = SSHKeyIndex::default();
        assert_eq!(index.version, 1);
        assert!(index.keys.is_empty());
    }

    #[test]
    fn key_index_roundtrip() {
        let index = SSHKeyIndex {
            version: 1,
            keys: vec![SSHKeyMeta {
                id: "k1".into(),
                name: "Test".into(),
                algorithm: KeyAlgorithm::Ed25519,
                fingerprint: "SHA256:abc".into(),
                public_key: "ssh-ed25519 AAAA".into(),
                has_passphrase: false,
                passphrase_credential_id: None,
                imported_from: None,
                created_at: "2024-01-01T00:00:00Z".into(),
            }],
        };
        let json = serde_json::to_string_pretty(&index).unwrap();
        let restored: SSHKeyIndex = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.keys.len(), 1);
        assert_eq!(restored.keys[0].name, "Test");
    }

    // ─── GenerateKeyInput ────────────────────────────────────

    #[test]
    fn generate_input_deserializes() {
        let json = r#"{"name":"My Key","algorithm":"ed25519"}"#;
        let input: GenerateKeyInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "My Key");
        assert_eq!(input.algorithm, KeyAlgorithm::Ed25519);
        assert!(input.passphrase.is_none());
    }

    #[test]
    fn generate_input_with_passphrase() {
        let json = r#"{"name":"My Key","algorithm":"rsa-4096","passphrase":"secret"}"#;
        let input: GenerateKeyInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.algorithm, KeyAlgorithm::Rsa4096);
        assert_eq!(input.passphrase, Some("secret".into()));
    }

    // ─── ImportKeyInput ──────────────────────────────────────

    #[test]
    fn import_input_deserializes() {
        let json =
            r#"{"name":"Imported","privateKeyPem":"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}"#;
        let input: ImportKeyInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "Imported");
        assert!(input.private_key_pem.contains("BEGIN OPENSSH"));
        assert!(input.passphrase.is_none());
    }

    #[test]
    fn import_input_with_passphrase() {
        let json = r#"{"name":"Encrypted","privateKeyPem":"pem-data","passphrase":"pass"}"#;
        let input: ImportKeyInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.passphrase, Some("pass".into()));
    }
}
