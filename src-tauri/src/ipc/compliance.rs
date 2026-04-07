/// IPC commands for change window compliance operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `ChangeWindowManager`.
use tauri::State;

use crate::compliance::{
    ChangeWindow, ChangeWindowCheckResult, ChangeWindowManager, SetChangeWindowInput,
};

/// Checks whether a command is allowed under the current change window policy.
///
/// Returns whether the command is dangerous and whether a window is active.
#[tauri::command]
pub fn change_window_check(
    state: State<'_, ChangeWindowManager>,
    command: String,
) -> Result<ChangeWindowCheckResult, String> {
    state.check_command(&command).map_err(|e| e.to_string())
}

/// Lists all defined change windows.
#[tauri::command]
pub fn change_window_list(
    state: State<'_, ChangeWindowManager>,
) -> Result<Vec<ChangeWindow>, String> {
    state.list().map_err(|e| e.to_string())
}

/// Creates or updates a change window.
///
/// Returns the window ID (generated for new, echoed for updates).
#[tauri::command]
pub fn change_window_set(
    state: State<'_, ChangeWindowManager>,
    input: SetChangeWindowInput,
) -> Result<String, String> {
    state.set(input).map_err(|e| e.to_string())
}

/// Deletes a change window by ID.
#[tauri::command]
pub fn change_window_delete(
    state: State<'_, ChangeWindowManager>,
    id: String,
) -> Result<(), String> {
    state.delete(&id).map_err(|e| e.to_string())
}

/// Returns whether any change window is currently active.
///
/// Used by the frontend to show the green/red lock indicator.
#[tauri::command]
pub fn change_window_active(
    state: State<'_, ChangeWindowManager>,
) -> Result<bool, String> {
    state.is_window_active().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::compliance::error::ComplianceError;

    #[test]
    fn compliance_error_to_string_format() {
        let err = ComplianceError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("bad data"));
    }

    #[test]
    fn compliance_error_io_format() {
        let err = ComplianceError::IoError("disk full".into());
        let msg = err.to_string();
        assert!(msg.contains("disk full"));
    }
}
