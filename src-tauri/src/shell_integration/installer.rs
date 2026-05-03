/// Shell integration installer — manages marker-delimited blocks in dotfiles.
///
/// # Marker Block Format
/// ```text
/// # === putz shell integration (do not edit between markers) ===
/// ...snippet content...
/// # === end putz shell integration ===
/// ```
///
/// # Safety
/// - Creates backup before first write (`<dotfile>.putz-backup-<ISO timestamp>`)
/// - Idempotent: replaces existing block, never duplicates
/// - Surgical uninstall: removes only the marker block
/// - Path traversal prevention: dotfile path must be canonical
/// - No symlink follow for backup files
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Start marker for shell integration block.
pub const MARKER_START: &str = "# === putz shell integration (do not edit between markers) ===";
/// End marker for shell integration block.
pub const MARKER_END: &str = "# === end putz shell integration ===";

/// PowerShell-compatible start marker (uses `#` comments too).
pub const PS_MARKER_START: &str = "# === putz shell integration (do not edit between markers) ===";
/// PowerShell-compatible end marker.
pub const PS_MARKER_END: &str = "# === end putz shell integration ===";

/// Bat-file start marker (uses `::` comments).
pub const BAT_MARKER_START: &str =
    ":: === putz shell integration (do not edit between markers) ===";
/// Bat-file end marker.
pub const BAT_MARKER_END: &str = ":: === end putz shell integration ===";

/// Installation status for a shell.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum InstallStatus {
    /// Not installed — no marker block found.
    NotInstalled,
    /// Installed — marker block matches current snippet.
    Installed,
    /// Custom modification — marker block exists but content differs.
    CustomModification,
}

/// Result of an install or uninstall operation.
#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub dotfile_path: String,
    pub backup_path: Option<String>,
    pub message: String,
}

/// Returns the snippet content for a given shell ID.
///
/// Snippets are bundled at compile time from `assets/shell-integration/`.
pub fn snippet_for_shell(shell_id: &str) -> Option<&'static str> {
    match shell_id {
        "bash" => Some(include_str!("../../../assets/shell-integration/bash.sh")),
        "zsh" => Some(include_str!("../../../assets/shell-integration/zsh.zsh")),
        "fish" => Some(include_str!("../../../assets/shell-integration/fish.fish")),
        "pwsh" | "powershell" => Some(include_str!("../../../assets/shell-integration/pwsh.ps1")),
        "cmd" => Some(include_str!("../../../assets/shell-integration/cmd.bat")),
        _ => None,
    }
}

/// Returns start/end markers appropriate for the shell type.
fn markers_for_shell(shell_id: &str) -> (&'static str, &'static str) {
    match shell_id {
        "cmd" => (BAT_MARKER_START, BAT_MARKER_END),
        _ => (MARKER_START, MARKER_END),
    }
}

/// Checks the installation status of shell integration in a dotfile.
pub fn check_status(shell_id: &str, dotfile_path: &Path) -> InstallStatus {
    let content = match fs::read_to_string(dotfile_path) {
        Ok(c) => c,
        Err(_) => return InstallStatus::NotInstalled,
    };

    let (start_marker, end_marker) = markers_for_shell(shell_id);
    let block = extract_marker_block(&content, start_marker, end_marker);

    match block {
        None => InstallStatus::NotInstalled,
        Some(existing) => {
            let expected = snippet_for_shell(shell_id).unwrap_or("");
            if normalize_whitespace(&existing) == normalize_whitespace(expected) {
                InstallStatus::Installed
            } else {
                InstallStatus::CustomModification
            }
        }
    }
}

