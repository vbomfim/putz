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
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::socket::Listener;
use super::types::{
    ColleagueStatus, ColleagueView, CommandStatus, Severity, SwarmHealth, SwarmStatePublic,
};
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
/// Maximum time `stop()` will wait for the listener / sweeper tasks to
/// observe their cancellation token and exit cleanly. On timeout we
/// `abort()` the handle and continue — a buggy/wedged task cannot block
/// the next `start()` forever. 5s is generous: clean shutdown is sub-ms
/// (one select! poll), and the listener's only post-cancel work is a
/// single `remove_file`.
const STOP_HANDLE_TIMEOUT: Duration = Duration::from_secs(5);
/// Minimum interval between successive evictions on the same `tab_id`.
/// Re-registers arriving faster than this are rate-limited (the new
/// register is rejected; the existing colleague is NOT evicted) to
/// defend against eviction-as-DoS within the trust boundary
/// (Sec pass-1 #4). 200ms ⇒ ≤5 evictions/sec/tab — orders of magnitude
/// above any legitimate crash-restart cadence.
const TAB_EVICTION_MIN_INTERVAL: Duration = Duration::from_millis(200);
/// Trailing-edge debounce window for `roster_update` broadcasts to
/// connected colleagues (T3 / FR-011). A flurry of `swarm_update_status`
/// calls — typical of a noisy shell stream emitting many OSC 133
/// boundaries — collapses into at most one broadcast per window so the
/// per-colleague mpsc back-channel is not flooded.
const ROSTER_BROADCAST_DEBOUNCE: Duration = Duration::from_millis(250);
/// Cap on cwd length accepted from the frontend — defends against a
/// pathologically long path (or a frontend bug pushing a buffer dump)
/// blowing up the per-colleague writer queue. 4 KiB is well above any
/// realistic filesystem path on supported platforms.
const MAX_CWD_LEN: usize = 4096;

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
    /// OS PID of the colleague process, surfaced in tracing on register /
    /// disconnect for operator debugging.
    // TODO(T3): expose pid in colleague status surface
    pid: Option<u32>,
    status: ColleagueStatus,
    last_seen: Instant,
    /// The connection currently associated with this colleague_id.
    /// On duplicate register, we evict the old one before swapping.
    conn_id: ConnectionId,
    /// Back-channel to the writer task. `try_send` only — never await.
    sender: mpsc::Sender<Frame>,
    /// OSC-derived command status (T3). Defaults to `Unknown` until the
    /// frontend pushes the first `swarm_update_status` for this tab.
    command_status: CommandStatus,
    /// Last seen OSC 7 working directory.
    ///
    /// **@privacy Tier-2** — quasi-identifier (working directory). Shared
    /// with peer colleagues per FR-011 within the same-machine same-user
    /// trust boundary. NEVER log, NEVER persist, NEVER forward to
    /// telemetry. PRI-001/002.
    cwd: Option<String>,
    /// Exit code from the most recent OSC 133;D, if any.
    last_command_exit: Option<i32>,
    /// Unix epoch milliseconds when the most recent command finished.
    last_command_at: Option<u64>,
}

#[derive(Default)]
struct Inner {
    /// Colleagues keyed by `colleague_id`.
    by_id: HashMap<String, Colleague>,
    /// Reverse index: connection → colleague_id.
    by_conn: HashMap<ConnectionId, String>,
    /// Reverse index: tab_id → colleague_id. Used by [`SwarmCoordinator::register`]
    /// to enforce FR-009 idempotency keyed on tab — a re-register from the
    /// same tab evicts whatever colleague was previously bound to it, even
    /// if the new colleague_id differs.
    by_tab: HashMap<String, String>,
    /// Per-tab last eviction timestamp. Drives the
    /// [`TAB_EVICTION_MIN_INTERVAL`] rate-limit that prevents
    /// eviction-as-DoS via rapid re-registers on the same tab
    /// (Sec pass-1 #4).
    last_eviction: HashMap<String, Instant>,
    /// Listening path (Unix socket file or Windows pipe name).
    path: Option<String>,
    /// T3: trailing-edge debounce state for `roster_update` broadcasts.
    /// `Some(handle)` = a broadcast is already scheduled; further
    /// `update_status` calls coalesce into it. Cleared by the broadcast
    /// task itself once it fires.
    pending_broadcast: Option<JoinHandle<()>>,
    /// T3: marker the broadcast task checks before sending — set on every
    /// `update_status` call so a pending broadcast knows fresh data is
    /// waiting; cleared just before the broadcast goes out.
    roster_dirty: bool,
}

/// Background tasks owned by an active swarm lifecycle. Stored on the
/// coordinator so `stop()` can await them — without this, the listener
/// task could continue running after `stop()` returns, observe its
/// cancellation token mid-shutdown, and then `remove_file()` a socket
/// that a *new* `start()` had just bound at the same pid-based path.
/// (That is the lifecycle race CR-GPT pass-2 caught after fixup #1.)
struct LifecycleHandles {
    listener: JoinHandle<()>,
    sweeper: JoinHandle<()>,
}

