/// Logging module — session logging infrastructure.
///
/// Provides file-based logging for terminal sessions with configurable
/// ANSI stripping, timestamps, and file rotation.
pub mod config;
pub mod error;
pub mod manager;
pub mod session_logger;

pub use config::{LogConfig, LogStatus};
#[allow(unused_imports)] // Re-exported for public API; currently used only in ipc::logging tests
pub use error::LogError;
pub use manager::LogManager;
pub use session_logger::SessionLogger;
