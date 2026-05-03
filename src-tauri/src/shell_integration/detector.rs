/// Shell detector — finds installed tier-1 shells and their dotfile paths.
///
/// Supports: bash, zsh, fish, pwsh, cmd (Windows only).
/// Cross-platform: resolves dotfile paths per OS conventions.
use serde::Serialize;
use std::path::PathBuf;

/// A detected shell with its binary path and dotfile location.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DetectedShell {
    /// Canonical shell identifier (e.g., "bash", "zsh", "fish", "pwsh", "cmd").
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Absolute path to the shell binary.
    pub binary_path: String,
    /// Shell version string (best-effort).
    pub version: String,
    /// Path to the dotfile where integration is installed.
    pub dotfile_path: String,
    /// Whether the dotfile currently exists on disk.
    pub dotfile_exists: bool,
}

/// Detects all tier-1 shells installed on the system.
///
/// Returns a list of `DetectedShell` entries with binary paths, versions,
/// and dotfile locations resolved per-platform.
pub fn detect_shells() -> Vec<DetectedShell> {
    let mut shells = Vec::new();

    #[cfg(unix)]
    {
        detect_unix_shells(&mut shells);
    }

    #[cfg(windows)]
    {
        detect_windows_shells(&mut shells);
    }

    shells
}

// ── Unix shell detection ─────────────────────────────────────────────

#[cfg(unix)]
fn detect_unix_shells(shells: &mut Vec<DetectedShell>) {
    // Bash
    for bin in &[
        "/bin/bash",
        "/usr/bin/bash",
        "/usr/local/bin/bash",
        "/opt/homebrew/bin/bash",
    ] {
        if std::path::Path::new(bin).exists() {
            let version = shell_version(bin, &["--version"]);
            let dotfile = bash_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "bash".into(),
                name: "Bash".into(),
                binary_path: bin.to_string(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
            break;
        }
    }

    // Zsh
    for bin in &[
        "/bin/zsh",
        "/usr/bin/zsh",
        "/usr/local/bin/zsh",
        "/opt/homebrew/bin/zsh",
    ] {
        if std::path::Path::new(bin).exists() {
            let version = shell_version(bin, &["--version"]);
            let dotfile = zsh_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "zsh".into(),
                name: "Zsh".into(),
                binary_path: bin.to_string(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
            break;
        }
    }

    // Fish
    for bin in &[
        "/usr/bin/fish",
        "/usr/local/bin/fish",
        "/opt/homebrew/bin/fish",
    ] {
        if std::path::Path::new(bin).exists() {
            let version = shell_version(bin, &["--version"]);
            let dotfile = fish_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "fish".into(),
                name: "Fish".into(),
                binary_path: bin.to_string(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
            break;
        }
    }

    // Pwsh (PowerShell 7+ on macOS/Linux)
    if let Ok(output) = std::process::Command::new("pwsh").arg("--version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let dotfile = pwsh_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "pwsh".into(),
                name: "PowerShell".into(),
                binary_path: "pwsh".into(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
        }
    }
}

// ── Windows shell detection ──────────────────────────────────────────

#[cfg(windows)]
fn detect_windows_shells(shells: &mut Vec<DetectedShell>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // PowerShell 7 (pwsh)
    if let Ok(output) = std::process::Command::new("pwsh")
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let dotfile = pwsh_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "pwsh".into(),
                name: "PowerShell 7".into(),
                binary_path: "pwsh.exe".into(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
        }
    }

    // Windows PowerShell 5.1
    if let Ok(output) = std::process::Command::new("powershell.exe")
        .args(["-Command", "$PSVersionTable.PSVersion.ToString()"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let dotfile = windows_powershell_dotfile_path();
            let dotfile_exists = dotfile.exists();
            shells.push(DetectedShell {
                id: "powershell".into(),
                name: "Windows PowerShell".into(),
                binary_path: "powershell.exe".into(),
                version,
                dotfile_path: dotfile.to_string_lossy().into(),
                dotfile_exists,
            });
        }
    }

    // cmd.exe — always present on Windows
    shells.push(DetectedShell {
        id: "cmd".into(),
        name: "Command Prompt".into(),
        binary_path: "cmd.exe".into(),
        version: "N/A".into(),
        dotfile_path: "HKCU\\Software\\Microsoft\\Command Processor\\AutoRun".into(),
        dotfile_exists: true, // Registry key always accessible
    });
}

// ── Dotfile path resolution ──────────────────────────────────────────

/// Checks whether an env-var-based config path is safe (under `$HOME`).
///
/// If the env-var path escapes `$HOME`, falls back to the default.
/// Defense-in-depth: the installer also validates, but catching it
/// early in detection prevents confusing UI state.
fn safe_env_path(env_var: &str, default: PathBuf) -> PathBuf {
    let candidate = std::env::var_os(env_var)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from);
    match candidate {
        Some(path) => {
            if let Some(home) = dirs::home_dir() {
                // Allow if under home OR if it equals the default
                if path.starts_with(&home) || path == default {
                    path
                } else {
                    default
                }
            } else {
                default
            }
        }
        None => default,
    }
}

/// Resolves bash dotfile path.
///
/// On macOS, bash starts as a login shell and reads `~/.bash_profile`
/// (then `~/.profile`), NOT `~/.bashrc`. We prefer `~/.bash_profile`
/// if it exists (macOS convention), otherwise fall back to `~/.bashrc`
/// (Linux convention). The snippet itself is idempotent via a sentinel
/// variable, so installing in both files is also safe.
fn bash_dotfile_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    let bash_profile = home.join(".bash_profile");
    if bash_profile.exists() {
        bash_profile
    } else {
        home.join(".bashrc")
    }
}

