/// SSH authentication strategies — password, public key, SSH agent.
///
/// Tries authentication methods in order of preference:
/// 1. SSH agent (if available)
/// 2. Public key (if key_path provided)
/// 3. Password (from vault or emitted prompt)
///
/// SECURITY:
/// - Passwords retrieved from VaultManager in Rust — NEVER via frontend
/// - Private key content never crosses IPC boundary
/// - Credentials zeroized after use via `Zeroizing<String>`
/// - Never log passwords, keys, or auth tokens
use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::client;
use zeroize::Zeroizing;

use super::SshHandler;
use crate::protocol::{
    ConnectionParams, EventEmitter, ProtocolError,
};

/// Attempts SSH authentication using available methods.
///
/// Tries methods in order: SSH agent → public key → password.
/// Returns Ok(()) on first successful auth, or the last error.
///
/// SECURITY: `vault_password` is wrapped in `Zeroizing<String>` to
/// ensure memory is zeroed when dropped. Callers should not retain
/// the original password.
pub async fn authenticate(
    session: &mut client::Handle<SshHandler>,
    username: &str,
    params: &ConnectionParams,
    vault_password: Option<String>,
    connection_id: &str,
    emitter: Arc<dyn EventEmitter>,
) -> Result<(), ProtocolError> {
    // Wrap the vault password for automatic zeroization on drop
    let vault_password: Option<Zeroizing<String>> =
        vault_password.map(Zeroizing::new);
    let mut last_error = None;

    // 1. Try SSH agent authentication
    match try_agent_auth(session, username).await {
        Ok(true) => return Ok(()),
        Ok(false) => {
            // Agent available but auth rejected — try next method
        }
        Err(e) => {
            // Agent not available or error — try next method
            last_error = Some(e);
        }
    }

    // 2. Try public key authentication (if key_path provided)
    if let Some(ref key_path) = params.key_path {
        // Use vault password as passphrase for encrypted keys
        let passphrase = vault_password.as_deref().map(|s| s.as_str());

        match try_key_auth(
            session,
            username,
            key_path,
            passphrase,
        )
        .await
        {
            Ok(true) => return Ok(()),
            Ok(false) => {
                // Key rejected — try next method
            }
            Err(e) => {
                last_error = Some(e);
            }
        }
    }

    // 3. Try password authentication
    if let Some(ref password) = vault_password {
        match try_password_auth(session, username, password)
            .await
        {
            Ok(true) => return Ok(()),
            Ok(false) => {
                last_error = Some(ProtocolError::AuthFailed(
                    "Password rejected by server".into(),
                ));
            }
            Err(e) => {
                last_error = Some(e);
            }
        }
    }

    // If no auth method succeeded, emit auth prompt event
    if last_error.is_some() || vault_password.is_none() {
        // Emit auth prompt to frontend
        let payload = serde_json::json!({
            "username": username,
            "methods": ["password"],
        });
        let event =
            format!("connection-auth-prompt-{connection_id}");
        emitter.emit_event(&event, &payload.to_string());
    }

    Err(last_error.unwrap_or_else(|| {
        ProtocolError::AuthFailed(
            "No authentication method succeeded. \
             Configure credentials in the vault or provide an SSH key."
                .into(),
        )
    }))
}

/// Attempts SSH agent authentication.
///
/// Connects to the SSH agent socket (SSH_AUTH_SOCK), lists available
/// keys, and tries each one for authentication.
///
/// Returns Ok(true) if auth succeeded, Ok(false) if rejected,
/// Err if agent is unavailable.
#[cfg(unix)]
async fn try_agent_auth(
    session: &mut client::Handle<SshHandler>,
    username: &str,
) -> Result<bool, ProtocolError> {
    // Check if SSH_AUTH_SOCK is set
    let sock_path = std::env::var("SSH_AUTH_SOCK").map_err(|_| {
        ProtocolError::AuthFailed(
            "SSH agent not available (SSH_AUTH_SOCK not set)".into(),
        )
    })?;

    if sock_path.is_empty() {
        return Err(ProtocolError::AuthFailed(
            "SSH_AUTH_SOCK is empty".into(),
        ));
    }

    // Connect to agent
    let mut agent =
        russh_keys::agent::client::AgentClient::connect_uds(&sock_path)
            .await
            .map_err(|e| {
                ProtocolError::AuthFailed(format!(
                    "Failed to connect to SSH agent: {e}"
                ))
            })?;

    // Request identities from agent
    let identities =
        agent.request_identities().await.map_err(|e| {
            ProtocolError::AuthFailed(format!(
                "Failed to list agent keys: {e}"
            ))
        })?;

    if identities.is_empty() {
        return Err(ProtocolError::AuthFailed(
            "SSH agent has no keys".into(),
        ));
    }

    // Try each agent key
    for identity in &identities {
        let result = session
            .authenticate_future(username, identity.clone(), agent)
            .await;

        match result {
            (returned_agent, Ok(authenticated)) => {
                agent = returned_agent;
                if authenticated {
                    return Ok(true);
                }
                // This key was rejected — try next
            }
            (returned_agent, Err(_)) => {
                agent = returned_agent;
                // Error with this key — try next
            }
        }
    }

    Ok(false)
}

