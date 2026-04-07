/// Remote path validation for SFTP operations.
///
/// Prevents path traversal attacks, null byte injection, and other
/// dangerous path patterns before they reach the remote server.
///
/// Design: Defense-in-depth — even though the remote server should
/// reject malicious paths, we validate locally to prevent abuse and
/// provide clear error messages to the user.

/// Maximum allowed path length (bytes).
const MAX_PATH_LENGTH: usize = 4096;

/// Validates a remote SFTP path for safety.
///
/// # Rules
/// - Must not be empty
/// - Must be absolute (start with `/`)
/// - Must not contain null bytes
/// - Must not contain `..` path components (traversal)
/// - Must not exceed 4096 bytes
/// - Must not contain control characters (0x00–0x1F except tab)
///
/// # Returns
/// `Ok(())` if the path is valid, `Err(String)` with a description otherwise.
pub fn validate_remote_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Remote path cannot be empty".into());
    }

    if path.len() > MAX_PATH_LENGTH {
        return Err(format!(
            "Remote path exceeds maximum length of {MAX_PATH_LENGTH} bytes"
        ));
    }

    if !path.starts_with('/') {
        return Err(format!(
            "Remote path must be absolute (start with /): {path}"
        ));
    }

    if path.contains('\0') {
        return Err("Remote path must not contain null bytes".into());
    }

    // Check for control characters (0x01–0x1F, excluding tab 0x09)
    for (i, byte) in path.bytes().enumerate() {
        if byte < 0x20 && byte != b'\t' {
            return Err(format!(
                "Remote path contains control character at position {i}"
            ));
        }
    }

    // Check for path traversal via `..` components
    for component in path.split('/') {
        if component == ".." {
            return Err(
                "Remote path must not contain '..' (path traversal)"
                    .into(),
            );
        }
    }

    Ok(())
}

/// Normalizes a remote path by collapsing redundant separators
/// and removing trailing slashes (except for root `/`).
///
/// Does NOT resolve `..` — that's the validation step's job to reject.
pub fn normalize_remote_path(path: &str) -> String {
    let parts: Vec<&str> =
        path.split('/').filter(|p| !p.is_empty()).collect();

    if parts.is_empty() {
        return "/".to_string();
    }

    format!("/{}", parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_remote_path: valid paths ────────────────────────

    #[test]
    fn accepts_root_path() {
        assert!(validate_remote_path("/").is_ok());
    }

    #[test]
    fn accepts_simple_absolute_path() {
        assert!(validate_remote_path("/home/user").is_ok());
    }

    #[test]
    fn accepts_deep_nested_path() {
        assert!(validate_remote_path("/a/b/c/d/e/f/g").is_ok());
    }

    #[test]
    fn accepts_path_with_dots_in_filename() {
        assert!(
            validate_remote_path("/home/user/.bashrc").is_ok()
        );
    }

    #[test]
    fn accepts_path_with_spaces() {
        assert!(
            validate_remote_path("/home/user/my documents")
                .is_ok()
        );
    }

    #[test]
    fn accepts_path_with_single_dot() {
        assert!(
            validate_remote_path("/home/user/./file.txt").is_ok()
        );
    }

    #[test]
    fn accepts_path_with_tab_character() {
        assert!(
            validate_remote_path("/home/user/file\twith\ttabs")
                .is_ok()
        );
    }

    // ── validate_remote_path: rejected paths ─────────────────────

    #[test]
    fn rejects_empty_path() {
        let err = validate_remote_path("").unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn rejects_relative_path() {
        let err =
            validate_remote_path("home/user").unwrap_err();
        assert!(err.contains("absolute"));
    }

    #[test]
    fn rejects_path_with_traversal_at_start() {
        let err =
            validate_remote_path("/../etc/passwd").unwrap_err();
        assert!(err.contains(".."));
    }

    #[test]
    fn rejects_path_with_traversal_in_middle() {
        let err =
            validate_remote_path("/home/../etc/passwd")
                .unwrap_err();
        assert!(err.contains(".."));
    }

    #[test]
    fn rejects_path_with_traversal_at_end() {
        let err =
            validate_remote_path("/home/user/..").unwrap_err();
        assert!(err.contains(".."));
    }

    #[test]
    fn rejects_path_with_null_byte() {
        let err =
            validate_remote_path("/home/user\0/file")
                .unwrap_err();
        assert!(err.contains("null"));
    }

    #[test]
    fn rejects_path_exceeding_max_length() {
        let long_path =
            format!("/{}", "a".repeat(MAX_PATH_LENGTH));
        let err =
            validate_remote_path(&long_path).unwrap_err();
        assert!(err.contains("maximum length"));
    }

    #[test]
    fn accepts_path_at_max_length() {
        // Path exactly at limit (including the leading /)
        let path = format!("/{}", "a".repeat(MAX_PATH_LENGTH - 1));
        assert_eq!(path.len(), MAX_PATH_LENGTH);
        assert!(validate_remote_path(&path).is_ok());
    }

    #[test]
    fn rejects_path_with_control_character() {
        let err =
            validate_remote_path("/home/user/\x01file")
                .unwrap_err();
        assert!(err.contains("control character"));
    }

    #[test]
    fn rejects_path_with_bell_character() {
        let err =
            validate_remote_path("/home/\x07bell")
                .unwrap_err();
        assert!(err.contains("control character"));
    }

    #[test]
    fn double_dot_in_filename_is_ok() {
        // "..." or "..hidden" are NOT traversal — only bare ".." is
        assert!(
            validate_remote_path("/home/user/...").is_ok()
        );
        assert!(
            validate_remote_path("/home/user/..hidden").is_ok()
        );
    }

    // ── normalize_remote_path ────────────────────────────────────

    #[test]
    fn normalize_root() {
        assert_eq!(normalize_remote_path("/"), "/");
    }

    #[test]
    fn normalize_removes_trailing_slash() {
        assert_eq!(
            normalize_remote_path("/home/user/"),
            "/home/user"
        );
    }

    #[test]
    fn normalize_collapses_double_slashes() {
        assert_eq!(
            normalize_remote_path("/home//user///files"),
            "/home/user/files"
        );
    }

    #[test]
    fn normalize_preserves_valid_path() {
        assert_eq!(
            normalize_remote_path("/home/user/file.txt"),
            "/home/user/file.txt"
        );
    }

    #[test]
    fn normalize_empty_returns_root() {
        assert_eq!(normalize_remote_path(""), "/");
    }
}
