/// Greet command — returns a personalized greeting from the Rust backend.
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
