//! Shared swarm types — no I/O, no runtime, just data.
//!
//! Kept separate from `wire` so the Tauri command layer can re-export
//! `ColleagueView` and `SwarmStatePublic` without dragging in the codec.
use serde::{Deserialize, Serialize};

/// Lifecycle state of a registered colleague. Driven by the
/// heartbeat sweeper in [`super::coordinator`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColleagueStatus {
    /// Recently registered or sent a heartbeat.
    Idle,
    /// Heartbeat received with explicit `working` status.
    Working,
    /// No heartbeat for >= STALE_TIMEOUT but socket is still open.
    Stale,
    /// No heartbeat for >= DEAD_TIMEOUT — about to be evicted.
    Dead,
}

impl ColleagueStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Working => "working",
            Self::Stale => "stale",
            Self::Dead => "dead",
        }
    }
}

/// Severity tag for `notify` frames — drives Cmd+J inbox bucketing.
///
/// Defaulting to [`Severity::Normal`] lets older / minimal clients omit the
/// field entirely (FR-015) — the wire decoder applies the default via
/// `#[serde(default)]` on `Frame::Notify { severity }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Urgent,
    #[default]
    Normal,
    Ambient,
}

/// OSC-derived command-execution status for a colleague's PTY (T3 / FR-011).
///
/// Distinct axis from [`ColleagueStatus`] (which is **lifecycle**:
/// idle/working/stale/dead driven by heartbeats). This is **command-level**:
/// what is the colleague's shell doing right now? Derived from OSC 133
/// prompt/cmd/done markers projected by the frontend and pushed back via
/// `swarm_update_status`.
///
/// Naming: the spec ticket suggested reusing `ColleagueStatus` for both
/// axes, but that would conflict with the existing lifecycle enum. We
/// keep the semantics on separate types so a peer agent can ask both
/// "is this colleague reachable?" and "is its shell busy?" without the
/// ambiguity of a single enum collapsing both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CommandStatus {
    /// Initial state, or no OSC 133 has been observed yet.
    #[default]
    Unknown,
    /// Between OSC 133;A (prompt start) and OSC 133;B (cmd start) —
    /// shell is at the prompt, no command running.
    Idle,
    /// Between OSC 133;B (cmd start) and OSC 133;D (cmd done) —
    /// command actively executing. (OSC 133;C, output-start, does not
    /// end the running state — the command is still in flight.)
    Running,
    /// After OSC 133;D with exit code 0.
    Done,
    /// After OSC 133;D with non-zero exit code.
    Error,
}

impl CommandStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}

/// Public view of a colleague — what the frontend and other colleagues see.
/// Excludes per-connection writer handles and `Instant` fields (not Serialize).
///
/// T3 added the optional `command_status`, `cwd`, `last_command_exit`,
/// `last_command_started_at`, and `last_ten_exit_codes` fields. They are
/// wire-optional (`#[serde(default)]`) so old extensions / frontends that
/// pre-date T3 still parse new `roster_update` payloads — and so the
/// older `register_ack` path continues to serialize with `null`/empty
/// placeholders rather than rejecting.
///
/// Wire-naming note: `last_command_started_at` was renamed from
/// `last_command_at` in PR #155 fixup (CR-GPT pass-2 #5) for semantic
/// clarity — the value is the START time of the last command, not its
/// completion time. The old name was never shipped on a release tag,
/// so no compat alias is kept.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColleagueView {
    pub id: String,
    pub name: String,
    pub tab_id: String,
    pub status: String,
    #[serde(default)]
    pub parent: Option<String>,
    /// OSC-derived command status (T3). `None` when no update has been
    /// pushed for this colleague yet.
    #[serde(default)]
    pub command_status: Option<CommandStatus>,
    /// Last seen OSC 7 working directory.
    ///
    /// @privacy Tier-2 — quasi-identifier (working directory). May reveal
    /// home dir / project name. Per spec FR-011 cwd IS shared with peer
    /// colleagues within the same-machine same-user trust boundary, but
    /// MUST NOT be logged or persisted to telemetry. PRI-001/002.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Exit code from the most recent OSC 133;D, if any.
    #[serde(default)]
    pub last_command_exit: Option<i32>,
    /// Unix epoch milliseconds when the most recent command **started**
    /// (OSC 133;B). Renamed from `last_command_at` in PR #155 fixup.
    #[serde(default)]
    pub last_command_started_at: Option<u64>,
    /// Exit codes of the last ≤10 command blocks for this colleague,
    /// chronological (oldest → newest). `None` entries appear for
    /// in-flight or abandoned blocks. Required by ticket #142 AC3 for
    /// the sidebar dot-row UI.
    #[serde(default)]
    pub last_ten_exit_codes: Vec<Option<i32>>,
}