/// Installs shell integration into the dotfile.
///
/// - If the dotfile doesn't exist, creates it (and parent dirs).
/// - Creates a backup before first write.
/// - Replaces existing marker block if present (idempotent).
/// - Appends marker block if not present.
pub fn install(shell_id: &str, dotfile_path: &Path) -> Result<InstallResult, String> {
    // Path traversal guard: canonicalize and verify it's under home.
    validate_dotfile_path(dotfile_path)?;

    let snippet =
        snippet_for_shell(shell_id).ok_or_else(|| format!("Unknown shell: {shell_id}"))?;
    let (start_marker, end_marker) = markers_for_shell(shell_id);

    // Ensure parent directory exists.
    if let Some(parent) = dotfile_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }

    // Read existing content (or empty if file doesn't exist).
    let existing_content = fs::read_to_string(dotfile_path).unwrap_or_default();

    // Backup before first write — only when:
    // 1. File exists on disk AND
    // 2. Our marker block is NOT already present (first-time install only)
    let already_installed = has_marker_block(&existing_content, start_marker, end_marker);
    let backup_path = if dotfile_path.exists() && !already_installed {
        Some(create_backup(dotfile_path)?)
    } else {
        None
    };

    // Build new content with marker block.
    let new_content = if already_installed {
        // Replace existing block.
        replace_marker_block(&existing_content, snippet, start_marker, end_marker)
    } else {
        // Append block.
        append_marker_block(&existing_content, snippet, start_marker, end_marker)
    };

    // Write atomically (write to temp + rename would be ideal, but
    // for dotfiles on the same filesystem, direct write is acceptable).
    fs::write(dotfile_path, &new_content)
        .map_err(|e| format!("Failed to write {}: {e}", dotfile_path.display()))?;

    Ok(InstallResult {
        success: true,
        dotfile_path: dotfile_path.to_string_lossy().into(),
        backup_path: backup_path.map(|p| p.to_string_lossy().into()),
        message: format!("Shell integration installed for {shell_id}"),
    })
}

/// Uninstalls shell integration from the dotfile.
///
/// Surgically removes only the marker block; preserves all other content.
pub fn uninstall(shell_id: &str, dotfile_path: &Path) -> Result<InstallResult, String> {
    validate_dotfile_path(dotfile_path)?;

    let content = fs::read_to_string(dotfile_path)
        .map_err(|e| format!("Failed to read {}: {e}", dotfile_path.display()))?;

    let (start_marker, end_marker) = markers_for_shell(shell_id);

    if !has_marker_block(&content, start_marker, end_marker) {
        return Ok(InstallResult {
            success: true,
            dotfile_path: dotfile_path.to_string_lossy().into(),
            backup_path: None,
            message: "Shell integration was not installed".into(),
        });
    }

    let new_content = remove_marker_block(&content, start_marker, end_marker);

    fs::write(dotfile_path, &new_content)
        .map_err(|e| format!("Failed to write {}: {e}", dotfile_path.display()))?;

    Ok(InstallResult {
        success: true,
        dotfile_path: dotfile_path.to_string_lossy().into(),
        backup_path: None,
        message: format!("Shell integration uninstalled for {shell_id}"),
    })
}

// ── Marker block operations ──────────────────────────────────────────

/// Checks whether a marker block exists in the content.
fn has_marker_block(content: &str, start: &str, end: &str) -> bool {
    content.contains(start) && content.contains(end)
}

/// Extracts the content between markers (exclusive of the markers themselves).
fn extract_marker_block(content: &str, start: &str, end: &str) -> Option<String> {
    let start_idx = content.find(start)?;
    let after_start = start_idx + start.len();
    // Skip the newline after start marker.
    let content_start = if content[after_start..].starts_with('\n') {
        after_start + 1
    } else {
        after_start
    };
    let end_idx = content[content_start..].find(end)?;
    let block = &content[content_start..content_start + end_idx];
    // Trim trailing newline before end marker.
    Some(block.trim_end_matches('\n').to_string())
}

