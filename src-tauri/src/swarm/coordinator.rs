//! In-process roster + routing for the swarm.
//!
//! The coordinator is the single source of truth for "which colleagues
//! are connected, and how do I send a frame to one of them?" It does
//! NOT know about sockets; the [`super::socket`] module owns the bytes.
//!
//! Concurrency: `Arc<RwLock<Inner>>`. Hot paths (heartbeat, send_to) take
//! the write lock briefly; the lock is never held across `await`s on the
//! per-connection mpsc senders — `try_send` is non-blocking.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::socket::{resolve_socket_path, Listener};
use super::types::{ColleagueStatus, ColleagueView, Severity, SwarmHealth, SwarmStatePublic};
use super::wire::Frame;

/// No heartbeat for this long → status moves to `Stale`. Spec FR (heartbeat sweep).
const STALE_TIMEOUT: Duration = Duration::from_secs(30);
/// No heartbeat for this long → colleague is evicted. Spec FR.
const DEAD_TIMEOUT: Duration = Duration::from_secs(60);
/// How often the sweeper inspects the registry.
const SWEEP_INTERVAL: Duration = Duration::from_secs(5);
/// Max colleagues in a single Putz process. Spec §3 says ≤10 realistic; we
/// cap at 50 for headroom but reject beyond that to bound memory.
const MAX_COLLEAGUES: usize = 50;
/// Identifier validation cap (also bounds frame field sizes).
const MAX_IDENT_LEN: usize = 100;
/// Notify message cap (bounds Cmd+J inbox memory growth).
const MAX_MESSAGE_LEN: usize = 4096;

/// Opaque per-connection key. Different from `colleague_id` so that
/// duplicate-tab evictions are unambiguous: a re-register on the same
/// `tab_id` gets a fresh `ConnectionId`, and the old connection is
/// disconnected by id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionId(pub String);

struct Colleague {
    name: String,
    parent: Option<String>,
    tab_id: String,
    #[allow(dead_code)]
    pid: Option<u32>,
    status: ColleagueStatus,
    last_seen: Instant,
    /// The connection currently associated with this colleague_id.
    /// On duplicate register, we evict the old one before swapping.
    conn_id: ConnectionId,
    /// Back-channel to the writer task. `try_send` only — never await.
    sender: mpsc::Sender<Frame>,
}

#[derive(Default)]
struct Inner {
    /// Colleagues keyed by `colleague_id`.
    by_id: HashMap<String, Colleague>,
    /// Reverse index: connection → colleague_id.
    by_conn: HashMap<ConnectionId, String>,
    /// Listening path (Unix socket file or Windows pipe name).
    path: Option<String>,
}

/// Thread-safe handle to the coordinator. Cheap to clone.
#[derive(Clone)]
pub struct SwarmCoordinator {
    inner: Arc<RwLock<Inner>>,
    enabled: Arc<AtomicBool>,
    cancel: Arc<RwLock<Option<CancellationToken>>>,
    lifecycle: Arc<Mutex<()>>,
}

