/// IPC commands for highlight management operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `HighlightManager`.
use tauri::State;

use crate::highlight::{
    CreateHighlightSetInput, HighlightManager, HighlightSet, UpdateHighlightSetInput,
};

/// Lists all highlight sets.
#[tauri::command]
pub fn highlight_list_sets(
    state: State<'_, HighlightManager>,
) -> Result<Vec<HighlightSet>, String> {
    state.list_sets().map_err(|e| e.to_string())
}

/// Gets a single highlight set by ID.
#[tauri::command]
pub fn highlight_get_set(
    state: State<'_, HighlightManager>,
    id: String,
) -> Result<HighlightSet, String> {
    state.get_set(&id).map_err(|e| e.to_string())
}

/// Creates a new highlight set.
///
/// Returns the generated UUID for the new set.
#[tauri::command]
pub fn highlight_create_set(
    state: State<'_, HighlightManager>,
    input: CreateHighlightSetInput,
) -> Result<String, String> {
    state.create_set(input).map_err(|e| e.to_string())
}

/// Updates an existing highlight set with partial fields.
#[tauri::command]
pub fn highlight_update_set(
    state: State<'_, HighlightManager>,
    id: String,
    input: UpdateHighlightSetInput,
) -> Result<(), String> {
    state.update_set(&id, input).map_err(|e| e.to_string())
}

/// Deletes a highlight set by ID.
#[tauri::command]
pub fn highlight_delete_set(state: State<'_, HighlightManager>, id: String) -> Result<(), String> {
    state.delete_set(&id).map_err(|e| e.to_string())
}
