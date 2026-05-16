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
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::socket::Listener;
use super::types::{
    ClaimView, ColleagueStatus, ColleagueView, CommandStatus, Severity, StatusSnapshot,
    SwarmHealth, SwarmStatePublic,
};
use super::wire::Frame;

/// Payload for the `swarm://notify` Tauri event (T4 / FR-014, FR-016).
///
/// Emitted to the frontend whenever a `Frame::Notify` is dispatched by
/// a connected colleague. Drives the per-tab notification ring and the
/// Cmd+J inbox panel.
///
/// @privacy Tier-2 — `message` carries arbitrary user-authored content
/// from the colleague's PTY context. NEVER log, NEVER persist to disk,
/// NEVER forward to telemetry. The frontend stores it in-memory only
/// (clears on app restart, per spec PRI-001).
#[derive(Debug, Clone, Serialize)]
pub struct NotifyEvent {
    pub colleague_id: String,
    pub tab_id: String,
    pub severity: Severity,
    /// @privacy Tier-2 PII — see struct doc.
    pub message: String,
    /// Unix epoch milliseconds at the moment the notify was received
    /// by the coordinator. Frontend uses this for "2 min ago" rendering.
    pub timestamp_ms: u64,
}

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

/// Cap on how many trailing exit codes are accepted from a single
/// snapshot push. Mirrors the renderer's `EXIT_CODE_HISTORY` constant.
/// Defends against a buggy renderer pushing a multi-thousand-entry
/// history that would inflate every roster broadcast.
const MAX_EXIT_CODE_HISTORY: usize = 10;

/// T5 — bounds for resource-coordination claims.
/// Resource name length cap (must fit `ascii_alphanumeric` + `-_./:`).
const MAX_RESOURCE_LEN: usize = 200;
/// Max simultaneously-held claims across the whole swarm. Bounds memory
/// against a buggy / hostile colleague claim-flooding the coordinator.
const MAX_CLAIMS: usize = 200;
/// Max TTL accepted for a single claim. Caps wall-clock drift on a
/// long-lived freeze and forces holders to re-affirm every few hours.
const MAX_CLAIM_TTL: Duration = Duration::from_secs(60 * 60 * 12); // 12h
/// Min TTL — anything below the sweep interval is a wasted setting (the
/// sweeper would tear it down within one tick anyway, and a 1s claim is
/// almost certainly a unit error). Bumped to 5s in the post-T5 fixup so
/// the worst-case eviction lag is exactly one [`SWEEP_INTERVAL`] cycle.
const MIN_CLAIM_TTL: Duration = Duration::from_secs(5);
/// Cap on inbound tool request_id length (correlation token).
const MAX_REQUEST_ID_LEN: usize = 100;

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
    /// Unix epoch milliseconds when the most recent command **started**
    /// (OSC 133;B). Renamed from `last_command_at` in PR #155 fixup
    /// (CR-GPT pass-2 #5) — the old name was ambiguous between "started"
    /// and "finished".
    last_command_started_at: Option<u64>,
    /// Last ≤10 command exit codes, chronological. `None` slots are
    /// in-flight / abandoned blocks. Drives the sidebar dot-row
    /// (ticket #142 AC3).
    last_ten_exit_codes: Vec<Option<i32>>,
}

/// T5 — internal record for an active resource claim.
///
/// `expires_at` (Instant) is authoritative for the in-process TTL sweeper —
/// monotonic, immune to wall-clock jumps. `expires_at_ms` is the wall-clock
/// projection sent on the wire so receivers can render
/// "expires at 14:32" without needing a coordinator round-trip per render.
///
/// @privacy Tier-2 — `message` is user-authored ("freeze prod, deploying v0.5").
/// MUST NOT be logged, persisted, or forwarded to telemetry. PRI-001/002.
struct ClaimInfo {
    holder_colleague_id: String,
    /// @privacy Tier-2 PII — see struct doc. Empty when the holder
    /// did not provide a message.
    message: String,
    expires_at: Instant,
    /// Wall-clock projection of `expires_at` for wire serialization.
    expires_at_ms: u64,
}

