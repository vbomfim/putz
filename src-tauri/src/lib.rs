mod commands;
mod ipc;
mod pty;

use commands::greet;
use ipc::{pty_close, pty_resize, pty_spawn, pty_write};
use pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            greet, pty_spawn, pty_write, pty_resize, pty_close
        ])
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
        assert_eq!(result, "Hello there! You've been greeted from Rust!");
    }

    #[test]
    fn greet_handles_whitespace_only_name() {
        let result = greet("   ");
        assert_eq!(result, "Hello there! You've been greeted from Rust!");
    }

    #[test]
    fn greet_trims_whitespace() {
        let result = greet("  Alice  ");
        assert_eq!(result, "Hello, Alice! You've been greeted from Rust!");
    }

    #[test]
    fn greet_handles_special_characters() {
        let result = greet("O'Brien");
        assert_eq!(result, "Hello, O'Brien! You've been greeted from Rust!");
    }

    #[test]
    fn greet_rejects_name_exceeding_max_length() {
        let long_name = "a".repeat(257);
        let result = greet(&long_name);
        assert_eq!(result, "Name is too long");
    }

    #[test]
    fn greet_accepts_name_at_max_length() {
        let name = "a".repeat(256);
        let result = greet(&name);
        assert!(result.starts_with("Hello, "));
        assert!(result.ends_with("! You've been greeted from Rust!"));
    }
}
