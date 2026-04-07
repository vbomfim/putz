/// Credential vault module — secure storage for passwords and passphrases.
///
/// Architecture:
/// - Metadata (names, types, timestamps) stored in `vault-index.json`
/// - Secrets stored in OS keychain (macOS Keychain, Windows Credential Manager,
///   Linux libsecret) via the `keyring` crate
/// - Keyring trait allows mocking for CI testing
///
/// SECURITY:
/// - `get_for_session()` is Rust-only — never exposed via IPC
/// - Secrets never written to disk files
/// - Secrets zeroized in memory via `Drop` + `zeroize`
pub mod error;
pub mod keyring;
pub mod manager;
pub mod models;
pub mod validation;

pub use manager::VaultManager;
pub use models::*;
