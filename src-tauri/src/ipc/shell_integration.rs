/// IPC commands for shell integration — detect, install, uninstall, status.
///
/// These are Tauri command handlers invoked from the React frontend via
/// `@tauri-apps/api/core`'s `invoke()`.
use std::path::PathBuf;

use crate::shell_integration::cmd_autorun::{self, CmdPreview, RegistryChange};
use crate::shell_integration::detector;
use crate::shell_integration::installer::{self, InstallResult, InstallStatus};

/// Detects all tier-1 shells installed on the system.
///
/// Returns a list of detected shells with binary paths, versions,
/// dotfile locations, and current install status.
///
/// The frontend should call this once at panel load and cache the result.
/// Subsequent install/uninstall calls accept `dotfile_path` directly,
/// avoiding redundant subprocess spawns for shell detection.
#[tauri::command]
pub fn shell_integration_detect() -> Vec<ShellInfo> {
    let detected = detector::detect_shells();
    detected
        .into_iter()
        .map(|shell| {
            let status = if shell.id == "cmd" {
                // cmd.exe uses registry — check via marker in AutoRun value.
                cmd_status_check()
            } else {
                installer::check_status(&shell.id, &PathBuf::from(&shell.dotfile_path))
            };
            ShellInfo {
                id: shell.id,
                name: shell.name,
                binary_path: shell.binary_path,
                version: shell.version,
                dotfile_path: shell.dotfile_path,
                dotfile_exists: shell.dotfile_exists,
                status,
            }
        })
        .collect()
}

/// Checks cmd.exe install status via the AutoRun registry key.
fn cmd_status_check() -> InstallStatus {
    // On non-Windows, cmd is always NotInstalled.
    #[cfg(not(windows))]
    {
        InstallStatus::NotInstalled
    }
    #[cfg(windows)]
    {
        match cmd_autorun::preview() {
            Ok(preview) => {
                if preview.has_existing_putz_segment {
                    InstallStatus::Installed
                } else {
                    InstallStatus::NotInstalled
                }
            }
            Err(_) => InstallStatus::NotInstalled,
        }
    }
}

/// Installs shell integration for the specified shell.
///
/// Accepts `dotfile_path` from the frontend's cached detection result
/// to avoid re-running shell detection subprocesses.
#[tauri::command]
pub fn shell_integration_install(
    shell_id: String,
    dotfile_path: Option<String>,
) -> Result<InstallResult, String> {
    if shell_id == "cmd" {
        return Err("cmd.exe install requires registry access — use shell_integration_install_cmd with explicit confirmation".into());
    }

    let path = resolve_dotfile_path(&shell_id, dotfile_path)?;

    eprintln!(
        "[shell_integration] install: shell={}, dotfile={}",
        shell_id,
        path.display()
    );

    installer::install(&shell_id, &path).map_err(sanitize_error)
}

/// Uninstalls shell integration for the specified shell.
///
/// Accepts `dotfile_path` from the frontend's cached detection result.
#[tauri::command]
pub fn shell_integration_uninstall(
    shell_id: String,
    dotfile_path: Option<String>,
) -> Result<InstallResult, String> {
    if shell_id == "cmd" {
        return Err(
            "cmd.exe uninstall requires registry access — use shell_integration_uninstall_cmd"
                .into(),
        );
    }

    let path = resolve_dotfile_path(&shell_id, dotfile_path)?;

    eprintln!(
        "[shell_integration] uninstall: shell={}, dotfile={}",
        shell_id,
        path.display()
    );

    installer::uninstall(&shell_id, &path).map_err(sanitize_error)
}

/// Returns the installation status for a specific shell.
///
/// Accepts `dotfile_path` from the frontend's cached detection result.
#[tauri::command]
pub fn shell_integration_status(
    shell_id: String,
    dotfile_path: Option<String>,
) -> Result<InstallStatus, String> {
    if shell_id == "cmd" {
        return Ok(cmd_status_check());
    }

    let path = resolve_dotfile_path(&shell_id, dotfile_path)?;

    Ok(installer::check_status(&shell_id, &path))
}

/// Resolves the dotfile path: uses the frontend-provided path if given,
/// otherwise falls back to re-detecting (backward compat).
fn resolve_dotfile_path(shell_id: &str, dotfile_path: Option<String>) -> Result<PathBuf, String> {
    match dotfile_path {
        Some(p) => Ok(PathBuf::from(p)),
        None => {
            // Fallback: re-detect (preserves backward compatibility)
            let shells = detector::detect_shells();
            let shell = shells
                .iter()
                .find(|s| s.id == shell_id)
                .ok_or_else(|| format!("Shell '{}' not detected on this system", shell_id))?;
            Ok(PathBuf::from(&shell.dotfile_path))
        }
    }
}

/// Sanitizes installer errors for IPC — strips full filesystem paths.
fn sanitize_error(e: String) -> String {
    // Don't leak full paths in error messages sent to the frontend.
    if e.contains("outside home directory") {
        "Refused: path outside home directory".to_string()
    } else if e.contains("traversal") {
        "Refused: path contains traversal components".to_string()
    } else if e.contains("Failed to") {
        "I/O error writing shell integration".to_string()
    } else {
        format!("Install failed: {e}")
    }
}

/// Returns the snippet content for a shell (for "Show Snippet" UI).
#[tauri::command]
pub fn shell_integration_show_snippet(shell_id: String) -> Result<String, String> {
    installer::snippet_for_shell(&shell_id)
        .map(|s| s.to_string())
        .ok_or_else(|| format!("No snippet available for shell '{}'", shell_id))
}

/// Shell info returned to the frontend — extends DetectedShell with status.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub binary_path: String,
    pub version: String,
    pub dotfile_path: String,
    pub dotfile_exists: bool,
    pub status: InstallStatus,
}

// ── cmd.exe AutoRun commands ─────────────────────────────────────────

/// Preview what a cmd.exe install would do — no side effects.
///
/// Returns the current and proposed AutoRun registry values so the
/// frontend can show a confirmation dialog before any registry write.
#[tauri::command]
pub fn shell_integration_cmd_preview() -> Result<CmdPreview, String> {
    cmd_autorun::preview()
}

/// Show the raw existing AutoRun value (gated behind explicit user action).
///
/// Privacy: The full AutoRun content from other applications is only
/// returned when the user explicitly clicks "Show existing AutoRun".
#[tauri::command]
pub fn shell_integration_cmd_show_existing() -> Result<String, String> {
    cmd_autorun::read_existing_autorun()
}

/// Install cmd.exe shell integration after explicit user confirmation.
///
/// The frontend MUST call `shell_integration_cmd_preview()` first,
/// show the user the proposed change, and only call this after
/// the user clicks "Install" in the confirmation dialog.
#[tauri::command]
pub fn shell_integration_cmd_install_confirmed() -> Result<RegistryChange, String> {
    eprintln!("[shell_integration] cmd install confirmed via registry");
    cmd_autorun::install_confirmed()
}

/// Uninstall cmd.exe shell integration.
///
/// Surgically removes only Putz's segment from the AutoRun chain.
/// Preserves other applications' AutoRun entries.
#[tauri::command]
pub fn shell_integration_cmd_uninstall() -> Result<RegistryChange, String> {
    eprintln!("[shell_integration] cmd uninstall via registry");
    cmd_autorun::uninstall()
}
