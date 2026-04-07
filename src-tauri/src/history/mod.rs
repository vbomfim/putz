/// Cross-session command history module — SQLite-backed command recall.
///
/// Architecture:
/// - SQLite database at `~/.config/putz/command_history.db`
/// - Stores commands with session context (host, session name)
/// - Supports full-text search and per-session recall
/// - Auto-prunes oldest entries when limit (100K) is exceeded
///
/// Thread-safe via `Mutex<rusqlite::Connection>`.
pub mod error;
pub mod manager;
pub mod models;

pub use manager::CommandHistoryManager;
pub use models::*;
