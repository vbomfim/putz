pub mod error;
pub mod manager;

#[allow(unused_imports)]
pub use error::PtyError;
pub use manager::PtyManager;
pub use manager::resolve_copilot_binary;
