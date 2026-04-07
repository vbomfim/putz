/// Session auto-login module — pattern-based automatic authentication.
///
/// Architecture:
/// - Built-in device patterns for Cisco IOS, Junos, and Linux
/// - Per-session login profiles with expect/send step sequences
/// - Variable substitution: `${username}`, `${password}` (from vault)
/// - Pattern matching on terminal output to detect prompts
///
/// SECURITY:
/// - Credentials come from the vault module (never stored here)
/// - Variables are substituted at match time — plaintext is never persisted
pub mod error;
pub mod manager;
pub mod models;

pub use manager::AutoLoginManager;
pub use models::*;
