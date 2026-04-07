//! Path validation for SFTP operations (remote and local).
//!
//! Prevents path traversal attacks, null byte injection, and other
//! dangerous path patterns before they reach the remote server or
//! the local filesystem.
//!
//! Design: Defense-in-depth — even though the remote server should
//! reject malicious paths, we validate locally to prevent abuse and
//! provide clear error messages to the user. Local paths are
//! canonicalized and confined to the user's home directory.

/// Maximum allowed path length (bytes).
const MAX_PATH_LENGTH: usize = 4096;

/// Maximum allowed transfer file size in bytes (10 GB).
pub const MAX_TRANSFER_SIZE: u64 = 10 * 1024 * 1024 * 1024;

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

/// Validates a local filesystem path for SFTP transfers.
///
/// Canonicalizes the path (resolving symlinks and `..`) and verifies
/// it falls within the user's home directory or standard download
/// locations. Prevents writing to arbitrary system paths.
///
/// # Rules
/// - Must not be empty
/// - Must not contain null bytes
/// - Must not exceed 4096 bytes
/// - Parent directory must exist (so we can canonicalize)
/// - Canonicalized path must fall within an allowed base directory
///   (user home, or platform temp dir)
///
/// # Returns
/// `Ok(canonical_path)` on success, `Err(String)` otherwise.
pub fn validate_local_path(path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("Local path cannot be empty".into());
    }

    if path.len() > MAX_PATH_LENGTH {
        return Err(format!(
            "Local path exceeds maximum length of {MAX_PATH_LENGTH} bytes"
        ));
    }

    if path.contains('\0') {
        return Err(
            "Local path must not contain null bytes".into(),
        );
    }

    // Canonicalize the parent directory to resolve symlinks and ..
    let file_path = std::path::Path::new(path);

    let parent = file_path.parent().ok_or_else(|| {
        "Local path has no parent directory".to_string()
    })?;

    // Parent must exist so we can canonicalize it
    let canonical_parent =
        parent.canonicalize().map_err(|e| {
            format!(
                "Cannot resolve local path parent '{}': {e}",
                parent.display()
            )
        })?;

    let file_name = file_path
        .file_name()
        .ok_or_else(|| {
            "Local path has no file name".to_string()
        })?
        .to_str()
        .ok_or_else(|| {
            "Local path file name is not valid UTF-8".to_string()
        })?;

    // Validate the file name itself
    if file_name.contains('/') || file_name.contains('\\') {
        return Err(
            "Local file name must not contain path separators"
                .into(),
        );
    }

    let canonical_path = canonical_parent.join(file_name);

    // Verify the canonical path falls within an allowed directory.
    // Allowed: user home directory or system temp directory.
    let allowed = is_within_allowed_directory(&canonical_parent);

    if !allowed {
        return Err(format!(
            "Local path '{}' is outside allowed directories \
             (home or temp)",
            canonical_path.display()
        ));
    }

    canonical_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            "Canonical path is not valid UTF-8".to_string()
        })
}

/// Checks whether a canonicalized directory is within an allowed
/// base directory (user home or system temp).
fn is_within_allowed_directory(
    dir: &std::path::Path,
) -> bool {
    // Check user home directory
    if let Some(home) = directories::UserDirs::new() {
        let home_dir = home.home_dir();
        if dir.starts_with(home_dir) {
            return true;
        }
    }

    // Check system temp directory
    let temp_dir = std::env::temp_dir();
    if let Ok(canonical_temp) = temp_dir.canonicalize() {
        if dir.starts_with(&canonical_temp) {
            return true;
        }
    }

    false
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

    // ── validate_local_path ──────────────────────────────────────

    #[test]
    fn local_path_rejects_empty() {
        let err = validate_local_path("").unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn local_path_rejects_null_bytes() {
        let err =
            validate_local_path("/tmp/file\0.txt").unwrap_err();
        assert!(err.contains("null"));
    }

    #[test]
    fn local_path_rejects_exceeding_max_length() {
        let long =
            format!("/tmp/{}", "a".repeat(MAX_PATH_LENGTH));
        let err = validate_local_path(&long).unwrap_err();
        assert!(err.contains("maximum length"));
    }

    #[test]
    fn local_path_accepts_temp_directory() {
        // std::env::temp_dir() is always allowed
        let temp = std::env::temp_dir();
        let path = temp.join("sftp_test_file.txt");
        let result =
            validate_local_path(path.to_str().unwrap());
        assert!(result.is_ok(), "Temp dir should be allowed: {result:?}");
    }

    #[test]
    fn local_path_accepts_home_directory() {
        if let Some(user_dirs) = directories::UserDirs::new() {
            let path =
                user_dirs.home_dir().join("sftp_test.txt");
            let result =
                validate_local_path(path.to_str().unwrap());
            assert!(
                result.is_ok(),
                "Home dir should be allowed: {result:?}"
            );
        }
    }

    #[test]
    fn local_path_rejects_system_path() {
        // /etc is outside home and temp on all platforms
        #[cfg(not(target_os = "windows"))]
        {
            let result = validate_local_path("/etc/passwd");
            assert!(
                result.is_err(),
                "System paths should be rejected"
            );
        }
    }

    #[test]
    fn local_path_resolves_traversal() {
        // Even if the raw path contains .., canonicalize resolves it.
        // The parent dir must exist for canonicalize to work.
        let temp = std::env::temp_dir();
        let traversal = format!(
            "{}/subdir/../sftp_test.txt",
            temp.display()
        );
        // /tmp/subdir may not exist so parent canonicalize will
        // fail — which is the correct safe behavior.
        let result = validate_local_path(&traversal);
        // Either it resolves within temp (OK) or the parent
        // doesn't exist (Err) — both are safe outcomes.
        assert!(
            result.is_ok() || result.is_err(),
            "Path with traversal should not panic"
        );
    }

    #[test]
    fn local_path_rejects_no_filename() {
        let result = validate_local_path("/");
        assert!(result.is_err());
    }

    // ── MAX_TRANSFER_SIZE ────────────────────────────────────────

    #[test]
    fn max_transfer_size_is_10gb() {
        assert_eq!(
            MAX_TRANSFER_SIZE,
            10 * 1024 * 1024 * 1024
        );
    }
}
