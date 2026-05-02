/// HTTP server for the swarm broker.
///
/// Axum-based localhost server with bearer-token authentication.
/// All 8 swarm endpoints are defined here as thin adapters that
/// delegate to `SwarmCoordinator` methods (H1).
///
/// The server binds to `127.0.0.1:0` (random port) and is managed by
/// the `SwarmCoordinator` via a `CancellationToken`.
use std::convert::Infallible;

use axum::{
    extract::{DefaultBodyLimit, Query, State as AxumState},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Sse,
    },
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::coordinator::SwarmCoordinator;
use super::models::*;

/// App state passed to every handler.
/// Holds a cheap-to-clone `SwarmCoordinator` (Arc internals) (H1)
/// and the bound port for host validation (H5).
#[derive(Clone)]
struct AppState {
    coordinator: SwarmCoordinator,
    token: String,
    port: u16,
    app_handle: tauri::AppHandle,
}

/// Start the HTTP server. Returns `(port, JoinHandle)` so the caller can
/// await graceful shutdown (M8).
pub(crate) async fn start_server(
    coordinator: SwarmCoordinator,
    token: String,
    cancel: CancellationToken,
    app_handle: tauri::AppHandle,
) -> Result<(u16, JoinHandle<()>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let state = AppState {
        coordinator,
        token,
        port,
        app_handle,
    };

    let app = Router::new()
        .route("/swarm/register", post(handle_register))
        .route("/swarm/deregister", post(handle_deregister))
        .route("/swarm/heartbeat", post(handle_heartbeat))
        .route("/swarm/roster", get(handle_roster))
        .route("/swarm/spawn", post(handle_spawn))
        .route("/swarm/messages", post(handle_messages))
        .route("/swarm/stream", get(handle_stream))
        .route("/swarm/focus", post(handle_focus))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            host_check_middleware,
        ))
        // M3: Limit request body to 64 KiB
        .layer(DefaultBodyLimit::max(65_536))
        .with_state(state);

    let handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(cancel.cancelled_owned())
            .await
            .ok();
    });

    Ok((port, handle))
}

// ─── Host Check Middleware (H5) ──────────────────────────────────────

/// Reject requests from unexpected Host or Origin headers (DNS rebinding protection, H5).
///
/// Allowed hosts: `127.0.0.1:{port}`, `localhost:{port}`.
/// If an `Origin` header is present it must also match the allowed set.
/// Missing `Host` → 403.
async fn host_check_middleware(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: middleware::Next,
) -> impl IntoResponse {
    let port = state.port;
    let allowed = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];

    // Check Host header (required)
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !allowed.iter().any(|a| a == host) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "forbidden"}))).into_response();
    }

    // Check Origin header (optional — absent is OK for same-origin requests)
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let origin_allowed = allowed.iter().any(|a| origin == format!("http://{a}"));
        if !origin_allowed {
            return (StatusCode::FORBIDDEN, Json(json!({"error": "forbidden"}))).into_response();
        }
    }

    next.run(request).await.into_response()
}

// ─── Auth Middleware (H4) ────────────────────────────────────────────

/// Bearer token authentication with constant-time comparison (H4).
async fn auth_middleware(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: middleware::Next,
) -> impl IntoResponse {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let expected = format!("Bearer {}", state.token);

    // H4: Constant-time comparison to prevent timing side-channels
    let auth_bytes = auth.as_bytes();
    let expected_bytes = expected.as_bytes();
    let ok = auth_bytes.len() == expected_bytes.len() && auth_bytes.ct_eq(expected_bytes).into();

    if !ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "unauthorized"})),
        )
            .into_response();
    }

    next.run(request).await.into_response()
}

// ─── Handlers (H1: thin adapters calling SwarmCoordinator) ───────────

async fn handle_register(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    match state.coordinator.register(req).await {
        Ok(registered_at) => (
            StatusCode::OK,
            Json(json!({"ok": true, "registered_at": registered_at.to_rfc3339()})),
        ),
        // M6: Generic error — no user input echoed
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error": e}))),
    }
}

async fn handle_deregister(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<DeregisterRequest>,
) -> impl IntoResponse {
    state.coordinator.deregister(&req.colleague_id).await;
    (StatusCode::OK, Json(json!({"ok": true})))
}

