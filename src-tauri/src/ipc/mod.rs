/// IPC module — Tauri command handlers for frontend–backend communication.
pub mod editor;
pub mod highlight;
pub mod perf;
pub mod scripting;
pub mod terminal;
pub mod theme;

pub mod audio_proxy;
pub mod git;
pub use audio_proxy::audio_proxy_url;

pub use editor::{
    dir_list, file_mtime, file_read, file_replace, file_replace_all, file_search, file_write,
};
pub use highlight::{
    highlight_create_set, highlight_delete_set, highlight_get_set, highlight_list_sets,
    highlight_update_set,
};
pub use perf::{perf_enabled, perf_log, perf_log_path};
pub use scripting::{
    script_delete, script_get, script_list, script_record_start, script_record_stop, script_run,
    script_run_multi, script_save, script_status, script_stop,
};
pub mod swarm;
pub use git::{
    git_branches, git_checkout, git_file_at_commit, git_log, git_pull, git_push, git_remotes,
    git_repo_root, git_rev_parse_head, git_show, git_stash_list, git_status, git_status_summary,
    git_tags, git_worktree_list,
};
pub use swarm::{swarm_get_state, swarm_set_enabled, swarm_spawn_colleague};
pub use terminal::{pty_close, pty_cwd, pty_list_shells, pty_resize, pty_spawn, pty_write};
pub use theme::{
    theme_create, theme_delete, theme_export, theme_get, theme_import, theme_list, theme_update,
};
pub mod shell_integration;
pub use shell_integration::{
    shell_integration_cmd_install_confirmed, shell_integration_cmd_preview,
    shell_integration_cmd_show_existing, shell_integration_cmd_uninstall, shell_integration_detect,
    shell_integration_install, shell_integration_show_snippet, shell_integration_status,
    shell_integration_uninstall,
};
