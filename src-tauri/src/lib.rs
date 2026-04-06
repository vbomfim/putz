mod commands;

use commands::greet;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::commands::greet;

    #[test]
    fn greet_returns_formatted_message() {
        let result = greet("World");
        assert_eq!(result, "Hello, World! You've been greeted from Rust!");
    }

    #[test]
    fn greet_handles_empty_name() {
        let result = greet("");
        assert_eq!(result, "Hello, ! You've been greeted from Rust!");
    }

    #[test]
    fn greet_handles_special_characters() {
        let result = greet("O'Brien");
        assert_eq!(result, "Hello, O'Brien! You've been greeted from Rust!");
    }
}