/// Thread-safe handle to the coordinator. Cheap to clone.
#[derive(Clone)]
pub struct SwarmCoordinator {
    inner: Arc<RwLock<Inner>>,
    enabled: Arc<AtomicBool>,
    cancel: Arc<RwLock<Option<CancellationToken>>>,
    /// Serializes `start`/`stop` so a re-entrant or racing toggle can't
    /// half-build state. Held for the entire duration of each call —
    /// crucially, `stop()` keeps it across the `await` of the listener
    /// JoinHandle, so the next `start()` only proceeds after old
    /// background tasks have fully exited and unlinked the socket file.
    lifecycle: Arc<Mutex<()>>,
    /// Background task handles — `Some` while enabled, `None` otherwise.
    /// Awaited (with timeout + abort fallback) by `stop()`.
    lifecycle_handles: Arc<Mutex<Option<LifecycleHandles>>>,
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
            lifecycle_handles: Arc::new(Mutex::new(None)),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Bind the listener and start the accept loop + heartbeat sweeper.
    /// Idempotent: a second call while enabled is a no-op.
    ///
    /// **Dependency inversion** (CR-Opus pass-1 #5): the caller supplies
    /// the transport via a `bind_listener` factory closure. The
    /// coordinator no longer hard-codes how/where it listens — callers
    /// (production: [`crate::swarm::lifecycle::bind_pid_listener`];
    /// tests: any closure returning a bound `Listener`) own that policy.
    /// The factory is invoked **inside** the lifecycle mutex so binding
    /// stays race-free across concurrent `start`/`stop` toggles.
    ///
    /// Generic over `R: tauri::Runtime` so tests can pass a `MockRuntime`
    /// `AppHandle` (production callers pass `tauri::AppHandle` which
    /// defaults to `Wry`).
    pub async fn start<R, F>(
        &self,
        app_handle: tauri::AppHandle<R>,
        bind_listener: F,
    ) -> Result<SwarmStatePublic, String>
    where
        R: tauri::Runtime,
        F: FnOnce() -> std::io::Result<Listener>,
    {
        let _guard = self.lifecycle.lock().await;
        if self.enabled() {
            return Ok(self.state_public().await);
        }

        let listener = bind_listener().map_err(|e| format!("swarm bind failed: {e}"))?;
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

        // Accept loop. Retain JoinHandle so `stop()` can await this task
        // before returning — prevents the listener's `remove_file` from
        // unlinking a socket bound by a *subsequent* `start()` (lifecycle
        // race CR-GPT pass-1 HIGH #3 / pass-2).
        let coord_for_listener = self.clone();
        let cancel_for_listener = cancel_root.clone();
        let listener_handle = tokio::spawn(async move {
            listener.run(coord_for_listener, cancel_for_listener).await;
        });

        // Heartbeat sweeper. Same lifecycle hygiene as listener.
        let coord_for_sweep = self.clone();
        let cancel_for_sweep = cancel_root.clone();
        let app_for_sweep = app_handle.clone();
        let sweeper_handle = tokio::spawn(async move {
            sweep_loop(coord_for_sweep, cancel_for_sweep, app_for_sweep).await;
        });

        {
            let mut handles = self.lifecycle_handles.lock().await;
            *handles = Some(LifecycleHandles {
                listener: listener_handle,
                sweeper: sweeper_handle,
            });
        }

        let public = self.state_public().await;
        emit_state_changed(&app_handle, &public);
        Ok(public)
    }

