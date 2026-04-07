/// Theme management module — terminal color scheme configuration.
///
/// Provides persistence, CRUD, validation, and built-in themes
/// for terminal color customization.
pub mod error;
pub mod manager;
pub mod models;
pub mod validation;

pub use manager::ThemeManager;
pub use models::*;
