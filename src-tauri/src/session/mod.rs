/// Session management module — saved session profiles and folder organization.
///
/// Provides persistence, CRUD, search, import/export, and backup functionality
/// for saved terminal sessions.
pub mod error;
pub mod manager;
pub mod models;
pub mod validation;

pub use manager::SessionManager;
pub use models::*;
