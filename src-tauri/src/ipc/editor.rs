//! File read/write IPC commands for the editor tab.
//!
//! Provides simple file I/O for the Monaco editor to open and save files.

/// Read a file's content as UTF-8 text.
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Get the modification timestamp of a file (ms since epoch).
#[tauri::command]
pub fn file_mtime(path: String) -> Result<u64, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat {}: {}", path, e))?;
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get mtime {}: {}", path, e))?;
    let duration = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?;
    Ok(duration.as_millis() as u64)
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
