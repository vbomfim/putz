/// IPC commands for command history operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `CommandHistoryManager`.
use tauri::State;

use crate::history::{
    AddCommandInput, CommandEntry, CommandHistoryManager, GetRecentInput, SearchHistoryInput,
};

/// Adds a command to the history.
///
/// Returns the row ID of the inserted entry.
#[tauri::command]
pub fn history_add(
    state: State<'_, CommandHistoryManager>,
    input: AddCommandInput,
) -> Result<i64, String> {
    state.add(input).map_err(|e| e.to_string())
}

/// Searches command history by substring match.
///
/// Returns matching entries ordered by most recent first.
#[tauri::command]
pub fn history_search(
    state: State<'_, CommandHistoryManager>,
    input: SearchHistoryInput,
) -> Result<Vec<CommandEntry>, String> {
    state.search(input).map_err(|e| e.to_string())
}

/// Gets the most recent commands for a specific session.
#[tauri::command]
pub fn history_get_recent(
    state: State<'_, CommandHistoryManager>,
    input: GetRecentInput,
) -> Result<Vec<CommandEntry>, String> {
    state.get_recent(input).map_err(|e| e.to_string())
}

/// Clears all command history.
#[tauri::command]
pub fn history_clear(state: State<'_, CommandHistoryManager>) -> Result<(), String> {
    state.clear().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::history::error::HistoryError;

    #[test]
    fn history_error_to_string_format() {
        let err = HistoryError::InvalidInput("bad data".into());
        let msg = err.to_string();
        assert!(msg.contains("bad data"));
    }

    #[test]
    fn history_error_database_format() {
        let err = HistoryError::DatabaseError("cannot open".into());
        let msg = err.to_string();
        assert!(msg.contains("Database error"));
    }
}