    /// Stop the listener, cancel all per-connection tasks, and clear the
    /// registry. Safe to call even if disabled.
    ///
    /// **Awaits** the listener and sweeper tasks (with a per-handle
    /// timeout — a wedged task triggers `abort()` and a warning log
    /// rather than blocking `stop()` forever) so all background work —
    /// including the listener's socket-file `remove_file` — completes
    /// before `stop()` returns. Without this, a rapid `disable → enable`
    /// toggle would let the old listener unlink a socket that the new
    /// `start()` had just bound at the same pid path.
    pub async fn stop(&self) {
        let _guard = self.lifecycle.lock().await;
        let token = self.cancel.write().await.take();
        if let Some(token) = token {
            token.cancel();
        }
        self.enabled.store(false, Ordering::SeqCst);

        // Await background tasks BEFORE clearing state — the listener's
        // shutdown path expects nothing further to race against it.
        let handles = self.lifecycle_handles.lock().await.take();
        if let Some(LifecycleHandles { listener, sweeper }) = handles {
            await_or_abort("listener", listener).await;
            await_or_abort("sweeper", sweeper).await;
        }

        let mut inner = self.inner.write().await;
        if let Some(handle) = inner.pending_broadcast.take() {
            handle.abort();
        }
        inner.roster_dirty = false;
        inner.by_id.clear();
        inner.by_conn.clear();
        inner.by_tab.clear();
        inner.last_eviction.clear();
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
    ///
    /// `initial_prompt` is treated as **@privacy Tier-2 PII** — it flows
    /// only into the spawned process's env (`COPILOT_COLLEAGUE_INITIAL_PROMPT`),
    /// never into logs, never persisted. See PRI-001/002.
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
            // @privacy Tier-2 PII — never log this value, never persist.
            // Pass-through to the spawned colleague's env only. PRI-001/002.
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

    /// Insert a colleague tied to a fresh `ConnectionId`. Idempotency is
    /// keyed on **`tab_id`** (FR-009): if a colleague is already registered
    /// for this tab — even under a different `colleague_id` — that prior
    /// registration is evicted (sent a best-effort `Disconnect` and removed
    /// from all indices) before the new colleague is inserted.
    ///
    /// Rationale: a "tab" is the user-visible unit. A Copilot CLI process
    /// crashing and being restarted in the same tab will produce a fresh
    /// `colleague_id` (UUID-suffixed) but reuse the tab. We must not leak
    /// the old roster entry.
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

        // FR-009 idempotency: evict any prior colleague bound to this tab,
        // regardless of colleague_id. Covers crash-restart and rename cases.
        //
        // Sec pass-1 #4 (eviction-as-DoS): rate-limit evictions on the
        // same `tab_id`. A buggy or hostile colleague that re-registers
        // in a tight loop would otherwise force constant evictions of
        // its own predecessor and burn coordinator CPU + spam writers.
        // We only guard the eviction path — the *first* register on a
        // fresh tab is always allowed; only successive re-registers
        // within `TAB_EVICTION_MIN_INTERVAL` of each other are refused.
        let evict_target: Option<String> = inner.by_tab.get(&tab_id).cloned();
        if let Some(prev_id) = evict_target {
            if let Some(last) = inner.last_eviction.get(&tab_id) {
                let since = Instant::now().duration_since(*last);
                if since < TAB_EVICTION_MIN_INTERVAL {
                    tracing_warn(&format!(
                        "swarm: rate-limited register on tab {tab_id:?} \
                         (last eviction {since:?} ago < {TAB_EVICTION_MIN_INTERVAL:?})"
                    ));
                    return Err("rate_limited".into());
                }
            }
            if let Some(prev) = inner.by_id.remove(&prev_id) {
                let _ = prev.sender.try_send(Frame::Disconnect {
                    colleague_id: prev_id.clone(),
                    reason: Some("replaced by new connection on same tab".into()),
                });
                inner.by_conn.remove(&prev.conn_id);
                tracing_warn(&format!(
                    "swarm: evicted colleague {prev_id:?} on tab {tab_id:?} \
                     (replaced by new register; pid was {:?})",
                    prev.pid
                ));
            }
            inner.by_tab.remove(&tab_id);
            inner.last_eviction.insert(tab_id.clone(), Instant::now());
        }

        // Capacity check (only for genuinely new colleagues — eviction above
        // may have freed a slot already).
        if !inner.by_id.contains_key(&colleague_id) && inner.by_id.len() >= MAX_COLLEAGUES {
            return Err("registry full".into());
        }

        // Edge case: a *different* tab is already holding this colleague_id.
        // This is a protocol error from the client (colleague_ids are
        // generated as `name-{uuid4-prefix}` so collisions are vanishingly
        // unlikely). Reject rather than silently shadow.
        if let Some(existing) = inner.by_id.get(&colleague_id) {
            if existing.tab_id != tab_id {
                return Err(format!(
                    "colleague_id {colleague_id:?} already bound to a different tab"
                ));
            }
        }

        tracing_warn(&format!(
            "swarm: registered colleague {colleague_id:?} on tab {tab_id:?} (pid={pid:?})"
        ));

        let colleague = Colleague {
            name: sanitize_label(&name),
            parent,
            tab_id: tab_id.clone(),
            pid,
            status: ColleagueStatus::Idle,
            last_seen: Instant::now(),
            conn_id: conn_id.clone(),
            sender,
            command_status: CommandStatus::Unknown,
            cwd: None,
            last_command_exit: None,
            last_command_at: None,
        };
        inner.by_id.insert(colleague_id.clone(), colleague);
        inner.by_conn.insert(conn_id.clone(), colleague_id.clone());
        inner.by_tab.insert(tab_id, colleague_id.clone());

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
            // Observability for backpressure / abuse — log size and conn
            // only; never log message contents (PRI-002).
            tracing_warn(&format!(
                "swarm: notify dropped (oversize {}B > {MAX_MESSAGE_LEN}B) from conn {conn_id:?}",
                message.len()
            ));
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
        if target
            .sender
            .try_send(Frame::RecvFrom {
                from: bound_id.clone(),
                payload,
            })
            .is_err()
        {
            // Backpressure: target's mpsc is full or closed. Log identity
            // only (no payload — PRI-002).
            tracing_warn(&format!(
                "swarm: send_to dropped (back-channel full) from {from:?} to {to:?}"
            ));
        }
    }

    /// Drop a connection. Called by the socket layer on EOF / error.
    pub async fn disconnect(&self, conn_id: &ConnectionId) {
        let mut inner = self.inner.write().await;
        if let Some(colleague_id) = inner.by_conn.remove(conn_id) {
            // Only remove from by_id / by_tab if this conn still owns it
            // (guards against duplicate-register eviction races).
            let owned_tab: Option<String> = match inner.by_id.get(&colleague_id) {
                Some(c) if &c.conn_id == conn_id => Some(c.tab_id.clone()),
                _ => None,
            };
            if let Some(tab_id) = owned_tab {
                if let Some(c) = inner.by_id.remove(&colleague_id) {
                    tracing_warn(&format!(
                        "swarm: disconnected colleague {colleague_id:?} (pid={:?})",
                        c.pid
                    ));
                }
                // Only clear by_tab if it still points at us (defensive).
                if inner.by_tab.get(&tab_id) == Some(&colleague_id) {
                    inner.by_tab.remove(&tab_id);
                }
            }
        }
    }

