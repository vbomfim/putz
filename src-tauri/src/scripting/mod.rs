/// Scripting module — sandboxed JavaScript automation for terminal sessions.
///
/// Provides a `ScriptManager` for CRUD operations on scripts and a
/// `ScriptEngine` (boa_engine) for sandboxed execution with the Putz API.
pub mod engine;
pub mod error;
pub mod manager;
pub mod models;
pub mod recorder;
pub mod validation;

pub use manager::ScriptManager;
pub use models::*;
