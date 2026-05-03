/// IPC commands for terminal PTY operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `PtyManager`.
///
/// Security: Session IDs are validated as UUID v4 format. Terminal I/O
/// content is never logged (may contain passwords/secrets).
use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::pty::PtyManager;
use crate::swarm::SwarmCoordinator;

#[cfg(test)]
use crate::pty::PtyError;

/// Spawns a new PTY session with a shell process.
///
/// Returns the UUID session ID that identifies this session for
/// all subsequent operations (write, resize, close).
///
/// If the swarm is enabled, injects `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID`
/// env vars into the session. (Replaces the prior `PUTZ_SWARM_URL` /
/// `PUTZ_SWARM_TOKEN` pair — auth is now OS file permissions.)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    swarm: State<'_, SwarmCoordinator>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
    tab_id: Option<String>,
) -> Result<String, String> {
    // H6: Use .await instead of block_on() to avoid deadlock risk
    let merged_env = if swarm.enabled() {
        let tid = tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let swarm_vars = swarm.env_vars(&tid).await;
        match swarm_vars {
            Some(vars) => Some(merge_env_swarm_wins(env.unwrap_or_default(), vars)),
            None => env,
        }
    } else {
        env
    };

    state
        .spawn(&app, shell, cwd, cols, rows, merged_env)
        .map_err(|e| e.to_string())
}

/// Merge swarm-owned env vars over a caller-supplied env, **swarm wins**.
///
/// Spec FR-020: `PUTZ_SWARM_PATH`, `PUTZ_TAB_ID`, and any other Putz-owned
/// swarm vars are NON-overridable by the caller. A caller that supplies a
/// `PUTZ_SWARM_PATH=bad` would otherwise be able to redirect a Copilot CLI
/// extension to a foreign socket path; we insert unconditionally so the
/// Putz-supplied value always wins.
fn merge_env_swarm_wins(
    mut base: HashMap<String, String>,
    swarm: HashMap<String, String>,
) -> HashMap<String, String> {
    for (k, v) in swarm {
        base.insert(k, v);
    }
    base
}

/// Writes input bytes to a PTY session (keystrokes from the terminal).
#[tauri::command]
pub fn pty_write(
    state: State<'_, PtyManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sid = &session_id[..8.min(session_id.len())];
    let len = data.len();
    crate::perf::log(&format!("pty_write ENTER session={sid} bytes={len}"));
    let t0 = std::time::Instant::now();
    let result = state.write(&session_id, &data).map_err(|e| e.to_string());
    let us = t0.elapsed().as_micros();
    crate::perf::log(&format!(
        "pty_write EXIT  session={sid} bytes={len} took_us={us}"
    ));
    result
}

/// Resizes a PTY session to new dimensions (cols × rows).
///
/// Called when the terminal UI resizes (e.g., window resize).
/// Sends SIGWINCH to the child process.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

/// Closes a PTY session, killing the child process.
///
/// The reader thread will detect EOF and emit a `pty-exit-{sessionId}` event.
#[tauri::command]
pub fn pty_close(state: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    state.close(&session_id).map_err(|e| e.to_string())
}

/// Gets the current working directory of a PTY session's shell process.
///
/// TODO(#119): migrate frontend callers to subscribe to cwdRegistry / OSC 7 events,
/// then delete this IPC. See https://github.com/vbomfim/putz/issues/119
#[tauri::command]
pub fn pty_cwd(state: State<'_, PtyManager>, session_id: String) -> Result<String, String> {
    let t0 = std::time::Instant::now();
    let result = state.get_cwd(&session_id).map_err(|e| e.to_string());
    let us = t0.elapsed().as_micros();
    if us > 5_000 {
        crate::perf::log(&format!(
            "pty_cwd session={} took_us={}",
            &session_id[..8.min(session_id.len())],
            us
        ));
    }
    result
}

