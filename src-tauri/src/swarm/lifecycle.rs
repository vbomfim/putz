//! Lifecycle glue between the IPC layer (which decides *where* the
//! transport binds) and the coordinator (which doesn't care).
//!
//! This module exists to invert the dependency that previously lived in
//! [`crate::swarm::coordinator::SwarmCoordinator::start`]: the
//! coordinator no longer constructs its own transport — callers pass
//! a factory closure that yields a bound [`Listener`]. The coordinator
//! invokes the factory inside its lifecycle mutex, so binding remains
//! race-free, but the coordinator itself is now pure policy (registry,
//! routing, heartbeat sweep) decoupled from socket mechanics
//! (CR-Opus pass-1 #5 — Dependency Inversion).
//!
//! Production callers use [`bind_pid_listener`] which preserves the
//! original behaviour — bind at the per-process pid path. Tests are
//! free to substitute any other factory (in-memory mock, tempdir-bound
//! listener, etc.) without touching coordinator code.
use std::io;

use super::socket::{resolve_socket_path, Listener};

/// Factory that binds a [`Listener`] at the per-process pid path.
/// This is the production wiring used by [`crate::ipc::swarm::swarm_set_enabled`].
pub fn bind_pid_listener() -> io::Result<Listener> {
    let path = resolve_socket_path(std::process::id());
    Listener::bind(path)
}