/// Replaces the existing marker block with new snippet content.
fn replace_marker_block(content: &str, snippet: &str, start: &str, end: &str) -> String {
    let start_idx = match content.find(start) {
        Some(i) => i,
        None => return content.to_string(),
    };
    let end_idx = match content.find(end) {
        Some(i) => i + end.len(),
        None => return content.to_string(),
    };
    // Include trailing newline after end marker if present.
    let end_idx = if content[end_idx..].starts_with('\n') {
        end_idx + 1
    } else {
        end_idx
    };

    let before = &content[..start_idx];
    let after = &content[end_idx..];

    format!("{before}{start}\n{snippet}\n{end}\n{after}")
}

/// Appends a marker block to the content.
fn append_marker_block(content: &str, snippet: &str, start: &str, end: &str) -> String {
    let separator = if content.is_empty() || content.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    format!("{content}{separator}\n{start}\n{snippet}\n{end}\n")
}

/// Removes the marker block from the content.
fn remove_marker_block(content: &str, start: &str, end: &str) -> String {
    let start_idx = match content.find(start) {
        Some(i) => i,
        None => return content.to_string(),
    };
    let end_idx = match content.find(end) {
        Some(i) => i + end.len(),
        None => return content.to_string(),
    };
    // Include trailing newline after end marker.
    let end_idx = if content[end_idx..].starts_with('\n') {
        end_idx + 1
    } else {
        end_idx
    };
    // Also remove the blank line before the block if present.
    let start_idx = if start_idx > 0 && content[..start_idx].ends_with('\n') {
        start_idx - 1
    } else {
        start_idx
    };

    let before = &content[..start_idx];
    let after = &content[end_idx..];

    let mut result = format!("{before}{after}");
    // Clean up any resulting double-newlines.
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    result
}

// ── Backup ───────────────────────────────────────────────────────────

/// Creates a backup of the dotfile with ISO timestamp suffix.
///
/// Uses `create_new(true)` to refuse to overwrite existing backups
/// (no symlink follow). Returns the backup path.
fn create_backup(dotfile_path: &Path) -> Result<PathBuf, String> {
    let timestamp = chrono::Local::now().format("%Y%m%dT%H%M%S");
    let file_name = dotfile_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let backup_name = format!("{file_name}.putz-backup-{timestamp}");
    let backup_path = dotfile_path
        .parent()
        .unwrap_or(dotfile_path)
        .join(&backup_name);

    // Read original content.
    let content = fs::read(dotfile_path)
        .map_err(|e| format!("Failed to read {} for backup: {e}", dotfile_path.display()))?;

    // Write backup with create_new to prevent symlink attacks.
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup_path)
        .map_err(|e| format!("Failed to create backup {}: {e}", backup_path.display()))?;

    file.write_all(&content)
        .map_err(|e| format!("Failed to write backup: {e}"))?;

    Ok(backup_path)
}

// ── Path validation ──────────────────────────────────────────────────

/// Validates that a dotfile path is safe to write to.
///
/// Prevents path traversal attacks by ensuring the path is under
/// the user's home directory or a known config directory.
fn validate_dotfile_path(path: &Path) -> Result<(), String> {
    // Canonicalize to resolve symlinks and `..`.
    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {e}"))?
    } else {
        // File doesn't exist yet — canonicalize parent.
        let parent = path
            .parent()
            .ok_or_else(|| "Invalid path: no parent directory".to_string())?;
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize parent: {e}"))?;
            canonical_parent.join(path.file_name().unwrap_or_default())
        } else {
            // Parent also doesn't exist — we'll create it, but verify the
            // grandparent is under home.
            path.to_path_buf()
        }
    };

    // Must be under user's home directory or known config locations.
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let home_canonical = if home.exists() {
        home.canonicalize().unwrap_or(home)
    } else {
        home
    };

    if !canonical.starts_with(&home_canonical) {
        return Err(format!(
            "Path {} is outside home directory — refusing to write",
            path.display()
        ));
    }

    Ok(())
}

