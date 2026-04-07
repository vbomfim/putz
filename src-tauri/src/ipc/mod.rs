/// IPC module — Tauri command handlers for frontend–backend communication.
pub mod session;
pub mod terminal;

pub use session::{
    session_create, session_create_folder, session_delete, session_delete_folder,
    session_duplicate, session_export, session_get, session_import, session_list,
    session_move, session_search, session_update,
};
pub use terminal::{pty_close, pty_resize, pty_spawn, pty_write};