async fn handle_heartbeat(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> impl IntoResponse {
    match state
        .coordinator
        .heartbeat(&req.colleague_id, req.status)
        .await
    {
        Ok(stale_peers) => (
            StatusCode::OK,
            Json(json!({"ok": true, "stale_peers": stale_peers})),
        ),
        Err(e) => {
            // Distinguish "not found" from validation errors (M6)
            let code = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (code, Json(json!({"error": e})))
        }
    }
}

async fn handle_roster(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    let peers = state.coordinator.roster().await;
    (StatusCode::OK, Json(json!({"peers": peers})))
}

async fn handle_spawn(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<SpawnRequest>,
) -> impl IntoResponse {
    use tauri::Emitter;

    // N1 (Security): validate inputs before constructing colleague_id / env vars.
    if !crate::swarm::coordinator::is_valid_identifier(&req.name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid name"})),
        );
    }
    if !crate::swarm::coordinator::is_valid_identifier(&req.parent_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid parent_id"})),
        );
    }
    if let Some(prompt) = &req.initial_prompt {
        if prompt.len() > 4096 {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "initial_prompt too long"})),
            );
        }
    }

    let colleague_id = SwarmCoordinator::generate_colleague_id(&req.name);
    let tab_id = uuid::Uuid::new_v4().to_string();

    // Use coordinator.colleague_env_vars() to build env (M1)
    let env = state
        .coordinator
        .colleague_env_vars(
            &tab_id,
            &colleague_id,
            &req.name,
            &req.parent_id,
            req.initial_prompt.as_deref(),
        )
        .await;

    let Some(env) = env else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Swarm not enabled"})),
        );
    };

    // Emit event for frontend to create the tab
    // TODO: Phase 2+ — extension integration will handle initial_prompt delivery
    let payload = json!({
        "name": req.name,
        "env": env,
        "shell": "copilot",
        "args": ["--yolo", "--experimental"],
        "colleague_id": colleague_id,
        "tab_id": tab_id,
    });

    let _ = state.app_handle.emit("swarm://spawn-tab", &payload);

    (
        StatusCode::OK,
        Json(json!({"colleague_id": colleague_id, "tab_id": tab_id})),
    )
}

async fn handle_messages(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<MessageRequest>,
) -> impl IntoResponse {
    match state.coordinator.route_message(req).await {
        Ok(msg_id) => (
            StatusCode::OK,
            Json(json!({"ok": true, "message_id": msg_id})),
        ),
        Err(e) => {
            let code = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (code, Json(json!({"error": e})))
        }
    }
}

#[derive(Deserialize)]
struct StreamQuery {
    id: String,
}

async fn handle_stream(
    AxumState(state): AxumState<AppState>,
    Query(query): Query<StreamQuery>,
) -> impl IntoResponse {
    let colleague_id = query.id;

    // H1: Delegate to coordinator.subscribe()
    let (mut rx, buffered) = match state.coordinator.subscribe(&colleague_id).await {
        Ok(pair) => pair,
        // M6: Generic error
        Err(_) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Colleague not found"})),
            ));
        }
    };

    let stream = async_stream::stream! {
        // First emit buffered events
        for event in buffered {
            let data = serde_json::to_string(&event).unwrap_or_default();
            let event_type = match &event {
                SseEvent::Message(_) => "message",
                SseEvent::RosterUpdate { .. } => "roster_update",
                SseEvent::PeerStatus { .. } => "peer_status",
            };
            yield Ok::<_, Infallible>(Event::default().event(event_type).data(data));
        }

        // Then stream live events
        while let Some(event) = rx.recv().await {
            let data = serde_json::to_string(&event).unwrap_or_default();
            let event_type = match &event {
                SseEvent::Message(_) => "message",
                SseEvent::RosterUpdate { .. } => "roster_update",
                SseEvent::PeerStatus { .. } => "peer_status",
            };
            yield Ok::<_, Infallible>(Event::default().event(event_type).data(data));
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn handle_focus(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<FocusRequest>,
) -> impl IntoResponse {
    use tauri::Emitter;
    // Emit event for frontend to focus the tab
    let _ = state
        .app_handle
        .emit("swarm://focus-tab", &json!({"tab_id": req.tab_id}));
    (StatusCode::OK, Json(json!({"ok": true})))
}
