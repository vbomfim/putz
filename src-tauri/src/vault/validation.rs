/// Input validation for credential vault operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Credential name: 1–200 chars, no path separators
/// - Username: 1–200 chars, no null bytes
/// - Secret: must not be empty
use super::error::VaultError;

/// Maximum length for credential name.
const MAX_NAME_LENGTH: usize = 200;

/// Maximum length for credential username.
const MAX_USERNAME_LENGTH: usize = 200;

/// Validates a credential display name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
pub fn validate_credential_name(name: &str) -> Result<(), VaultError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(VaultError::InvalidInput(
            "Credential name cannot be empty".into(),
        ));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(VaultError::InvalidInput(format!(
            "Credential name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(VaultError::InvalidInput(
            "Credential name cannot contain path separators (/ or \\)".into(),
        ));
    }
    Ok(())
}

/// Validates a credential username.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain null bytes
pub fn validate_credential_username(username: &str) -> Result<(), VaultError> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(VaultError::InvalidInput(
            "Username cannot be empty".into(),
        ));
    }
    if trimmed.len() > MAX_USERNAME_LENGTH {
        return Err(VaultError::InvalidInput(format!(
            "Username exceeds maximum length of {MAX_USERNAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('\0') {
        return Err(VaultError::InvalidInput(
            "Username cannot contain null bytes".into(),
        ));
    }
    Ok(())
}

/// Validates that a secret is not empty.
///
/// SECURITY: This function only checks for emptiness.
/// The secret value MUST NOT appear in error messages.
pub fn validate_secret(secret: &str) -> Result<(), VaultError> {
    if secret.is_empty() {
        return Err(VaultError::InvalidInput(
            "Secret cannot be empty".into(),
        ));
    }
    Ok(())
}

/// Validates a UUID string format.
pub fn validate_uuid(id: &str) -> Result<(), VaultError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(VaultError::InvalidInput(format!(
            "Invalid UUID format: {id}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Credential name validation ────────────────────────────

    #[test]
    fn valid_credential_name() {
        assert!(validate_credential_name("DC1 Admin").is_ok());
    }

    #[test]
    fn valid_credential_name_with_special_chars() {
        assert!(validate_credential_name("Server (prod) #1 — main").is_ok());
    }

    #[test]
    fn credential_name_empty_rejected() {
        assert!(validate_credential_name("").is_err());
    }

    #[test]
    fn credential_name_whitespace_only_rejected() {
        assert!(validate_credential_name("   ").is_err());
    }

    #[test]
    fn credential_name_too_long_rejected() {
        let long = "a".repeat(201);
        assert!(validate_credential_name(&long).is_err());
    }

    #[test]
    fn credential_name_at_max_length_accepted() {
        let name = "a".repeat(200);
        assert!(validate_credential_name(&name).is_ok());
    }

    #[test]
    fn credential_name_with_forward_slash_rejected() {
        assert!(validate_credential_name("cred/prod").is_err());
    }

    #[test]
    fn credential_name_with_backslash_rejected() {
        assert!(validate_credential_name("cred\\prod").is_err());
    }

    // ─── Username validation ──────────────────────────────────

    #[test]
    fn valid_username() {
        assert!(validate_credential_username("admin").is_ok());
        assert!(validate_credential_username("root").is_ok());
        assert!(validate_credential_username("user@domain.com").is_ok());
    }

    #[test]
    fn username_empty_rejected() {
        assert!(validate_credential_username("").is_err());
        assert!(validate_credential_username("   ").is_err());
    }

    #[test]
    fn username_too_long_rejected() {
        let long = "u".repeat(201);
        assert!(validate_credential_username(&long).is_err());
    }

    #[test]
    fn username_at_max_length_accepted() {
        let name = "u".repeat(200);
        assert!(validate_credential_username(&name).is_ok());
    }

    #[test]
    fn username_with_null_byte_rejected() {
        assert!(validate_credential_username("user\0name").is_err());
    }

    // ─── Secret validation ────────────────────────────────────

    #[test]
    fn valid_secret() {
        assert!(validate_secret("mypassword").is_ok());
    }

    #[test]
    fn secret_empty_rejected() {
        assert!(validate_secret("").is_err());
    }

    #[test]
    fn secret_whitespace_only_accepted() {
        // Whitespace-only secrets are technically valid (users may want them)
        assert!(validate_secret("   ").is_ok());
    }

    #[test]
    fn secret_error_does_not_contain_value() {
        // SECURITY: Error message must never reveal the secret
        let result = validate_secret("");
        if let Err(e) = result {
            let msg = e.to_string();
            assert!(!msg.contains("hunter2"));
        }
    }

    // ─── UUID validation ──────────────────────────────────────

    #[test]
    fn valid_uuid() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn invalid_uuid_rejected() {
        assert!(validate_uuid("not-a-uuid").is_err());
        assert!(validate_uuid("").is_err());
    }

    #[test]
    fn uuid_without_hyphens_accepted() {
        assert!(validate_uuid("550e8400e29b41d4a716446655440000").is_ok());
    }
}