/// Public swarm state for the Tauri `swarm_get_state` command.
///
/// The `path` field carries the socket / pipe path. Was previously
/// serialized as `url` for back-compat with the HTTP-broker era; that
/// alias is now removed (issue #146 — frontend updated in lockstep).
#[derive(Debug, Clone, Serialize)]
pub struct SwarmStatePublic {
    pub enabled: bool,
    /// Socket path (Unix) or pipe name (Windows). `null` when disabled.
    pub path: Option<String>,
    pub colleague_count: usize,
    pub colleague_ids: Vec<String>,
}

impl SwarmStatePublic {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            path: None,
            colleague_count: 0,
            colleague_ids: vec![],
        }
    }
}

/// Public view of an active resource claim (T5 / swarm coordination tools).
///
/// Returned in `RegisterAck` snapshots, in `list_claims` tool responses,
/// and broadcast in `claim` / `release` frames so every colleague keeps
/// a consistent local cache without polling.
///
/// @privacy Tier-2 — `message` is user-authored ("pushing v0.5 to staging").
/// MUST NOT be logged, persisted, or forwarded to telemetry. PRI-001/002.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimView {
    pub resource: String,
    pub holder: String,
    /// @privacy Tier-2 PII — see struct doc. Empty string when the
    /// holder did not provide a message.
    pub message: String,
    /// Unix epoch milliseconds when the claim auto-expires unless refreshed.
    pub expires_at_ms: u64,
}

/// Health snapshot for the optional `swarm_health` command (spec §11).
#[derive(Debug, Clone, Serialize)]
pub struct SwarmHealth {
    pub listening: bool,
    pub path: Option<String>,
    pub colleague_count: usize,
}

/// Full OSC-derived status snapshot pushed by the frontend (T3 / FR-011).
///
/// **Full-snapshot semantics** (CR-GPT pass-2 #2): every field carries
/// real state. `Option::None` means "this field is unset" — NOT "skip
/// this field on update". This is the contract that lets the frontend
/// clear a previously-set `cwd` (e.g., after a tab is reset) by pushing
/// a snapshot with `cwd: None`. Partial-update semantics (the original
/// shape) made cleared values impossible to express on the wire.
///
/// The "no change → no broadcast" check in the coordinator still
/// suppresses redundant traffic.
///
/// @privacy Tier-2 — `cwd` is a quasi-identifier. PRI-001/002.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct StatusSnapshot {
    /// OSC 133-derived state. Defaults to [`CommandStatus::Unknown`] when
    /// the renderer has no signal yet.
    #[serde(default)]
    pub command_status: CommandStatus,
    /// Last seen OSC 7 working directory, or `None` if never observed
    /// / explicitly cleared.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Exit code from most recent OSC 133;D, or `None`.
    #[serde(default)]
    pub last_command_exit: Option<i32>,
    /// Epoch milliseconds when the most recent command **started**
    /// (OSC 133;B), or `None`.
    #[serde(default)]
    pub last_command_started_at: Option<u64>,
    /// Trailing exit codes (≤10, chronological). `None` entries are
    /// in-flight or abandoned blocks. Empty when the colleague has
    /// no command history yet.
    #[serde(default)]
    pub last_ten_exit_codes: Vec<Option<i32>>,
}
