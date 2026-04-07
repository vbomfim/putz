/// IPC commands for session management operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `SessionManager`.
use tauri::State;

use crate::session::{
    CreateSessionInput, MoveSessionInput, SessionManager, SessionNode, SessionProfile,
    UpdateSessionInput,
};

/// Lists all sessions and folders as a tree structure.
#[tauri::command]
pub fn session_list(state: State<'_, SessionManager>) -> Vec<SessionNode> {
    state.list_tree()
}

/// Gets a single session profile by ID.
#[tauri::command]
pub fn session_get(
    state: State<'_, SessionManager>,
    id: String,
) -> Result<SessionProfile, String> {
    state.get_session(&id).map_err(|e| e.to_string())
}

/// Creates a new session profile.
///
/// Returns the generated UUID for the new session.
#[tauri::command]
pub fn session_create(
    state: State<'_, SessionManager>,
    input: CreateSessionInput,
) -> Result<String, String> {
    state.create_session(input).map_err(|e| e.to_string())
}

/// Updates an existing session profile with partial fields.
#[tauri::command]
pub fn session_update(
    state: State<'_, SessionManager>,
    id: String,
    input: UpdateSessionInput,
) -> Result<(), String> {
    state.update_session(&id, input).map_err(|e| e.to_string())
}

/// Deletes a session profile by ID.
#[tauri::command]
pub fn session_delete(
    state: State<'_, SessionManager>,
    id: String,
) -> Result<(), String> {
    state.delete_session(&id).map_err(|e| e.to_string())
}

/// Moves a session to a different folder.
#[tauri::command]
pub fn session_move(
    state: State<'_, SessionManager>,
    input: MoveSessionInput,
) -> Result<(), String> {
    state.move_session(input).map_err(|e| e.to_string())
}

/// Duplicates a session with a new ID and "(copy)" suffix.
///
/// Returns the UUID of the new copy.
#[tauri::command]
pub fn session_duplicate(
    state: State<'_, SessionManager>,
    id: String,
) -> Result<String, String> {
    state.duplicate_session(&id).map_err(|e| e.to_string())
}

/// Searches sessions by query string (matches name, host, username).
#[tauri::command]
pub fn session_search(
    state: State<'_, SessionManager>,
    query: String,
) -> Vec<SessionProfile> {
    state.search(&query)
}

/// Exports the entire session store as a JSON string.
#[tauri::command]
pub fn session_export(
    state: State<'_, SessionManager>,
) -> Result<String, String> {
    state.export().map_err(|e| e.to_string())
}

/// Imports sessions from a JSON string.
///
/// Returns the number of sessions imported.
#[tauri::command]
pub fn session_import(
    state: State<'_, SessionManager>,
    data: String,
) -> Result<usize, String> {
    state.import(&data).map_err(|e| e.to_string())
}

/// Creates a new folder.
///
/// Returns the generated UUID for the new folder.
#[tauri::command]
pub fn session_create_folder(
    state: State<'_, SessionManager>,
    name: String,
    parent_id: String,
) -> Result<String, String> {
    state
        .create_folder(&name, &parent_id)
        .map_err(|e| e.to_string())
}

/// Deletes a folder by ID (must be empty).
#[tauri::command]
pub fn session_delete_folder(
    state: State<'_, SessionManager>,
    id: String,
) -> Result<(), String> {
    state.delete_folder(&id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::session::error::SessionError;

    #[test]
    fn session_error_to_string_format() {
        let err = SessionError::NotFound("abc-123".into());
        let msg = err.to_string();
        assert!(msg.contains("abc-123"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn session_error_invalid_input_format() {
        let err = SessionError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("bad data"));
    }
}
