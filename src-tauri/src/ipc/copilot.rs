//! Copilot CLI integration — first-run discovery + extension install.
//!
//! Tauri commands the Settings UI uses to:
//!   1. Detect whether `gh copilot` is available on the user's PATH.
//!   2. Resolve the platform-specific install dir for the bundled
//!      `extensions/copilot-swarm/` colleague shim.
//!   3. Copy the bundled shim into that dir (with overwrite protection
//!      per spec SEC-006).
//!
//! Pure I/O — no shell-out except the `gh copilot` PATH probe (which
//! itself calls `--version` only, no user-controllable arguments).
//!
//! @privacy The functions here only handle filesystem paths — no PII.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

/// File names we expect inside a valid bundled extension source dir.
/// Used to harden [`copilot_install_extension`] against being pointed
/// at an arbitrary directory outside Putz's bundled resources.
const REQUIRED_FILES: &[&str] = &["index.mjs", "package.json", "manifest.json"];

/// Subdirectory name created inside Copilot's extensions dir.
pub const EXTENSION_DIR_NAME: &str = "putz-colleague";

/// Result of the install-status probe surfaced to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopilotIntegrationStatus {
    /// `true` when `gh copilot --version` exits 0.
    pub gh_copilot_available: bool,
    /// Resolved per-user extensions dir (may not exist yet).
    pub extension_dir: Option<String>,
    /// `true` when `EXTENSION_DIR_NAME` exists inside `extension_dir`.
    pub installed: bool,
}

/// Resolve the per-user Copilot CLI extensions directory.
///
/// Layout (matches the spec's first-run discovery section):
///   * Linux/macOS: `~/.local/share/gh/copilot-extensions/`
///   * Windows: `%LOCALAPPDATA%\GitHub CLI\copilot-extensions\`
///
/// Returns `None` if the home / local-app-data dir cannot be resolved.
pub fn resolve_extension_dir() -> Option<PathBuf> {
    if let Ok(over) = std::env::var("PUTZ_COLLEAGUE_DIR") {
        if !over.is_empty() {
            return Some(PathBuf::from(over));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.is_empty() {
                return Some(
                    PathBuf::from(local)
                        .join("GitHub CLI")
                        .join("copilot-extensions"),
                );
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("gh")
                .join("copilot-extensions"),
        )
    }
}

/// Probe `gh copilot --version`. Returns `true` if the binary is on
/// PATH and exits 0. Suppresses stdout/stderr.
fn probe_gh_copilot() -> bool {
    Command::new("gh")
        .args(["copilot", "--version"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Copy the contents of `source_dir` (the bundled extension) into
/// `target_dir/EXTENSION_DIR_NAME`. Refuses to overwrite when the
/// destination dir exists unless `overwrite` is set (SEC-006).
///
/// Returns the absolute install path on success.
pub fn install_extension(
    source_dir: &Path,
    target_root: &Path,
    overwrite: bool,
) -> io::Result<PathBuf> {
    validate_source_dir(source_dir)?;
    let dest = target_root.join(EXTENSION_DIR_NAME);
    if dest.exists() {
        if !overwrite {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "destination exists; set overwrite=true to replace",
            ));
        }
        // Best-effort cleanup of an existing install. We only remove a
        // dir whose name matches our marker — never a free-form path.
        if dest.is_dir() {
            fs::remove_dir_all(&dest)?;
        } else {
            fs::remove_file(&dest)?;
        }
    }
    fs::create_dir_all(&dest)?;
    copy_dir_recursive(source_dir, &dest)?;
    Ok(dest)
}

/// Validate that `source_dir` looks like our bundled extension. Catches
/// accidental misuse (e.g., a frontend bug that passes the wrong path)
/// before we copy arbitrary files into the user's home dir.
fn validate_source_dir(source_dir: &Path) -> io::Result<()> {
    if !source_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("source dir not found: {}", source_dir.display()),
        ));
    }
    for required in REQUIRED_FILES {
        if !source_dir.join(required).is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("source dir missing required file: {required}"),
            ));
        }
    }
    Ok(())
}