impl Default for SwarmCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl SwarmCoordinator {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Inner::default())),
            enabled: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(RwLock::new(None)),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Bind the listener and start the accept loop + heartbeat sweeper.
    /// Idempotent: a second call while enabled is a no-op.
    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<SwarmStatePublic, String> {
        let _guard = self.lifecycle.lock().await;
        if self.enabled() {
            return Ok(self.state_public().await);
        }

        let path = resolve_socket_path(std::process::id());
        let listener = Listener::bind(path.clone())
            .map_err(|e| format!("swarm bind failed at {}: {e}", path.display()))?;
        let path_string = listener.path().display().to_string();

        let cancel_root = CancellationToken::new();
        {
            let mut inner = self.inner.write().await;
            inner.path = Some(path_string.clone());
        }
        {
            let mut cancel_guard = self.cancel.write().await;
            *cancel_guard = Some(cancel_root.clone());
        }
        self.enabled.store(true, Ordering::SeqCst);

        // Accept loop.
        let coord_for_listener = self.clone();
        let cancel_for_listener = cancel_root.clone();
        tokio::spawn(async move {
            listener.run(coord_for_listener, cancel_for_listener).await;
        });

        // Heartbeat sweeper.
        let coord_for_sweep = self.clone();
        let cancel_for_sweep = cancel_root.clone();
        let app_for_sweep = app_handle.clone();
        tokio::spawn(async move {
            sweep_loop(coord_for_sweep, cancel_for_sweep, app_for_sweep).await;
        });

        let public = self.state_public().await;
        emit_state_changed(&app_handle, &public);
        Ok(public)
    }

    /// Stop the listener, cancel all per-connection tasks, and clear the
    /// registry. Safe to call even if disabled.
    pub async fn stop(&self) {
        let _guard = self.lifecycle.lock().await;
        let token = self.cancel.write().await.take();
        if let Some(token) = token {
            token.cancel();
        }
        self.enabled.store(false, Ordering::SeqCst);
        let mut inner = self.inner.write().await;
        inner.by_id.clear();
        inner.by_conn.clear();
        inner.path = None;
    }

    pub async fn state_public(&self) -> SwarmStatePublic {
        if !self.enabled() {
            return SwarmStatePublic::disabled();
        }
        let inner = self.inner.read().await;
        SwarmStatePublic {
            enabled: true,
            path: inner.path.clone(),
            colleague_count: inner.by_id.len(),
            colleague_ids: inner.by_id.keys().cloned().collect(),
        }
    }

    pub async fn health(&self) -> SwarmHealth {
        let inner = self.inner.read().await;
        SwarmHealth {
            listening: self.enabled(),
            path: inner.path.clone(),
            colleague_count: inner.by_id.len(),
        }
    }

    /// Env vars to inject into a PTY. `PUTZ_SWARM_PATH` replaces the
    /// removed `PUTZ_SWARM_URL` / `PUTZ_SWARM_TOKEN` pair (no auth needed
    /// — the OS file permissions are the auth).
    pub async fn env_vars(&self, tab_id: &str) -> Option<HashMap<String, String>> {
        if !self.enabled() {
            return None;
        }
        let inner = self.inner.read().await;
        let path = inner.path.as_ref()?;
        let mut vars = HashMap::new();
        vars.insert("PUTZ_SWARM_PATH".into(), path.clone());
        vars.insert("PUTZ_TAB_ID".into(), tab_id.into());
        Some(vars)
    }

    /// Env vars for a freshly-spawned colleague tab — base env + identity.
    pub async fn colleague_env_vars(
        &self,
        tab_id: &str,
        colleague_id: &str,
        name: &str,
        parent: &str,
        initial_prompt: Option<&str>,
    ) -> Option<HashMap<String, String>> {
        let mut vars = self.env_vars(tab_id).await?;
        vars.insert("COPILOT_COLLEAGUE_ID".into(), colleague_id.into());
        vars.insert("COPILOT_COLLEAGUE_NAME".into(), name.into());
        vars.insert("COPILOT_COLLEAGUE_PARENT".into(), parent.into());
        if let Some(prompt) = initial_prompt {
            vars.insert("COPILOT_COLLEAGUE_INITIAL_PROMPT".into(), prompt.into());
        }
        Some(vars)
    }

    /// Generate a colleague_id from a display name (4-hex suffix).
    pub fn generate_colleague_id(name: &str) -> String {
        let hex = &Uuid::new_v4().to_string()[..4];
        format!("{name}-{hex}")
    }

    /// Snapshot of the current roster — used both by tests and by the
    /// `register_ack` payload via [`Self::register`].
    pub async fn roster(&self) -> Vec<ColleagueView> {
        let inner = self.inner.read().await;
        inner
            .by_id
            .iter()
            .map(|(id, c)| view_with_id(id, c))
            .collect()
    }

    /// Insert a colleague tied to a fresh `ConnectionId`. If `colleague_id`
    /// already has a connection, the old one is evicted (a `Disconnect`
    /// frame is sent best-effort to its sender).
    ///
    /// Returns `(connection_id, register_ack_frame)` so the socket layer
    /// can send the ack on the correct stream.
    pub async fn register(
        &self,
        tab_id: String,
        colleague_id: String,
        name: String,
        parent: Option<String>,
        pid: Option<u32>,
        sender: mpsc::Sender<Frame>,
    ) -> Result<(ConnectionId, Frame), String> {
        validate_ident(&colleague_id, "colleague_id")?;
        validate_ident(&name, "name")?;
        validate_tab_id(&tab_id)?;

        let conn_id = ConnectionId(Uuid::new_v4().to_string());
        let mut inner = self.inner.write().await;

        // Capacity check (only for genuinely new colleagues).
        if !inner.by_id.contains_key(&colleague_id) && inner.by_id.len() >= MAX_COLLEAGUES {
            return Err("registry full".into());
        }

        // Duplicate-tab eviction: send Disconnect to the old sender (if
        // the channel is full or closed, we ignore — the old conn is
        // gone either way).
        let old_conn = inner.by_id.get(&colleague_id).map(|c| {
            let _ = c.sender.try_send(Frame::Disconnect {
                colleague_id: colleague_id.clone(),
                reason: Some("replaced by new connection".into()),
            });
            c.conn_id.clone()
        });
        if let Some(old) = old_conn {
            inner.by_conn.remove(&old);
        }

        let colleague = Colleague {
            name: sanitize_label(&name),
            parent,
            tab_id,
            pid,
            status: ColleagueStatus::Idle,
            last_seen: Instant::now(),
            conn_id: conn_id.clone(),
            sender,
        };
        inner.by_id.insert(colleague_id.clone(), colleague);
        inner.by_conn.insert(conn_id.clone(), colleague_id.clone());

        let roster: Vec<ColleagueView> = inner
            .by_id
            .iter()
            .map(|(id, c)| view_with_id(id, c))
            .collect();
        let ack = Frame::RegisterAck {
            colleague_id,
            roster,
        };
        Ok((conn_id, ack))
    }

    /// Mark heartbeat. Status defaults to `Idle` if not provided / unknown.
    pub async fn heartbeat(
        &self,
        conn_id: &ConnectionId,
        colleague_id: &str,
        status: Option<&str>,
    ) {
        let mut inner = self.inner.write().await;
        // Verify the connection still owns this colleague_id (defends
        // against a hung old conn writing after eviction).
        let bound_id = match inner.by_conn.get(conn_id) {
            Some(id) if id == colleague_id => id.clone(),
            _ => return,
        };
        if let Some(c) = inner.by_id.get_mut(&bound_id) {
            c.last_seen = Instant::now();
            c.status = parse_status(status).unwrap_or(ColleagueStatus::Idle);
        }
    }

    /// Notify — currently a no-op for routing (the inbox UI lives in T4).
    /// We still validate input and update last_seen.
    pub async fn notify(
        &self,
        conn_id: &ConnectionId,
        colleague_id: &str,
        _severity: Severity,
        message: String,
    ) {
        if message.len() > MAX_MESSAGE_LEN {
            return;
        }
        let mut inner = self.inner.write().await;
        let bound_id = match inner.by_conn.get(conn_id) {
            Some(id) if id == colleague_id => id.clone(),
            _ => return,
        };
        if let Some(c) = inner.by_id.get_mut(&bound_id) {
            c.last_seen = Instant::now();
        }
        // T4 will hook the inbox emitter here.
    }

    /// Route a message from `from` to `to`. Best-effort — if `to` has a
    /// full channel, the message is dropped (M3: bounded back-channel).
    pub async fn send_to(
        &self,
        conn_id: &ConnectionId,
        from: &str,
        to: &str,
        payload: serde_json::Value,
    ) {
        let inner = self.inner.read().await;
        let bound_id = match inner.by_conn.get(conn_id) {
            Some(id) if id == from => id,
            _ => return, // sender forging a `from`
        };
        let Some(target) = inner.by_id.get(to) else {
            return;
        };
        let _ = target.sender.try_send(Frame::RecvFrom {
            from: bound_id.clone(),
            payload,
        });
    }

    /// Drop a connection. Called by the socket layer on EOF / error.
    pub async fn disconnect(&self, conn_id: &ConnectionId) {
        let mut inner = self.inner.write().await;
        if let Some(colleague_id) = inner.by_conn.remove(conn_id) {
            // Only remove from by_id if this conn still owns it (guards
            // against duplicate-register eviction races).
            if let Some(c) = inner.by_id.get(&colleague_id) {
                if &c.conn_id == conn_id {
                    inner.by_id.remove(&colleague_id);
                }
            }
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn view_with_id(id: &str, c: &Colleague) -> ColleagueView {
    ColleagueView {
        id: id.into(),
        name: c.name.clone(),
        tab_id: c.tab_id.clone(),
        status: c.status.as_str().into(),
        parent: c.parent.clone(),
    }
}

fn validate_ident(s: &str, field: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > MAX_IDENT_LEN {
        return Err(format!("invalid {field}: length"));
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("invalid {field}: characters"));
    }
    Ok(())
}

fn validate_tab_id(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > MAX_IDENT_LEN {
        return Err("invalid tab_id".into());
    }
    Ok(())
}

fn parse_status(s: Option<&str>) -> Option<ColleagueStatus> {
    match s? {
        "idle" => Some(ColleagueStatus::Idle),
        "working" => Some(ColleagueStatus::Working),
        _ => None,
    }
}

/// Strip control characters from user-controlled labels before they hit
/// any UI (SEC-005). We don't HTML-escape — the frontend is responsible
/// for escaping at render time — but control chars can break terminal
/// rendering even if escaped.
fn sanitize_label(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

fn emit_state_changed(app: &tauri::AppHandle, state: &SwarmStatePublic) {
    use tauri::Emitter;
    let _ = app.emit("swarm://state-changed", state);
}

async fn sweep_loop(
    coord: SwarmCoordinator,
    cancel: CancellationToken,
    app_handle: tauri::AppHandle,
) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(SWEEP_INTERVAL) => {
                let evicted = sweep_once(&coord).await;
                if evicted {
                    let public = coord.state_public().await;
                    emit_state_changed(&app_handle, &public);
                }
            }
        }
    }
}

