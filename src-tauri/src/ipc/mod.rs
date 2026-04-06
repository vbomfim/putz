/// IPC module — Tauri command handlers for frontend–backend communication.
pub mod terminal;

pub use terminal::{pty_close, pty_resize, pty_spawn, pty_write};