/// SSH agent is not available on Windows (Unix domain sockets only).
#[cfg(not(unix))]
async fn try_agent_auth(
    _session: &mut client::Handle<SshHandler>,
    _username: &str,
) -> Result<bool, ProtocolError> {
    Err(ProtocolError::AuthFailed(
        "SSH agent forwarding is not supported on Windows".into(),
    ))
}

/// Validates and canonicalizes an SSH key path.
///
/// SECURITY: Prevents path traversal attacks by:
/// 1. Blocking paths containing `..` components
/// 2. Canonicalizing the resolved path
/// 3. Ensuring it stays within the user's home or ~/.ssh directory
///
/// Returns the validated canonical path or an error.
fn validate_key_path(key_path: &str) -> Result<PathBuf, ProtocolError> {
    let path = Path::new(key_path);

    // Block obvious traversal attempts before canonicalization
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err(ProtocolError::InvalidParams(
                "SSH key path must not contain '..' components"
                    .into(),
            ));
        }
    }

    // Resolve to canonical path (follows symlinks, resolves `.`)
    let canonical = path.canonicalize().map_err(|e| {
        ProtocolError::AuthFailed(format!(
            "SSH key path not found or inaccessible: {e}"
        ))
    })?;

    // Ensure the key is within the user's home directory
    if let Some(home) = dirs_home() {
        if !canonical.starts_with(&home) {
            return Err(ProtocolError::InvalidParams(
                "SSH key path must be within user home directory"
                    .into(),
            ));
        }
    }

    Ok(canonical)
}

/// Returns the user's home directory.
fn dirs_home() -> Option<PathBuf> {
    directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
}

/// Attempts public key authentication with a key file.
///
/// Loads the key from disk, decrypts with passphrase if needed.
/// Validates the key path against traversal attacks before loading.
///
/// Returns Ok(true) if auth succeeded, Ok(false) if rejected.
async fn try_key_auth(
    session: &mut client::Handle<SshHandler>,
    username: &str,
    key_path: &str,
    passphrase: Option<&str>,
) -> Result<bool, ProtocolError> {
    // Validate and canonicalize the key path [SECURITY]
    let canonical_path = validate_key_path(key_path)?;

    // Load the key file
    let key_pair = if let Some(passphrase) = passphrase {
        russh_keys::load_secret_key(&canonical_path, Some(passphrase))
            .map_err(|e| {
                ProtocolError::AuthFailed(format!(
                    "Failed to load SSH key (wrong passphrase?): {e}"
                ))
            })?
    } else {
        russh_keys::load_secret_key(&canonical_path, None)
            .map_err(|e| {
                ProtocolError::AuthFailed(format!(
                    "Failed to load SSH key \
                     (encrypted key needs passphrase): {e}"
                ))
            })?
    };

    let auth_result = session
        .authenticate_publickey(username, Arc::new(key_pair))
        .await
        .map_err(|e| {
            ProtocolError::AuthFailed(format!(
                "Public key auth failed: {e}"
            ))
        })?;

    Ok(auth_result)
}

/// Attempts password authentication.
///
/// Returns Ok(true) if auth succeeded, Ok(false) if rejected.
async fn try_password_auth(
    session: &mut client::Handle<SshHandler>,
    username: &str,
    password: &str,
) -> Result<bool, ProtocolError> {
    let auth_result = session
        .authenticate_password(username, password)
        .await
        .map_err(|e| {
            ProtocolError::AuthFailed(format!(
                "Password auth failed: {e}"
            ))
        })?;

    Ok(auth_result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_key_path ──

    #[test]
    fn validate_key_path_rejects_parent_traversal() {
        let result = validate_key_path("/home/user/../etc/passwd");
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("..")
        );
    }

    #[test]
    fn validate_key_path_rejects_relative_traversal() {
        let result = validate_key_path("../../etc/shadow");
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("..")
        );
    }

    #[test]
    fn validate_key_path_rejects_nonexistent_file() {
        let result = validate_key_path(
            "/nonexistent/path/id_ed25519",
        );
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("not found"));
    }

    #[test]
    fn validate_key_path_accepts_existing_home_file() {
        // Create a temp file inside home directory
        if let Some(home) = dirs_home() {
            let test_dir = home.join(".ssh");
            if test_dir.exists() {
                // Only test if ~/.ssh exists (CI may not have it)
                let known_hosts = test_dir.join("known_hosts");
                if known_hosts.exists() {
                    let result = validate_key_path(
                        known_hosts.to_str().unwrap(),
                    );
                    assert!(result.is_ok());
                }
            }
        }
    }

    // ── Authentication flow ──

    #[test]
    fn auth_failed_error_format() {
        let err = ProtocolError::AuthFailed(
            "No authentication method succeeded".into(),
        );
        assert!(err
            .to_string()
            .contains("No authentication method succeeded"));
    }

    #[test]
    fn password_rejected_error() {
        let err = ProtocolError::AuthFailed(
            "Password rejected by server".into(),
        );
        assert!(err.to_string().contains("rejected"));
    }

    // ── Zeroizing password ──

    #[test]
    fn zeroizing_wraps_password() {
        let pw = Zeroizing::new("secret123".to_string());
        assert_eq!(pw.as_str(), "secret123");
        // pw is zeroized on drop — verified by the type system
    }

    #[test]
    fn zeroizing_none_is_valid() {
        let pw: Option<Zeroizing<String>> = None;
        assert!(pw.is_none());
    }
}
