/// Maximum allowed length for the `name` parameter.
const MAX_NAME_LENGTH: usize = 256;

/// Greet command — returns a personalized greeting from the Rust backend.
///
/// Validates input: empty/whitespace-only names produce a generic greeting,
/// and names exceeding 256 characters are rejected.
#[tauri::command]
pub fn greet(name: &str) -> String {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return "Hello there! You've been greeted from Rust!".to_string();
    }

    if trimmed.len() > MAX_NAME_LENGTH {
        return "Name is too long".to_string();
    }

    format!("Hello, {}! You've been greeted from Rust!", trimmed)
}