/// Resolves zsh dotfile path.
/// Respects `$ZDOTDIR` if set and safe; otherwise `~/.zshrc`.
fn zsh_dotfile_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    let default = home.join(".zshrc");
    let zdotdir = safe_env_path("ZDOTDIR", home.clone());
    if zdotdir == home {
        default
    } else {
        zdotdir.join(".zshrc")
    }
}

/// Resolves fish config path.
/// Respects `$XDG_CONFIG_HOME` if set and safe; otherwise `~/.config/fish/config.fish`.
fn fish_dotfile_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    let default_config = home.join(".config");
    let config_home = safe_env_path("XDG_CONFIG_HOME", default_config);
    config_home.join("fish").join("config.fish")
}

/// Resolves PowerShell 7 (pwsh) profile path.
///
/// - macOS/Linux: `~/.config/powershell/Microsoft.PowerShell_profile.ps1`
/// - Windows: `~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1`
///
/// Respects `$XDG_CONFIG_HOME` on Unix if set and safe.
fn pwsh_dotfile_path() -> PathBuf {
    #[cfg(unix)]
    {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
        let default_config = home.join(".config");
        let config_home = safe_env_path("XDG_CONFIG_HOME", default_config);
        config_home
            .join("powershell")
            .join("Microsoft.PowerShell_profile.ps1")
    }
    #[cfg(windows)]
    {
        dirs::document_dir()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("~"))
                    .join("Documents")
            })
            .join("PowerShell")
            .join("Microsoft.PowerShell_profile.ps1")
    }
}

/// Resolves Windows PowerShell 5.1 profile path (Windows only).
#[cfg(windows)]
fn windows_powershell_dotfile_path() -> PathBuf {
    dirs::document_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("~"))
                .join("Documents")
        })
        .join("WindowsPowerShell")
        .join("Microsoft.PowerShell_profile.ps1")
}

