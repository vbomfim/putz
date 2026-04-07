/// IPC command handlers for the template engine.
///
/// Exposes template CRUD and execution as Tauri commands.
use tauri::State;

use crate::templates::models::*;
use crate::templates::TemplateManager;

/// Lists all saved templates (metadata only).
#[tauri::command]
pub fn template_list(
    state: State<'_, TemplateManager>,
) -> Vec<TemplateMeta> {
    state.list()
}

/// Gets a template's metadata, content, and variables by ID.
#[tauri::command]
pub fn template_get(
    state: State<'_, TemplateManager>,
    id: String,
) -> Result<TemplateWithContent, String> {
    state.get(&id).map_err(|e| e.to_string())
}

/// Creates or updates a template. Returns the template ID.
#[tauri::command]
pub fn template_create(
    state: State<'_, TemplateManager>,
    input: SaveTemplateInput,
) -> Result<String, String> {
    state.create(input).map_err(|e| e.to_string())
}

/// Deletes a template by ID (built-in templates cannot be deleted).
#[tauri::command]
pub fn template_delete(
    state: State<'_, TemplateManager>,
    id: String,
) -> Result<(), String> {
    state.delete(&id).map_err(|e| e.to_string())
}

/// Executes a template by substituting variables. Returns the rendered text.
#[tauri::command]
pub fn template_execute(
    state: State<'_, TemplateManager>,
    input: ExecuteTemplateInput,
) -> Result<String, String> {
    state.execute(input).map_err(|e| e.to_string())
}
