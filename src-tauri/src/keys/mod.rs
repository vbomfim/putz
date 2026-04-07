/// SSH key management module — generation, import, storage, and fingerprints.
///
/// Architecture:
/// - Metadata (names, algorithms, fingerprints) stored in `keys/index.json`
/// - Private keys stored as individual files (`keys/{id}.key`) with 0600 perms
/// - Public keys and fingerprints are safe for IPC/frontend
///
/// SECURITY:
/// - Private keys NEVER cross the IPC boundary
/// - `get_key_path()` is Rust-only — never exposed via IPC
/// - Key generation uses OS CSPRNG
/// - File permissions 0600 on Unix
pub mod error;
pub mod manager;
pub mod models;
pub mod validation;

pub use manager::KeyManager;
pub use models::*;