/// One sweep tick: mark stale, evict dead. Returns true if anything
/// changed (caller emits state-changed).
async fn sweep_once(coord: &SwarmCoordinator) -> bool {
    let now = Instant::now();
    let mut inner = coord.inner.write().await;
    let mut to_evict = Vec::new();
    let mut changed = false;
    for (id, c) in inner.by_id.iter_mut() {
        let elapsed = now.duration_since(c.last_seen);
        if elapsed >= DEAD_TIMEOUT {
            to_evict.push(id.clone());
        } else if elapsed >= STALE_TIMEOUT && c.status != ColleagueStatus::Stale {
            c.status = ColleagueStatus::Stale;
            changed = true;
        }
    }
    for id in to_evict {
        if let Some(c) = inner.by_id.remove(&id) {
            inner.by_conn.remove(&c.conn_id);
            // Best-effort: tell the writer task to quit so the connection closes.
            let _ = c.sender.try_send(Frame::Disconnect {
                colleague_id: id,
                reason: Some("heartbeat timeout".into()),
            });
            changed = true;
        }
    }
    changed
}

// Ensure view_with_id is used (see Self::roster + register's roster build).

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn coordinator_starts_disabled() {
        let c = SwarmCoordinator::new();
        assert!(!c.enabled());
        let s = c.state_public().await;
        assert!(!s.enabled);
        assert!(s.path.is_none());
    }

    #[tokio::test]
    async fn env_vars_none_when_disabled() {
        let c = SwarmCoordinator::new();
        assert!(c.env_vars("tab-1").await.is_none());
    }

    #[tokio::test]
    async fn register_validates_inputs() {
        let c = SwarmCoordinator::new();
        let (tx, _rx) = mpsc::channel(8);
        let res = c
            .register(
                "tab".into(),
                "bad id with spaces".into(),
                "alice".into(),
                None,
                None,
                tx,
            )
            .await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn register_then_disconnect_clears_registry() {
        let c = SwarmCoordinator::new();
        let (tx, _rx) = mpsc::channel(8);
        let (cid, _ack) = c
            .register("tab".into(), "alice".into(), "alice".into(), None, None, tx)
            .await
            .unwrap();
        assert_eq!(c.roster().await.len(), 1);
        c.disconnect(&cid).await;
        assert_eq!(c.roster().await.len(), 0);
    }

    #[tokio::test]
    async fn duplicate_register_evicts_old_connection() {
        let c = SwarmCoordinator::new();
        let (tx1, mut rx1) = mpsc::channel(8);
        let (cid1, _) = c
            .register(
                "tab1".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx1,
            )
            .await
            .unwrap();
        let (tx2, _rx2) = mpsc::channel(8);
        let (cid2, _) = c
            .register(
                "tab2".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx2,
            )
            .await
            .unwrap();
        assert_ne!(cid1, cid2);
        // Old sender received a Disconnect.
        let evicted = rx1.try_recv();
        assert!(matches!(evicted, Ok(Frame::Disconnect { .. })));
        assert_eq!(c.roster().await.len(), 1);
    }

    #[tokio::test]
    async fn send_to_routes_to_target_sender() {
        let c = SwarmCoordinator::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        let (cid_a, _) = c
            .register(
                "ta".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx_a,
            )
            .await
            .unwrap();
        let (tx_b, mut rx_b) = mpsc::channel(8);
        let (_cid_b, _) = c
            .register("tb".into(), "bob".into(), "bob".into(), None, None, tx_b)
            .await
            .unwrap();
        c.send_to(&cid_a, "alice", "bob", serde_json::json!({"x": 1}))
            .await;
        let got = rx_b.try_recv().expect("expected RecvFrom");
        match got {
            Frame::RecvFrom { from, payload } => {
                assert_eq!(from, "alice");
                assert_eq!(payload, serde_json::json!({"x": 1}));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[tokio::test]
    async fn send_to_rejects_forged_from() {
        let c = SwarmCoordinator::new();
        let (tx_a, _) = mpsc::channel(8);
        let (cid_a, _) = c
            .register(
                "ta".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx_a,
            )
            .await
            .unwrap();
        let (tx_b, mut rx_b) = mpsc::channel(8);
        let (_cid_b, _) = c
            .register("tb".into(), "bob".into(), "bob".into(), None, None, tx_b)
            .await
            .unwrap();
        // Alice's connection forges a `from = "bob"`.
        c.send_to(&cid_a, "bob", "bob", serde_json::json!({})).await;
        assert!(rx_b.try_recv().is_err(), "forged frame must be dropped");
    }

    #[tokio::test]
    async fn sweep_marks_stale_and_evicts_dead() {
        let c = SwarmCoordinator::new();
        let (tx, _rx) = mpsc::channel(8);
        let (_cid, _) = c
            .register("tab".into(), "alice".into(), "alice".into(), None, None, tx)
            .await
            .unwrap();
        // Backdate last_seen past DEAD_TIMEOUT.
        {
            let mut inner = c.inner.write().await;
            let col = inner.by_id.get_mut("alice").unwrap();
            col.last_seen = Instant::now() - DEAD_TIMEOUT - Duration::from_secs(1);
        }
        let changed = sweep_once(&c).await;
        assert!(changed);
        assert_eq!(c.roster().await.len(), 0);
    }

    /// [AC-4] Sweep marks Stale (not Dead) when last_seen is between the
    /// stale and dead thresholds — colleague stays in roster.
    #[tokio::test]
    async fn sweep_marks_stale_without_eviction_in_intermediate_window() {
        let c = SwarmCoordinator::new();
        let (tx, _rx) = mpsc::channel(8);
        let (_cid, _) = c
            .register("tab".into(), "alice".into(), "alice".into(), None, None, tx)
            .await
            .unwrap();
        // Backdate to STALE_TIMEOUT + 1s, well below DEAD_TIMEOUT.
        {
            let mut inner = c.inner.write().await;
            let col = inner.by_id.get_mut("alice").unwrap();
            col.last_seen = Instant::now() - STALE_TIMEOUT - Duration::from_secs(1);
        }
        let changed = sweep_once(&c).await;
        assert!(changed, "stale transition should report changed=true");
        let roster = c.roster().await;
        assert_eq!(roster.len(), 1, "stale colleague must NOT be evicted");
        assert_eq!(roster[0].status, "stale", "status must transition to stale");

        // A second sweep at the same instant must NOT re-report changed
        // (idempotent — guards against spammy state-changed emissions).
        let changed_again = sweep_once(&c).await;
        assert!(!changed_again, "no-op sweep must not report change");
    }

    /// [BOUNDARY] send_to a nonexistent colleague is a silent no-op.
    /// Defends against panic-on-missing-key bug if HashMap lookup ever
    /// changes shape.
    #[tokio::test]
    async fn send_to_unknown_target_is_silent_noop() {
        let c = SwarmCoordinator::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        let (cid_a, _) = c
            .register(
                "ta".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx_a,
            )
            .await
            .unwrap();
        // No `bob` registered. Must not panic, must not error visibly.
        c.send_to(&cid_a, "alice", "ghost", serde_json::json!({"x": 1}))
            .await;
        // Roster still intact, no side effect.
        assert_eq!(c.roster().await.len(), 1);
    }

    #[test]
    fn validate_ident_accepts_safe_chars_rejects_others() {
        assert!(validate_ident("alice-1.2_x", "x").is_ok());
        assert!(validate_ident("", "x").is_err());
        assert!(validate_ident("with space", "x").is_err());
        assert!(validate_ident("with/slash", "x").is_err());
        let too_long = "a".repeat(MAX_IDENT_LEN + 1);
        assert!(validate_ident(&too_long, "x").is_err());
    }

    #[test]
    fn sanitize_label_strips_control_chars() {
        assert_eq!(sanitize_label("alice\u{1b}[31m"), "alice[31m");
        assert_eq!(sanitize_label("plain"), "plain");
    }

    #[test]
    fn generate_colleague_id_is_unique_per_call() {
        let a = SwarmCoordinator::generate_colleague_id("x");
        let b = SwarmCoordinator::generate_colleague_id("x");
        assert_ne!(a, b);
    }
}
