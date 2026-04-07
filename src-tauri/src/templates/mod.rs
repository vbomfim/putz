/// Command Templates module — reusable command templates with variable substitution.
///
/// Provides a `TemplateManager` for CRUD operations on templates and
/// variable extraction/substitution for executing templates against
/// terminal sessions.
///
/// Templates use `{{variable}}` syntax for placeholder substitution.
pub mod error;
pub mod manager;
pub mod models;

pub use manager::TemplateManager;
pub use models::*;