    /// T3 / FR-011 — apply a partial OSC-derived status update for the
    /// colleague currently bound to `tab_id`. All four payload fields are
    /// optional so the frontend can push only what changed (e.g., a cwd
    /// update without touching `command_status`).
    ///
    /// Behaviour:
    /// - **Tab unknown** → `Err("unknown_tab")`. This is the primary
    ///   defense against a buggy or compromised renderer pushing bogus
    ///   updates: only tabs the coordinator already knows about are
    ///   accepted.
    /// - **cwd validation** — capped at [`MAX_CWD_LEN`] and rejected if
    ///   it contains control characters. Rejects with `Err("invalid_cwd")`
    ///   rather than silently truncating; the frontend should never emit
    ///   such a value, so a hit indicates a bug worth surfacing.
    /// - **state change** — emits `swarm://state-changed` to the frontend
    ///   immediately (cheap; in-process), and schedules a debounced
    ///   `roster_update` broadcast to peer colleagues (250 ms trailing).
    ///
    /// Generic over `R: tauri::Runtime` for the same testability reason
    /// as [`Self::start`].
    pub async fn update_status<R: tauri::Runtime>(
        &self,
        app_handle: tauri::AppHandle<R>,
        tab_id: &str,
        command_status: Option<CommandStatus>,
        cwd: Option<String>,
        last_command_exit: Option<i32>,
        last_command_at: Option<u64>,
    ) -> Result<(), String> {
        validate_tab_id(tab_id)?;
        if let Some(ref s) = cwd {
            if s.len() > MAX_CWD_LEN || s.chars().any(|c| c.is_control()) {
                return Err("invalid_cwd".into());
            }
        }
        let mut changed = false;
        {
            let mut inner = self.inner.write().await;
            let Some(colleague_id) = inner.by_tab.get(tab_id).cloned() else {
                return Err("unknown_tab".into());
            };
            if let Some(c) = inner.by_id.get_mut(&colleague_id) {
                if let Some(s) = command_status {
                    if c.command_status != s {
                        c.command_status = s;
                        changed = true;
                    }
                }
                if let Some(new_cwd) = cwd {
                    if c.cwd.as_deref() != Some(new_cwd.as_str()) {
                        c.cwd = Some(new_cwd);
                        changed = true;
                    }
                }
                if let Some(exit) = last_command_exit {
                    if c.last_command_exit != Some(exit) {
                        c.last_command_exit = Some(exit);
                        changed = true;
                    }
                }
                if let Some(at) = last_command_at {
                    if c.last_command_at != Some(at) {
                        c.last_command_at = Some(at);
                        changed = true;
                    }
                }
            }
            if changed {
                inner.roster_dirty = true;
            }
        }

        if changed {
            let public = self.state_public().await;
            emit_state_changed(&app_handle, &public);
            self.schedule_roster_broadcast().await;
        }
        Ok(())
    }

    /// Schedule a debounced roster broadcast to all connected colleagues.
    /// Coalesces under a `JoinHandle` slot — only one task is in-flight
    /// per debounce window. The task itself clears the slot before it
    /// performs the send, so a fresh `update_status` arriving during the
    /// send window will schedule a new broadcast for the *next* window
    /// rather than be lost.
    async fn schedule_roster_broadcast(&self) {
        let mut inner = self.inner.write().await;
        if inner.pending_broadcast.is_some() {
            return; // already scheduled — coalesce
        }
        let coord = self.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE).await;
            coord.broadcast_roster_now().await;
        });
        inner.pending_broadcast = Some(handle);
    }

    /// Internal: drop the pending-broadcast slot and push the current
    /// roster to every connected colleague. Best-effort — a full mpsc
    /// channel drops the frame (logged once, no retry — we'll catch up
    /// on the next change).
    async fn broadcast_roster_now(&self) {
        let (frame, senders): (Frame, Vec<(String, mpsc::Sender<Frame>)>) = {
            let mut inner = self.inner.write().await;
            inner.pending_broadcast = None;
            if !inner.roster_dirty {
                return;
            }
            inner.roster_dirty = false;
            let colleagues: Vec<ColleagueView> = inner
                .by_id
                .iter()
                .map(|(id, c)| view_with_id(id, c))
                .collect();
            let senders = inner
                .by_id
                .iter()
                .map(|(id, c)| (id.clone(), c.sender.clone()))
                .collect();
            (Frame::RosterUpdate { colleagues }, senders)
        };
        for (id, tx) in senders {
            if tx.try_send(frame.clone()).is_err() {
                tracing_warn(&format!(
                    "swarm: roster_update dropped (back-channel full) for {id:?}"
                ));
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
        command_status: Some(c.command_status),
        cwd: c.cwd.clone(),
        last_command_exit: c.last_command_exit,
        last_command_at: c.last_command_at,
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
    // Same charset as colleague_id / name (CR-Opus #7) — defends against
    // control chars / unicode confusables flowing into env vars.
    validate_ident(s, "tab_id")
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

fn emit_state_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>, state: &SwarmStatePublic) {
    use tauri::Emitter;
    let _ = app.emit("swarm://state-changed", state);
}

/// Stripped-down stand-in for `tracing::warn!`. Mirrors the helper in
/// [`super::socket`] so coordinator-side observability calls don't need
/// to cross the module boundary. Never log frame contents (PRI-002).
fn tracing_warn(msg: &str) {
    eprintln!("[swarm] {msg}");
}

/// Await a background task with a bounded timeout. On timeout, abort
/// the task and continue — never let a wedged background task block the
/// next `start()`. Logs a warning either way for operator visibility.
async fn await_or_abort(label: &str, handle: JoinHandle<()>) {
    let abort = handle.abort_handle();
    match tokio::time::timeout(STOP_HANDLE_TIMEOUT, handle).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) if e.is_cancelled() => {} // expected if previously aborted
        Ok(Err(e)) => tracing_warn(&format!("swarm {label} task join error: {e}")),
        Err(_) => {
            tracing_warn(&format!(
                "swarm {label} task did not exit within {STOP_HANDLE_TIMEOUT:?} of cancel — aborting"
            ));
            abort.abort();
        }
    }
}

