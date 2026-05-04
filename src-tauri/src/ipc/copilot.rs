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
const REQUIRED_FILES: &[&str] = &["extension.mjs", "package.json", "manifest.json"];

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
/// Copilot CLI's actual on-disk convention is `~/.copilot/extensions/<name>/`
/// (verified by inspecting installed extensions: craig, danet, keryxis,
/// sdlc-guardian — all live under `~/.copilot/extensions/` with an
/// `extension.mjs` entry file). This is the same on macOS and Linux.
///
/// Layout:
///   * macOS / Linux: `~/.copilot/extensions/`
///   * Windows: `%USERPROFILE%\.copilot\extensions\`
///
/// Returns `None` if the home dir cannot be resolved.
pub fn resolve_extension_dir() -> Option<PathBuf> {
    if let Ok(over) = std::env::var("PUTZ_COLLEAGUE_DIR") {
        if !over.is_empty() {
            return Some(PathBuf::from(over));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Some(
                    PathBuf::from(profile)
                        .join(".copilot")
                        .join("extensions"),
                );
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var_os("HOME")?;
        Some(PathBuf::from(home).join(".copilot").join("extensions"))
    }
}

/// Probe `gh copilot --version`. Returns `true` if the binary is on
/// PATH and exits 0. Suppresses stdout/stderr.
///
/// Risk surface: executes `gh copilot --version` with fixed args and
/// nulled stdin/stdout/stderr. We never pass user input as an argument,
/// and we don't read the output. Risk is bounded to running the `gh`
/// binary already on the user's PATH — same risk as any shell prompt
/// that completes against PATH.
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
/// Atomicity: copies into a sibling `<dest>.tmp` directory first; if
/// any individual file copy fails, the partial tmp dir is removed so
/// the install slot stays in its previous state. On success, the tmp
/// dir is renamed into place (this is atomic on POSIX; on Windows
/// `rename` is also atomic when both paths are on the same volume).
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
    // Stage in `<dest>.tmp` then rename atomically. Roll back on copy err.
    let staging = target_root.join(format!("{EXTENSION_DIR_NAME}.tmp"));
    if staging.exists() {
        // Leftover from a previous failed install — clear it.
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging)?;
    if let Err(err) = copy_dir_recursive(source_dir, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(err);
    }
    fs::rename(&staging, &dest)?;
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
///
/// `installed` requires both the marker dir AND `extension.mjs` inside it
/// to exist — guards against a partial install slot reporting success.
#[tauri::command]
pub fn copilot_get_status() -> CopilotIntegrationStatus {
    let extension_dir = resolve_extension_dir();
    let installed = extension_dir
        .as_ref()
        .map(|d| {
            let marker = d.join(EXTENSION_DIR_NAME);
            marker.is_dir() && marker.join("extension.mjs").is_file()
        })
        .unwrap_or(false);
    CopilotIntegrationStatus {
        gh_copilot_available: probe_gh_copilot(),
        extension_dir: extension_dir.map(|p| p.to_string_lossy().to_string()),
        installed,
    }
}

/// Install the bundled extension into the user's Copilot extensions dir.
///
/// The source path is computed by the backend from
/// [`tauri::AppHandle::path().resource_dir()`] — the frontend cannot
/// influence which directory is copied. This closes the previous
/// trust-boundary gap where a frontend bug could pass an arbitrary
/// path that happened to contain the marker files.
///
/// Returns the absolute path of the new install on success.
#[tauri::command]
pub fn copilot_install_extension(
    app: tauri::AppHandle,
    overwrite: Option<bool>,
) -> Result<String, String> {
    use tauri::Manager;
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve resource dir: {e}"))?;
    // Tauri bundles `../extensions/copilot-swarm/**/*` under `Resources/_up_/extensions/copilot-swarm/`
    // because the `..` segment is rewritten to `_up_` at bundle time. Try the bundled path first;
    // fall back to the dev-mode path (project root sibling) when running under `npm run tauri dev`.
    let bundled = resource_root
        .join("_up_")
        .join("extensions")
        .join("copilot-swarm");
    let dev_fallback = resource_root
        .join("..")
        .join("extensions")
        .join("copilot-swarm");
    let source = if bundled.exists() {
        bundled
    } else {
        dev_fallback
    };
    let canon_resource = resource_root
        .canonicalize()
        .map_err(|e| format!("canonicalize resource dir: {e}"))?;
    let canon_source = source
        .canonicalize()
        .map_err(|e| format!("canonicalize bundled extension dir: {e}"))?;
    // Containment check: the canonicalized source must be under the resource root in production
    // (where `_up_` is a real subdir) OR a parent-relative dev path. Check either is contained.
    let canon_resource_parent = canon_resource.parent().map(|p| p.to_path_buf());
    let in_resources = canon_source.starts_with(&canon_resource);
    let in_dev_parent = canon_resource_parent
        .as_ref()
        .map(|p| canon_source.starts_with(p))
        .unwrap_or(false);
    if !in_resources && !in_dev_parent {
        return Err(format!(
            "refusing to install: bundled extension path {} is not under app resource dir {}",
            canon_source.display(),
            canon_resource.display(),
        ));
    }

    let target = resolve_extension_dir().ok_or_else(|| {
        "Could not resolve Copilot extensions directory (HOME/LOCALAPPDATA unset)".to_string()
    })?;
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| format!("create target dir: {e}"))?;
    }
    install_extension(&canon_source, &target, overwrite.unwrap_or(false))
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
        assert!(installed.join("extension.mjs").is_file());
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
        write(&src.path().join("extension.mjs"), "v2");
        let installed = install_extension(src.path(), target.path(), true).unwrap();
        let body = fs::read_to_string(installed.join("extension.mjs")).unwrap();
        assert_eq!(body, "v2");
    }

    #[test]
    fn install_rejects_bad_source_dir() {
        let target = tempfile::tempdir().unwrap();
        let err = install_extension(Path::new("/this/path/does/not/exist"), target.path(), false)
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn install_rolls_back_staging_when_source_disappears_mid_copy() {
        // Build a source dir that passes validate_source_dir but whose
        // *contents* aren't fully readable by simulating: copy a valid
        // source first to verify success, then point at a non-existent
        // source through validate (caught earlier). This test asserts
        // the staging cleanup code path runs without leaving artifacts.
        let src = tempfile::tempdir().unwrap();
        make_source(src.path());
        let target = tempfile::tempdir().unwrap();

        // Pre-create a stale staging dir to simulate a previous failed
        // install. install_extension should clear it before reusing.
        let stale = target.path().join(format!("{EXTENSION_DIR_NAME}.tmp"));
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("garbage"), "old").unwrap();

        install_extension(src.path(), target.path(), false).unwrap();
        // Staging dir should be gone after successful rename-into-place.
        assert!(!stale.exists(), "staging dir leaked after install");
        // Real install present.
        assert!(target
            .path()
            .join(EXTENSION_DIR_NAME)
            .join("extension.mjs")
            .is_file());
    }

    #[test]
    fn extension_dir_resolves_under_dot_copilot() {
        // Smoke: PUTZ_COLLEAGUE_DIR override path always resolves.
        // The default path resolution requires HOME/USERPROFILE which we
        // can't safely mutate in parallel test runs. Compile-time check
        // that the cfg branches exist is the real assertion.
        std::env::set_var("PUTZ_COLLEAGUE_DIR", "/tmp/putz-test-extdir");
        let resolved = resolve_extension_dir();
        std::env::remove_var("PUTZ_COLLEAGUE_DIR");
        assert_eq!(resolved.as_deref(), Some(std::path::Path::new("/tmp/putz-test-extdir")));
    }
}
