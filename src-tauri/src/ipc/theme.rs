/// IPC commands for theme management operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command validates its
/// input and delegates to `ThemeManager`.
use tauri::State;

use crate::theme::{
    CreateThemeInput, Theme, ThemeExport, ThemeManager, UpdateThemeInput,
};

/// Lists all themes (built-in + custom).
#[tauri::command]
pub fn theme_list(state: State<'_, ThemeManager>) -> Result<Vec<Theme>, String> {
    state.list_themes().map_err(|e| e.to_string())
}

/// Gets a single theme by ID.
#[tauri::command]
pub fn theme_get(state: State<'_, ThemeManager>, id: String) -> Result<Theme, String> {
    state.get_theme(&id).map_err(|e| e.to_string())
}

/// Creates a new custom theme. Returns the generated UUID.
#[tauri::command]
pub fn theme_create(
    state: State<'_, ThemeManager>,
    input: CreateThemeInput,
) -> Result<String, String> {
    state.create_theme(input).map_err(|e| e.to_string())
}

/// Updates an existing custom theme with partial fields.
#[tauri::command]
pub fn theme_update(
    state: State<'_, ThemeManager>,
    id: String,
    input: UpdateThemeInput,
) -> Result<(), String> {
    state.update_theme(&id, input).map_err(|e| e.to_string())
}

/// Deletes a custom theme by ID.
#[tauri::command]
pub fn theme_delete(state: State<'_, ThemeManager>, id: String) -> Result<(), String> {
    state.delete_theme(&id).map_err(|e| e.to_string())
}

/// Imports a theme from a ThemeExport JSON payload.
#[tauri::command]
pub fn theme_import(
    state: State<'_, ThemeManager>,
    data: ThemeExport,
) -> Result<String, String> {
    state.import_theme(data).map_err(|e| e.to_string())
}

/// Exports a theme as a ThemeExport JSON payload.
#[tauri::command]
pub fn theme_export(state: State<'_, ThemeManager>, id: String) -> Result<ThemeExport, String> {
    state.export_theme(&id).map_err(|e| e.to_string())
}
