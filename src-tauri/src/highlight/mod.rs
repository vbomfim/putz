/// Highlight management module — keyword highlighting rules and presets.
///
/// Provides persistence, CRUD, validation, and built-in presets
/// for terminal keyword highlighting.
pub mod error;
pub mod manager;
pub mod models;
pub mod validation;

pub use manager::HighlightManager;
pub use models::*;