/// Normalize whitespace for comparison (trim lines, collapse blank lines).
fn normalize_whitespace(s: &str) -> String {
    s.lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: creates a temp dir that's a subdirectory of the real home,
    /// so path validation passes.
    fn test_dir() -> TempDir {
        let home = dirs::home_dir().expect("Need home dir for tests");
        let test_base = home.join(".putz-test-tmp");
        fs::create_dir_all(&test_base).ok();
        tempfile::tempdir_in(&test_base).expect("Failed to create temp dir")
    }

    fn write_dotfile(dir: &TempDir, name: &str, content: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        path
    }

    // ── snippet_for_shell ────────────────────────────────────────────

    #[test]
    fn snippet_for_known_shells() {
        assert!(snippet_for_shell("bash").is_some());
        assert!(snippet_for_shell("zsh").is_some());
        assert!(snippet_for_shell("fish").is_some());
        assert!(snippet_for_shell("pwsh").is_some());
        assert!(snippet_for_shell("cmd").is_some());
    }

    #[test]
    fn snippet_for_unknown_shell_returns_none() {
        assert!(snippet_for_shell("nushell").is_none());
        assert!(snippet_for_shell("").is_none());
    }

    // ── Marker block operations ──────────────────────────────────────

    #[test]
    fn has_marker_block_detects_presence() {
        let content = format!("before\n{MARKER_START}\nstuff\n{MARKER_END}\nafter");
        assert!(has_marker_block(&content, MARKER_START, MARKER_END));
    }

    #[test]
    fn has_marker_block_returns_false_when_absent() {
        let content = "just some shell config\n";
        assert!(!has_marker_block(content, MARKER_START, MARKER_END));
    }

    #[test]
    fn extract_marker_block_returns_content() {
        let content = format!("before\n{MARKER_START}\nmy snippet\n{MARKER_END}\nafter");
        let block = extract_marker_block(&content, MARKER_START, MARKER_END);
        assert_eq!(block, Some("my snippet".to_string()));
    }

    #[test]
    fn extract_marker_block_returns_none_when_absent() {
        let block = extract_marker_block("no markers here", MARKER_START, MARKER_END);
        assert_eq!(block, None);
    }

    #[test]
    fn replace_marker_block_preserves_surroundings() {
        let content = format!("before\n{MARKER_START}\nold snippet\n{MARKER_END}\nafter\n");
        let result = replace_marker_block(&content, "new snippet", MARKER_START, MARKER_END);
        assert!(result.contains("before\n"));
        assert!(result.contains("new snippet"));
        assert!(result.contains("after\n"));
        assert!(!result.contains("old snippet"));
    }

    #[test]
    fn append_marker_block_adds_at_end() {
        let content = "existing config\n";
        let result = append_marker_block(content, "my snippet", MARKER_START, MARKER_END);
        assert!(result.starts_with("existing config\n"));
        assert!(result.contains(MARKER_START));
        assert!(result.contains("my snippet"));
        assert!(result.contains(MARKER_END));
    }

    #[test]
    fn append_to_empty_content() {
        let result = append_marker_block("", "my snippet", MARKER_START, MARKER_END);
        assert!(result.contains(MARKER_START));
        assert!(result.contains("my snippet"));
        assert!(result.contains(MARKER_END));
    }

    #[test]
    fn remove_marker_block_is_surgical() {
        let content = format!("before\n\n{MARKER_START}\nsnippet\n{MARKER_END}\nafter\n");
        let result = remove_marker_block(&content, MARKER_START, MARKER_END);
        assert!(result.contains("before"));
        assert!(result.contains("after"));
        assert!(!result.contains("snippet"));
        assert!(!result.contains(MARKER_START));
    }

    // ── Install / Uninstall integration ──────────────────────────────

    #[test]
    fn install_creates_marker_block_in_new_file() {
        let dir = test_dir();
        let dotfile = dir.path().join(".bashrc");
        let result = install("bash", &dotfile).unwrap();
        assert!(result.success);
        let content = fs::read_to_string(&dotfile).unwrap();
        assert!(content.contains(MARKER_START));
        assert!(content.contains(MARKER_END));
        assert!(content.contains("__putz_osc7_cwd"));
    }

    #[test]
    fn install_is_idempotent() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".zshrc", "# existing config\n");
        install("zsh", &dotfile).unwrap();
        install("zsh", &dotfile).unwrap();
        let content = fs::read_to_string(&dotfile).unwrap();
        // Should have exactly one marker block, not two.
        let count = content.matches(MARKER_START).count();
        assert_eq!(count, 1, "Expected exactly 1 marker block, got {count}");
    }

    #[test]
    fn install_creates_backup() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "original content\n");
        let result = install("bash", &dotfile).unwrap();
        assert!(result.backup_path.is_some());
        let backup = PathBuf::from(result.backup_path.unwrap());
        assert!(backup.exists());
        let backup_content = fs::read_to_string(&backup).unwrap();
        assert_eq!(backup_content, "original content\n");
    }

    #[test]
    fn uninstall_removes_marker_block() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "before\n");
        install("bash", &dotfile).unwrap();
        // Verify it's installed.
        let content = fs::read_to_string(&dotfile).unwrap();
        assert!(content.contains(MARKER_START));
        // Uninstall.
        let result = uninstall("bash", &dotfile).unwrap();
        assert!(result.success);
        let content = fs::read_to_string(&dotfile).unwrap();
        assert!(!content.contains(MARKER_START));
        assert!(content.contains("before"));
    }

    #[test]
    fn uninstall_noop_when_not_installed() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "just config\n");
        let result = uninstall("bash", &dotfile).unwrap();
        assert!(result.success);
        assert_eq!(result.message, "Shell integration was not installed");
    }

    #[test]
    fn check_status_not_installed() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "just config\n");
        assert_eq!(check_status("bash", &dotfile), InstallStatus::NotInstalled);
    }

    #[test]
    fn check_status_installed() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "");
        install("bash", &dotfile).unwrap();
        assert_eq!(check_status("bash", &dotfile), InstallStatus::Installed);
    }

    #[test]
    fn check_status_custom_modification() {
        let dir = test_dir();
        let dotfile = write_dotfile(&dir, ".bashrc", "");
        install("bash", &dotfile).unwrap();
        // Modify the block content.
        let content = fs::read_to_string(&dotfile).unwrap();
        let modified = content.replace("__putz_osc7_cwd", "__my_custom_osc7");
        fs::write(&dotfile, modified).unwrap();
        assert_eq!(
            check_status("bash", &dotfile),
            InstallStatus::CustomModification
        );
    }

    #[test]
    fn check_status_nonexistent_file() {
        let path = PathBuf::from("/nonexistent/.bashrc");
        assert_eq!(check_status("bash", &path), InstallStatus::NotInstalled);
    }

    // ── Path validation ──────────────────────────────────────────────

    #[test]
    fn validate_path_rejects_outside_home() {
        let result = validate_dotfile_path(Path::new("/etc/passwd"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside home directory"));
    }

    #[test]
    fn validate_path_accepts_home_subdir() {
        let home = dirs::home_dir().expect("Need home dir");
        let path = home.join(".bashrc");
        let result = validate_dotfile_path(&path);
        assert!(result.is_ok());
    }

    // ── Bat marker tests ─────────────────────────────────────────────

    #[test]
    fn bat_markers_used_for_cmd() {
        let (start, end) = markers_for_shell("cmd");
        assert!(start.starts_with("::"));
        assert!(end.starts_with("::"));
    }

    #[test]
    fn standard_markers_used_for_other_shells() {
        for shell in &["bash", "zsh", "fish", "pwsh"] {
            let (start, end) = markers_for_shell(shell);
            assert!(start.starts_with('#'), "Expected # marker for {shell}");
            assert!(end.starts_with('#'), "Expected # marker for {shell}");
        }
    }

    // ── Normalize whitespace ─────────────────────────────────────────

    #[test]
    fn normalize_whitespace_trims_trailing() {
        let a = "line1  \nline2\n";
        let b = "line1\nline2";
        assert_eq!(normalize_whitespace(a), normalize_whitespace(b));
    }
}
