/// Input validation for SSH key operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Key name: 1–200 chars, no path separators
/// - Private key PEM: must not be empty, must look like PEM
use super::error::KeyError;

/// Maximum length for key display name.
const MAX_NAME_LENGTH: usize = 200;

/// Validates a key display name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
pub fn validate_key_name(name: &str) -> Result<(), KeyError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(KeyError::InvalidInput("Key name cannot be empty".into()));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(KeyError::InvalidInput(format!(
            "Key name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(KeyError::InvalidInput(
            "Key name cannot contain path separators (/ or \\)".into(),
        ));
    }
    Ok(())
}

/// Validates private key PEM content for import.
///
/// Rules:
/// - Must not be empty
/// - Must contain a PEM header marker
pub fn validate_private_key_pem(pem: &str) -> Result<(), KeyError> {
    if pem.trim().is_empty() {
        return Err(KeyError::InvalidInput(
            "Private key data cannot be empty".into(),
        ));
    }
    if !pem.contains("PRIVATE KEY") {
        return Err(KeyError::InvalidInput(
            "Invalid private key format: expected PEM-encoded key".into(),
        ));
    }
    Ok(())
}

/// Validates a UUID string format.
pub fn validate_uuid(id: &str) -> Result<(), KeyError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(KeyError::InvalidInput(format!("Invalid UUID format: {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Key name validation ─────────────────────────────────

    #[test]
    fn valid_key_name() {
        assert!(validate_key_name("Production Server").is_ok());
    }

    #[test]
    fn valid_key_name_with_special_chars() {
        assert!(validate_key_name("Server (prod) #1 — main").is_ok());
    }

    #[test]
    fn key_name_empty_rejected() {
        assert!(validate_key_name("").is_err());
    }

    #[test]
    fn key_name_whitespace_only_rejected() {
        assert!(validate_key_name("   ").is_err());
    }

    #[test]
    fn key_name_too_long_rejected() {
        let long = "a".repeat(201);
        assert!(validate_key_name(&long).is_err());
    }

    #[test]
    fn key_name_at_max_length_accepted() {
        let name = "a".repeat(200);
        assert!(validate_key_name(&name).is_ok());
    }

    #[test]
    fn key_name_with_forward_slash_rejected() {
        assert!(validate_key_name("key/prod").is_err());
    }

    #[test]
    fn key_name_with_backslash_rejected() {
        assert!(validate_key_name("key\\prod").is_err());
    }

    // ─── PEM validation ──────────────────────────────────────

    #[test]
    fn valid_pem_openssh() {
        assert!(validate_private_key_pem(
            "-----BEGIN OPENSSH PRIVATE KEY-----\ndata\n-----END OPENSSH PRIVATE KEY-----"
        )
        .is_ok());
    }

    #[test]
    fn valid_pem_rsa() {
        assert!(validate_private_key_pem(
            "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----"
        )
        .is_ok());
    }

    #[test]
    fn pem_empty_rejected() {
        assert!(validate_private_key_pem("").is_err());
    }

    #[test]
    fn pem_whitespace_only_rejected() {
        assert!(validate_private_key_pem("   ").is_err());
    }

    #[test]
    fn pem_no_header_rejected() {
        assert!(validate_private_key_pem("just some random data").is_err());
    }

    #[test]
    fn pem_public_key_rejected() {
        assert!(validate_private_key_pem("-----BEGIN PUBLIC KEY-----\ndata").is_err());
    }

    // ─── UUID validation ─────────────────────────────────────

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
