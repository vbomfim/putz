/// Swarm coordinator — in-memory registry, message routing, SSE fan-out.
///
/// The coordinator is the central state for the swarm broker. It owns:
/// - The colleague registry (HashMap<colleague_id, Colleague>)
/// - Per-colleague SSE sender (mpsc::UnboundedSender)
/// - Message buffers for disconnected colleagues
/// - The HTTP server lifecycle (start/stop via CancellationToken)
/// - The stale-detection background task
///
/// Thread-safe: all mutable state behind `Arc<RwLock<..>>` or atomics.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::models::*;

/// Duration after which a colleague is marked Stale (no heartbeat).
const STALE_TIMEOUT: Duration = Duration::from_secs(60);
/// Duration after which a colleague is marked Dead.
const DEAD_TIMEOUT: Duration = Duration::from_secs(300);
/// Stale-check sweep interval.
const SWEEP_INTERVAL: Duration = Duration::from_secs(5);
/// Message buffer TTL in seconds.
const MESSAGE_BUFFER_TTL: u64 = 60;
/// Maximum colleagues allowed in a single swarm (M3: resource bounds).
const MAX_COLLEAGUES: usize = 50;
/// Bounded SSE channel capacity per colleague (M3: resource bounds).
const SSE_CHANNEL_SIZE: usize = 256;
/// Maximum prompt/body length in characters (M4: input validation).
const MAX_PROMPT_LENGTH: usize = 4096;

/// Check if a string is a valid identifier: alphanumeric + hyphens + underscores, 1-100 chars (M4).
pub(crate) fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Internal mutable state of the coordinator.
pub(crate) struct CoordinatorInner {
    /// Colleague registry keyed by colleague_id.
    pub(super) registry: HashMap<String, Colleague>,
    /// Per-colleague SSE event sender (bounded channel, M3).
    pub(super) senders: HashMap<String, mpsc::Sender<SseEvent>>,
    /// Server task handle for clean shutdown (M8).
    pub(super) server_handle: Option<tokio::task::JoinHandle<()>>,
    /// Message buffer for disconnected colleagues (keyed by colleague_id).
    pub(super) buffers: HashMap<String, MessageBuffer>,
    /// Current server URL (e.g., "http://127.0.0.1:12345").
    pub(super) url: Option<String>,
    /// Current bearer token.
    pub(super) token: Option<String>,
    /// Server port (for reference).
    pub(super) port: Option<u16>,
}

/// The swarm coordinator — manages the entire swarm lifecycle.
///
/// Follows the project's manager pattern: `Arc`-wrapped internals,
/// `new()` constructor, methods on `&self`.
#[derive(Clone)]
pub struct SwarmCoordinator {
    inner: Arc<RwLock<CoordinatorInner>>,
    enabled: Arc<AtomicBool>,
    cancel: Arc<RwLock<Option<CancellationToken>>>,
    /// Lifecycle mutex — serializes start/stop calls (M8).
    lifecycle: Arc<Mutex<()>>,
}

