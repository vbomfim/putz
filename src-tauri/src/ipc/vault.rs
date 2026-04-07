/// IPC commands for credential vault operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `VaultManager`.
///
/// SECURITY:
/// - `vault_get` returns the full credential (with secret) for the editor ONLY.
/// - `vault_list` returns metadata only — NO secrets.
/// - `get_for_session` is intentionally NOT exposed here — it's Rust-only.
use tauri::State;

use crate::vault::{Credential, CredentialMeta, SetCredentialInput, VaultManager};

/// Lists all stored credentials (metadata only — NO secrets).
#[tauri::command]
pub fn vault_list(
    state: State<'_, VaultManager>,
) -> Result<Vec<CredentialMeta>, String> {
    state.list().map_err(|e| e.to_string())
}

/// Gets a full credential (including secret) by ID.
///
/// Used by the credential editor form to display/edit the credential.
/// SECURITY: The secret crosses the IPC boundary here — acceptable for
/// the editor use case. `get_for_session` (backend-only) is the method
/// used by protocol implementations.
#[tauri::command]
pub fn vault_get(
    state: State<'_, VaultManager>,
    id: String,
) -> Result<Credential, String> {
    state.get(&id).map_err(|e| e.to_string())
}

/// Creates or updates a credential.
///
/// Returns the credential ID (generated for new, echoed for updates).
#[tauri::command]
pub fn vault_set(
    state: State<'_, VaultManager>,
    input: SetCredentialInput,
) -> Result<String, String> {
    state.set(input).map_err(|e| e.to_string())
}

/// Deletes a credential from both the index and the OS keychain.
#[tauri::command]
pub fn vault_delete(
    state: State<'_, VaultManager>,
    id: String,
) -> Result<(), String> {
    state.delete(&id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::vault::error::VaultError;

    #[test]
    fn vault_error_to_string_format() {
        let err = VaultError::NotFound("abc-123".into());
        let msg = err.to_string();
        assert!(msg.contains("abc-123"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn vault_error_invalid_input_format() {
        let err = VaultError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("bad data"));
    }

    #[test]
    fn vault_error_access_denied_format() {
        let err = VaultError::AccessDenied("user cancelled".into());
        let msg = err.to_string();
        assert!(msg.contains("Access denied"));
    }
}
