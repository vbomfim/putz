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

use crate::logging::LogManager;
use crate::pty::PtyManager;

#[cfg(test)]
use crate::pty::PtyError;

/// Spawns a new PTY session with a shell process.
///
/// Returns the UUID session ID that identifies this session for
/// all subsequent operations (write, resize, close).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    log_state: State<'_, LogManager>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
) -> Result<String, String> {
    eprintln!("[pty_spawn] cols={} rows={}", cols, rows);
    state
        .spawn(&app, shell, cwd, cols, rows, env, log_state.get_loggers())
        .map_err(|e| e.to_string())
}

/// Writes input bytes to a PTY session (keystrokes from the terminal).
#[tauri::command]
pub fn pty_write(
    state: State<'_, PtyManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    eprintln!("[pty_write] session={} len={}", &session_id[..8], data.len());
    state.write(&session_id, &data).map_err(|e| e.to_string())
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
    eprintln!("[pty_resize] session={} cols={} rows={}", &session_id[..8], cols, rows);
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
#[tauri::command]
pub fn pty_cwd(state: State<'_, PtyManager>, session_id: String) -> Result<String, String> {
    state.get_cwd(&session_id).map_err(|e| e.to_string())
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
}