/// Recursively copy `src` into `dst`. Uses only `std::fs` — no shell-out,
/// no symlink following (defends against a malicious bundle being a
/// symlink to `/etc`, which can't happen for our bundled resources but
/// keeps the function safe to reuse).
fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_symlink() {
            // Skip symlinks deliberately.
            continue;
        }
        if ft.is_dir() {
            fs::create_dir_all(&to)?;
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// ─── Tauri commands ────────────────────────────────────────────────

/// `true` iff `gh copilot --version` succeeds. Cheap probe — safe to
/// call on every Settings open.
#[tauri::command]
pub fn copilot_check_installed() -> bool {
    probe_gh_copilot()
}

/// Resolved per-user extensions dir. May not exist yet.
#[tauri::command]
pub fn copilot_get_extension_dir() -> Option<String> {
    resolve_extension_dir().map(|p| p.to_string_lossy().to_string())
}

/// Aggregate status for the Settings card.
#[tauri::command]
pub fn copilot_get_status() -> CopilotIntegrationStatus {
    let extension_dir = resolve_extension_dir();
    let installed = extension_dir
        .as_ref()
        .map(|d| d.join(EXTENSION_DIR_NAME).is_dir())
        .unwrap_or(false);
    CopilotIntegrationStatus {
        gh_copilot_available: probe_gh_copilot(),
        extension_dir: extension_dir.map(|p| p.to_string_lossy().to_string()),
        installed,
    }
}

/// Install the bundled extension into the user's Copilot extensions dir.
///
/// `source_dir` MUST point at Putz's bundled `extensions/copilot-swarm/`
/// (resolved by the frontend via `tauri.conf.json` `bundle.resources`).
/// We validate the source structure before copying — see
/// [`validate_source_dir`].
///
/// Returns the absolute path of the new install on success.
#[tauri::command]
pub fn copilot_install_extension(
    source_dir: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let target = resolve_extension_dir().ok_or_else(|| {
        "Could not resolve Copilot extensions directory (HOME/LOCALAPPDATA unset)".to_string()
    })?;
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| format!("create target dir: {e}"))?;
    }
    install_extension(Path::new(&source_dir), &target, overwrite.unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("install failed: {e}"))
}

/// Remove the installed extension. Idempotent — succeeds if not present.
#[tauri::command]
pub fn copilot_uninstall_extension() -> Result<(), String> {
    let Some(target) = resolve_extension_dir() else {
        return Ok(()); // nothing to remove
    };
    let dest = target.join(EXTENSION_DIR_NAME);
    if !dest.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dest).map_err(|e| format!("uninstall failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    fn make_source(dir: &Path) {
        for f in REQUIRED_FILES {
            write(&dir.join(f), "x");
        }
        write(&dir.join("src/wire.mjs"), "y");
    }

    #[test]
    fn validate_source_rejects_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let err = validate_source_dir(dir.path()).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn validate_source_accepts_complete_dir() {
        let dir = tempfile::tempdir().unwrap();
        make_source(dir.path());
        validate_source_dir(dir.path()).unwrap();
    }

    #[test]
    fn install_copies_files_into_marker_subdir() {
        let src = tempfile::tempdir().unwrap();
        make_source(src.path());
        let target = tempfile::tempdir().unwrap();
        let installed = install_extension(src.path(), target.path(), false).unwrap();
        assert!(installed.ends_with(EXTENSION_DIR_NAME));
        assert!(installed.join("index.mjs").is_file());
        assert!(installed.join("src/wire.mjs").is_file());
    }

    #[test]
    fn install_refuses_to_overwrite_without_flag() {
        let src = tempfile::tempdir().unwrap();
        make_source(src.path());
        let target = tempfile::tempdir().unwrap();
        install_extension(src.path(), target.path(), false).unwrap();
        let err = install_extension(src.path(), target.path(), false).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn install_overwrites_when_flag_set() {
        let src = tempfile::tempdir().unwrap();
        make_source(src.path());
        let target = tempfile::tempdir().unwrap();
        install_extension(src.path(), target.path(), false).unwrap();
        // Modify source, reinstall with overwrite.
        write(&src.path().join("index.mjs"), "v2");
        let installed = install_extension(src.path(), target.path(), true).unwrap();
        let body = fs::read_to_string(installed.join("index.mjs")).unwrap();
        assert_eq!(body, "v2");
    }

    #[test]
    fn install_rejects_bad_source_dir() {
        let target = tempfile::tempdir().unwrap();
        let err = install_extension(Path::new("/this/path/does/not/exist"), target.path(), false)
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