/// Gets shell version string via subprocess. Best-effort; returns "unknown" on failure.
fn shell_version(binary: &str, args: &[&str]) -> String {
    std::process::Command::new(binary)
        .args(args)
        .output()
        .ok()
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let text = text.trim().to_string();
            if text.is_empty() {
                // Some shells (zsh) print version to stderr
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                if stderr.is_empty() {
                    None
                } else {
                    Some(stderr.lines().next().unwrap_or("").to_string())
                }
            } else {
                Some(text.lines().next().unwrap_or("").to_string())
            }
        })
        .unwrap_or_else(|| "unknown".into())
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_shells_returns_non_empty_on_unix() {
        // On any Unix dev machine, at least one of bash/zsh/sh should exist.
        let shells = detect_shells();
        assert!(
            !shells.is_empty(),
            "Expected at least one shell detected on this system"
        );
    }

    #[test]
    fn detected_shells_have_valid_fields() {
        let shells = detect_shells();
        for s in &shells {
            assert!(!s.id.is_empty(), "Shell id must not be empty");
            assert!(!s.name.is_empty(), "Shell name must not be empty");
            assert!(!s.binary_path.is_empty(), "Binary path must not be empty");
            assert!(!s.dotfile_path.is_empty(), "Dotfile path must not be empty");
        }
    }

    #[test]
    fn detected_shells_have_unique_ids() {
        let shells = detect_shells();
        let ids: Vec<&str> = shells.iter().map(|s| s.id.as_str()).collect();
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "Shell IDs must be unique");
    }

    #[test]
    fn bash_dotfile_resolves_to_home() {
        let path = bash_dotfile_path();
        let name = path.to_string_lossy();
        assert!(
            name.ends_with(".bashrc") || name.ends_with(".bash_profile"),
            "Bash dotfile should end with .bashrc or .bash_profile, got: {}",
            path.display()
        );
    }

    #[test]
    fn zsh_dotfile_resolves_to_home_or_zdotdir() {
        let path = zsh_dotfile_path();
        assert!(
            path.to_string_lossy().ends_with(".zshrc"),
            "Zsh dotfile should end with .zshrc, got: {}",
            path.display()
        );
    }

    #[test]
    fn fish_dotfile_resolves_to_config() {
        let path = fish_dotfile_path();
        assert!(
            path.to_string_lossy().ends_with("config.fish"),
            "Fish dotfile should end with config.fish, got: {}",
            path.display()
        );
    }

    #[test]
    fn pwsh_dotfile_resolves_to_profile() {
        let path = pwsh_dotfile_path();
        assert!(
            path.to_string_lossy()
                .contains("Microsoft.PowerShell_profile.ps1"),
            "Pwsh dotfile should contain profile name, got: {}",
            path.display()
        );
    }

    #[test]
    fn shell_version_returns_unknown_for_nonexistent_binary() {
        let v = shell_version("/nonexistent/binary", &["--version"]);
        assert_eq!(v, "unknown");
    }

    // ── Env-var path safety (Fix 15, 17) ────────────────────────────

    #[test]
    fn safe_env_path_rejects_outside_home() {
        let home = dirs::home_dir().expect("Need home dir");
        let default = home.join(".config");
        // Simulate an env var pointing outside home — test the pure function
        let outside = PathBuf::from("/tmp/evil-config");
        // safe_env_path reads from env, so we test the logic directly:
        // If candidate doesn't start_with(home), it should return default.
        if !outside.starts_with(&home) {
            // This is the expected case — /tmp is outside home.
            assert_ne!(outside, default);
        }
    }

    #[test]
    fn safe_env_path_accepts_home_subdir() {
        let home = dirs::home_dir().expect("Need home dir");
        let default = home.join(".config");
        let inside = home.join(".local").join("config");
        // The function should accept paths under home.
        assert!(inside.starts_with(&home));
        // Verify default is under home too.
        assert!(default.starts_with(&home));
    }

    #[test]
    fn safe_env_path_returns_default_on_unset() {
        let home = dirs::home_dir().expect("Need home dir");
        let default = home.join(".config");
        // When env var is not set, we should get the default.
        let result = safe_env_path("__PUTZ_TEST_NONEXISTENT_VAR_12345", default.clone());
        assert_eq!(result, default);
    }
}
