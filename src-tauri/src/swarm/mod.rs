//! Swarm subsystem — local-IPC roster + routing for Copilot CLI colleagues.
//!
//! Replaces the Phase-1 HTTP broker (#140 / spec `putz-copilot-swarm`).
//! Surface is a per-process Unix socket / Windows named pipe — zero open
//! network ports, OS-level auth via file permissions.
//!
//! Layout:
//! - `wire`        — length-prefixed JSON frame codec
//! - `types`       — shared serializable types (no I/O)
//! - `socket`      — cross-platform listener + per-connection task
//! - `coordinator` — in-process registry, routing, heartbeat sweep
pub mod coordinator;
pub mod lifecycle;
pub mod socket;
pub mod spawn_recipe;
pub mod types;
pub mod wire;

pub use coordinator::SwarmCoordinator;
pub use spawn_recipe::{
    load_workspace_recipes, ErrorKind as RecipeErrorKind, LoadRecipeError, LoadResult, SpawnRecipe,
};
pub use types::SwarmStatePublic;
