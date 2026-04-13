/// IPC commands for SSH key management operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `KeyManager`.
///
/// SECURITY:
/// - `key_list` returns metadata only — NO private key material.
/// - `key_get_public` returns only the public key.
/// - `get_key_path` is intentionally NOT exposed here — it's Rust-only.
/// - `key_generate` and `key_import` NEVER return private key data.
use tauri::State;

use crate::keys::{GenerateKeyInput, ImportKeyInput, KeyManager, SSHKeyMeta};

/// Lists all stored SSH keys (metadata only — NO private keys).
#[tauri::command]
pub fn key_list(state: State<'_, KeyManager>) -> Result<Vec<SSHKeyMeta>, String> {
    state.list().map_err(|e| e.to_string())
}

/// Generates a new SSH key pair.
///
/// Returns the key metadata (public key, fingerprint, algorithm).
/// The private key is stored on disk — NEVER returned via IPC.
#[tauri::command]
pub fn key_generate(
    state: State<'_, KeyManager>,
    input: GenerateKeyInput,
) -> Result<SSHKeyMeta, String> {
    state.generate(input).map_err(|e| e.to_string())
}

/// Imports an existing SSH private key.
///
/// Accepts PEM-encoded private key data. The key is stored in managed
/// storage — the original key data is NOT retained.
#[tauri::command]
pub fn key_import(
    state: State<'_, KeyManager>,
    input: ImportKeyInput,
) -> Result<SSHKeyMeta, String> {
    state.import(input).map_err(|e| e.to_string())
}

/// Deletes an SSH key from both the index and disk.
#[tauri::command]
pub fn key_delete(state: State<'_, KeyManager>, id: String) -> Result<(), String> {
    state.delete(&id).map_err(|e| e.to_string())
}

/// Gets the public key in OpenSSH format for a given key ID.
///
/// Used for "Copy Public Key" functionality — safe for clipboard.
/// SECURITY: Only returns the public key — private key stays on disk.
#[tauri::command]
pub fn key_get_public(state: State<'_, KeyManager>, id: String) -> Result<String, String> {
    state.get_public_key(&id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::keys::error::KeyError;

    #[test]
    fn key_error_to_string_format() {
        let err = KeyError::NotFound("key-123".into());
        let msg = err.to_string();
        assert!(msg.contains("key-123"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn key_error_invalid_input_format() {
        let err = KeyError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("bad data"));
    }

    #[test]
    fn key_error_crypto_format() {
        let err = KeyError::CryptoError("invalid key".into());
        let msg = err.to_string();
        assert!(msg.contains("Crypto error"));
    }
}