async fn sweep_loop<R: tauri::Runtime>(
    coord: SwarmCoordinator,
    cancel: CancellationToken,
    app_handle: tauri::AppHandle<R>,
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
            inner.by_tab.remove(&c.tab_id);
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
        // FR-009: idempotency is keyed on tab_id, NOT colleague_id.
        // Re-registering the same tab with a *different* colleague_id must
        // still evict the prior colleague (e.g., crash → restart picks a
        // fresh `name-{uuid4}` id but reuses the tab).
        let c = SwarmCoordinator::new();
        let (tx1, mut rx1) = mpsc::channel(8);
        let (cid1, _) = c
            .register(
                "tab-shared".into(),
                "alice-aaaa".into(),
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
                "tab-shared".into(),
                "alice-bbbb".into(), // DIFFERENT colleague_id, same tab
                "alice".into(),
                None,
                None,
                tx2,
            )
            .await
            .unwrap();
        assert_ne!(cid1, cid2);
        // Old sender received a Disconnect (proves eviction-by-tab worked).
        let evicted = rx1.try_recv();
        assert!(
            matches!(evicted, Ok(Frame::Disconnect { .. })),
            "old connection was not sent a Disconnect frame: got {evicted:?}"
        );
        // Roster has only the new colleague — old one is gone.
        let roster = c.roster().await;
        assert_eq!(
            roster.len(),
            1,
            "roster must have exactly the new colleague"
        );
        assert_eq!(roster[0].id, "alice-bbbb");
    }

    /// FR-009 corner: the *same* colleague_id re-registering on the same
    /// tab is also handled (degenerate case of the tab-keyed rule).
    #[tokio::test]
    async fn duplicate_register_same_colleague_id_same_tab_evicts() {
        let c = SwarmCoordinator::new();
        let (tx1, mut rx1) = mpsc::channel(8);
        let _ = c
            .register(
                "tab".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx1,
            )
            .await
            .unwrap();
        let (tx2, _) = mpsc::channel(8);
        let _ = c
            .register(
                "tab".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx2,
            )
            .await
            .unwrap();
        assert!(matches!(rx1.try_recv(), Ok(Frame::Disconnect { .. })));
        assert_eq!(c.roster().await.len(), 1);
    }

    /// Sec pass-1 #4 (eviction-as-DoS): when re-registers arrive on the
    /// same tab faster than `TAB_EVICTION_MIN_INTERVAL`, only the first
    /// eviction goes through. Subsequent registers are rejected with
    /// `rate_limited` and the existing colleague is preserved.
    /// After the cooldown elapses, eviction is allowed again.
    #[tokio::test]
    async fn rapid_re_registration_is_rate_limited_per_tab() {
        let c = SwarmCoordinator::new();
        let (tx0, _rx0) = mpsc::channel(8);
        c.register(
            "dos-tab".into(),
            "alice-0000".into(),
            "alice".into(),
            None,
            None,
            tx0,
        )
        .await
        .unwrap();

        // First re-register: eviction allowed (no prior eviction
        // timestamp on this tab yet).
        let (tx1, _rx1) = mpsc::channel(8);
        let r1 = c
            .register(
                "dos-tab".into(),
                "alice-1111".into(),
                "alice".into(),
                None,
                None,
                tx1,
            )
            .await;
        assert!(r1.is_ok(), "first re-register should evict, not rate-limit");

        // Hammer with rapid re-registers — every one must be refused
        // by the rate limit until the cooldown elapses. The colleague
        // currently bound to the tab must remain unchanged.
        let mut rate_limited = 0;
        for i in 0..10 {
            let (tx, _rx) = mpsc::channel(8);
            let res = c
                .register(
                    "dos-tab".into(),
                    format!("alice-r{i}"),
                    "alice".into(),
                    None,
                    None,
                    tx,
                )
                .await;
            match res {
                Err(ref e) if e == "rate_limited" => rate_limited += 1,
                other => panic!("expected rate_limited, got {other:?}"),
            }
        }
        assert_eq!(
            rate_limited, 10,
            "all 10 rapid re-registers must be rate-limited"
        );
        let roster = c.roster().await;
        assert_eq!(roster.len(), 1);
        assert_eq!(
            roster[0].id, "alice-1111",
            "rate-limited registers MUST NOT evict the existing colleague"
        );

        // After the cooldown, eviction is allowed again.
        tokio::time::sleep(TAB_EVICTION_MIN_INTERVAL + Duration::from_millis(50)).await;
        let (tx2, _rx2) = mpsc::channel(8);
        let r2 = c
            .register(
                "dos-tab".into(),
                "alice-2222".into(),
                "alice".into(),
                None,
                None,
                tx2,
            )
            .await;
        assert!(r2.is_ok(), "post-cooldown re-register should succeed");
        let roster = c.roster().await;
        assert_eq!(roster[0].id, "alice-2222");
    }

    /// Rate-limit isolation: hammering tab-A must NOT block re-registers
    /// on tab-B. The cooldown is per-tab.
    #[tokio::test]
    async fn rate_limit_is_per_tab_id() {
        let c = SwarmCoordinator::new();
        // Seed tab-A with two registers (drives a tracked eviction).
        for id in &["a-0", "a-1"] {
            let (tx, _rx) = mpsc::channel(8);
            let _ = c
                .register("tab-a".into(), (*id).into(), "a".into(), None, None, tx)
                .await;
        }
        // Tab-A is now in cooldown. Tab-B's first eviction must work.
        let (txb0, _) = mpsc::channel(8);
        c.register("tab-b".into(), "b-0".into(), "b".into(), None, None, txb0)
            .await
            .unwrap();
        let (txb1, _) = mpsc::channel(8);
        let res = c
            .register("tab-b".into(), "b-1".into(), "b".into(), None, None, txb1)
            .await;
        assert!(
            res.is_ok(),
            "tab-B eviction must not be blocked by tab-A's cooldown: {res:?}"
        );
    }

    /// Defensive: a *different* tab trying to claim an in-use colleague_id
    /// is rejected (vanishingly unlikely in practice — UUID-suffixed ids).
    #[tokio::test]
    async fn register_rejects_colleague_id_collision_across_tabs() {
        let c = SwarmCoordinator::new();
        let (tx1, _) = mpsc::channel(8);
        let _ = c
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
        let (tx2, _) = mpsc::channel(8);
        let res = c
            .register(
                "tab2".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx2,
            )
            .await;
        assert!(res.is_err(), "expected colleague_id collision rejection");
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

    /// CR-Opus #7: tab_id must use the same charset rule as colleague_id —
    /// rejecting control characters and other non-safe input that would
    /// otherwise flow into an env var.
    #[test]
    fn validate_tab_id_rejects_control_chars() {
        assert!(validate_tab_id("tab-1").is_ok());
        assert!(validate_tab_id("").is_err());
        assert!(validate_tab_id("tab\x00null").is_err());
        assert!(validate_tab_id("tab\nnewline").is_err());
        assert!(validate_tab_id("tab with space").is_err());
    }

    #[tokio::test]
    async fn register_rejects_tab_id_with_control_chars() {
        let c = SwarmCoordinator::new();
        let (tx, _rx) = mpsc::channel(8);
        let res = c
            .register(
                "tab\x07bell".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx,
            )
            .await;
        assert!(res.is_err(), "tab_id with control char must be rejected");
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

    /// CR-GPT pass-1 HIGH #3 / pass-2 regression: a rapid stop→start
    /// must NOT let the previous listener's `remove_file` cleanup unlink
    /// the new listener's socket file. With the JoinHandle await fix in
    /// `stop()`, the old listener has fully exited (and run its
    /// remove_file) before `stop()` returns; the subsequent `start()`
    /// then binds a fresh socket that nothing else can touch.
    ///
    /// Without the fix, this test fails: the leaked old listener task
    /// races, observes its cancel token, and `remove_file()`s the new
    /// socket — the subsequent path-exists assertion fails (or the
    /// client `connect()` fails).
    ///
    /// We override `start()`'s pid-based path by binding the listeners
    /// directly under a tempdir, then driving the same lifecycle
    /// orchestration code path. (The `start`/`stop` API is path-coupled
    /// via `resolve_socket_path`; using a tempdir keeps the test
    /// hermetic against parallel test runners using the same pid.)
    #[cfg(unix)]
    #[tokio::test]
    async fn restart_does_not_unlink_new_socket() {
        use crate::swarm::socket::{connect, Listener};
        use crate::swarm::wire::{read_frame, write_frame};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("restart.sock");

        // Round 1: bind, spawn listener, then "stop" by cancelling +
        // awaiting (mirrors what coordinator.stop() now does internally).
        let l1 = Listener::bind(path.clone()).unwrap();
        assert!(path.exists(), "round-1 socket file missing after bind");
        let coord1 = SwarmCoordinator::new();
        let cancel1 = CancellationToken::new();
        let h1 = tokio::spawn({
            let coord = coord1.clone();
            let cancel = cancel1.clone();
            async move { l1.run(coord, cancel).await }
        });
        // brief settle so accept loop is parked in select!
        tokio::time::sleep(Duration::from_millis(20)).await;

        // STOP: cancel + await — this is the lifecycle race fix in
        // miniature. After the await returns, l1's `remove_file` has
        // already run. The path is now gone.
        cancel1.cancel();
        await_or_abort("test-listener-1", h1).await;
        assert!(
            !path.exists(),
            "round-1 listener should have unlinked its socket on shutdown"
        );

        // START again: bind a new listener at the same path. Without the
        // fix above, l1 might still be alive here and would race to
        // `remove_file()` this fresh socket out from under us.
        let l2 = Listener::bind(path.clone()).unwrap();
        assert!(path.exists(), "round-2 socket file missing after re-bind");
        let coord2 = SwarmCoordinator::new();
        let cancel2 = CancellationToken::new();
        let h2 = tokio::spawn({
            let coord = coord2.clone();
            let cancel = cancel2.clone();
            async move { l2.run(coord, cancel).await }
        });

        // Give any leaked old task time to misbehave.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            path.exists(),
            "new listener's socket file was unlinked — lifecycle race regression"
        );

        // Functional check: a real client can connect and register on
        // the new listener.
        let mut client = connect(&path).await.unwrap();
        write_frame(
            &mut client,
            &Frame::Register {
                tab_id: "round2".into(),
                colleague_id: "post-restart".into(),
                name: "post-restart".into(),
                parent: None,
                pid: None,
            },
        )
        .await
        .unwrap();
        let ack = tokio::time::timeout(Duration::from_secs(2), read_frame(&mut client))
            .await
            .expect("register on round-2 listener timed out — possible socket unlinked")
            .unwrap()
            .unwrap();
        assert!(matches!(ack, Frame::RegisterAck { .. }));

        cancel2.cancel();
        drop(client);
        await_or_abort("test-listener-2", h2).await;
    }

    /// Direct lifecycle test of the *coordinator* `start`/`stop` pair
    /// (mock_app provides an `AppHandle<MockRuntime>`). Proves the
    /// public API itself satisfies the same invariant as the lower-level
    /// test above. Marked serial because the production
    /// `bind_pid_listener` factory binds at the pid-resolved path,
    /// which is shared across parallel in-process tests.
    #[cfg(unix)]
    #[tokio::test]
    #[serial_test::serial]
    async fn coordinator_stop_then_start_preserves_socket() {
        use crate::swarm::lifecycle::bind_pid_listener;
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();

        let coord = SwarmCoordinator::new();
        let s1 = coord
            .start(handle.clone(), bind_pid_listener)
            .await
            .unwrap();
        let path1 = std::path::PathBuf::from(s1.path.expect("start must publish path"));
        assert!(path1.exists(), "start should create the socket file");

        coord.stop().await;
        // After stop, the old socket file is gone.
        assert!(
            !path1.exists(),
            "stop must unlink the socket file before returning"
        );

        // Restart at (most likely) the same pid path.
        let s2 = coord
            .start(handle.clone(), bind_pid_listener)
            .await
            .unwrap();
        let path2 = std::path::PathBuf::from(s2.path.expect("restart must publish path"));
        assert!(path2.exists(), "restart should create the socket file");

        // Give any (hypothetical, post-fix shouldn't exist) leaked old
        // task time to race. The new socket must survive.
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(
            path2.exists(),
            "lifecycle race: new socket file disappeared after rapid stop→start"
        );

        coord.stop().await;
    }

    // ─── T3 / FR-011 — OSC-derived command status ───────────────────

    /// Helper: register one colleague + return the (coord, app, tab_id, rx).
    async fn one_registered_colleague() -> (
        SwarmCoordinator,
        tauri::AppHandle<tauri::test::MockRuntime>,
        String,
        mpsc::Receiver<Frame>,
    ) {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let coord = SwarmCoordinator::new();
        let (tx, rx) = mpsc::channel(16);
        coord
            .register(
                "tab-1".into(),
                "alice".into(),
                "alice".into(),
                None,
                None,
                tx,
            )
            .await
            .unwrap();
        (coord, handle, "tab-1".into(), rx)
    }

    #[tokio::test]
    async fn update_status_rejects_unknown_tab() {
        let app = tauri::test::mock_app();
        let coord = SwarmCoordinator::new();
        let res = coord
            .update_status(
                app.handle().clone(),
                "ghost",
                Some(CommandStatus::Running),
                None,
                None,
                None,
            )
            .await;
        assert_eq!(res.unwrap_err(), "unknown_tab");
    }

    #[tokio::test]
    async fn update_status_rejects_invalid_tab_id() {
        let app = tauri::test::mock_app();
        let coord = SwarmCoordinator::new();
        let res = coord
            .update_status(
                app.handle().clone(),
                "tab\nbad",
                Some(CommandStatus::Idle),
                None,
                None,
                None,
            )
            .await;
        assert!(res.is_err(), "control char in tab_id must be rejected");
    }

    #[tokio::test]
    async fn update_status_rejects_cwd_with_control_chars() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        let res = coord
            .update_status(app, &tab_id, None, Some("/home\x00null".into()), None, None)
            .await;
        assert_eq!(res.unwrap_err(), "invalid_cwd");
    }

    #[tokio::test]
    async fn update_status_rejects_oversized_cwd() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        let huge = "/".to_string() + &"a".repeat(MAX_CWD_LEN);
        let res = coord
            .update_status(app, &tab_id, None, Some(huge), None, None)
            .await;
        assert_eq!(res.unwrap_err(), "invalid_cwd");
    }

    #[tokio::test]
    async fn update_status_atomically_updates_colleague_fields() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                Some(CommandStatus::Done),
                Some("/work/proj".into()),
                Some(0),
                Some(1_700_000_000_000),
            )
            .await
            .unwrap();
        let roster = coord.roster().await;
        assert_eq!(roster.len(), 1);
        let v = &roster[0];
        assert_eq!(v.command_status, Some(CommandStatus::Done));
        assert_eq!(v.cwd.as_deref(), Some("/work/proj"));
        assert_eq!(v.last_command_exit, Some(0));
        assert_eq!(v.last_command_at, Some(1_700_000_000_000));
    }

    #[tokio::test]
    async fn update_status_partial_update_preserves_other_fields() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                Some(CommandStatus::Running),
                Some("/a".into()),
                None,
                None,
            )
            .await
            .unwrap();
        // Subsequent call only touches command_status — cwd must persist.
        coord
            .update_status(app, &tab_id, Some(CommandStatus::Done), None, Some(0), None)
            .await
            .unwrap();
        let roster = coord.roster().await;
        assert_eq!(roster[0].command_status, Some(CommandStatus::Done));
        assert_eq!(roster[0].cwd.as_deref(), Some("/a"));
        assert_eq!(roster[0].last_command_exit, Some(0));
    }

    /// Roster broadcast: after the debounce window, every connected
    /// colleague receives a single `RosterUpdate` even if many
    /// `update_status` calls arrived in quick succession.
    #[tokio::test]
    async fn roster_broadcast_is_debounced_and_collapses_burst() {
        let (coord, app, tab_id, mut rx) = one_registered_colleague().await;
        for i in 0..10 {
            coord
                .update_status(
                    app.clone(),
                    &tab_id,
                    Some(if i % 2 == 0 {
                        CommandStatus::Running
                    } else {
                        CommandStatus::Idle
                    }),
                    None,
                    None,
                    None,
                )
                .await
                .unwrap();
        }
        // Before the debounce window elapses, no broadcast should be on
        // the wire yet.
        assert!(rx.try_recv().is_err(), "broadcast must not fire eagerly");
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        let mut roster_updates = 0;
        while let Ok(frame) = rx.try_recv() {
            if matches!(frame, Frame::RosterUpdate { .. }) {
                roster_updates += 1;
            }
        }
        assert_eq!(
            roster_updates, 1,
            "burst of 10 updates must collapse to 1 broadcast"
        );
    }

    #[tokio::test]
    async fn roster_broadcast_carries_all_colleagues() {
        let app = tauri::test::mock_app();
        let coord = SwarmCoordinator::new();
        let (tx_a, mut rx_a) = mpsc::channel(8);
        let (tx_b, _rx_b) = mpsc::channel(8);
        coord
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
        coord
            .register("tb".into(), "bob".into(), "bob".into(), None, None, tx_b)
            .await
            .unwrap();
        coord
            .update_status(
                app.handle().clone(),
                "ta",
                Some(CommandStatus::Running),
                None,
                None,
                None,
            )
            .await
            .unwrap();
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        // Drain everything Alice received and pick the RosterUpdate.
        let mut roster_payload: Option<Vec<ColleagueView>> = None;
        while let Ok(frame) = rx_a.try_recv() {
            if let Frame::RosterUpdate { colleagues } = frame {
                roster_payload = Some(colleagues);
            }
        }
        let roster = roster_payload.expect("alice should receive roster_update");
        assert_eq!(roster.len(), 2, "broadcast must carry the full roster");
        let alice = roster.iter().find(|v| v.id == "alice").unwrap();
        assert_eq!(alice.command_status, Some(CommandStatus::Running));
    }

    /// A no-op update (same value as already stored) must NOT trigger a
    /// broadcast — guards against state-changed event spam from a
    /// frontend that re-pushes the same status every render tick.
    #[tokio::test]
    async fn unchanged_update_status_skips_broadcast() {
        let (coord, app, tab_id, mut rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                Some(CommandStatus::Idle),
                None,
                None,
                None,
            )
            .await
            .unwrap();
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        // Drain the legitimate first broadcast.
        while rx.try_recv().is_ok() {}
        // Re-push the SAME value — no change, no broadcast.
        coord
            .update_status(app, &tab_id, Some(CommandStatus::Idle), None, None, None)
            .await
            .unwrap();
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        assert!(
            rx.try_recv().is_err(),
            "no-op update must not emit a broadcast"
        );
    }
}
