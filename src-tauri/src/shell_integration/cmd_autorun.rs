/// cmd.exe AutoRun registry management for shell integration.
///
/// On Windows, cmd.exe has no dotfile concept. Instead, it uses the registry key
/// `HKCU\Software\Microsoft\Command Processor\AutoRun` to run a command on
/// every cmd.exe launch.
///
/// # Safeguards
/// - **Show before write**: `preview()` returns the current and proposed values
///   without side effects — the frontend MUST show this before calling `install()`.
/// - **Concatenation**: Never overwrites existing AutoRun chains from other apps.
///   Putz's segment is appended with ` & ` separator.
/// - **Surgical uninstall**: Parses the AutoRun value, removes only Putz's
///   segment, and preserves everything else. If nothing remains, deletes the key.
/// - **Idempotent**: If Putz's segment is already present, install is a no-op.
///
/// On non-Windows platforms, all public functions return
/// `Err("cmd.exe is only supported on Windows")`.
use serde::Serialize;

/// The Putz segment identifier used in the AutoRun value.
/// We wrap the path in quotes and look for this marker to identify our segment.
const PUTZ_AUTORUN_MARKER: &str = "putz-cmd-init";

/// Result of a registry preview or change operation.
#[derive(Debug, Clone, Serialize)]
pub struct RegistryChange {
    /// The AutoRun value before the operation (empty string if key didn't exist).
    pub previous: String,
    /// The AutoRun value after the operation.
    pub new: String,
    /// What happened: "installed", "uninstalled", "noop", "deleted".
    pub action: String,
    /// Path to the cmd init script (on Windows).
    pub snippet_path: String,
}

/// Preview of what a cmd.exe install would do — no side effects.
#[derive(Debug, Clone, Serialize)]
pub struct CmdPreview {
    /// Current AutoRun value (empty if not set).
    pub existing_autorun: String,
    /// Proposed AutoRun value after install.
    pub proposed_autorun: String,
    /// Path to the Putz cmd init script.
    pub snippet_path: String,
    /// Human-readable explanation.
    pub explanation: String,
}

/// Returns the path where Putz's cmd.bat init script lives.
///
/// On Windows: `%LOCALAPPDATA%\putz\cmd-init.bat`
/// On non-Windows: placeholder path (function is only meaningful on Windows).
pub fn cmd_snippet_path() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("~"))
                    .join("AppData")
                    .join("Local")
            })
            .join("putz")
            .join("cmd-init.bat")
    }
    #[cfg(not(windows))]
    {
        std::path::PathBuf::from("/not-applicable/putz/cmd-init.bat")
    }
}

/// Builds the segment string that identifies Putz in the AutoRun chain.
fn putz_segment(snippet_path: &std::path::Path) -> String {
    // Use quoted path with our marker in the filename for identification.
    format!("\"{}\"", snippet_path.display())
}

/// Checks whether Putz's segment is present in an AutoRun value.
fn has_putz_segment(autorun: &str, snippet_path: &std::path::Path) -> bool {
    let segment = putz_segment(snippet_path);
    autorun.contains(&segment) || autorun.contains(PUTZ_AUTORUN_MARKER)
}

/// Appends Putz's segment to an existing AutoRun value.
fn concat_autorun(existing: &str, snippet_path: &std::path::Path) -> String {
    let segment = putz_segment(snippet_path);
    if existing.is_empty() {
        segment
    } else {
        format!("{} & {}", existing.trim_end(), segment)
    }
}

/// Removes Putz's segment from an AutoRun value (surgical).
///
/// Splits on ` & `, filters out segments containing our marker or path,
/// and rejoins. Returns empty string if nothing remains.
fn remove_putz_segment(autorun: &str, snippet_path: &std::path::Path) -> String {
    let segment = putz_segment(snippet_path);
    let parts: Vec<&str> = autorun.split(" & ").collect();
    let filtered: Vec<&str> = parts
        .into_iter()
        .filter(|part| {
            let trimmed = part.trim();
            trimmed != segment.trim()
                && !trimmed.contains(PUTZ_AUTORUN_MARKER)
                && !trimmed.contains(&snippet_path.display().to_string())
        })
        .collect();
    filtered.join(" & ")
}

// ═══════════════════════════════════════════════════════════════════════
// Windows implementation
// ═══════════════════════════════════════════════════════════════════════

#[cfg(windows)]
mod platform {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const SUBKEY: &str = r"Software\Microsoft\Command Processor";

