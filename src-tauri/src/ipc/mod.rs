/// IPC module — Tauri command handlers for frontend–backend communication.
pub mod connection;
pub mod highlight;
pub mod logging;
pub mod session;
pub mod sftp;
pub mod terminal;
pub mod theme;
pub mod vault;

pub use connection::{
    connection_close, connection_open, connection_resize, connection_write, serial_list_ports,
    serial_send_break,
};
pub use highlight::{
    highlight_create_set, highlight_delete_set, highlight_get_set, highlight_list_sets,
    highlight_update_set,
};
pub use logging::{logging_start, logging_status, logging_stop};
pub use session::{
    session_create, session_create_folder, session_delete, session_delete_folder,
    session_duplicate, session_export, session_get, session_import, session_list, session_move,
    session_search, session_update,
};
pub use sftp::{
    sftp_close, sftp_delete, sftp_download, sftp_list, sftp_mkdir,
    sftp_open, sftp_rename, sftp_stat, sftp_upload,
};
pub use terminal::{pty_close, pty_resize, pty_spawn, pty_write};
pub use theme::{
    theme_create, theme_delete, theme_export, theme_get, theme_import, theme_list, theme_update,
};
pub use vault::{vault_delete, vault_get, vault_list, vault_set};
