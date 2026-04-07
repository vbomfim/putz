mod commands;
mod highlight;
mod ipc;
mod keys;
mod logging;
mod menu;
mod protocol;
mod pty;
mod scripting;
mod session;
mod theme;
mod vault;

use commands::greet;
use highlight::HighlightManager;
use ipc::{
    connection_close, connection_open, connection_resize, connection_write,
    forwarding_add, forwarding_list, forwarding_remove, forwarding_status,
    highlight_create_set,
    highlight_delete_set, highlight_get_set, highlight_list_sets, highlight_update_set,
    key_delete, key_generate, key_get_public, key_import, key_list,
    logging_start, logging_status, logging_stop, pty_close, pty_resize, pty_spawn, pty_write,
    script_delete, script_get, script_list, script_record_start, script_record_stop, script_run,
    script_run_multi, script_save, script_status, script_stop, serial_list_ports,
    serial_send_break, session_create, session_create_folder, session_delete,
    session_delete_folder, session_duplicate, session_export, session_get, session_import,
    session_list, session_move, session_search, session_update, sftp_close, sftp_delete,
    sftp_download, sftp_list, sftp_mkdir, sftp_open, sftp_rename, sftp_stat, sftp_upload,
    theme_create, theme_delete, theme_export, theme_get, theme_import, theme_list, theme_update,
    vault_delete, vault_get, vault_list, vault_set,
};
use keys::KeyManager;
use logging::LogManager;
use protocol::connection_manager::ConnectionManager;
use protocol::sftp::SftpManager;
use protocol::ssh::forwarding::ForwardingManager;
use pty::PtyManager;
use scripting::ScriptManager;
use session::SessionManager;
use theme::ThemeManager;
use vault::VaultManager;

// Needed for try_state() in on_window_event handler
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, &event);
        })
        .manage(PtyManager::new())
        .manage(SessionManager::new())
        .manage(ConnectionManager::new())
        .manage(VaultManager::new())
        .manage(KeyManager::new())
        .manage(LogManager::new())
        .manage(SftpManager::new())
        .manage(HighlightManager::new())
        .manage(ScriptManager::new())
        .manage(ThemeManager::new())
        .manage(ForwardingManager::new())
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
            forwarding_add,
            forwarding_remove,
            forwarding_list,
            forwarding_status,
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
            sftp_open,
            sftp_list,
            sftp_stat,
            sftp_download,
            sftp_upload,
            sftp_rename,
            sftp_delete,
            sftp_mkdir,
            sftp_close,
            vault_list,
            vault_get,
            vault_set,
            vault_delete,
            logging_start,
            logging_stop,
            logging_status,
            highlight_list_sets,
            highlight_get_set,
            highlight_create_set,
            highlight_update_set,
            highlight_delete_set,
            key_list,
            key_generate,
            key_import,
            key_delete,
            key_get_public,
            script_list,
            script_get,
            script_save,
            script_delete,
            script_run,
            script_run_multi,
            script_status,
            script_stop,
            script_record_start,
            script_record_stop,
            theme_list,
            theme_get,
            theme_create,
            theme_update,
            theme_delete,
            theme_import,
            theme_export,
        ])
        // Fix 8: Graceful app exit — clean up PTY sessions and protocol connections
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Close all PTY sessions (sends SIGHUP to child processes)
                let pty_mgr: tauri::State<'_, PtyManager> = window.state();
                pty_mgr.close_all();
                // Close all protocol connections
                let conn_mgr: tauri::State<'_, ConnectionManager> = window.state();
                // Block briefly on async close — app is exiting anyway
                tauri::async_runtime::block_on(conn_mgr.close_all());
            }
        })
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
