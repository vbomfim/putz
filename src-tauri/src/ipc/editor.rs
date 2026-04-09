//! File read/write IPC commands for the editor tab.
//!
//! Provides simple file I/O for the Monaco editor to open and save files.

/// Read a file's content as UTF-8 text.
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Write content to a file (creates or overwrites).
#[tauri::command]
pub fn file_write(path: String, content: String) -> Result<(), String> {
    // Create parent directories if they don't exist
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}
