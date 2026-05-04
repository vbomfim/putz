//! Tauri IPC commands for the swarm subsystem.
//!
//! Surface preserved from the HTTP-broker era so the React/Settings
//! layer doesn't need changes (T4 owns any UX-side renames):
//!   * `swarm_set_enabled(enabled)` — start/stop the local listener.
//!   * `swarm_get_state()` — current `SwarmStatePublic` (path, count, ids).
//!   * `swarm_spawn_colleague(name, initial_prompt)` — request a new
//!     colleague tab via the `swarm://spawn-tab` event.
use tauri::State;

use crate::swarm::{lifecycle::bind_pid_listener, SwarmCoordinator};

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
        // DIP (CR-Opus pass-1 #5): we own the transport-binding policy;
        // the coordinator just runs whatever Listener we give it.
        state
            .start(app.clone(), bind_pid_listener)
            .await
            .map(|_| ())?;
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

/// T3 / FR-011 — push an OSC-derived **full status snapshot** from the
/// frontend projection layer into the coordinator.
///
/// **Full-snapshot semantics** (CR-GPT pass-2 #2): the renderer always
/// sends every field on every push. `Option::None` means "this field is
/// genuinely unset" — NOT "skip update". This lets the renderer clear
/// previously-populated fields (e.g., reset `cwd` to `None` after a
/// session reset). The "no change → no broadcast" check inside
/// `update_status` keeps the wire calm.
///
/// **Security:** the coordinator validates `tab_id` against its known
/// roster — unknown tabs are rejected with `unknown_tab`. This is the
/// primary defense against a buggy renderer or compromised content
/// pushing bogus status updates for unrelated tabs.
///
/// **Privacy:** `cwd` (inside `snapshot`) is **@privacy Tier-2**
/// (quasi-identifier — see PRI-001/002). The coordinator stores it
/// in-process only and forwards it to peer colleagues over the local
/// socket per FR-011. It is NEVER logged to stderr / persisted /
/// forwarded to telemetry.
#[tauri::command]
pub async fn swarm_update_status(
    state: State<'_, SwarmCoordinator>,
    app: tauri::AppHandle,
    tab_id: String,
    snapshot: crate::swarm::types::StatusSnapshot,
) -> Result<(), String> {
    state.update_status(app, &tab_id, snapshot).await
}