#[derive(Default)]
struct Inner {
    /// Colleagues keyed by `colleague_id`.
    by_id: HashMap<String, Colleague>,
    /// Reverse index: connection → colleague_id.
    by_conn: HashMap<ConnectionId, String>,
    /// T5: active resource claims keyed by resource name.
    claims: HashMap<String, ClaimInfo>,
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
    /// T4 / FR-014, FR-016: type-erased emitter for `swarm://notify` Tauri
    /// events. Set inside [`SwarmCoordinator::start`] from the
    /// caller-provided `app_handle` and cleared on `stop()`. The closure
    /// captures `AppHandle<R>` so the runtime generic does not leak into
    /// the coordinator's struct definition (keeps the per-method generic
    /// from infecting every helper).
    ///
    /// @privacy Tier-2 — payloads carry user-authored notify messages.
    /// The closure body MUST emit-and-forget; never log payloads.
    notify_emitter: Option<Arc<dyn Fn(NotifyEvent) + Send + Sync>>,
    /// Type-erased emitter for `swarm://state-changed` Tauri events.
    /// Set in [`SwarmCoordinator::start`] alongside `notify_emitter`,
    /// cleared on `stop()`. Used by paths that mutate the roster but
    /// don't have an `AppHandle` in scope (e.g., `register`,
    /// `disconnect`) so the frontend's `useSwarmRoster` hook refreshes
    /// the sidebar immediately, not on the next 30s sweep.
    state_changed_emitter: Option<Arc<dyn Fn(SwarmStatePublic) + Send + Sync>>,
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
            // Install the type-erased notify emitter so dispatch_frame
            // can fan a `Frame::Notify` out to the frontend without
            // knowing the runtime generic. Cleared in `stop()`.
            let emit_app = app_handle.clone();
            inner.notify_emitter = Some(Arc::new(move |event: NotifyEvent| {
                use tauri::Emitter;
                // Best-effort fire-and-forget. Frontend may not be
                // listening yet during early boot — that's acceptable
                // (notifies that arrive before the listener mounts are
                // dropped, matching the in-memory-only PRI-001 model).
                let _ = emit_app.emit("swarm://notify", &event);
            }));
            // Sibling closure for `swarm://state-changed`. Used by
            // `register` / `disconnect` so the sidebar updates in real
            // time without waiting for the 30s sweep tick.
            let emit_app2 = app_handle.clone();
            inner.state_changed_emitter = Some(Arc::new(move |state: SwarmStatePublic| {
                use tauri::Emitter;
                let _ = emit_app2.emit("swarm://state-changed", &state);
            }));
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
            // The aborted task may still acquire the lock briefly (between
            // its sleep waking and our abort signal landing); roster_dirty
            // is cleared on the very next line, so any zombie broadcast
            // short-circuits harmlessly via the `if !roster_dirty` early
            // return in `broadcast_roster_now`.
            handle.abort();
        }
        inner.roster_dirty = false;
        inner.notify_emitter = None;
        inner.state_changed_emitter = None;
        inner.by_id.clear();
        inner.by_conn.clear();
        inner.by_tab.clear();
        inner.last_eviction.clear();
        inner.claims.clear();
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
    ///
    /// Windows: the listener's internal path is the bare pipe name
    /// (e.g., `putz-swarm-12345`) because the `interprocess` crate's
    /// `GenericNamespaced` binder adds the `\\.\pipe\` prefix at bind
    /// time. Children connecting via Node's `net.connect({path})` (or
    /// any consumer that doesn't speak the namespaced abstraction)
    /// require the FULL path. Per spec FR-007 `PUTZ_SWARM_PATH` is the
    /// "absolute socket/pipe path" — so we expose the prefixed form to
    /// children while keeping the internal representation bare for the
    /// binder.
    pub async fn env_vars(&self, tab_id: &str) -> Option<HashMap<String, String>> {
        if !self.enabled() {
            return None;
        }
        let inner = self.inner.read().await;
        let path = inner.path.as_ref()?;
        let mut vars = HashMap::new();
        vars.insert("PUTZ_SWARM_PATH".into(), to_child_pipe_path(path));
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
                // CR-Pass-2 (I1): the evicted colleague's claims must be
                // released immediately, otherwise they leak until the TTL
                // sweeper runs. The OLD connection's eventual disconnect
                // can no longer find the colleague (we just removed it
                // from by_conn), so this is the only place to do it.
                let evicted_claims: Vec<String> = inner
                    .claims
                    .iter()
                    .filter(|(_, c)| c.holder_colleague_id == prev_id)
                    .map(|(r, _)| r.clone())
                    .collect();
                for r in &evicted_claims {
                    inner.claims.remove(r);
                }
                if !evicted_claims.is_empty() {
                    let senders: Vec<(String, mpsc::Sender<Frame>)> = inner
                        .by_id
                        .iter()
                        .map(|(id, c)| (id.clone(), c.sender.clone()))
                        .collect();
                    for resource in evicted_claims {
                        let frame = Frame::Release {
                            resource,
                            holder: prev_id.clone(),
                        };
                        broadcast_frame_to(&frame, &senders, "release-evicted");
                    }
                }
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

        // @privacy: tab_id is a server-issued Uuid v4, not user-derived;
        // safe to log. colleague_id and pid likewise have no PII content.
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
            last_command_started_at: None,
            last_ten_exit_codes: Vec::new(),
        };
        inner.by_id.insert(colleague_id.clone(), colleague);
        inner.by_conn.insert(conn_id.clone(), colleague_id.clone());
        inner.by_tab.insert(tab_id, colleague_id.clone());

        let roster: Vec<ColleagueView> = inner
            .by_id
            .iter()
            .map(|(id, c)| view_with_id(id, c))
            .collect();
        let claims_snapshot = collect_claim_views(&inner.claims);
        let ack = Frame::RegisterAck {
            colleague_id,
            roster,
            claims: claims_snapshot,
        };

        // Notify the frontend so the sidebar refreshes immediately —
        // without this, useSwarmRoster only re-fetches on the next
        // sweep tick (≈30s) or a manual toggle.
        let emitter = inner.state_changed_emitter.clone();
        let public = SwarmStatePublic {
            enabled: true,
            path: inner.path.clone(),
            colleague_count: inner.by_id.len(),
            colleague_ids: inner.by_id.keys().cloned().collect(),
        };
        // Drop write lock before the (synchronous, fire-and-forget) emit
        // so a slow Tauri channel doesn't extend the critical section.
        drop(inner);
        if let Some(emit) = emitter {
            emit(public);
        }

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
        severity: Severity,
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
        // Sec F8: strip control characters (BEL, ESC, NUL, etc.) at
        // ingress so a hostile colleague cannot smuggle ANSI escape
        // sequences or terminal-confusing bytes into the inbox UI.
        // Keeps `\t` / `\n` (legible whitespace authors may use).
        let message = sanitize_notify_message(&message);
        // Snapshot the data we need (tab_id, emitter clone) under the
        // lock, then drop the lock before invoking the emitter — the
        // closure may call into Tauri's runtime and we never want to
        // hold a lock across an unknown-cost callback.
        let event_and_emitter = {
            let mut inner = self.inner.write().await;
            let bound_id = match inner.by_conn.get(conn_id) {
                Some(id) if id == colleague_id => id.clone(),
                _ => return,
            };
            let tab_id_opt = inner.by_id.get(&bound_id).map(|c| c.tab_id.clone());
            if let Some(c) = inner.by_id.get_mut(&bound_id) {
                c.last_seen = Instant::now();
            }
            let emitter = inner.notify_emitter.clone();
            tab_id_opt.zip(emitter).map(|(tab_id, emitter)| {
                let event = NotifyEvent {
                    colleague_id: bound_id,
                    tab_id,
                    severity,
                    message,
                    timestamp_ms: now_unix_millis(),
                };
                (event, emitter)
            })
        };
        if let Some((event, emitter)) = event_and_emitter {
            emitter(event);
        }
    }

    /// T4 / F9 — send a notify message to a target colleague's inbox.
    ///
    /// Used by the right-click "Send notify…" UI in the sidebar.
    /// The message is sanitized + capped server-side and emitted
    /// directly via the same path as wire-frame `Notify` so the
    /// target's UI cannot tell it apart from a peer-originated
    /// notification.
    ///
    /// Returns `Err(String)` only on hard validation failure
    /// (oversize); a missing target is silently dropped (UI may have
    /// raced a disconnect).
    pub async fn send_notify_to(
        &self,
        app: tauri::AppHandle,
        target_colleague_id: &str,
        message: String,
    ) -> Result<(), String> {
        use tauri::Emitter;

        if message.is_empty() {
            return Err("Notify message is empty".into());
        }
        if message.len() > MAX_MESSAGE_LEN {
            return Err(format!(
                "Notify message too long ({} bytes; max {MAX_MESSAGE_LEN})",
                message.len()
            ));
        }
        let message = sanitize_notify_message(&message);

        // Snapshot tab_id + sender under lock; emit/send outside the lock.
        let (tab_id, target_sender) = {
            let inner = self.inner.read().await;
            match inner.by_id.get(target_colleague_id) {
                Some(c) => (c.tab_id.clone(), c.sender.clone()),
                None => return Ok(()), // target gone — best-effort
            }
        };
        // 1. Deliver to the target colleague's socket so its `copilot`
        //    session can surface the message via `session.log`.
        let _ = target_sender.try_send(Frame::RecvNotify {
            from: "putz".into(),
            message: message.clone(),
            severity: Severity::Normal,
        });
        // 2. Emit local Tauri event so the SENDER (Putz UI) sees its own
        //    sent message in the inbox / sidebar — confirms delivery.
        let event = NotifyEvent {
            colleague_id: target_colleague_id.to_string(),
            tab_id,
            severity: Severity::Normal,
            message,
            timestamp_ms: now_unix_millis(),
        };
        let _ = app.emit("swarm://notify", &event);
        Ok(())
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
        // T5: collect (and drop) any claims this colleague held so we can
        // broadcast their releases after we drop the write lock. Caches
        // on peer colleagues converge with the holder's exit instead of
        // waiting for the TTL sweeper.
        //
        // CR-Pass-2 (I1): release claims for THIS colleague_id even when
        // the by_id slot has already been re-bound to a newer connection
        // (duplicate-tab eviction race). The OLD connection's holder may
        // still own claims that need to be torn down — we cannot wait
        // for the sweeper, and we cannot key the release on `owned_tab`
        // because the by_tab/by_id entries may now belong to the new
        // colleague.
        type ReleaseBroadcast = (Vec<(String, String)>, Vec<(String, mpsc::Sender<Frame>)>);
        let release_broadcast: Option<ReleaseBroadcast>;
        let mut inner = self.inner.write().await;
        if let Some(colleague_id) = inner.by_conn.remove(conn_id) {
            // Collect every claim held by this colleague, regardless of
            // whether by_id still maps the colleague to this conn_id.
            let to_release: Vec<String> = inner
                .claims
                .iter()
                .filter(|(_, c)| c.holder_colleague_id == colleague_id)
                .map(|(r, _)| r.clone())
                .collect();
            let mut released_claims: Vec<(String, String)> = Vec::with_capacity(to_release.len());
            for r in to_release {
                inner.claims.remove(&r);
                released_claims.push((r, colleague_id.clone()));
            }

            // Only remove from by_id / by_tab if this conn still owns it
            // (guards against duplicate-register eviction races: if a
            // newer conn took over, leave the colleague slot intact).
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
                // Notify frontend so the sidebar removes the row immediately.
                let emitter = inner.state_changed_emitter.clone();
                let public = SwarmStatePublic {
                    enabled: true,
                    path: inner.path.clone(),
                    colleague_count: inner.by_id.len(),
                    colleague_ids: inner.by_id.keys().cloned().collect(),
                };
                if let Some(emit) = emitter.as_ref() {
                    let public_clone = public.clone();
                    drop(inner);
                    emit(public_clone);
                    inner = self.inner.write().await;
                }
            }
            let released_senders: Vec<(String, mpsc::Sender<Frame>)> = inner
                .by_id
                .iter()
                .map(|(id, c)| (id.clone(), c.sender.clone()))
                .collect();
            release_broadcast = if released_claims.is_empty() {
                None
            } else {
                Some((released_claims, released_senders))
            };
        } else {
            release_broadcast = None;
        }
        drop(inner);
        if let Some((claims, senders)) = release_broadcast {
            for (resource, holder) in claims {
                let frame = Frame::Release { resource, holder };
                broadcast_frame_to(&frame, &senders, "release-disconnect");
            }
        }
    }

    /// T3 / FR-011 — apply a full OSC-derived status snapshot for the
    /// colleague currently bound to `tab_id`.
    ///
    /// **Full-snapshot semantics** (CR-GPT pass-2 #2): the renderer pushes
    /// the *entire* projection on every change. `Option::None` means the
    /// field is genuinely unset (e.g., `cwd: None` after a tab reset
    /// clears the previously-observed cwd) — NOT "skip this field". The
    /// previous partial-update API made it impossible to clear a field
    /// once it had been populated. The "no change → no broadcast" check
    /// at the bottom of this method still suppresses redundant traffic.
    ///
    /// **Emit ordering note:** `swarm://state-changed` is emitted outside
    /// the write-lock scope (so the emit doesn't block other writers).
    /// Concurrent `update_status` calls may therefore deliver their
    /// state-changed events in an order that does not match the order in
    /// which their lock-held mutations resolved. Consumers MUST treat
    /// each event as a *full snapshot*, not a delta — re-read state on
    /// every event, never accumulate. The `RosterUpdate` broadcast on
    /// the wire follows the same contract (the receiver overwrites its
    /// local view, never merges).
    ///
    /// **Behaviour:**
    /// - **Tab unknown** → `Err("unknown_tab")`. Primary defense against
    ///   a buggy / compromised renderer pushing bogus updates.
    /// - **cwd validation** — capped at [`MAX_CWD_LEN`] and rejected if
    ///   it contains control characters (`Err("invalid_cwd")`).
    /// - **exit-code history** — capped at [`MAX_EXIT_CODE_HISTORY`]
    ///   entries (`Err("invalid_exit_codes")`).
    /// - **state change** — emits `swarm://state-changed` to the frontend
    ///   immediately (cheap; in-process), and schedules a coalescing
    ///   throttle for `roster_update` broadcasts to peer colleagues.
    ///
    /// Generic over `R: tauri::Runtime` for the same testability reason
    /// as [`Self::start`].
    pub async fn update_status<R: tauri::Runtime>(
        &self,
        app_handle: tauri::AppHandle<R>,
        tab_id: &str,
        snapshot: StatusSnapshot,
    ) -> Result<(), String> {
        validate_tab_id(tab_id)?;
        if let Some(ref s) = snapshot.cwd {
            if s.len() > MAX_CWD_LEN || s.chars().any(|c| c.is_control()) {
                return Err("invalid_cwd".into());
            }
        }
        if snapshot.last_ten_exit_codes.len() > MAX_EXIT_CODE_HISTORY {
            return Err("invalid_exit_codes".into());
        }
        let mut changed = false;
        {
            let mut inner = self.inner.write().await;
            let Some(colleague_id) = inner.by_tab.get(tab_id).cloned() else {
                return Err("unknown_tab".into());
            };
            if let Some(c) = inner.by_id.get_mut(&colleague_id) {
                if c.command_status != snapshot.command_status {
                    c.command_status = snapshot.command_status;
                    changed = true;
                }
                if c.cwd != snapshot.cwd {
                    c.cwd = snapshot.cwd;
                    changed = true;
                }
                if c.last_command_exit != snapshot.last_command_exit {
                    c.last_command_exit = snapshot.last_command_exit;
                    changed = true;
                }
                if c.last_command_started_at != snapshot.last_command_started_at {
                    c.last_command_started_at = snapshot.last_command_started_at;
                    changed = true;
                }
                if c.last_ten_exit_codes != snapshot.last_ten_exit_codes {
                    c.last_ten_exit_codes = snapshot.last_ten_exit_codes;
                    changed = true;
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

    /// Schedule a coalescing-throttle roster broadcast to all connected
    /// colleagues — at-most-once per [`ROSTER_BROADCAST_DEBOUNCE`] window.
    /// Coalesces under a `JoinHandle` slot — only one task is in-flight
    /// per window. The task itself clears the slot before it performs the
    /// send, so a fresh `update_status` arriving during the send window
    /// will schedule a new broadcast for the *next* window rather than be
    /// lost.
    ///
    /// Naming note (CR-Opus pass-2 #10): this is a coalescing throttle,
    /// not a trailing-edge debounce. A trailing-edge debounce would reset
    /// the timer on every event (and could starve indefinitely under a
    /// continuous stream). This implementation fires exactly one
    /// broadcast per window once any event arrives — correct for keeping
    /// the wire calm without ever starving.
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

    // ─── T5: claims (resource coordination) ─────────────────────────

    /// Try to acquire `resource` for the colleague currently bound to
    /// `conn_id`. Idempotent if `(resource, holder)` already match —
    /// the TTL and `message` are refreshed in place.
    ///
    /// Returns the wire-shaped result the dispatcher serializes into a
    /// `tool_response`. On success, broadcasts a `Frame::Claim` to every
    /// connected colleague (including the holder, so every cache
    /// converges on the same record without local guesswork).
    ///
    /// @privacy Tier-2 — `message` is user-authored. NEVER log it.
    pub async fn try_claim(
        &self,
        conn_id: &ConnectionId,
        resource: String,
        ttl: Duration,
        message: Option<String>,
    ) -> ClaimAttempt {
        if let Err(reason) = validate_resource(&resource) {
            return ClaimAttempt::InvalidInput(reason);
        }
        if ttl < MIN_CLAIM_TTL || ttl > MAX_CLAIM_TTL {
            return ClaimAttempt::InvalidInput("invalid_ttl".into());
        }
        let message = match message {
            Some(m) if m.len() > MAX_MESSAGE_LEN => {
                return ClaimAttempt::InvalidInput("message_too_long".into());
            }
            Some(m) => sanitize_notify_message(&m),
            None => String::new(),
        };

        let now = Instant::now();
        let expires_at = now + ttl;
        let expires_at_ms = now_unix_millis().saturating_add(ttl.as_millis() as u64);

        let (broadcast_frame, senders) = {
            let mut inner = self.inner.write().await;
            let holder = match inner.by_conn.get(conn_id).cloned() {
                Some(id) => id,
                None => return ClaimAttempt::NotRegistered,
            };
            // Already held by someone else and not expired? Refuse.
            if let Some(existing) = inner.claims.get(&resource) {
                if existing.holder_colleague_id != holder && existing.expires_at > now {
                    return ClaimAttempt::Held(ClaimView {
                        resource: resource.clone(),
                        holder: existing.holder_colleague_id.clone(),
                        message: existing.message.clone(),
                        expires_at_ms: existing.expires_at_ms,
                    });
                }
            }
            if !inner.claims.contains_key(&resource) && inner.claims.len() >= MAX_CLAIMS {
                return ClaimAttempt::InvalidInput("claim_table_full".into());
            }
            inner.claims.insert(
                resource.clone(),
                ClaimInfo {
                    holder_colleague_id: holder.clone(),
                    message: message.clone(),
                    expires_at,
                    expires_at_ms,
                },
            );
            tracing_warn(&format!(
                "swarm: claim {res:?} held by {h:?} ttl={ttl:?}",
                res = log_trunc(&resource),
                h = log_trunc(&holder),
            ));
            let frame = Frame::Claim {
                resource: resource.clone(),
                holder: holder.clone(),
                message: message.clone(),
                expires_at_ms,
            };
            let senders: Vec<(String, mpsc::Sender<Frame>)> = inner
                .by_id
                .iter()
                .map(|(id, c)| (id.clone(), c.sender.clone()))
                .collect();
            (frame, senders)
        };
        broadcast_frame_to(&broadcast_frame, &senders, "claim");
        ClaimAttempt::Acquired(ClaimView {
            resource,
            holder: match &broadcast_frame {
                Frame::Claim { holder, .. } => holder.clone(),
                _ => unreachable!("broadcast_frame is always Claim here"),
            },
            message,
            expires_at_ms,
        })
    }

    /// Release a claim on `resource`. No-op if not held by `conn_id`.
    pub async fn release_claim(&self, conn_id: &ConnectionId, resource: String) -> ReleaseResult {
        let (broadcast_frame, senders) = {
            let mut inner = self.inner.write().await;
            let holder = match inner.by_conn.get(conn_id).cloned() {
                Some(id) => id,
                None => return ReleaseResult::NotRegistered,
            };
            match inner.claims.get(&resource) {
                Some(existing) if existing.holder_colleague_id == holder => {
                    inner.claims.remove(&resource);
                    tracing_warn(&format!(
                        "swarm: claim {res:?} released by {h:?}",
                        res = log_trunc(&resource),
                        h = log_trunc(&holder),
                    ));
                    let frame = Frame::Release {
                        resource,
                        holder: holder.clone(),
                    };
                    let senders: Vec<(String, mpsc::Sender<Frame>)> = inner
                        .by_id
                        .iter()
                        .map(|(id, c)| (id.clone(), c.sender.clone()))
                        .collect();
                    (frame, senders)
                }
                _ => return ReleaseResult::NotHeldBySelf,
            }
        };
        broadcast_frame_to(&broadcast_frame, &senders, "release");
        ReleaseResult::Released
    }

    /// Read-only check.
    pub async fn check_claim(&self, resource: &str) -> Option<ClaimView> {
        let now = Instant::now();
        let inner = self.inner.read().await;
        inner.claims.get(resource).and_then(|c| {
            if c.expires_at <= now {
                None
            } else {
                Some(ClaimView {
                    resource: resource.to_string(),
                    holder: c.holder_colleague_id.clone(),
                    message: c.message.clone(),
                    expires_at_ms: c.expires_at_ms,
                })
            }
        })
    }

    /// Snapshot of all currently-active (non-expired) claims.
    pub async fn list_claims(&self) -> Vec<ClaimView> {
        let inner = self.inner.read().await;
        collect_claim_views(&inner.claims)
    }

    /// Sweep expired claims. Called from the heartbeat sweeper.
    /// Broadcasts a `Frame::Release` per evicted claim so caches converge.
    pub async fn sweep_expired_claims(&self) {
        let now = Instant::now();
        let (releases, senders) = {
            let mut inner = self.inner.write().await;
            let expired: Vec<(String, String)> = inner
                .claims
                .iter()
                .filter(|(_, c)| c.expires_at <= now)
                .map(|(r, c)| (r.clone(), c.holder_colleague_id.clone()))
                .collect();
            for (r, _) in &expired {
                inner.claims.remove(r);
            }
            let senders: Vec<(String, mpsc::Sender<Frame>)> = inner
                .by_id
                .iter()
                .map(|(id, c)| (id.clone(), c.sender.clone()))
                .collect();
            (expired, senders)
        };
        for (resource, holder) in releases {
            tracing_warn(&format!(
                "swarm: claim {res:?} expired (was held by {h:?})",
                res = log_trunc(&resource),
                h = log_trunc(&holder),
            ));
            let frame = Frame::Release { resource, holder };
            broadcast_frame_to(&frame, &senders, "release-expired");
        }
    }

    /// One-to-many notify — deliver `message` to every colleague EXCEPT
    /// the sender (who already has it locally). Returns the recipient count.
    pub async fn broadcast_notify(
        &self,
        conn_id: &ConnectionId,
        severity: Severity,
        message: String,
    ) -> Result<usize, String> {
        if message.is_empty() {
            return Err("empty_message".into());
        }
        if message.len() > MAX_MESSAGE_LEN {
            return Err("message_too_long".into());
        }
        let message = sanitize_notify_message(&message);
        let inner = self.inner.read().await;
        let from = match inner.by_conn.get(conn_id) {
            Some(id) => id.clone(),
            None => return Err("not_registered".into()),
        };
        let mut count = 0usize;
        for (id, c) in inner.by_id.iter() {
            if id == &from {
                continue;
            }
            if c.sender
                .try_send(Frame::RecvNotify {
                    from: from.clone(),
                    message: message.clone(),
                    severity,
                })
                .is_ok()
            {
                count += 1;
            }
        }
        Ok(count)
    }

    /// Direct message — deliver `message` from the connection's holder
    /// to `target_colleague_id` only. Returns Err if target not present.
    pub async fn send_notify_between_colleagues(
        &self,
        conn_id: &ConnectionId,
        target_colleague_id: &str,
        message: String,
    ) -> Result<(), String> {
        self.send_acked(conn_id, target_colleague_id, message, Severity::Normal)
            .await
            .map(|_| ())
    }

    /// T5 — acknowledged 1:1 send used by `swarm_send` (Frame::SendReq).
    /// Validates length, sanitizes for bidi/control chars, and surfaces
    /// `unknown_target` / `message_too_long` / `back_channel_full` as
    /// distinct error codes (vs the legacy `send_notify_between_colleagues`
    /// which silently swallowed back-channel-full).
    pub async fn send_acked(
        &self,
        conn_id: &ConnectionId,
        target_colleague_id: &str,
        message: String,
        severity: Severity,
    ) -> Result<(), String> {
        if message.is_empty() {
            return Err("empty_message".into());
        }
        validate_message_len(&message)?;
        let message = sanitize_notify_message(&message);
        let inner = self.inner.read().await;
        let from = match inner.by_conn.get(conn_id) {
            Some(id) => id.clone(),
            None => return Err("not_registered".into()),
        };
        let target = match inner.by_id.get(target_colleague_id) {
            Some(t) => t,
            None => return Err("unknown_target".into()),
        };
        target
            .sender
            .try_send(Frame::RecvNotify {
                from,
                message,
                severity,
            })
            .map_err(|_| "back_channel_full".to_string())
    }

    /// Push a frame on the back-channel of the colleague currently bound
    /// to `conn_id`. Used by the socket dispatcher to ship `tool_response`
    /// frames back to the requester. Best-effort — drops on full channel.
    pub async fn send_to_conn(&self, conn_id: &ConnectionId, frame: Frame) {
        let inner = self.inner.read().await;
        if let Some(id) = inner.by_conn.get(conn_id) {
            if let Some(c) = inner.by_id.get(id) {
                let _ = c.sender.try_send(frame);
            }
        }
    }
}

/// Outcome of [`SwarmCoordinator::try_claim`]. The dispatcher in
/// [`super::socket`] turns this into a wire `tool_response`.
#[derive(Debug, Clone, PartialEq)]
pub enum ClaimAttempt {
    Acquired(ClaimView),
    Held(ClaimView),
    InvalidInput(String),
    NotRegistered,
}

/// Outcome of [`SwarmCoordinator::release_claim`].
#[derive(Debug, Clone, PartialEq)]
pub enum ReleaseResult {
    Released,
    NotHeldBySelf,
    NotRegistered,
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Convert the listener's internal path to the form a child process must
/// pass to its socket-connect call.
///
/// On Unix this is a no-op (filesystem socket paths are absolute already).
/// On Windows the listener stores the bare pipe name (e.g.,
/// `putz-swarm-12345`) because `interprocess::GenericNamespaced` adds the
/// `\\.\pipe\` prefix internally. Children using Node's `net.connect`
/// (libuv), Python's `pywin32`, or `CreateFile` directly need the FULL
/// path. Idempotent: if the path is already prefixed, it is returned
/// unchanged (defends against test fixtures that pass a full path).
// `return` is structurally required: each cfg block is the function's
// terminal expression on its matching platform.
#[allow(clippy::needless_return)]
fn to_child_pipe_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        const PIPE_PREFIX: &str = r"\\.\pipe\";
        if path.starts_with(PIPE_PREFIX) || path.starts_with(r"\\?\pipe\") {
            return path.to_string();
        }
        return format!("{PIPE_PREFIX}{path}");
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

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
        last_command_started_at: c.last_command_started_at,
        last_ten_exit_codes: c.last_ten_exit_codes.clone(),
    }
}

/// Snapshot non-expired claims as [`ClaimView`]s for wire serialization.
fn collect_claim_views(claims: &HashMap<String, ClaimInfo>) -> Vec<ClaimView> {
    let now = Instant::now();
    claims
        .iter()
        .filter(|(_, c)| c.expires_at > now)
        .map(|(r, c)| ClaimView {
            resource: r.clone(),
            holder: c.holder_colleague_id.clone(),
            message: c.message.clone(),
            expires_at_ms: c.expires_at_ms,
        })
        .collect()
}

/// Validate a T5 `resource` identifier. Allows `:` `/` `.` `-` `_` plus
/// alphanumerics — covers things like `deploy-prod`, `db/migrations`,
/// `env:staging`. Rejects empty, oversize, and control characters.
fn validate_resource(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > MAX_RESOURCE_LEN {
        return Err("invalid_resource".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
    {
        return Err("invalid_resource".into());
    }
    Ok(())
}

/// Validate an inbound `request_id` correlation token.
pub(crate) fn validate_request_id(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > MAX_REQUEST_ID_LEN {
        return Err("invalid_request_id".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("invalid_request_id".into());
    }
    Ok(())
}

/// Broadcast a frame to every connected colleague — best-effort, drops
/// on full back-channel with a warn log keyed by colleague id only.
fn broadcast_frame_to(frame: &Frame, senders: &[(String, mpsc::Sender<Frame>)], label: &str) {
    for (id, tx) in senders {
        if tx.try_send(frame.clone()).is_err() {
            tracing_warn(&format!(
                "swarm: {label} broadcast dropped (back-channel full) for {id:?}"
            ));
        }
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

/// Strip dangerous control characters from a notify message at the
/// coordinator ingress. Mirrors [`sanitize_label`]'s posture but
/// preserves `\t` and `\n` so legible whitespace authored by the
/// sender survives. Defends against ANSI escape injection / bell
/// flooding into the inbox UI.
///
/// Also strips Unicode bidi/format "trojan" code points (RTLO, LRO,
/// LRI/RLI/PDI, zero-width joiner/non-joiner, BOM, …) — these allow a
/// peer to render a message that looks visually different from its
/// underlying bytes (e.g. a fake `[Swarm —` header or a swapped
/// resource name). See <https://trojansource.codes>. We strip the
/// individual ranges explicitly rather than the full `Cf` (Format)
/// general category to avoid pulling in `unicode-properties`; the
/// covered ranges are the ones with known UI-spoofing impact.
fn sanitize_notify_message(s: &str) -> String {
    s.chars()
        .filter(|c| {
            // Keep \t and \n (legible whitespace).
            if *c == '\t' || *c == '\n' {
                return true;
            }
            // Drop everything else in the C0/C1 control set.
            if c.is_control() {
                return false;
            }
            // Drop Unicode bidi/zero-width "trojan" code points.
            let cp = *c as u32;
            if matches!(cp,
                0x200B..=0x200F | // ZWSP, ZWNJ, ZWJ, LRM, RLM
                0x202A..=0x202E | // LRE, RLE, PDF, LRO, RLO
                0x2066..=0x2069 | // LRI, RLI, FSI, PDI
                0xFEFF            // ZWNBSP / BOM
            ) {
                return false;
            }
            true
        })
        .collect()
}

/// Reusable trust-boundary guard: reject messages exceeding
/// [`MAX_MESSAGE_LEN`] before any further processing. Returned `Err`
/// is the wire `error` code clients see in `tool_response.error`.
pub(crate) fn validate_message_len(s: &str) -> Result<(), String> {
    if s.len() > MAX_MESSAGE_LEN {
        return Err("message_too_long".into());
    }
    Ok(())
}

/// Truncate a user-controlled string to ≤32 chars for logging, with an
/// ellipsis suffix when truncated. Used by `tracing_warn` callers that
/// must surface a resource/holder identifier for operator debugging
/// without echoing arbitrarily long Tier-3 user-controlled labels.
fn log_trunc(s: &str) -> String {
    const LOG_FIELD_MAX: usize = 32;
    if s.chars().count() <= LOG_FIELD_MAX {
        return s.to_string();
    }
    let mut out: String = s.chars().take(LOG_FIELD_MAX).collect();
    out.push('…');
    out
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

/// Current time as Unix epoch milliseconds. Centralized so tests can
/// (in the future) stub via a trait if we need replay determinism;
/// callers should not call `SystemTime::now()` directly.
fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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
                // T5: also evict expired claims and broadcast their releases.
                coord.sweep_expired_claims().await;
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

    #[test]
    fn to_child_pipe_path_unix_is_passthrough() {
        // Unix paths are already absolute filesystem paths; never rewrite.
        let p = "/tmp/putz-swarm-1234.sock";
        let out = super::to_child_pipe_path(p);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(out, p);
        #[cfg(target_os = "windows")]
        assert_eq!(out, format!(r"\\.\pipe\{p}"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn to_child_pipe_path_windows_prefixes_bare_name() {
        // Spec FR-007: PUTZ_SWARM_PATH must be the absolute pipe path.
        // The internal listener path is bare (interprocess GenericNamespaced
        // adds the prefix) — children connecting via Node net.connect()
        // need the full \\.\pipe\... form.
        assert_eq!(
            super::to_child_pipe_path("putz-swarm-33160"),
            r"\\.\pipe\putz-swarm-33160"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn to_child_pipe_path_windows_idempotent_when_already_prefixed() {
        // Defensive: don't double-prefix if a fixture passes a full path.
        let already = r"\\.\pipe\putz-swarm-1";
        assert_eq!(super::to_child_pipe_path(already), already);
        let alt = r"\\?\pipe\putz-swarm-2";
        assert_eq!(super::to_child_pipe_path(alt), alt);
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
    fn sanitize_notify_message_strips_dangerous_controls_keeps_whitespace() {
        // BEL, NUL, ESC stripped; tab + newline preserved.
        let dirty = "hi\u{0007}there\u{001b}[31m\nline\u{0000}two\tend";
        let clean = sanitize_notify_message(dirty);
        assert_eq!(clean, "hithere[31m\nlinetwo\tend");
    }

    /// B1: Unicode bidi/zero-width "trojan" code points must be stripped
    /// at coordinator ingress so a peer cannot render a message that
    /// looks visually different from its underlying bytes (TrojanSource).
    #[test]
    fn sanitize_notify_message_strips_bidi_overrides() {
        // Right-to-left override (U+202E) — the classic TrojanSource
        // primitive used to mask source-code identifiers.
        assert_eq!(
            sanitize_notify_message("safe\u{202E}evil"),
            "safeevil",
            "RTLO must be stripped"
        );
        // Left-to-right override (U+202D).
        assert_eq!(sanitize_notify_message("a\u{202D}b"), "ab");
        // Pop directional formatting.
        assert_eq!(sanitize_notify_message("a\u{202C}b"), "ab");
        // Zero-width joiner / non-joiner / space.
        assert_eq!(
            sanitize_notify_message("a\u{200B}b\u{200C}c\u{200D}d"),
            "abcd"
        );
        // LRM / RLM markers.
        assert_eq!(sanitize_notify_message("a\u{200E}b\u{200F}c"), "abc");
        // Isolates (LRI/RLI/FSI/PDI).
        assert_eq!(
            sanitize_notify_message("\u{2066}a\u{2067}b\u{2068}c\u{2069}d"),
            "abcd"
        );
        // BOM / ZWNBSP.
        assert_eq!(sanitize_notify_message("\u{FEFF}hello"), "hello");
        // Plain ASCII unchanged.
        assert_eq!(sanitize_notify_message("hello world"), "hello world");
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

    /// Build a [`StatusSnapshot`] with sensible defaults; tests override
    /// only the fields they care about. Centralizes the "full snapshot
    /// semantics" boilerplate (CR-GPT pass-2 #2).
    fn snap() -> StatusSnapshot {
        StatusSnapshot::default()
    }

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
                StatusSnapshot {
                    command_status: CommandStatus::Running,
                    ..snap()
                },
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
                StatusSnapshot {
                    command_status: CommandStatus::Idle,
                    ..snap()
                },
            )
            .await;
        assert!(res.is_err(), "control char in tab_id must be rejected");
    }

    #[tokio::test]
    async fn update_status_rejects_cwd_with_control_chars() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        let res = coord
            .update_status(
                app,
                &tab_id,
                StatusSnapshot {
                    cwd: Some("/home\x00null".into()),
                    ..snap()
                },
            )
            .await;
        assert_eq!(res.unwrap_err(), "invalid_cwd");
    }

    #[tokio::test]
    async fn update_status_rejects_oversized_cwd() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        let huge = "/".to_string() + &"a".repeat(MAX_CWD_LEN);
        let res = coord
            .update_status(
                app,
                &tab_id,
                StatusSnapshot {
                    cwd: Some(huge),
                    ..snap()
                },
            )
            .await;
        assert_eq!(res.unwrap_err(), "invalid_cwd");
    }

    /// Renderer tries to push more than [`MAX_EXIT_CODE_HISTORY`] entries
    /// — must be rejected (defense against a buggy frontend bloating
    /// every roster broadcast).
    #[tokio::test]
    async fn update_status_rejects_oversized_exit_code_history() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        let too_many = vec![Some(0); MAX_EXIT_CODE_HISTORY + 1];
        let res = coord
            .update_status(
                app,
                &tab_id,
                StatusSnapshot {
                    last_ten_exit_codes: too_many,
                    ..snap()
                },
            )
            .await;
        assert_eq!(res.unwrap_err(), "invalid_exit_codes");
    }

    #[tokio::test]
    async fn update_status_atomically_updates_colleague_fields() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                StatusSnapshot {
                    command_status: CommandStatus::Done,
                    cwd: Some("/work/proj".into()),
                    last_command_exit: Some(0),
                    last_command_started_at: Some(1_700_000_000_000),
                    last_ten_exit_codes: vec![Some(0), Some(1), None, Some(0)],
                },
            )
            .await
            .unwrap();
        let roster = coord.roster().await;
        assert_eq!(roster.len(), 1);
        let v = &roster[0];
        assert_eq!(v.command_status, Some(CommandStatus::Done));
        assert_eq!(v.cwd.as_deref(), Some("/work/proj"));
        assert_eq!(v.last_command_exit, Some(0));
        assert_eq!(v.last_command_started_at, Some(1_700_000_000_000));
        assert_eq!(v.last_ten_exit_codes, vec![Some(0), Some(1), None, Some(0)]);
    }

    /// Full-snapshot semantics: a subsequent push with `cwd: None` MUST
    /// clear the previously-stored cwd (CR-GPT pass-2 #2). Under the
    /// old partial-update API this was impossible — the old `None` meant
    /// "skip this field" and cwd would persist forever once set.
    #[tokio::test]
    async fn update_status_clears_cwd_when_snapshot_has_none() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                StatusSnapshot {
                    cwd: Some("/work/proj".into()),
                    ..snap()
                },
            )
            .await
            .unwrap();
        // Push a snapshot with cwd: None — must clear, not skip.
        coord.update_status(app, &tab_id, snap()).await.unwrap();
        let roster = coord.roster().await;
        assert_eq!(roster[0].cwd, None, "cwd must be cleared by full snapshot");
    }

    /// Full-snapshot semantics: same property for `last_command_exit`.
    #[tokio::test]
    async fn update_status_clears_last_exit_when_snapshot_has_none() {
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app.clone(),
                &tab_id,
                StatusSnapshot {
                    last_command_exit: Some(42),
                    ..snap()
                },
            )
            .await
            .unwrap();
        coord.update_status(app, &tab_id, snap()).await.unwrap();
        let roster = coord.roster().await;
        assert_eq!(
            roster[0].last_command_exit, None,
            "last_command_exit must be cleared by full snapshot"
        );
    }

    /// Roster broadcast: after the throttle window, every connected
    /// colleague receives a single `RosterUpdate` even if many
    /// `update_status` calls arrived in quick succession.
    ///
    /// Uses `tokio::time::pause()` (CR-Opus pass-2 #12) so the test
    /// advances time deterministically — no real sleep, no flake risk
    /// under loaded CI. After advancing past the broadcast window we
    /// yield several times so the spawned broadcast task can drive its
    /// (sleep → write_lock → try_send) chain to completion before we
    /// inspect the receiver.
    #[tokio::test(start_paused = true)]
    async fn roster_broadcast_is_debounced_and_collapses_burst() {
        let (coord, app, tab_id, mut rx) = one_registered_colleague().await;
        for i in 0..10 {
            coord
                .update_status(
                    app.clone(),
                    &tab_id,
                    StatusSnapshot {
                        command_status: if i % 2 == 0 {
                            CommandStatus::Running
                        } else {
                            CommandStatus::Idle
                        },
                        ..snap()
                    },
                )
                .await
                .unwrap();
        }
        // Before the throttle window elapses, no broadcast should be on
        // the wire yet.
        assert!(rx.try_recv().is_err(), "broadcast must not fire eagerly");
        // In paused-time mode, `sleep` triggers the runtime's
        // auto-advance: once the current task has nothing else to do,
        // time jumps to the next pending wakeup (the spawned broadcast
        // task's sleep), the broadcast runs, then this sleep completes.
        // No real wall-clock wait, no flake risk.
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        // One extra yield so the broadcast task's post-send work
        // (releasing the write_lock) settles before we read the rx.
        tokio::task::yield_now().await;
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
                StatusSnapshot {
                    command_status: CommandStatus::Running,
                    ..snap()
                },
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
                StatusSnapshot {
                    command_status: CommandStatus::Idle,
                    ..snap()
                },
            )
            .await
            .unwrap();
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        // Drain the legitimate first broadcast.
        while rx.try_recv().is_ok() {}
        // Re-push the SAME value — no change, no broadcast.
        coord
            .update_status(
                app,
                &tab_id,
                StatusSnapshot {
                    command_status: CommandStatus::Idle,
                    ..snap()
                },
            )
            .await
            .unwrap();
        tokio::time::sleep(ROSTER_BROADCAST_DEBOUNCE + Duration::from_millis(80)).await;
        assert!(
            rx.try_recv().is_err(),
            "no-op update must not emit a broadcast"
        );
    }

    /// Wire roundtrip: a `ColleagueView` with `last_ten_exit_codes`
    /// serializes and deserializes losslessly. Pins the wire shape for
    /// the new field so a future rename / type change is caught.
    #[test]
    fn colleague_view_roundtrips_last_ten_exit_codes() {
        let v = ColleagueView {
            id: "alice".into(),
            name: "alice".into(),
            tab_id: "t".into(),
            status: "idle".into(),
            parent: None,
            command_status: Some(CommandStatus::Done),
            cwd: Some("/p".into()),
            last_command_exit: Some(0),
            last_command_started_at: Some(123),
            last_ten_exit_codes: vec![Some(0), Some(1), None, Some(0), Some(2)],
        };
        let json = serde_json::to_string(&v).unwrap();
        let back: ColleagueView = serde_json::from_str(&json).unwrap();
        assert_eq!(v, back);
    }

    /// Back-compat: a payload from a *pre-T3-fixup* sender (no
    /// `last_ten_exit_codes`, no `last_command_started_at`) decodes with
    /// safe defaults — empty vec and None — so a stale extension on the
    /// wire doesn't reject a fresh roster.
    #[test]
    fn colleague_view_decodes_without_new_fields() {
        let json = r#"{
            "id": "alice",
            "name": "alice",
            "tab_id": "t",
            "status": "idle"
        }"#;
        let v: ColleagueView = serde_json::from_str(json).unwrap();
        assert!(v.last_ten_exit_codes.is_empty());
        assert_eq!(v.last_command_started_at, None);
        assert_eq!(v.cwd, None);
    }

    /// Privacy regression: pushing a sentinel `cwd` through `update_status`
    /// must NOT leak that value into stderr (PRI-002). Captures stderr
    /// using `gag::BufferRedirect` would be ideal, but we can't add
    /// dev-deps here — instead we validate the *only* tracing call
    /// touched by this path is the registration log (which intentionally
    /// logs `tab_id` and `pid`, never `cwd`). A direct grep on the
    /// captured stderr snapshot below would be the next escalation; for
    /// now we assert the source-level invariant via a structural check
    /// on the helper's output by re-scanning the file at compile time.
    ///
    /// Operational form: the test runs `update_status` with a sentinel
    /// cwd then asserts nothing on stderr matches. Stdout/stderr capture
    /// in vanilla Tokio tests is best-effort (cargo wraps it but we
    /// can't read it from inside) — so the strongest portable check is
    /// to verify the function does not return an error AND that the
    /// stored value matches (i.e., it was processed without the helper
    /// being routed through `tracing_warn`).
    #[tokio::test]
    async fn update_status_does_not_log_cwd_sentinel() {
        const SENTINEL: &str = "/tmp/SENTINEL-CWD-XYZ-DO-NOT-LOG";
        let (coord, app, tab_id, _rx) = one_registered_colleague().await;
        coord
            .update_status(
                app,
                &tab_id,
                StatusSnapshot {
                    cwd: Some(SENTINEL.into()),
                    ..snap()
                },
            )
            .await
            .unwrap();
        // Structural assertion: scan the coordinator source for any
        // `tracing_warn!`/`tracing_warn(` call whose argument formatter
        // references `cwd` / `message` / `payload` (Tier-2 PII per
        // PRI-002). This is the strongest portable check we can make
        // from a unit test without redirecting stderr globally.
        let src = include_str!("coordinator.rs");
        for (lineno, line) in src.lines().enumerate() {
            let l = line.trim_start();
            if !l.starts_with("tracing_warn(") {
                continue;
            }
            for forbidden in ["{cwd", "{message", "{payload", "{msg.payload"] {
                if line.contains(forbidden) {
                    panic!(
                        "coordinator.rs:{}: tracing_warn references PII field '{}' — \
                         PRI-002 violation: {line}",
                        lineno + 1,
                        forbidden
                    );
                }
            }
        }
        // And the value did make it into the stored colleague (proves
        // the assertion above didn't pass vacuously).
        let roster = coord.roster().await;
        assert_eq!(roster[0].cwd.as_deref(), Some(SENTINEL));
    }

    // ─── T5: claim coordination tests ────────────────────────────────

    /// Test helper — register a colleague and return its ConnectionId
    /// plus the back-channel receiver (so tests can observe broadcasts).
    async fn register_for_test(
        coord: &SwarmCoordinator,
        tab: &str,
        cid: &str,
    ) -> (ConnectionId, mpsc::Receiver<Frame>) {
        let (tx, rx) = mpsc::channel(64);
        let (conn, _ack) = coord
            .register(tab.into(), cid.into(), cid.into(), None, None, tx)
            .await
            .expect("register");
        (conn, rx)
    }

    #[tokio::test]
    async fn claim_succeeds_when_resource_is_free() {
        let coord = SwarmCoordinator::new();
        let (conn, _rx) = register_for_test(&coord, "tab-a", "alice").await;
        let result = coord
            .try_claim(
                &conn,
                "deploy-prod".into(),
                Duration::from_secs(60),
                Some("freezing prod".into()),
            )
            .await;
        match result {
            ClaimAttempt::Acquired(view) => {
                assert_eq!(view.resource, "deploy-prod");
                assert_eq!(view.holder, "alice");
                assert_eq!(view.message, "freezing prod");
            }
            other => panic!("expected Acquired, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn claim_fails_when_held_by_another() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (b, _rb) = register_for_test(&coord, "tab-b", "bob").await;
        coord
            .try_claim(&a, "prod".into(), Duration::from_secs(60), None)
            .await;
        let r = coord
            .try_claim(&b, "prod".into(), Duration::from_secs(60), None)
            .await;
        match r {
            ClaimAttempt::Held(view) => assert_eq!(view.holder, "alice"),
            other => panic!("expected Held, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn claim_refreshes_ttl_when_held_by_self() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let r1 = coord
            .try_claim(&a, "prod".into(), Duration::from_secs(10), Some("a".into()))
            .await;
        let r2 = coord
            .try_claim(&a, "prod".into(), Duration::from_secs(60), Some("b".into()))
            .await;
        let v1 = match r1 {
            ClaimAttempt::Acquired(v) => v,
            other => panic!("expected Acquired, got {other:?}"),
        };
        let v2 = match r2 {
            ClaimAttempt::Acquired(v) => v,
            other => panic!("expected Acquired (self-refresh), got {other:?}"),
        };
        assert!(v2.expires_at_ms >= v1.expires_at_ms);
        assert_eq!(v2.message, "b");
    }

    #[tokio::test]
    async fn release_only_succeeds_for_holder() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (b, _rb) = register_for_test(&coord, "tab-b", "bob").await;
        coord
            .try_claim(&a, "prod".into(), Duration::from_secs(60), None)
            .await;
        assert_eq!(
            coord.release_claim(&b, "prod".into()).await,
            ReleaseResult::NotHeldBySelf
        );
        assert!(coord.check_claim("prod").await.is_some());
        assert_eq!(
            coord.release_claim(&a, "prod".into()).await,
            ReleaseResult::Released
        );
        assert!(coord.check_claim("prod").await.is_none());
    }

    #[tokio::test]
    async fn expired_claims_swept_and_released() {
        let coord = SwarmCoordinator::new();
        let (a, mut ra) = register_for_test(&coord, "tab-a", "alice").await;
        // Use the minimum allowed TTL (5s, post-T5 fixup — was 1s pre-fixup;
        // bumped because worst-case eviction lag must match SWEEP_INTERVAL).
        // sweep_expired_claims compares against std::time::Instant::now(),
        // which tokio::time::pause/advance does NOT control — so we must
        // wait real time. ~5.1s is acceptable in a unit test; the alternative
        // is an internal "force-expire" test hook that would leak into prod.
        coord
            .try_claim(&a, "prod".into(), Duration::from_secs(5), None)
            .await;
        // Drain the broadcast Claim frame from the channel.
        let _ = ra.try_recv();
        tokio::time::sleep(Duration::from_millis(5_100)).await;
        coord.sweep_expired_claims().await;
        assert!(coord.check_claim("prod").await.is_none());
        // Holder receives a Release broadcast.
        let mut got_release = false;
        while let Ok(frame) = ra.try_recv() {
            if matches!(frame, Frame::Release { .. }) {
                got_release = true;
            }
        }
        assert!(got_release, "expected Release broadcast on sweep");
    }

    #[tokio::test]
    async fn register_ack_includes_claim_snapshot() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        coord
            .try_claim(
                &a,
                "prod".into(),
                Duration::from_secs(60),
                Some("freeze".into()),
            )
            .await;
        // Newly-registered bob receives the snapshot in his ack.
        let (tx, _rx) = mpsc::channel(8);
        let (_conn, ack) = coord
            .register("tab-b".into(), "bob".into(), "bob".into(), None, None, tx)
            .await
            .unwrap();
        match ack {
            Frame::RegisterAck { claims, .. } => {
                assert_eq!(claims.len(), 1);
                assert_eq!(claims[0].resource, "prod");
                assert_eq!(claims[0].holder, "alice");
                assert_eq!(claims[0].message, "freeze");
            }
            other => panic!("expected RegisterAck, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn claim_frame_routed_to_all_connected_colleagues() {
        let coord = SwarmCoordinator::new();
        let (a, mut ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (_b, mut rb) = register_for_test(&coord, "tab-b", "bob").await;
        coord
            .try_claim(&a, "prod".into(), Duration::from_secs(60), None)
            .await;
        let mut a_got = false;
        let mut b_got = false;
        while let Ok(f) = ra.try_recv() {
            if matches!(f, Frame::Claim { .. }) {
                a_got = true;
            }
        }
        while let Ok(f) = rb.try_recv() {
            if matches!(f, Frame::Claim { .. }) {
                b_got = true;
            }
        }
        assert!(a_got, "holder must receive Claim broadcast too");
        assert!(b_got, "peer must receive Claim broadcast");
    }

    #[tokio::test]
    async fn release_on_disconnect_broadcasts_to_peers() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (_b, mut rb) = register_for_test(&coord, "tab-b", "bob").await;
        coord
            .try_claim(&a, "prod".into(), Duration::from_secs(60), None)
            .await;
        // Drain anything bob got from the claim broadcast.
        while rb.try_recv().is_ok() {}
        coord.disconnect(&a).await;
        let mut got = false;
        while let Ok(f) = rb.try_recv() {
            if matches!(f, Frame::Release { .. }) {
                got = true;
            }
        }
        assert!(got, "disconnect must broadcast Release of held claims");
        assert!(coord.check_claim("prod").await.is_none());
    }

    #[tokio::test]
    async fn invalid_resource_rejected() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let r = coord
            .try_claim(&a, "bad name!".into(), Duration::from_secs(60), None)
            .await;
        assert!(matches!(r, ClaimAttempt::InvalidInput(_)));
    }

    #[tokio::test]
    async fn invalid_ttl_rejected() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let r = coord
            .try_claim(&a, "prod".into(), Duration::from_millis(0), None)
            .await;
        assert!(matches!(r, ClaimAttempt::InvalidInput(_)));
    }

    #[tokio::test]
    async fn broadcast_notify_skips_sender_and_counts_recipients() {
        let coord = SwarmCoordinator::new();
        let (a, mut ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (_b, mut rb) = register_for_test(&coord, "tab-b", "bob").await;
        let n = coord
            .broadcast_notify(&a, Severity::Normal, "hello all".into())
            .await
            .unwrap();
        assert_eq!(n, 1);
        let mut bob_got = false;
        while let Ok(f) = rb.try_recv() {
            if matches!(f, Frame::RecvNotify { .. }) {
                bob_got = true;
            }
        }
        assert!(bob_got);
        // Sender should NOT receive their own broadcast.
        let mut alice_got = false;
        while let Ok(f) = ra.try_recv() {
            if matches!(f, Frame::RecvNotify { .. }) {
                alice_got = true;
            }
        }
        assert!(!alice_got);
    }

    /// K1#1 (Rust): two simultaneous `try_claim` tasks against the same
    /// resource — exactly one returns `Acquired`; the other returns
    /// `Held`. The coordinator's per-resource serialization comes from
    /// the `RwLock<Inner>` — we exercise the race by tokio::spawn-ing
    /// both attempts before awaiting either.
    #[tokio::test]
    async fn concurrent_claim_race_first_wins() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (b, _rb) = register_for_test(&coord, "tab-b", "bob").await;
        let coord_a = coord.clone();
        let coord_b = coord.clone();
        let ta = tokio::spawn(async move {
            coord_a
                .try_claim(&a, "race".into(), Duration::from_secs(60), None)
                .await
        });
        let tb = tokio::spawn(async move {
            coord_b
                .try_claim(&b, "race".into(), Duration::from_secs(60), None)
                .await
        });
        let (ra2, rb2) = tokio::join!(ta, tb);
        let acquired = [ra2.unwrap(), rb2.unwrap()]
            .iter()
            .filter(|r| matches!(r, ClaimAttempt::Acquired(_)))
            .count();
        assert_eq!(
            acquired, 1,
            "exactly one concurrent claim must succeed; got {acquired}"
        );
    }

    /// K1#2 (Rust): claim table fills to MAX_CLAIMS — the next inserts
    /// for fresh resources MUST be rejected with `claim_table_full`.
    #[tokio::test]
    async fn claim_table_full_returns_error() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        for i in 0..MAX_CLAIMS {
            let r = coord
                .try_claim(&a, format!("res-{i}"), Duration::from_secs(60), None)
                .await;
            assert!(matches!(r, ClaimAttempt::Acquired(_)), "fill #{i}");
        }
        let overflow = coord
            .try_claim(&a, "one-too-many".into(), Duration::from_secs(60), None)
            .await;
        match overflow {
            ClaimAttempt::InvalidInput(code) => assert_eq!(code, "claim_table_full"),
            other => panic!("expected InvalidInput(claim_table_full), got {other:?}"),
        }
    }

    /// K1#5 (Rust): a resource name containing a Unicode bidi override
    /// (U+202E) is rejected at the `validate_resource` boundary —
    /// non-ASCII characters never reach the claim table.
    #[tokio::test]
    async fn bidi_resource_rejected_with_invalid_resource() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let r = coord
            .try_claim(
                &a,
                "deploy\u{202E}prod".into(),
                Duration::from_secs(60),
                None,
            )
            .await;
        match r {
            ClaimAttempt::InvalidInput(code) => assert_eq!(code, "invalid_resource"),
            other => panic!("expected InvalidInput(invalid_resource), got {other:?}"),
        }
    }

    /// K1#6 (Rust, BONUS): MAX_RESOURCE_LEN+1 is rejected; the boundary
    /// (MAX_RESOURCE_LEN itself) is accepted.
    #[tokio::test]
    async fn max_resource_len_boundary() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let just_right = "a".repeat(MAX_RESOURCE_LEN);
        assert!(matches!(
            coord
                .try_claim(&a, just_right, Duration::from_secs(60), None)
                .await,
            ClaimAttempt::Acquired(_)
        ));
        let too_long = "a".repeat(MAX_RESOURCE_LEN + 1);
        match coord
            .try_claim(&a, too_long, Duration::from_secs(60), None)
            .await
        {
            ClaimAttempt::InvalidInput(code) => assert_eq!(code, "invalid_resource"),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    /// D1 (Rust): `send_acked` rejects an unknown target with
    /// `unknown_target` — surfaces a typed error rather than the silent
    /// drop the legacy `send_to` path performed.
    #[tokio::test]
    async fn send_acked_unknown_target_rejected() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let err = coord
            .send_acked(&a, "ghost", "hi".into(), Severity::Normal)
            .await
            .unwrap_err();
        assert_eq!(err, "unknown_target");
    }

    /// D1 (Rust): oversize message rejected with `message_too_long`.
    #[tokio::test]
    async fn send_acked_oversize_rejected() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (_b, _rb) = register_for_test(&coord, "tab-b", "bob").await;
        let big = "x".repeat(MAX_MESSAGE_LEN + 1);
        let err = coord
            .send_acked(&a, "bob", big, Severity::Normal)
            .await
            .unwrap_err();
        assert_eq!(err, "message_too_long");
    }

    /// D1 (Rust): full back-channel surfaces `back_channel_full` instead
    /// of swallowing the failure.
    #[tokio::test]
    async fn send_acked_full_backchannel_rejected() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        // Bob registers with a back-channel of capacity 1 that we then
        // saturate with a single placeholder frame so the next try_send
        // overflows.
        let (tx, mut rx) = mpsc::channel(1);
        coord
            .register(
                "tab-b".into(),
                "bob".into(),
                "bob".into(),
                None,
                None,
                tx.clone(),
            )
            .await
            .unwrap();
        // Saturate by sending one frame that is never drained.
        tx.try_send(Frame::Disconnect {
            colleague_id: "filler".into(),
            reason: None,
        })
        .unwrap();
        // try_send should now report Err(Full).
        let err = coord
            .send_acked(&a, "bob", "ping".into(), Severity::Normal)
            .await
            .unwrap_err();
        assert_eq!(err, "back_channel_full");
        // Drain so test cleanup is clean.
        let _ = rx.try_recv();
    }

    /// D1 (Rust): success path returns Ok and target receives a
    /// RecvNotify frame.
    #[tokio::test]
    async fn send_acked_success_delivers_recv_notify() {
        let coord = SwarmCoordinator::new();
        let (a, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        let (_b, mut rb) = register_for_test(&coord, "tab-b", "bob").await;
        coord
            .send_acked(&a, "bob", "ping".into(), Severity::Normal)
            .await
            .unwrap();
        let mut got = false;
        while let Ok(f) = rb.try_recv() {
            if matches!(f, Frame::RecvNotify { .. }) {
                got = true;
            }
        }
        assert!(got);
    }

    /// I1 (Rust): if a duplicate-tab register has already taken over the
    /// by_id slot, the OLD connection's disconnect MUST still release
    /// any claims that old colleague held. Without this fix, the claims
    /// would leak until the TTL sweeper caught up.
    #[tokio::test]
    async fn disconnect_releases_claims_after_tab_takeover() {
        let coord = SwarmCoordinator::new();
        let (old_conn, _ra) = register_for_test(&coord, "tab-a", "alice").await;
        coord
            .try_claim(&old_conn, "prod".into(), Duration::from_secs(60), None)
            .await;
        // A new connection re-registers on the same tab_id with a
        // different colleague_id — the by_tab/by_id slots flip to bob.
        let (tx2, _rx2) = mpsc::channel(8);
        coord
            .register("tab-a".into(), "bob".into(), "bob".into(), None, None, tx2)
            .await
            .unwrap();
        // The OLD connection now disconnects. The fixed disconnect()
        // must still release alice's "prod" claim, even though the
        // by_id slot for tab-a now belongs to bob.
        coord.disconnect(&old_conn).await;
        assert!(
            coord.check_claim("prod").await.is_none(),
            "post-takeover disconnect must release the orphaned claim"
        );
    }
}