/// Lists available shells on the system.
/// Returns a list of {name, path} objects for shells that exist.
#[tauri::command]
pub fn pty_list_shells() -> Vec<serde_json::Value> {
    let mut shells = Vec::new();

    #[cfg(unix)]
    {
        let candidates = [
            ("Zsh", "/bin/zsh"),
            ("Bash", "/bin/bash"),
            ("Fish", "/usr/local/bin/fish"),
            ("Fish", "/usr/bin/fish"),
            ("Sh", "/bin/sh"),
        ];
        for (name, path) in candidates {
            if std::path::Path::new(path).exists() {
                // Deduplicate by name
                if !shells.iter().any(|s: &serde_json::Value| s["name"] == name) {
                    shells.push(serde_json::json!({"name": name, "path": path}));
                }
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // PowerShell 7 (pwsh)
        if Command::new("pwsh")
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok()
        {
            shells.push(serde_json::json!({"name": "PowerShell 7", "path": "pwsh.exe"}));
        }
        // Windows PowerShell
        if Command::new("powershell.exe")
            .arg("-Command")
            .arg("$PSVersionTable.PSVersion.Major")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok()
        {
            shells
                .push(serde_json::json!({"name": "Windows PowerShell", "path": "powershell.exe"}));
        }
        // CMD
        shells.push(serde_json::json!({"name": "Command Prompt", "path": "cmd.exe"}));
        // Git Bash
        let git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for path in git_bash_paths {
            if std::path::Path::new(path).exists() {
                shells.push(serde_json::json!({"name": "Git Bash", "path": path}));
                break;
            }
        }
        // WSL
        if Command::new("wsl.exe")
            .arg("--status")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok()
        {
            shells.push(serde_json::json!({"name": "WSL", "path": "wsl.exe"}));
        }
        // Nushell
        if Command::new("nu.exe")
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok()
        {
            shells.push(serde_json::json!({"name": "Nushell", "path": "nu.exe"}));
        }
    }

    shells
}

#[cfg(test)]
mod tests {
    // IPC command handlers are thin wrappers around PtyManager methods.
    // The actual logic (validation, session management) is tested in
    // pty::manager::tests. These commands require a Tauri runtime to
    // test directly, so we rely on the manager's unit tests + E2E tests.

    use super::*;

    #[test]
    fn pty_error_to_string_format() {
        // Verify error-to-string mapping produces readable messages
        let err = PtyError::NotFound("abc-123".into());
        let msg = err.to_string();
        assert!(msg.contains("abc-123"));
        assert!(msg.contains("not found"));
    }

    /// FR-020: swarm-owned env vars MUST override any caller-supplied
    /// values. If a caller (or a compromised frontend) supplies
    /// `PUTZ_SWARM_PATH=bad`, the merged result must contain Putz's
    /// real swarm path, not the caller's bogus one.
    #[test]
    fn swarm_env_vars_override_caller_supplied() {
        let mut caller = HashMap::new();
        caller.insert("PUTZ_SWARM_PATH".into(), "/tmp/attacker.sock".into());
        caller.insert("PUTZ_TAB_ID".into(), "fake-tab".into());
        caller.insert("CALLER_OWNED".into(), "keep-me".into());

        let mut swarm = HashMap::new();
        swarm.insert(
            "PUTZ_SWARM_PATH".into(),
            "/run/user/1000/putz/swarm-42.sock".into(),
        );
        swarm.insert("PUTZ_TAB_ID".into(), "real-tab-uuid".into());

        let merged = merge_env_swarm_wins(caller, swarm);
        assert_eq!(
            merged.get("PUTZ_SWARM_PATH").map(String::as_str),
            Some("/run/user/1000/putz/swarm-42.sock"),
            "Putz-owned PUTZ_SWARM_PATH must win over caller-supplied value (FR-020)"
        );
        assert_eq!(
            merged.get("PUTZ_TAB_ID").map(String::as_str),
            Some("real-tab-uuid"),
            "Putz-owned PUTZ_TAB_ID must win over caller-supplied value (FR-020)"
        );
        // Caller-owned non-swarm vars are preserved.
        assert_eq!(
            merged.get("CALLER_OWNED").map(String::as_str),
            Some("keep-me")
        );
    }

    /// FR-020 corner: caller env without any swarm vars — swarm vars
    /// are still injected.
    #[test]
    fn swarm_env_vars_inject_into_empty_caller_env() {
        let mut swarm = HashMap::new();
        swarm.insert("PUTZ_SWARM_PATH".into(), "/p".into());
        let merged = merge_env_swarm_wins(HashMap::new(), swarm);
        assert_eq!(
            merged.get("PUTZ_SWARM_PATH").map(String::as_str),
            Some("/p")
        );
    }
}
