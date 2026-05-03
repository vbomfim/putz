/// IPC commands for shell integration — detect, install, uninstall, status.
///
/// These are Tauri command handlers invoked from the React frontend via
/// `@tauri-apps/api/core`'s `invoke()`.
use std::path::PathBuf;

use crate::shell_integration::detector;
use crate::shell_integration::installer::{self, InstallResult, InstallStatus};

/// Detects all tier-1 shells installed on the system.
///
/// Returns a list of detected shells with binary paths, versions,
/// dotfile locations, and current install status.
#[tauri::command]
pub fn shell_integration_detect() -> Vec<ShellInfo> {
    let detected = detector::detect_shells();
    detected
        .into_iter()
        .map(|shell| {
            let status = if shell.id == "cmd" {
                // cmd.exe uses registry, not dotfile — check differently.
                InstallStatus::NotInstalled // TODO: Windows registry check
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

/// Installs shell integration for the specified shell.
#[tauri::command]
pub fn shell_integration_install(shell_id: String) -> Result<InstallResult, String> {
    let shells = detector::detect_shells();
    let shell = shells
        .iter()
        .find(|s| s.id == shell_id)
        .ok_or_else(|| format!("Shell '{}' not detected on this system", shell_id))?;

    if shell.id == "cmd" {
        return Err("cmd.exe install requires registry access — use shell_integration_install_cmd with explicit confirmation".into());
    }

    installer::install(&shell.id, &PathBuf::from(&shell.dotfile_path))
}

/// Uninstalls shell integration for the specified shell.
#[tauri::command]
pub fn shell_integration_uninstall(shell_id: String) -> Result<InstallResult, String> {
    let shells = detector::detect_shells();
    let shell = shells
        .iter()
        .find(|s| s.id == shell_id)
        .ok_or_else(|| format!("Shell '{}' not detected on this system", shell_id))?;

    if shell.id == "cmd" {
        return Err(
            "cmd.exe uninstall requires registry access — use shell_integration_uninstall_cmd"
                .into(),
        );
    }

    installer::uninstall(&shell.id, &PathBuf::from(&shell.dotfile_path))
}

/// Returns the installation status for a specific shell.
#[tauri::command]
pub fn shell_integration_status(shell_id: String) -> Result<InstallStatus, String> {
    let shells = detector::detect_shells();
    let shell = shells
        .iter()
        .find(|s| s.id == shell_id)
        .ok_or_else(|| format!("Shell '{}' not detected on this system", shell_id))?;

    Ok(installer::check_status(
        &shell.id,
        &PathBuf::from(&shell.dotfile_path),
    ))
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
