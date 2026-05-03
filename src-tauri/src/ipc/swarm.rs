//! Tauri IPC commands for the swarm subsystem.
//!
//! Surface preserved from the HTTP-broker era so the React/Settings
//! layer doesn't need changes (T4 owns any UX-side renames):
//!   * `swarm_set_enabled(enabled)` — start/stop the local listener.
//!   * `swarm_get_state()` — current `SwarmStatePublic` (path, count, ids).
//!   * `swarm_spawn_colleague(name, initial_prompt)` — request a new
//!     colleague tab via the `swarm://spawn-tab` event.
use tauri::State;

use crate::swarm::SwarmCoordinator;

/// Enable or disable the swarm. When enabling, binds the local socket
/// and starts the accept loop + heartbeat sweeper. When disabling,
/// cancels both, drops the registry, and unlinks the socket file (Unix).
#[tauri::command]
pub async fn swarm_set_enabled(
    state: State<'_, SwarmCoordinator>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use tauri::Emitter;

    if enabled {
        // start() emits state-changed itself.
        state.start(app.clone()).await.map(|_| ())?;
    } else {
        state.stop().await;
        let public = state.state_public().await;
        let _ = app.emit("swarm://state-changed", &public);
    }
    Ok(())
}

/// Read-only state for frontend display. Never contains secrets — the
/// path is non-sensitive (it's a file mode-600 owned by the same user).
#[tauri::command]
pub async fn swarm_get_state(
    state: State<'_, SwarmCoordinator>,
) -> Result<crate::swarm::SwarmStatePublic, String> {
    Ok(state.state_public().await)
}

/// Spawn a colleague tab. Fire-and-forget — the actual tab creation
/// happens in the frontend in response to the `swarm://spawn-tab` event.
#[tauri::command]
pub async fn swarm_spawn_colleague(
    state: State<'_, SwarmCoordinator>,
    app: tauri::AppHandle,
    name: String,
    // @privacy Tier-2 PII — never log, never persist, never forward to telemetry.
    // Free-form user-authored prompt; may contain user content / secrets. See PRI-001/002.
    initial_prompt: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    if !state.enabled() {
        return Err("Swarm is not enabled".into());
    }

    let colleague_id = SwarmCoordinator::generate_colleague_id(&name);
    let tab_id = uuid::Uuid::new_v4().to_string();

    let env = state
        .colleague_env_vars(
            &tab_id,
            &colleague_id,
            &name,
            "self",
            initial_prompt.as_deref(),
        )
        .await
        .ok_or("Swarm not configured")?;

    let payload = serde_json::json!({
        "name": name,
        "env": env,
        "shell": "copilot",
        "args": ["--yolo", "--experimental"],
        "colleague_id": colleague_id,
        "tab_id": tab_id,
    });

    app.emit("swarm://spawn-tab", &payload)
        .map_err(|e| e.to_string())?;
    Ok(())
}
