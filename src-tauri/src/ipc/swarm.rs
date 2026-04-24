/// Tauri IPC commands for the swarm feature.
///
/// Three commands:
/// - `swarm_set_enabled(enabled)` — start/stop the swarm broker
/// - `swarm_get_state()` — return current SwarmStatePublic (no token, H3)
/// - `swarm_spawn_colleague(name, initial_prompt)` — request a new colleague tab
use tauri::State;

use crate::swarm::SwarmCoordinator;

/// Enable or disable the swarm broker.
///
/// When enabled, starts the HTTP server and stale sweeper.
/// When disabled, stops the HTTP server and clears all state.
/// Emits `swarm://state-changed` with `SwarmStatePublic` (no token, H3).
#[tauri::command]
pub async fn swarm_set_enabled(
    state: State<'_, SwarmCoordinator>,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use tauri::Emitter;

    if enabled {
        // start() already emits state-changed with SwarmStatePublic (H3)
        state.start(app.clone()).await.map_err(|e| e.to_string())?;
    } else {
        state.stop().await;
        // Emit disabled state (stop() doesn't emit)
        let public = state.state_public().await;
        let _ = app.emit("swarm://state-changed", &public);
    }

    Ok(())
}

/// Get the current swarm state for frontend display (H3: no token exposed).
#[tauri::command]
pub async fn swarm_get_state(
    state: State<'_, SwarmCoordinator>,
) -> Result<crate::swarm::SwarmStatePublic, String> {
    Ok(state.state_public().await)
}

/// Spawn a new colleague agent tab.
///
/// Uses `coordinator.colleague_env_vars()` (M1) to build a consistent env map
/// including `COPILOT_COLLEAGUE_PARENT` (L1).
///
/// This is a fire-and-forget command. The actual tab creation happens
/// via a `swarm://spawn-tab` event emitted to the frontend.
#[tauri::command]
pub async fn swarm_spawn_colleague(
    state: State<'_, SwarmCoordinator>,
    app: tauri::AppHandle,
    name: String,
    initial_prompt: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    if !state.enabled() {
        return Err("Swarm is not enabled".into());
    }

    let colleague_id = SwarmCoordinator::generate_colleague_id(&name);
    let tab_id = uuid::Uuid::new_v4().to_string();

    // M1: Use consolidated colleague_env_vars() — no duplication (L1: includes COPILOT_COLLEAGUE_PARENT)
    let env = state
        .colleague_env_vars(
            &tab_id,
            &colleague_id,
            &name,
            "self", // spawned from IPC → parent is self
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

/// Deregister all colleagues associated with a tab.
///
/// Called by the frontend when a swarm tab is closed, ensuring the
/// broker cleans up the colleague entry immediately rather than
/// waiting for the stale sweeper.
#[tauri::command]
pub async fn swarm_deregister_by_tab(
    state: State<'_, SwarmCoordinator>,
    tab_id: String,
) -> Result<(), String> {
    if !state.enabled() {
        return Ok(()); // No-op when swarm is disabled
    }
    state.deregister_by_tab(&tab_id).await;
    Ok(())
}