    /// Reads the current AutoRun value from the registry.
    fn read_autorun() -> Result<String, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .open_subkey(SUBKEY)
            .map_err(|e| format!("Failed to open registry key: {e}"))?;
        Ok(key.get_value("AutoRun").unwrap_or_default())
    }

    /// Preview the install — returns current and proposed values without writing.
    pub fn preview() -> Result<CmdPreview, String> {
        let existing = read_autorun().unwrap_or_default();
        let path = cmd_snippet_path();

        if has_putz_segment(&existing, &path) {
            return Ok(CmdPreview {
                existing_autorun: existing.clone(),
                proposed_autorun: existing,
                snippet_path: path.display().to_string(),
                explanation: "Putz shell integration is already installed in cmd.exe AutoRun. No changes needed.".into(),
            });
        }

        let proposed = concat_autorun(&existing, &path);
        let explanation = if existing.is_empty() {
            "The AutoRun registry value is currently empty. Putz will set it to run the shell integration script on every cmd.exe launch.".into()
        } else {
            format!(
                "The AutoRun registry value already contains other entries. Putz will append its script after the existing chain: {}",
                existing
            )
        };

        Ok(CmdPreview {
            existing_autorun: existing,
            proposed_autorun: proposed,
            snippet_path: path.display().to_string(),
            explanation,
        })
    }

    /// Installs Putz's cmd.exe integration via the AutoRun registry key.
    ///
    /// 1. Writes the cmd.bat snippet to the local app data directory.
    /// 2. Adds the snippet path to the AutoRun registry value.
    pub fn install() -> Result<RegistryChange, String> {
        let path = cmd_snippet_path();
        let existing = read_autorun().unwrap_or_default();

        // Idempotent check.
        if has_putz_segment(&existing, &path) {
            return Ok(RegistryChange {
                previous: existing.clone(),
                new: existing,
                action: "noop".into(),
                snippet_path: path.display().to_string(),
            });
        }

        // Write the cmd.bat snippet to disk.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {e}"))?;
        }
        let snippet =
            super::super::installer::snippet_for_shell("cmd").ok_or("No cmd snippet available")?;
        std::fs::write(&path, snippet).map_err(|e| format!("Failed to write cmd-init.bat: {e}"))?;

        // Update registry.
        let new_value = concat_autorun(&existing, &path);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(SUBKEY)
            .map_err(|e| format!("Failed to create registry key: {e}"))?;
        key.set_value("AutoRun", &new_value)
            .map_err(|e| format!("Failed to write AutoRun value: {e}"))?;

        Ok(RegistryChange {
            previous: existing,
            new: new_value,
            action: "installed".into(),
            snippet_path: path.display().to_string(),
        })
    }

    /// Uninstalls Putz's cmd.exe integration from the AutoRun registry key.
    ///
    /// Surgically removes only Putz's segment; preserves other apps' chains.
    pub fn uninstall() -> Result<RegistryChange, String> {
        let path = cmd_snippet_path();
        let existing = read_autorun().unwrap_or_default();

        if !has_putz_segment(&existing, &path) {
            return Ok(RegistryChange {
                previous: existing.clone(),
                new: existing,
                action: "noop".into(),
                snippet_path: path.display().to_string(),
            });
        }

        let new_value = remove_putz_segment(&existing, &path);

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(SUBKEY)
            .map_err(|e| format!("Failed to open registry key: {e}"))?;

        if new_value.is_empty() {
            // Nothing left — delete the AutoRun value entirely.
            key.delete_value("AutoRun")
                .map_err(|e| format!("Failed to delete AutoRun value: {e}"))?;
            Ok(RegistryChange {
                previous: existing,
                new: String::new(),
                action: "deleted".into(),
                snippet_path: path.display().to_string(),
            })
        } else {
            key.set_value("AutoRun", &new_value)
                .map_err(|e| format!("Failed to update AutoRun value: {e}"))?;
            Ok(RegistryChange {
                previous: existing,
                new: new_value,
                action: "uninstalled".into(),
                snippet_path: path.display().to_string(),
            })
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Non-Windows stubs
// ═══════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn preview() -> Result<CmdPreview, String> {
        Err("cmd.exe is only supported on Windows".into())
    }

    pub fn install() -> Result<RegistryChange, String> {
        Err("cmd.exe is only supported on Windows".into())
    }

    pub fn uninstall() -> Result<RegistryChange, String> {
        Err("cmd.exe is only supported on Windows".into())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API — delegates to platform-specific implementation
// ═══════════════════════════════════════════════════════════════════════

/// Preview the cmd.exe install — returns current and proposed AutoRun values.
/// No side effects. Frontend MUST call this before `install_confirmed()`.
pub fn preview() -> Result<CmdPreview, String> {
    platform::preview()
}

/// Install Putz's cmd.exe integration. Caller MUST have shown the preview
/// dialog and received explicit user confirmation before calling this.
pub fn install_confirmed() -> Result<RegistryChange, String> {
    platform::install()
}

/// Uninstall Putz's cmd.exe integration. Surgical removal of only Putz's
/// segment from the AutoRun chain.
pub fn uninstall() -> Result<RegistryChange, String> {
    platform::uninstall()
}

// ═══════════════════════════════════════════════════════════════════════
// Tests — pure logic tests run on all platforms
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_path() -> PathBuf {
        PathBuf::from(r"C:\Users\test\AppData\Local\putz\cmd-init.bat")
    }

    // ── Segment identification ───────────────────────────────────────

    #[test]
    fn has_putz_segment_detects_quoted_path() {
        let path = test_path();
        let autorun = format!(r#""{}""#, path.display());
        assert!(has_putz_segment(&autorun, &path));
    }

    #[test]
    fn has_putz_segment_detects_marker_keyword() {
        let path = test_path();
        let autorun = "something & putz-cmd-init & something-else";
        assert!(has_putz_segment(autorun, &path));
    }

    #[test]
    fn has_putz_segment_returns_false_for_unrelated() {
        let path = test_path();
        let autorun = r#""C:\other\app\autorun.bat""#;
        assert!(!has_putz_segment(autorun, &path));
    }

    #[test]
    fn has_putz_segment_handles_empty() {
        let path = test_path();
        assert!(!has_putz_segment("", &path));
    }

    // ── Concat ───────────────────────────────────────────────────────

    #[test]
    fn concat_autorun_with_empty_existing() {
        let path = test_path();
        let result = concat_autorun("", &path);
        assert_eq!(result, format!(r#""{}""#, path.display()));
    }

    #[test]
    fn concat_autorun_preserves_existing_chain() {
        let path = test_path();
        let existing = r#"chcp 65001 & "C:\other\autorun.bat""#;
        let result = concat_autorun(existing, &path);
        assert!(result.starts_with(existing));
        assert!(result.contains(" & "));
        assert!(result.ends_with(&format!(r#""{}""#, path.display())));
    }

    #[test]
    fn concat_autorun_trims_trailing_whitespace() {
        let path = test_path();
        let existing = "chcp 65001  ";
        let result = concat_autorun(existing, &path);
        assert!(!result.contains("  &")); // no double-space before &
    }

    // ── Surgical removal ─────────────────────────────────────────────

    #[test]
    fn remove_putz_segment_preserves_other_apps() {
        let path = test_path();
        let other = r#""C:\other\app\autorun.bat""#;
        let autorun = format!(r#"{} & "{}""#, other, path.display());
        let result = remove_putz_segment(&autorun, &path);
        assert_eq!(result.trim(), other);
        assert!(!result.contains(&path.display().to_string()));
    }

    #[test]
    fn remove_putz_segment_returns_empty_when_only_putz() {
        let path = test_path();
        let autorun = format!(r#""{}""#, path.display());
        let result = remove_putz_segment(&autorun, &path);
        assert!(result.is_empty());
    }

    #[test]
    fn remove_putz_segment_handles_middle_position() {
        let path = test_path();
        let autorun = format!(
            r#"chcp 65001 & "{}" & "C:\other\stuff.bat""#,
            path.display()
        );
        let result = remove_putz_segment(&autorun, &path);
        assert!(!result.contains(&path.display().to_string()));
        assert!(result.contains("chcp 65001"));
        assert!(result.contains("other"));
    }

    #[test]
    fn remove_putz_segment_noop_when_not_present() {
        let path = test_path();
        let autorun = r#"chcp 65001 & "C:\other\autorun.bat""#;
        let result = remove_putz_segment(autorun, &path);
        assert_eq!(result, autorun);
    }

    // ── Idempotency ──────────────────────────────────────────────────

    #[test]
    fn concat_then_remove_restores_original() {
        let path = test_path();
        let original = r#"chcp 65001 & "C:\someapp\init.bat""#;
        let after_install = concat_autorun(original, &path);
        let after_uninstall = remove_putz_segment(&after_install, &path);
        assert_eq!(after_uninstall, original);
    }

    #[test]
    fn double_concat_is_idempotent_with_guard() {
        let path = test_path();
        let first = concat_autorun("", &path);
        // Guard: has_putz_segment should prevent double concat.
        assert!(has_putz_segment(&first, &path));
        // If guard is checked, second concat is skipped — simulating the install logic.
    }

    // ── Non-Windows stubs ────────────────────────────────────────────

    #[cfg(not(windows))]
    #[test]
    fn preview_returns_error_on_non_windows() {
        let result = preview();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("only supported on Windows"));
    }

    #[cfg(not(windows))]
    #[test]
    fn install_returns_error_on_non_windows() {
        let result = install_confirmed();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("only supported on Windows"));
    }

    #[cfg(not(windows))]
    #[test]
    fn uninstall_returns_error_on_non_windows() {
        let result = uninstall();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("only supported on Windows"));
    }
}
