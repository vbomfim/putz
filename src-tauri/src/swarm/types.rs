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

/// Public view of a colleague — what the frontend and other colleagues see.
/// Excludes per-connection writer handles and `Instant` fields (not Serialize).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColleagueView {
    pub id: String,
    pub name: String,
    pub tab_id: String,
    pub status: String,
    #[serde(default)]
    pub parent: Option<String>,
}

/// Public swarm state for the Tauri `swarm_get_state` command.
///
/// `path` replaces the old `url` field — same JSON key name to keep the
/// frontend type definition stable. The value is now the socket / pipe
/// path instead of an HTTP URL.
#[derive(Debug, Clone, Serialize)]
pub struct SwarmStatePublic {
    pub enabled: bool,
    /// Socket path (Unix) or pipe name (Windows). `null` when disabled.
    /// Keyed as `url` for frontend back-compat.
    // TODO(#146): rename `url` → `path` in both Rust serde and
    // src/components/Settings/SettingsTab.tsx (T4 cleanup).
    #[serde(rename = "url")]
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

/// Health snapshot for the optional `swarm_health` command (spec §11).
#[derive(Debug, Clone, Serialize)]
pub struct SwarmHealth {
    pub listening: bool,
    pub path: Option<String>,
    pub colleague_count: usize,
}
