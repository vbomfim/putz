/// IPC commands for session auto-login operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `AutoLoginManager`.
use tauri::State;

use crate::autologin::{AutoLoginManager, AutoLoginProfile, LoginAction, SetAutoLoginInput};

/// Gets the auto-login profile for a session.
#[tauri::command]
pub fn autologin_get_profile(
    state: State<'_, AutoLoginManager>,
    session_id: String,
) -> Result<AutoLoginProfile, String> {
    state.get_profile(&session_id).map_err(|e| e.to_string())
}

/// Sets (creates or updates) an auto-login profile.
#[tauri::command]
pub fn autologin_set_profile(
    state: State<'_, AutoLoginManager>,
    input: SetAutoLoginInput,
) -> Result<(), String> {
    state.set_profile(input).map_err(|e| e.to_string())
}

/// Deletes an auto-login profile.
#[tauri::command]
pub fn autologin_delete_profile(
    state: State<'_, AutoLoginManager>,
    session_id: String,
) -> Result<(), String> {
    state.delete_profile(&session_id).map_err(|e| e.to_string())
}

/// Starts an auto-login sequence for a connection.
///
/// Returns true if the login sequence was activated.
#[tauri::command]
pub fn autologin_start(
    state: State<'_, AutoLoginManager>,
    connection_id: String,
    session_id: String,
) -> Result<bool, String> {
    state
        .start_login(&connection_id, &session_id)
        .map_err(|e| e.to_string())
}

/// Processes terminal output against the auto-login sequence.
///
/// Returns a `LoginAction` indicating what the frontend should do.
#[tauri::command]
pub fn autologin_process(
    state: State<'_, AutoLoginManager>,
    connection_id: String,
    output: String,
    username: String,
    password: String,
) -> Result<LoginAction, String> {
    state
        .process_output(&connection_id, &output, &username, &password)
        .map_err(|e| e.to_string())
}

/// Cancels an active auto-login sequence.
#[tauri::command]
pub fn autologin_cancel(
    state: State<'_, AutoLoginManager>,
    connection_id: String,
) -> Result<(), String> {
    state
        .cancel_login(&connection_id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::autologin::error::AutoLoginError;

    #[test]
    fn autologin_error_to_string_format() {
        let err = AutoLoginError::NotFound("sess-123".into());
        let msg = err.to_string();
        assert!(msg.contains("sess-123"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn autologin_error_invalid_input_format() {
        let err = AutoLoginError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("Invalid input"));
    }
}
