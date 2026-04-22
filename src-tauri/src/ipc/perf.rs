//! Tauri commands for frontend perf logging.

#[tauri::command]
pub fn perf_log(line: String) {
    crate::perf::log(&format!("[js] {line}"));
}

#[tauri::command]
pub fn perf_log_path() -> String {
    crate::perf::path_string()
}

#[tauri::command]
pub fn perf_enabled() -> bool {
    crate::perf::is_enabled()
}
