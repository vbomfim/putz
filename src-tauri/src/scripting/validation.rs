/// Input validation for scripting engine operations.
///
/// All IPC inputs are validated on the Rust side before processing.
/// Validation rules:
/// - Name: 1–200 chars, no path separators (`/`, `\`)
/// - Content: max 1 MB
/// - Script ID: UUID v4 format
use super::error::ScriptError;

/// Maximum length for script names.
const MAX_NAME_LENGTH: usize = 200;

/// Maximum script content size (1 MB).
const MAX_CONTENT_SIZE: usize = 1_048_576;

/// Maximum number of saved scripts.
pub const MAX_SCRIPTS: usize = 500;

/// Maximum concurrent script executions.
pub const MAX_CONCURRENT_RUNS: usize = 32;

/// Maximum sessions in a multi-run.
pub const MAX_MULTI_SESSIONS: usize = 64;

/// Validates a script name.
///
/// Rules:
/// - Must not be empty or whitespace-only
/// - Must not exceed 200 characters
/// - Must not contain path separators (`/`, `\`)
/// - Must not contain `..` (path traversal)
pub fn validate_name(name: &str) -> Result<(), ScriptError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ScriptError::InvalidInput(
            "Script name cannot be empty".into(),
        ));
    }
    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(ScriptError::InvalidInput(format!(
            "Script name exceeds maximum length of {MAX_NAME_LENGTH} characters"
        )));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(ScriptError::InvalidInput(
            "Script name cannot contain path separators (/ or \\)".into(),
        ));
    }
    if trimmed.contains("..") {
        return Err(ScriptError::InvalidInput(
            "Script name cannot contain '..' (path traversal)".into(),
        ));
    }
    Ok(())
}

/// Validates script content (JavaScript source code).
///
/// Rules:
/// - Must not be empty
/// - Must not exceed 1 MB
pub fn validate_content(content: &str) -> Result<(), ScriptError> {
    if content.trim().is_empty() {
        return Err(ScriptError::InvalidInput(
            "Script content cannot be empty".into(),
        ));
    }
    if content.len() > MAX_CONTENT_SIZE {
        return Err(ScriptError::InvalidInput(format!(
            "Script content exceeds maximum size of {} bytes",
            MAX_CONTENT_SIZE
        )));
    }
    Ok(())
}

/// Validates a UUID string format.
pub fn validate_uuid(id: &str) -> Result<(), ScriptError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(ScriptError::InvalidInput(format!(
            "Invalid UUID format: {id}"
        )));
    }
    Ok(())
}

/// Generates a safe filename from a script name.
///
/// Converts to lowercase, replaces spaces/special chars with hyphens,
/// removes consecutive hyphens, and appends `.js`.
pub fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // Remove consecutive hyphens and trim leading/trailing hyphens.
    let mut result = String::new();
    let mut prev_hyphen = false;
    for c in sanitized.chars() {
        if c == '-' {
            if !prev_hyphen && !result.is_empty() {
                result.push(c);
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }
    let result = result.trim_end_matches('-').to_string();

    if result.is_empty() {
        return "script.js".to_string();
    }

    format!("{result}.js")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Name validation ───────────────────────────────────────

    #[test]
    fn valid_name() {
        assert!(validate_name("Backup Config").is_ok());
    }

    #[test]
    fn valid_name_with_special_chars() {
        assert!(validate_name("Script #1 — login").is_ok());
    }

    #[test]
    fn name_empty_rejected() {
        assert!(validate_name("").is_err());
    }

    #[test]
    fn name_whitespace_only_rejected() {
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn name_too_long_rejected() {
        let long = "a".repeat(201);
        assert!(validate_name(&long).is_err());
    }

    #[test]
    fn name_at_max_length_accepted() {
        let name = "a".repeat(200);
        assert!(validate_name(&name).is_ok());
    }

    #[test]
    fn name_with_forward_slash_rejected() {
        assert!(validate_name("script/test").is_err());
    }

    #[test]
    fn name_with_backslash_rejected() {
        assert!(validate_name("script\\test").is_err());
    }

    #[test]
    fn name_with_path_traversal_rejected() {
        assert!(validate_name("..").is_err());
        assert!(validate_name("../etc").is_err());
    }

    // ─── Content validation ────────────────────────────────────

    #[test]
    fn valid_content() {
        assert!(validate_content("putz.send('hello');").is_ok());
    }

    #[test]
    fn content_empty_rejected() {
        assert!(validate_content("").is_err());
    }

    #[test]
    fn content_whitespace_only_rejected() {
        assert!(validate_content("   \n\t  ").is_err());
    }

    #[test]
    fn content_at_max_size_accepted() {
        let content = "a".repeat(MAX_CONTENT_SIZE);
        assert!(validate_content(&content).is_ok());
    }

    #[test]
    fn content_exceeding_max_rejected() {
        let content = "a".repeat(MAX_CONTENT_SIZE + 1);
        assert!(validate_content(&content).is_err());
    }

    // ─── UUID validation ───────────────────────────────────────

    #[test]
    fn valid_uuid() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn invalid_uuid_rejected() {
        assert!(validate_uuid("not-a-uuid").is_err());
        assert!(validate_uuid("").is_err());
    }

    // ─── Filename sanitization ─────────────────────────────────

    #[test]
    fn sanitize_simple_name() {
        assert_eq!(sanitize_filename("Backup Config"), "backup-config.js");
    }

    #[test]
    fn sanitize_name_with_special_chars() {
        assert_eq!(sanitize_filename("Script #1 (prod)"), "script-1-prod.js");
    }

    #[test]
    fn sanitize_name_with_multiple_spaces() {
        assert_eq!(
            sanitize_filename("my   great   script"),
            "my-great-script.js"
        );
    }

    #[test]
    fn sanitize_name_with_underscores() {
        assert_eq!(sanitize_filename("my_script_v2"), "my_script_v2.js");
    }

    #[test]
    fn sanitize_empty_name_returns_default() {
        assert_eq!(sanitize_filename(""), "script.js");
    }

    #[test]
    fn sanitize_all_special_chars_returns_default() {
        assert_eq!(sanitize_filename("!@#$%"), "script.js");
    }

    #[test]
    fn sanitize_preserves_hyphens() {
        assert_eq!(sanitize_filename("my-script"), "my-script.js");
    }

    #[test]
    fn sanitize_trims_whitespace() {
        assert_eq!(sanitize_filename("  my script  "), "my-script.js");
    }
}
