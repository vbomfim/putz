mod commands;
mod ipc;
mod logging;
mod protocol;
mod pty;
mod session;
mod vault;

use commands::greet;
use ipc::{
    connection_close, connection_open, connection_resize, connection_write,
    logging_start, logging_status, logging_stop,
    pty_close, pty_resize, pty_spawn, pty_write, serial_list_ports, serial_send_break,
    session_create, session_create_folder, session_delete, session_delete_folder,
    session_duplicate, session_export, session_get, session_import, session_list,
    session_move, session_search, session_update, vault_delete, vault_get, vault_list,
    vault_set,
};
use logging::LogManager;
use protocol::connection_manager::ConnectionManager;
use pty::PtyManager;
use session::SessionManager;
use vault::VaultManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::new())
        .manage(SessionManager::new())
        .manage(ConnectionManager::new())
        .manage(VaultManager::new())
        .manage(LogManager::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            connection_open,
            connection_write,
            connection_resize,
            connection_close,
            serial_list_ports,
            serial_send_break,
            session_list,
            session_get,
            session_create,
            session_update,
            session_delete,
            session_move,
            session_duplicate,
            session_search,
            session_import,
            session_export,
            session_create_folder,
            session_delete_folder,
            vault_list,
            vault_get,
            vault_set,
            vault_delete,
            logging_start,
            logging_stop,
            logging_status,
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
