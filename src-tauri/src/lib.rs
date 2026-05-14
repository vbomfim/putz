#![allow(dead_code)]

mod commands;
mod highlight;
mod ipc;
mod menu;
mod perf;
mod pty;
mod scripting;
mod shell_integration;
mod swarm;
mod theme;

use commands::greet;
use highlight::HighlightManager;
use ipc::{
    audio_proxy_url, copilot_check_installed, copilot_get_extension_dir, copilot_get_status,
    copilot_install_extension, copilot_uninstall_extension, dir_list, file_mtime, file_read,
    file_replace, file_replace_all, file_search, file_write, git_branches, git_checkout,
    git_file_at_commit, git_log, git_pull, git_push, git_remotes, git_repo_root,
    git_rev_parse_head, git_show, git_stash_list, git_status, git_status_summary, git_tags,
    git_worktree_list, highlight_create_set, highlight_delete_set, highlight_get_set,
    highlight_list_sets, highlight_update_set, perf_enabled, perf_log, perf_log_path, pty_close,
    pty_cwd, pty_list_shells, pty_resize, pty_spawn, pty_write,
    script_delete, script_get,
    script_list, script_record_start, script_record_stop, script_run, script_run_multi,
    script_save, script_status, script_stop, shell_integration_cmd_install_confirmed,
    shell_integration_cmd_preview, shell_integration_cmd_show_existing,
    shell_integration_cmd_uninstall, shell_integration_detect, shell_integration_install,
    shell_integration_show_snippet, shell_integration_status, shell_integration_uninstall,
    swarm_get_roster, swarm_get_state, swarm_read_workspace_recipes, swarm_send_notify,
    swarm_set_enabled, swarm_spawn_colleague, swarm_spawn_from_recipe, swarm_update_status,
    theme_create, theme_delete, theme_export, theme_get, theme_import, theme_list, theme_update,
};
use pty::PtyManager;
use scripting::ScriptManager;
use swarm::SwarmCoordinator;
use theme::ThemeManager;

// Needed for try_state() in on_window_event handler
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    perf::log("=== putz startup ===");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, &event);
        })
        .manage(PtyManager::new())
        .manage(HighlightManager::new())
        .manage(ScriptManager::new())
        .manage(ThemeManager::new())
        .manage(SwarmCoordinator::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            pty_cwd,
            pty_list_shells,
            perf_enabled,
            perf_log,
            perf_log_path,
            highlight_list_sets,
            highlight_get_set,
            highlight_create_set,
            highlight_update_set,
            highlight_delete_set,
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
            file_read,
            file_write,
            file_mtime,
            file_search,
            file_replace,
            file_replace_all,
            dir_list,
            git_log,
            git_branches,
            git_status,
            git_show,
            git_stash_list,
            git_remotes,
            git_rev_parse_head,
            git_file_at_commit,
            git_repo_root,
            git_worktree_list,
            git_status_summary,
            git_checkout,
            audio_proxy_url,
            git_push,
            git_pull,
            git_tags,
            swarm_set_enabled,
            swarm_get_state,
            swarm_get_roster,
            swarm_spawn_colleague,
            swarm_spawn_from_recipe,
            swarm_read_workspace_recipes,
            swarm_send_notify,
            swarm_update_status,
            shell_integration_detect,
            shell_integration_install,
            shell_integration_uninstall,
            shell_integration_status,
            shell_integration_show_snippet,
            shell_integration_cmd_preview,
            shell_integration_cmd_show_existing,
            shell_integration_cmd_install_confirmed,
            shell_integration_cmd_uninstall,
            copilot_check_installed,
            copilot_get_extension_dir,
            copilot_get_status,
            copilot_install_extension,
            copilot_uninstall_extension,
        ])
        // Fix 8: Graceful app exit — clean up PTY sessions
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() != "main" {
                    return;
                }
                // Close all PTY sessions (sends SIGHUP to child processes)
                let pty_mgr: tauri::State<'_, PtyManager> = window.state();
                pty_mgr.close_all();
                // Stop swarm broker if running
                let swarm: tauri::State<'_, SwarmCoordinator> = window.state();
                tauri::async_runtime::block_on(swarm.stop());
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