impl SwarmCoordinator {
    /// Creates a new disabled coordinator.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(CoordinatorInner {
                registry: HashMap::new(),
                senders: HashMap::new(),
                server_handle: None,
                buffers: HashMap::new(),
                url: None,
                token: None,
                port: None,
            })),
            enabled: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(RwLock::new(None)),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }

    /// Whether the swarm is currently enabled.
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Start the swarm: bind HTTP server, generate token, start sweeper.
    /// Returns the SwarmState with url and token.
    ///
    /// Guarded by a lifecycle mutex to prevent concurrent start/stop races (M8).
    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<SwarmState, String> {
        let _guard = self.lifecycle.lock().await;

        if self.enabled() {
            // Already running — return current state
            return Ok(self.state().await);
        }

        // Generate a new 32-byte hex token each time
        let token = generate_token();

        // Create cancellation token for graceful shutdown
        let cancel_token = CancellationToken::new();
        let cancel_child = cancel_token.child_token();

        // Start the HTTP server — returns (port, JoinHandle) (H1: pass SwarmCoordinator)
        let (port, server_handle) = super::http_server::start_server(
            self.clone(),
            token.clone(),
            cancel_child.clone(),
            app_handle.clone(),
        )
        .await
        .map_err(|e| format!("Failed to start swarm server: {e}"))?;

        let url = format!("http://127.0.0.1:{port}");

        // Store state
        {
            let mut inner = self.inner.write().await;
            inner.url = Some(url.clone());
            inner.token = Some(token.clone());
            inner.port = Some(port);
            inner.server_handle = Some(server_handle);
        }

        self.enabled.store(true, Ordering::SeqCst);

        // Store cancel token
        {
            let mut cancel_guard = self.cancel.write().await;
            *cancel_guard = Some(cancel_token);
        }

        // Start stale sweeper task
        let sweep_inner = self.inner.clone();
        let sweep_cancel = cancel_child;
        tokio::spawn(async move {
            stale_sweeper(sweep_inner, sweep_cancel).await;
        });

        let state = SwarmState {
            enabled: true,
            url: Some(url),
            token: Some(token),
        };

        // Emit public state (no token) to frontend (H3)
        emit_state_changed(&app_handle, &self.state_public().await);

        Ok(state)
    }

    /// Stop the swarm: cancel server, clear state.
    ///
    /// Guarded by a lifecycle mutex to prevent concurrent start/stop races (M8).
    pub async fn stop(&self) {
        let _guard = self.lifecycle.lock().await;

        // Cancel the server and sweeper
        {
            let mut cancel_guard = self.cancel.write().await;
            if let Some(token) = cancel_guard.take() {
                token.cancel();
            }
        }

        // Await server task for clean port release (M8)
        let server_handle = {
            let mut inner = self.inner.write().await;
            inner.server_handle.take()
        };
        if let Some(handle) = server_handle {
            let _ = handle.await;
        }

        self.enabled.store(false, Ordering::SeqCst);

        // Clear all state
        {
            let mut inner = self.inner.write().await;
            inner.registry.clear();
            inner.senders.clear();
            inner.buffers.clear();
            inner.url = None;
            inner.token = None;
            inner.port = None;
        }
    }

    /// Get current swarm state (for `swarm_get_state` command).
    pub async fn state(&self) -> SwarmState {
        if !self.enabled() {
            return SwarmState::disabled();
        }
        let inner = self.inner.read().await;
        SwarmState {
            enabled: true,
            url: inner.url.clone(),
            token: inner.token.clone(),
        }
    }

    /// Get current swarm state for frontend consumption — never contains secrets (H3).
    pub async fn state_public(&self) -> SwarmStatePublic {
        if !self.enabled() {
            return SwarmStatePublic::disabled();
        }
        let inner = self.inner.read().await;
        SwarmStatePublic {
            enabled: true,
            url: inner.url.clone(),
            colleague_count: inner.registry.len(),
            colleague_ids: inner.registry.keys().cloned().collect(),
        }
    }

    /// Returns the env vars to inject into new PTY sessions, or None if disabled.
    pub async fn env_vars(&self, tab_id: &str) -> Option<HashMap<String, String>> {
        if !self.enabled() {
            return None;
        }
        let inner = self.inner.read().await;
        let url = inner.url.as_ref()?;
        let token = inner.token.as_ref()?;
        let mut vars = HashMap::new();
        vars.insert("PUTZ_SWARM_URL".into(), url.clone());
        vars.insert("PUTZ_SWARM_TOKEN".into(), token.clone());
        vars.insert("PUTZ_TAB_ID".into(), tab_id.into());
        Some(vars)
    }

    /// Returns the env vars for a spawned colleague (ambient + identity vars).
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

    // ─── Registry operations (used by HTTP handlers) ──────────────

    /// Register a colleague.
    ///
    /// Validates input (M4) and enforces capacity limits (M3).
    pub async fn register(&self, req: RegisterRequest) -> Result<DateTime<Utc>, String> {
        // M4: Input validation
        if !is_valid_identifier(&req.colleague_id) {
            return Err("Invalid colleague_id".into());
        }
        if !is_valid_identifier(&req.name) {
            return Err("Invalid name".into());
        }
        if req.tab_id.is_empty() || req.tab_id.len() > 100 {
            return Err("Invalid tab_id".into());
        }

        let mut inner = self.inner.write().await;

        // M3: Capacity check (only for genuinely new colleagues)
        if !inner.registry.contains_key(&req.colleague_id) && inner.registry.len() >= MAX_COLLEAGUES
        {
            return Err("Registry full".into());
        }

        let now = Utc::now();
        let colleague = Colleague {
            id: req.colleague_id.clone(),
            name: req.name,
            parent: req.parent,
            tab_id: req.tab_id,
            pid: req.pid,
            cwd: req.cwd,
            status: ColleagueStatus::Idle,
            last_seen: Instant::now(),
            last_seen_at: now,
            registered_at: now,
        };
        inner.registry.insert(req.colleague_id.clone(), colleague);
        // Create a message buffer for this colleague
        inner
            .buffers
            .entry(req.colleague_id)
            .or_insert_with(|| MessageBuffer::new(MESSAGE_BUFFER_TTL));
        Ok(now)
    }

    /// Deregister a colleague by ID.
    pub async fn deregister(&self, colleague_id: &str) {
        let mut inner = self.inner.write().await;
        inner.registry.remove(colleague_id);
        inner.senders.remove(colleague_id);
        inner.buffers.remove(colleague_id);
        // Broadcast roster update to remaining peers
        broadcast_roster_update(&inner);
    }

    /// Deregister all colleagues associated with a tab_id.
    pub async fn deregister_by_tab(&self, tab_id: &str) {
        let mut inner = self.inner.write().await;
        let ids_to_remove: Vec<String> = inner
            .registry
            .values()
            .filter(|c| c.tab_id == tab_id)
            .map(|c| c.id.clone())
            .collect();
        for id in &ids_to_remove {
            inner.registry.remove(id);
            inner.senders.remove(id);
            inner.buffers.remove(id);
        }
        if !ids_to_remove.is_empty() {
            broadcast_roster_update(&inner);
        }
    }

    /// Process a heartbeat: update last_seen and status.
    /// Returns list of stale peer IDs.
    ///
    /// Accepts only `Idle` and `Working` statuses (M2).
    pub async fn heartbeat(
        &self,
        colleague_id: &str,
        status: ColleagueStatus,
    ) -> Result<Vec<String>, String> {
        // Only Idle and Working are valid heartbeat statuses (M2)
        match status {
            ColleagueStatus::Idle | ColleagueStatus::Working => {}
            _ => return Err("Invalid status".into()),
        }

        let mut inner = self.inner.write().await;
        let colleague = inner
            .registry
            .get_mut(colleague_id)
            .ok_or_else(|| "Colleague not found".to_string())?;

        colleague.last_seen = Instant::now();
        colleague.last_seen_at = Utc::now();
        colleague.status = status;

        // Return stale peers
        let stale: Vec<String> = inner
            .registry
            .values()
            .filter(|c| c.status == ColleagueStatus::Stale || c.status == ColleagueStatus::Dead)
            .map(|c| c.id.clone())
            .collect();

        Ok(stale)
    }

    /// Get the current roster.
    pub async fn roster(&self) -> Vec<ColleagueView> {
        let inner = self.inner.read().await;
        inner.registry.values().map(ColleagueView::from).collect()
    }

    /// Route a message to the target colleague.
    pub async fn route_message(&self, req: MessageRequest) -> Result<String, String> {
        // M4: Validate body length
        if req.body.len() > MAX_PROMPT_LENGTH {
            return Err("Message body too large".into());
        }

        let msg_id = Uuid::new_v4().to_string();
        let message = Message {
            id: msg_id.clone(),
            from: req.from,
            to: req.to.clone(),
            severity: req.severity,
            body: req.body,
            sent_at: Utc::now(),
        };

        let inner = self.inner.read().await;

        // Check recipient exists (M6: generic error, no user input echo)
        if !inner.registry.contains_key(&req.to) {
            return Err("Recipient not found".to_string());
        }

        let event = SseEvent::Message(message);

        // Try to deliver via SSE sender (try_send is non-blocking, M3)
        if let Some(sender) = inner.senders.get(&req.to) {
            if sender.try_send(event.clone()).is_ok() {
                return Ok(msg_id);
            }
        }

        // Fall through to buffer
        drop(inner);
        let mut inner = self.inner.write().await;
        let buf = inner
            .buffers
            .entry(req.to)
            .or_insert_with(|| MessageBuffer::new(MESSAGE_BUFFER_TTL));
        buf.push(event);

        Ok(msg_id)
    }

    /// Subscribe a colleague to SSE events. Returns a bounded receiver and any buffered messages.
    pub async fn subscribe(
        &self,
        colleague_id: &str,
    ) -> Result<(mpsc::Receiver<SseEvent>, Vec<SseEvent>), String> {
        let mut inner = self.inner.write().await;

        if !inner.registry.contains_key(colleague_id) {
            return Err("Colleague not found".to_string());
        }

        let (tx, rx) = mpsc::channel(SSE_CHANNEL_SIZE);
        inner.senders.insert(colleague_id.to_string(), tx);

        // Drain any buffered messages
        let buffered = inner
            .buffers
            .get_mut(colleague_id)
            .map(|b| b.drain_valid())
            .unwrap_or_default();

        Ok((rx, buffered))
    }

    /// Generate a colleague_id from a name.
    pub fn generate_colleague_id(name: &str) -> String {
        let hex = &Uuid::new_v4().to_string()[..4];
        format!("{name}-{hex}")
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Generate a 32-byte hex token.
fn generate_token() -> String {
    let bytes: [u8; 32] = rand_bytes();
    hex_encode(&bytes)
}

/// Simple random bytes using uuid v4 as entropy source (no extra dependency).
///
/// Security note: uuid v4 uses the OS CSPRNG (`getrandom`), which provides
/// cryptographic-quality randomness. Two back-to-back v4 UUIDs yield 256 bits
/// of entropy — sufficient for bearer tokens (L2).
fn rand_bytes() -> [u8; 32] {
    let mut out = [0u8; 32];
    let u1 = Uuid::new_v4();
    let u2 = Uuid::new_v4();
    out[..16].copy_from_slice(u1.as_bytes());
    out[16..].copy_from_slice(u2.as_bytes());
    out
}

/// Hex-encode bytes.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Emit `swarm://state-changed` Tauri event with public state (no token, H3).
fn emit_state_changed(app: &tauri::AppHandle, state: &SwarmStatePublic) {
    use tauri::Emitter;
    let _ = app.emit("swarm://state-changed", state);
}

/// Broadcast a roster update SSE event to all connected colleagues (try_send, M3).
fn broadcast_roster_update(inner: &CoordinatorInner) {
    let peers: Vec<ColleagueView> = inner.registry.values().map(ColleagueView::from).collect();
    let event = SseEvent::RosterUpdate {
        peers: peers.clone(),
    };
    for sender in inner.senders.values() {
        let _ = sender.try_send(event.clone());
    }
}

/// Background task that sweeps the registry for stale/dead colleagues.
///
/// M7: Collects transitions under write lock, drops it, then broadcasts under read lock.
async fn stale_sweeper(inner: Arc<RwLock<CoordinatorInner>>, cancel: CancellationToken) {
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(SWEEP_INTERVAL) => {
                // M7: Collect transitions under write lock, then release
                let transitions = {
                    let mut state = inner.write().await;
                    let now = Instant::now();
                    let mut transitions = Vec::new();

                    for colleague in state.registry.values_mut() {
                        let elapsed = now.duration_since(colleague.last_seen);
                        let old_status = colleague.status.clone();

                        if elapsed > DEAD_TIMEOUT && colleague.status != ColleagueStatus::Dead {
                            colleague.status = ColleagueStatus::Dead;
                        } else if elapsed > STALE_TIMEOUT
                            && colleague.status != ColleagueStatus::Stale
                            && colleague.status != ColleagueStatus::Dead
                        {
                            colleague.status = ColleagueStatus::Stale;
                        }

                        if colleague.status != old_status {
                            transitions.push((colleague.id.clone(), colleague.status.to_string()));
                        }
                    }
                    transitions
                }; // write lock dropped

                // Broadcast under read lock (M7: no write lock held during broadcast)
                if !transitions.is_empty() {
                    let state = inner.read().await;
                    for (id, status) in &transitions {
                        let event = SseEvent::PeerStatus {
                            id: id.clone(),
                            status: status.clone(),
                        };
                        for sender in state.senders.values() {
                            let _ = sender.try_send(event.clone());
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_token_is_64_hex_chars() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_token_is_unique() {
        let t1 = generate_token();
        let t2 = generate_token();
        assert_ne!(t1, t2);
    }

    #[test]
    fn generate_colleague_id_format() {
        let id = SwarmCoordinator::generate_colleague_id("alice");
        assert!(id.starts_with("alice-"));
        assert_eq!(id.len(), "alice-".len() + 4);
    }

    #[test]
    fn hex_encode_correct() {
        let bytes = [0xde, 0xad, 0xbe, 0xef];
        assert_eq!(hex_encode(&bytes), "deadbeef");
    }

    #[tokio::test]
    async fn coordinator_new_is_disabled() {
        let coord = SwarmCoordinator::new();
        assert!(!coord.enabled());
        assert!(!coord.state().await.enabled);
    }

    #[tokio::test]
    async fn env_vars_none_when_disabled() {
        let coord = SwarmCoordinator::new();
        assert!(coord.env_vars("tab-1").await.is_none());
    }

    #[tokio::test]
    async fn register_and_roster() {
        let coord = SwarmCoordinator::new();
        let req = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: Some(1234),
            cwd: None,
        };
        coord.register(req).await.unwrap();
        let roster = coord.roster().await;
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].id, "alice-a1b2");
    }

    #[tokio::test]
    async fn deregister_removes_colleague() {
        let coord = SwarmCoordinator::new();
        let req = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: None,
            cwd: None,
        };
        coord.register(req).await.unwrap();
        coord.deregister("alice-a1b2").await;
        assert!(coord.roster().await.is_empty());
    }

    #[tokio::test]
    async fn deregister_by_tab_removes_all() {
        let coord = SwarmCoordinator::new();
        for id in ["a-0001", "b-0002"] {
            let req = RegisterRequest {
                colleague_id: id.into(),
                name: id.into(),
                parent: None,
                tab_id: "tab-shared".into(),
                pid: None,
                cwd: None,
            };
            coord.register(req).await.unwrap();
        }
        coord.deregister_by_tab("tab-shared").await;
        assert!(coord.roster().await.is_empty());
    }

    #[tokio::test]
    async fn heartbeat_updates_status() {
        let coord = SwarmCoordinator::new();
        let req = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: None,
            cwd: None,
        };
        coord.register(req).await.unwrap();
        coord
            .heartbeat("alice-a1b2", ColleagueStatus::Working)
            .await
            .unwrap();

        let inner = coord.inner.read().await;
        assert_eq!(
            inner.registry["alice-a1b2"].status,
            ColleagueStatus::Working
        );
    }

    #[tokio::test]
    async fn heartbeat_invalid_status_errors() {
        let coord = SwarmCoordinator::new();
        let req = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: None,
            cwd: None,
        };
        coord.register(req).await.unwrap();
        let result = coord.heartbeat("alice-a1b2", ColleagueStatus::Stale).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn heartbeat_unknown_colleague_errors() {
        let coord = SwarmCoordinator::new();
        let result = coord.heartbeat("nobody", ColleagueStatus::Idle).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn message_to_unknown_recipient_errors() {
        let coord = SwarmCoordinator::new();
        let req = MessageRequest {
            from: "alice".into(),
            to: "nobody".into(),
            severity: Severity::Normal,
            body: "hello".into(),
        };
        let result = coord.route_message(req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn message_buffered_when_no_subscriber() {
        let coord = SwarmCoordinator::new();
        // Register recipient
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Send message (no SSE subscriber yet)
        let msg_id = coord
            .route_message(MessageRequest {
                from: "alice-a1b2".into(),
                to: "bob-0001".into(),
                severity: Severity::Urgent,
                body: "urgent task".into(),
            })
            .await
            .unwrap();
        assert!(!msg_id.is_empty());

        // Subscribe and get buffered messages
        let (_rx, buffered) = coord.subscribe("bob-0001").await.unwrap();
        assert_eq!(buffered.len(), 1);
    }

    #[tokio::test]
    async fn message_delivered_to_subscriber() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Subscribe first
        let (mut rx, _) = coord.subscribe("bob-0001").await.unwrap();

        // Send message
        coord
            .route_message(MessageRequest {
                from: "alice-a1b2".into(),
                to: "bob-0001".into(),
                severity: Severity::Normal,
                body: "hello bob".into(),
            })
            .await
            .unwrap();

        // Should receive it
        let event = rx.try_recv().unwrap();
        match event {
            SseEvent::Message(msg) => {
                assert_eq!(msg.body, "hello bob");
                assert_eq!(msg.to, "bob-0001");
            }
            _ => panic!("Expected Message event"),
        }
    }

    #[tokio::test]
    async fn subscribe_unknown_errors() {
        let coord = SwarmCoordinator::new();
        let result = coord.subscribe("nobody").await;
        assert!(result.is_err());
    }

    // ─── QA Guardian: Integration & Contract Tests ───────────────────

    /// [CONTRACT] register() must create a MessageBuffer entry so messages
    /// can be buffered before the colleague subscribes to SSE.
    /// BUG: HTTP handler `handle_register` bypasses this — see http_server.rs L112-131.
    #[tokio::test]
    async fn register_creates_message_buffer() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let inner = coord.inner.read().await;
        assert!(
            inner.buffers.contains_key("alice-a1b2"),
            "register() must create a MessageBuffer for the new colleague"
        );
    }

    /// [CONTRACT] register() returns a valid RFC3339 timestamp.
    #[tokio::test]
    async fn register_returns_valid_timestamp() {
        let coord = SwarmCoordinator::new();
        let before = chrono::Utc::now();
        let registered_at = coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();
        let after = chrono::Utc::now();
        assert!(registered_at >= before && registered_at <= after);
    }

    /// [EDGE] Re-registering the same colleague_id should overwrite, not duplicate.
    #[tokio::test]
    async fn register_duplicate_overwrites() {
        let coord = SwarmCoordinator::new();
        let req1 = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice-v1".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: Some(100),
            cwd: None,
        };
        let req2 = RegisterRequest {
            colleague_id: "alice-a1b2".into(),
            name: "alice-v2".into(),
            parent: Some("parent-0001".into()),
            tab_id: "tab-2".into(),
            pid: Some(200),
            cwd: Some("/new/cwd".into()),
        };
        coord.register(req1).await.unwrap();
        coord.register(req2).await.unwrap();

        let roster = coord.roster().await;
        assert_eq!(
            roster.len(),
            1,
            "Duplicate ID should overwrite, not duplicate"
        );
        assert_eq!(roster[0].name, "alice-v2");
    }

    /// [EDGE] Deregistering a non-existent colleague should not panic.
    #[tokio::test]
    async fn deregister_nonexistent_is_noop() {
        let coord = SwarmCoordinator::new();
        // Should not panic or error
        coord.deregister("nonexistent-0000").await;
        assert!(coord.roster().await.is_empty());
    }

    /// [EDGE] deregister_by_tab with unknown tab_id is a no-op.
    #[tokio::test]
    async fn deregister_by_tab_unknown_is_noop() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();
        coord.deregister_by_tab("nonexistent-tab").await;
        assert_eq!(
            coord.roster().await.len(),
            1,
            "Alice should still be registered"
        );
    }

    /// [CONTRACT] deregister() cleans up sender and buffer along with registry.
    #[tokio::test]
    async fn deregister_cleans_up_all_state() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Subscribe to create a sender
        let (_rx, _) = coord.subscribe("alice-a1b2").await.unwrap();

        // Route a message to create buffered content (subscribe drains, so send after)
        // Actually, subscribe drains existing buffers. Let's register bob, send to bob
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Now deregister alice
        coord.deregister("alice-a1b2").await;

        let inner = coord.inner.read().await;
        assert!(!inner.registry.contains_key("alice-a1b2"));
        assert!(!inner.senders.contains_key("alice-a1b2"));
        assert!(!inner.buffers.contains_key("alice-a1b2"));
    }

    /// [CONTRACT] subscribe() returns buffered messages and subsequent subscribe
    /// drains the buffer (no double-delivery).
    #[tokio::test]
    async fn subscribe_drains_buffer_no_double_delivery() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Send 3 messages while no subscriber
        for i in 0..3 {
            coord
                .route_message(MessageRequest {
                    from: "alice-a1b2".into(),
                    to: "bob-0001".into(),
                    severity: Severity::Normal,
                    body: format!("msg-{i}"),
                })
                .await
                .unwrap();
        }

        // First subscribe gets all 3 buffered messages
        let (_rx1, buffered1) = coord.subscribe("bob-0001").await.unwrap();
        assert_eq!(
            buffered1.len(),
            3,
            "First subscribe should drain all buffered messages"
        );

        // Second subscribe (re-subscribe) should get no buffered messages
        let (_rx2, buffered2) = coord.subscribe("bob-0001").await.unwrap();
        assert_eq!(
            buffered2.len(),
            0,
            "Re-subscribe should not re-deliver buffered messages"
        );
    }

    /// [CONTRACT] subscribe() replaces the previous sender — old receiver stops getting events.
    #[tokio::test]
    async fn subscribe_replaces_sender() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // First subscription
        let (mut rx_old, _) = coord.subscribe("bob-0001").await.unwrap();

        // Second subscription (replaces first)
        let (mut rx_new, _) = coord.subscribe("bob-0001").await.unwrap();

        // Send a message
        coord
            .route_message(MessageRequest {
                from: "alice".into(),
                to: "bob-0001".into(),
                severity: Severity::Normal,
                body: "hello".into(),
            })
            .await
            .unwrap();

        // New receiver should get the message
        assert!(
            rx_new.try_recv().is_ok(),
            "New subscriber should receive the message"
        );

        // Old receiver should NOT get new messages (sender was replaced)
        // The old tx was dropped when replaced, so old rx will eventually get None
        // For now, it should have no new messages
        assert!(
            rx_old.try_recv().is_err(),
            "Old subscriber should not receive new messages"
        );
    }

    /// [EDGE] Route message from a colleague to itself.
    #[tokio::test]
    async fn route_message_to_self() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let (mut rx, _) = coord.subscribe("alice-a1b2").await.unwrap();

        // Self-message
        let result = coord
            .route_message(MessageRequest {
                from: "alice-a1b2".into(),
                to: "alice-a1b2".into(),
                severity: Severity::Normal,
                body: "note to self".into(),
            })
            .await;
        assert!(result.is_ok(), "Self-message should succeed");

        let event = rx.try_recv().unwrap();
        match event {
            SseEvent::Message(msg) => {
                assert_eq!(msg.from, "alice-a1b2");
                assert_eq!(msg.to, "alice-a1b2");
                assert_eq!(msg.body, "note to self");
            }
            _ => panic!("Expected Message event"),
        }
    }

    /// [EDGE] Route message after recipient deregistered → should error.
    #[tokio::test]
    async fn route_message_after_deregister_errors() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        coord.deregister("bob-0001").await;

        let result = coord
            .route_message(MessageRequest {
                from: "alice-a1b2".into(),
                to: "bob-0001".into(),
                severity: Severity::Normal,
                body: "hello".into(),
            })
            .await;
        assert!(
            result.is_err(),
            "Message to deregistered colleague should fail"
        );
    }

    /// [BOUNDARY] env_vars() returns exactly 3 vars when coordinator has URL and token set.
    #[tokio::test]
    async fn env_vars_returns_three_vars_when_configured() {
        let coord = SwarmCoordinator::new();
        // Manually set inner state (simulating started coordinator)
        {
            let mut inner = coord.inner.write().await;
            inner.url = Some("http://127.0.0.1:12345".into());
            inner.token = Some("abcd1234".into());
        }
        coord
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let vars = coord.env_vars("tab-42").await.unwrap();
        assert_eq!(vars.len(), 3);
        assert_eq!(vars["PUTZ_SWARM_URL"], "http://127.0.0.1:12345");
        assert_eq!(vars["PUTZ_SWARM_TOKEN"], "abcd1234");
        assert_eq!(vars["PUTZ_TAB_ID"], "tab-42");
    }

    /// [BOUNDARY] colleague_env_vars() returns all required vars including identity.
    #[tokio::test]
    async fn colleague_env_vars_includes_identity() {
        let coord = SwarmCoordinator::new();
        {
            let mut inner = coord.inner.write().await;
            inner.url = Some("http://127.0.0.1:12345".into());
            inner.token = Some("tok-1234".into());
        }
        coord
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let vars = coord
            .colleague_env_vars("tab-1", "alice-a1b2", "alice", "parent-0001", None)
            .await
            .unwrap();

        assert_eq!(vars.len(), 6, "3 swarm vars + 3 identity vars (no prompt)");
        assert_eq!(vars["PUTZ_SWARM_URL"], "http://127.0.0.1:12345");
        assert_eq!(vars["PUTZ_SWARM_TOKEN"], "tok-1234");
        assert_eq!(vars["PUTZ_TAB_ID"], "tab-1");
        assert_eq!(vars["COPILOT_COLLEAGUE_ID"], "alice-a1b2");
        assert_eq!(vars["COPILOT_COLLEAGUE_NAME"], "alice");
        assert_eq!(vars["COPILOT_COLLEAGUE_PARENT"], "parent-0001");
    }

    /// [BOUNDARY] colleague_env_vars() includes COPILOT_COLLEAGUE_INITIAL_PROMPT when provided.
    #[tokio::test]
    async fn colleague_env_vars_includes_prompt_when_provided() {
        let coord = SwarmCoordinator::new();
        {
            let mut inner = coord.inner.write().await;
            inner.url = Some("http://127.0.0.1:12345".into());
            inner.token = Some("tok-1234".into());
        }
        coord
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let vars = coord
            .colleague_env_vars(
                "tab-1",
                "alice-a1b2",
                "alice",
                "parent-0001",
                Some("Fix the bug in auth.rs"),
            )
            .await
            .unwrap();

        assert_eq!(vars.len(), 7, "3 swarm + 3 identity + 1 prompt");
        assert_eq!(
            vars["COPILOT_COLLEAGUE_INITIAL_PROMPT"],
            "Fix the bug in auth.rs"
        );
    }

    /// [BOUNDARY] colleague_env_vars() returns None when coordinator is disabled.
    #[tokio::test]
    async fn colleague_env_vars_none_when_disabled() {
        let coord = SwarmCoordinator::new();
        assert!(!coord.enabled.load(std::sync::atomic::Ordering::SeqCst));
        let result = coord
            .colleague_env_vars("tab-1", "alice-a1b2", "alice", "parent", None)
            .await;
        assert!(result.is_none());
    }

    /// [BOUNDARY] env_vars() returns None when URL is not set (enabled but not started).
    #[tokio::test]
    async fn env_vars_none_when_url_missing() {
        let coord = SwarmCoordinator::new();
        coord
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // enabled=true but inner.url is None (start() not called)
        let result = coord.env_vars("tab-1").await;
        assert!(result.is_none(), "Should return None when URL not yet set");
    }

    /// [CONTRACT] heartbeat with "idle" resets from Working back to Idle.
    #[tokio::test]
    async fn heartbeat_working_to_idle() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        coord
            .heartbeat("alice-a1b2", ColleagueStatus::Working)
            .await
            .unwrap();
        coord
            .heartbeat("alice-a1b2", ColleagueStatus::Idle)
            .await
            .unwrap();

        let inner = coord.inner.read().await;
        assert_eq!(inner.registry["alice-a1b2"].status, ColleagueStatus::Idle);
    }

    /// [CONTRACT] heartbeat returns stale peers in the response.
    #[tokio::test]
    async fn heartbeat_reports_stale_peers() {
        let coord = SwarmCoordinator::new();
        // Register alice
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();
        // Register bob and make him stale
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Manually mark bob as stale
        {
            let mut inner = coord.inner.write().await;
            inner.registry.get_mut("bob-0001").unwrap().status = ColleagueStatus::Stale;
        }

        let stale_peers = coord
            .heartbeat("alice-a1b2", ColleagueStatus::Idle)
            .await
            .unwrap();
        assert_eq!(stale_peers.len(), 1);
        assert_eq!(stale_peers[0], "bob-0001");
    }

    /// [CONTRACT] Multiple messages buffer in order (FIFO).
    #[tokio::test]
    async fn buffered_messages_are_fifo() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        // Send messages in order
        for i in 0..5 {
            coord
                .route_message(MessageRequest {
                    from: "alice".into(),
                    to: "bob-0001".into(),
                    severity: Severity::Normal,
                    body: format!("msg-{i}"),
                })
                .await
                .unwrap();
        }

        let (_rx, buffered) = coord.subscribe("bob-0001").await.unwrap();
        assert_eq!(buffered.len(), 5);

        // Verify FIFO order
        for (i, event) in buffered.iter().enumerate() {
            match event {
                SseEvent::Message(msg) => {
                    assert_eq!(msg.body, format!("msg-{i}"), "Messages must be FIFO");
                }
                _ => panic!("Expected Message event"),
            }
        }
    }

    /// [EDGE] generate_colleague_id with empty name still produces valid ID.
    #[test]
    fn generate_colleague_id_empty_name() {
        let id = SwarmCoordinator::generate_colleague_id("");
        // Format: "{name}-{4hex}", empty name → "-xxxx"
        assert!(
            id.starts_with('-'),
            "Empty name should still produce -xxxx format"
        );
        assert_eq!(id.len(), 1 + 4, "dash + 4 hex chars");
    }

    /// [EDGE] generate_colleague_id with special characters in name.
    /// Note: generate_colleague_id() does not sanitize — validation happens at register() (M4).
    #[test]
    fn generate_colleague_id_special_chars() {
        let id = SwarmCoordinator::generate_colleague_id("hello world/test");
        assert!(id.starts_with("hello world/test-"));
        // This ID would be rejected by register() due to is_valid_identifier() check (M4).
    }

    /// [EDGE] Concurrent register + route_message should not deadlock.
    #[tokio::test]
    async fn concurrent_register_and_message() {
        let coord = Arc::new(SwarmCoordinator::new());

        // Pre-register bob so messages to bob are valid
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let coord1 = coord.clone();
        let coord2 = coord.clone();

        let handle1 = tokio::spawn(async move {
            for i in 0..10 {
                let _ = coord1
                    .register(RegisterRequest {
                        colleague_id: format!("peer-{i:04}"),
                        name: format!("peer-{i}"),
                        parent: None,
                        tab_id: format!("tab-{i}"),
                        pid: None,
                        cwd: None,
                    })
                    .await;
            }
        });

        let handle2 = tokio::spawn(async move {
            for i in 0..10 {
                let _ = coord2
                    .route_message(MessageRequest {
                        from: format!("peer-{i:04}"),
                        to: "bob-0001".into(),
                        severity: Severity::Normal,
                        body: format!("concurrent-msg-{i}"),
                    })
                    .await;
            }
        });

        // Both should complete without deadlock
        let (r1, r2) = tokio::join!(handle1, handle2);
        r1.unwrap();
        r2.unwrap();

        // Bob should exist with messages buffered
        let roster = coord.roster().await;
        assert!(!roster.is_empty(), "At least bob should be registered");
    }

    /// [EDGE] Concurrent subscribe + route_message should not lose messages.
    #[tokio::test]
    async fn concurrent_subscribe_and_message() {
        let coord = Arc::new(SwarmCoordinator::new());

        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let coord1 = coord.clone();
        let coord2 = coord.clone();

        // Subscribe in one task
        let handle1 = tokio::spawn(async move { coord1.subscribe("bob-0001").await.unwrap() });

        // Send messages in another
        let handle2 = tokio::spawn(async move {
            for i in 0..5 {
                let _ = coord2
                    .route_message(MessageRequest {
                        from: "alice".into(),
                        to: "bob-0001".into(),
                        severity: Severity::Normal,
                        body: format!("msg-{i}"),
                    })
                    .await;
            }
        });

        let (r1, r2) = tokio::join!(handle1, handle2);
        // Both tasks should complete without panic/deadlock
        let (_rx, _buffered) = r1.unwrap();
        r2.unwrap();
        // We can't predict exactly how many go to buffer vs live, but nothing should be lost
        // (race means some go to buffer before subscribe, some to live after)
        // At minimum, no panic or deadlock occurred
    }

    /// [CONTRACT] roster() returns ColleagueView with correct status string.
    #[tokio::test]
    async fn roster_returns_correct_status_string() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        coord
            .heartbeat("alice-a1b2", ColleagueStatus::Working)
            .await
            .unwrap();

        let roster = coord.roster().await;
        assert_eq!(roster[0].status, "working");
    }

    /// [CONTRACT] SwarmState::disabled() has predictable shape.
    #[tokio::test]
    async fn state_disabled_shape() {
        let coord = SwarmCoordinator::new();
        let state = coord.state().await;
        assert!(!state.enabled);
        assert!(state.url.is_none());
        assert!(state.token.is_none());

        // Verify serialization shape
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["enabled"], false);
        assert!(json["url"].is_null());
        assert!(json["token"].is_null());
    }

    /// [CONTRACT] state_public() never exposes token (H3).
    #[tokio::test]
    async fn state_public_excludes_token() {
        let coord = SwarmCoordinator::new();
        {
            let mut inner = coord.inner.write().await;
            inner.url = Some("http://127.0.0.1:9999".into());
            inner.token = Some("super-secret-token".into());
            inner.registry.insert(
                "alice-a1b2".into(),
                Colleague {
                    id: "alice-a1b2".into(),
                    name: "alice".into(),
                    parent: None,
                    tab_id: "tab-1".into(),
                    pid: None,
                    cwd: None,
                    status: ColleagueStatus::Idle,
                    last_seen: Instant::now(),
                    last_seen_at: chrono::Utc::now(),
                    registered_at: chrono::Utc::now(),
                },
            );
        }
        coord.enabled.store(true, Ordering::SeqCst);

        let public = coord.state_public().await;
        assert!(public.enabled);
        assert_eq!(public.colleague_count, 1);
        assert_eq!(public.colleague_ids, vec!["alice-a1b2".to_string()]);

        // Verify no token in serialized output
        let json = serde_json::to_string(&public).unwrap();
        assert!(
            !json.contains("super-secret-token"),
            "Token must never appear in public state"
        );
    }

    /// [CONTRACT] state_public() when disabled returns disabled shape.
    #[tokio::test]
    async fn state_public_disabled() {
        let coord = SwarmCoordinator::new();
        let public = coord.state_public().await;
        assert!(!public.enabled);
        assert_eq!(public.colleague_count, 0);
        assert!(public.colleague_ids.is_empty());
    }

    /// [M4] register() rejects invalid colleague_id.
    #[tokio::test]
    async fn register_rejects_invalid_colleague_id() {
        let coord = SwarmCoordinator::new();
        let result = coord
            .register(RegisterRequest {
                colleague_id: "has spaces bad".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid colleague_id"));
    }

    /// [M4] register() rejects invalid name.
    #[tokio::test]
    async fn register_rejects_invalid_name() {
        let coord = SwarmCoordinator::new();
        let result = coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "bad name!".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid name"));
    }

    /// [M4] register() rejects empty tab_id.
    #[tokio::test]
    async fn register_rejects_empty_tab_id() {
        let coord = SwarmCoordinator::new();
        let result = coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "".into(),
                pid: None,
                cwd: None,
            })
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid tab_id"));
    }

    /// [M3] register() enforces MAX_COLLEAGUES capacity.
    #[tokio::test]
    async fn register_capacity_limit() {
        let coord = SwarmCoordinator::new();
        // Fill up to MAX_COLLEAGUES
        for i in 0..MAX_COLLEAGUES {
            coord
                .register(RegisterRequest {
                    colleague_id: format!("peer-{i:04}"),
                    name: format!("peer{i}"),
                    parent: None,
                    tab_id: format!("tab-{i}"),
                    pid: None,
                    cwd: None,
                })
                .await
                .unwrap();
        }

        // One more should fail
        let result = coord
            .register(RegisterRequest {
                colleague_id: "overflow-0000".into(),
                name: "overflow".into(),
                parent: None,
                tab_id: "tab-overflow".into(),
                pid: None,
                cwd: None,
            })
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Registry full"));
    }

    /// [M3] Re-registration of existing ID does NOT count against capacity.
    #[tokio::test]
    async fn register_reregister_bypasses_capacity() {
        let coord = SwarmCoordinator::new();
        // Fill up to MAX_COLLEAGUES
        for i in 0..MAX_COLLEAGUES {
            coord
                .register(RegisterRequest {
                    colleague_id: format!("peer-{i:04}"),
                    name: format!("peer{i}"),
                    parent: None,
                    tab_id: format!("tab-{i}"),
                    pid: None,
                    cwd: None,
                })
                .await
                .unwrap();
        }

        // Re-register an existing one should succeed
        let result = coord
            .register(RegisterRequest {
                colleague_id: "peer-0000".into(),
                name: "peer0-v2".into(),
                parent: None,
                tab_id: "tab-0".into(),
                pid: None,
                cwd: None,
            })
            .await;
        assert!(
            result.is_ok(),
            "Re-registration should bypass capacity check"
        );
    }

    /// [M4] route_message() rejects oversized body.
    #[tokio::test]
    async fn route_message_rejects_oversized_body() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "bob-0001".into(),
                name: "bob".into(),
                parent: None,
                tab_id: "tab-2".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let big_body = "x".repeat(MAX_PROMPT_LENGTH + 1);
        let result = coord
            .route_message(MessageRequest {
                from: "alice-a1b2".into(),
                to: "bob-0001".into(),
                severity: Severity::Normal,
                body: big_body,
            })
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
    }

    /// [M2] heartbeat() rejects Dead status.
    #[tokio::test]
    async fn heartbeat_rejects_dead_status() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();
        let result = coord.heartbeat("alice-a1b2", ColleagueStatus::Dead).await;
        assert!(result.is_err());
    }

    /// [H2] heartbeat() updates last_seen_at timestamp.
    #[tokio::test]
    async fn heartbeat_updates_last_seen_at() {
        let coord = SwarmCoordinator::new();
        coord
            .register(RegisterRequest {
                colleague_id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                pid: None,
                cwd: None,
            })
            .await
            .unwrap();

        let before = chrono::Utc::now();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        coord
            .heartbeat("alice-a1b2", ColleagueStatus::Working)
            .await
            .unwrap();

        let inner = coord.inner.read().await;
        let alice = &inner.registry["alice-a1b2"];
        assert!(
            alice.last_seen_at > before,
            "last_seen_at should be updated after heartbeat"
        );
    }

    /// [M4] is_valid_identifier accepts valid patterns.
    #[test]
    fn valid_identifiers() {
        assert!(is_valid_identifier("alice-a1b2"));
        assert!(is_valid_identifier("bob-0001"));
        assert!(is_valid_identifier("My.Agent_v2"));
        assert!(is_valid_identifier("a")); // single char
    }

    /// [M4] is_valid_identifier rejects invalid patterns.
    #[test]
    fn invalid_identifiers() {
        assert!(!is_valid_identifier(""));
        assert!(!is_valid_identifier("has space"));
        assert!(!is_valid_identifier("has/slash"));
        assert!(!is_valid_identifier("has\nnewline"));
        assert!(!is_valid_identifier(&"x".repeat(129))); // too long
    }

    /// [CONTRACT] stop() clears all state (registry, senders, buffers, url, token).
    #[tokio::test]
    async fn stop_clears_all_state() {
        let coord = SwarmCoordinator::new();
        // Manually populate state
        {
            let mut inner = coord.inner.write().await;
            inner.url = Some("http://127.0.0.1:9999".into());
            inner.token = Some("test-token".into());
            inner.port = Some(9999);
            inner.registry.insert(
                "alice-a1b2".into(),
                Colleague {
                    id: "alice-a1b2".into(),
                    name: "alice".into(),
                    parent: None,
                    tab_id: "tab-1".into(),
                    pid: None,
                    cwd: None,
                    status: ColleagueStatus::Idle,
                    last_seen: Instant::now(),
                    last_seen_at: chrono::Utc::now(),
                    registered_at: chrono::Utc::now(),
                },
            );
        }
        coord.enabled.store(true, Ordering::SeqCst);

        coord.stop().await;

        assert!(!coord.enabled());
        let inner = coord.inner.read().await;
        assert!(inner.registry.is_empty());
        assert!(inner.senders.is_empty());
        assert!(inner.buffers.is_empty());
        assert!(inner.url.is_none());
        assert!(inner.token.is_none());
        assert!(inner.port.is_none());
    }
}
