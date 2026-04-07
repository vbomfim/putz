/// Compliance module — change window enforcement for network operations.
///
/// Architecture:
/// - Change windows define when dangerous commands are permitted
/// - Commands like `configure terminal`, `write mem`, `commit` are flagged
/// - Users get a warning when executing dangerous commands outside windows
/// - Config persisted to `change_windows.json`
pub mod error;
pub mod manager;
pub mod models;

pub use manager::ChangeWindowManager;
pub use models::*;
