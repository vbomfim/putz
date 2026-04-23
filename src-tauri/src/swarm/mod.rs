/// Swarm module — in-process HTTP broker for Copilot CLI colleague agents.
///
/// Feature-flagged and disabled by default. When enabled, provides:
/// - Localhost HTTP server with bearer-token auth (8 endpoints)
/// - In-memory colleague registry with heartbeat/stale detection
/// - Per-colleague SSE event streams
/// - Env var injection into PTY sessions
///
/// Architecture:
/// - `models.rs` — data types (Colleague, Message, Severity, SseEvent, etc.)
/// - `coordinator.rs` — registry, routing, lifecycle management
/// - `http_server.rs` — axum HTTP server with all endpoints
pub mod coordinator;
pub mod http_server;
pub mod models;

pub use coordinator::SwarmCoordinator;
pub use models::SwarmStatePublic;
