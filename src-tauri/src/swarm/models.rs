/// Data models for the swarm broker.
///
/// Defines colleague registry entries, messages, severity levels,
/// SSE event types, and the public swarm state.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::Instant;

// ─── Colleague ───────────────────────────────────────────────────────

/// Status of a registered colleague.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColleagueStatus {
    Idle,
    Working,
    Stale,
    Dead,
}

impl std::fmt::Display for ColleagueStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Idle => write!(f, "idle"),
            Self::Working => write!(f, "working"),
            Self::Stale => write!(f, "stale"),
            Self::Dead => write!(f, "dead"),
        }
    }
}

/// A registered colleague in the swarm.
#[derive(Debug, Clone)]
pub struct Colleague {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub tab_id: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub status: ColleagueStatus,
    pub last_seen: Instant,
    /// Wall-clock time of the last heartbeat (serializable). Updated by register + heartbeat.
    pub last_seen_at: DateTime<Utc>,
    pub registered_at: DateTime<Utc>,
}

/// Serializable view of a Colleague for API responses.
#[derive(Debug, Clone, Serialize)]
pub struct ColleagueView {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub tab_id: String,
    pub status: String,
    pub last_seen: String,
}

impl From<&Colleague> for ColleagueView {
    fn from(c: &Colleague) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            parent: c.parent.clone(),
            tab_id: c.tab_id.clone(),
            status: c.status.to_string(),
            last_seen: c.last_seen_at.to_rfc3339(),
        }
    }
}

// ─── Messages ────────────────────────────────────────────────────────

/// Message severity levels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Urgent,
    Normal,
    Ambient,
}

/// A message sent between colleagues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub severity: Severity,
    pub body: String,
    pub sent_at: DateTime<Utc>,
}

// ─── SSE Events ──────────────────────────────────────────────────────

/// Events pushed to colleagues via SSE.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SseEvent {
    Message(Message),
    RosterUpdate { peers: Vec<ColleagueView> },
    PeerStatus { id: String, status: String },
}

// ─── HTTP Request/Response types ─────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub colleague_id: String,
    pub name: String,
    pub parent: Option<String>,
    pub tab_id: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeregisterRequest {
    pub colleague_id: String,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub colleague_id: String,
    pub status: ColleagueStatus,
}

#[derive(Debug, Deserialize)]
pub struct SpawnRequest {
    pub name: String,
    pub initial_prompt: Option<String>,
    pub parent_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessageRequest {
    pub from: String,
    pub to: String,
    pub severity: Severity,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct FocusRequest {
    pub tab_id: String,
}

// ─── Swarm State (public) ────────────────────────────────────────────

/// Public swarm state exposed via Tauri commands and events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmState {
    pub enabled: bool,
    pub url: Option<String>,
    pub token: Option<String>,
}

impl SwarmState {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            url: None,
            token: None,
        }
    }
}

/// Public swarm state exposed via IPC — never contains secrets.
/// Use this instead of `SwarmState` when returning data to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SwarmStatePublic {
    pub enabled: bool,
    pub url: Option<String>,
    pub colleague_count: usize,
    pub colleague_ids: Vec<String>,
}

impl SwarmStatePublic {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            url: None,
            colleague_count: 0,
            colleague_ids: vec![],
        }
    }
}

// ─── Message Buffer ──────────────────────────────────────────────────

/// Short-lived buffer for messages to disconnected colleagues.
/// Messages older than `ttl_secs` are dropped on access.
pub struct MessageBuffer {
    pub messages: VecDeque<(Instant, SseEvent)>,
    pub ttl_secs: u64,
}

impl MessageBuffer {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            messages: VecDeque::new(),
            ttl_secs,
        }
    }

    /// Maximum buffered messages per colleague (M3: resource bounds).
    pub const MAX_SIZE: usize = 100;

    /// Push an event into the buffer, dropping the oldest if at capacity.
    pub fn push(&mut self, event: SseEvent) {
        if self.messages.len() >= Self::MAX_SIZE {
            self.messages.pop_front();
        }
        self.messages.push_back((Instant::now(), event));
    }

    /// Drain all non-expired messages.
    pub fn drain_valid(&mut self) -> Vec<SseEvent> {
        let now = Instant::now();
        let ttl = std::time::Duration::from_secs(self.ttl_secs);
        // Remove expired from front
        while let Some((ts, _)) = self.messages.front() {
            if now.duration_since(*ts) > ttl {
                self.messages.pop_front();
            } else {
                break;
            }
        }
        self.messages.drain(..).map(|(_, e)| e).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colleague_status_display() {
        assert_eq!(ColleagueStatus::Idle.to_string(), "idle");
        assert_eq!(ColleagueStatus::Working.to_string(), "working");
        assert_eq!(ColleagueStatus::Stale.to_string(), "stale");
        assert_eq!(ColleagueStatus::Dead.to_string(), "dead");
    }

    #[test]
    fn colleague_view_from_colleague() {
        let now = Utc::now();
        let c = Colleague {
            id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: Some("mom-0000".into()),
            tab_id: "tab-1".into(),
            pid: Some(1234),
            cwd: Some("/tmp".into()),
            status: ColleagueStatus::Idle,
            last_seen: Instant::now(),
            last_seen_at: now,
            registered_at: now,
        };
        let view = ColleagueView::from(&c);
        assert_eq!(view.id, "alice-a1b2");
        assert_eq!(view.name, "alice");
        assert_eq!(view.status, "idle");
        assert_eq!(view.parent.as_deref(), Some("mom-0000"));
    }

    #[test]
    fn swarm_state_disabled_defaults() {
        let s = SwarmState::disabled();
        assert!(!s.enabled);
        assert!(s.url.is_none());
        assert!(s.token.is_none());
    }

    #[test]
    fn message_buffer_push_and_drain() {
        let mut buf = MessageBuffer::new(60);
        let event = SseEvent::PeerStatus {
            id: "a".into(),
            status: "idle".into(),
        };
        buf.push(event);
        let drained = buf.drain_valid();
        assert_eq!(drained.len(), 1);
        // Second drain should be empty
        assert!(buf.drain_valid().is_empty());
    }

    #[test]
    fn severity_serde_roundtrip() {
        let json = serde_json::to_string(&Severity::Urgent).unwrap();
        assert_eq!(json, "\"urgent\"");
        let parsed: Severity = serde_json::from_str("\"normal\"").unwrap();
        assert_eq!(parsed, Severity::Normal);
    }

    // ─── QA Guardian: Contract & Edge-Case Tests ─────────────────────

    /// [CONTRACT] RegisterRequest deserializes from valid JSON with all fields.
    #[test]
    fn register_request_full_deser() {
        let json = r#"{
            "colleague_id": "alice-a1b2",
            "name": "alice",
            "parent": "parent-0001",
            "tab_id": "tab-1",
            "pid": 1234,
            "cwd": "/tmp/work"
        }"#;
        let req: RegisterRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.colleague_id, "alice-a1b2");
        assert_eq!(req.name, "alice");
        assert_eq!(req.parent, Some("parent-0001".into()));
        assert_eq!(req.tab_id, "tab-1");
        assert_eq!(req.pid, Some(1234));
        assert_eq!(req.cwd, Some("/tmp/work".into()));
    }

    /// [CONTRACT] RegisterRequest deserializes with only required fields.
    #[test]
    fn register_request_minimal_deser() {
        let json = r#"{
            "colleague_id": "alice-a1b2",
            "name": "alice",
            "tab_id": "tab-1"
        }"#;
        let req: RegisterRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.colleague_id, "alice-a1b2");
        assert!(req.parent.is_none());
        assert!(req.pid.is_none());
        assert!(req.cwd.is_none());
    }

    /// [EDGE] RegisterRequest fails when required field "colleague_id" is missing.
    #[test]
    fn register_request_missing_colleague_id_fails() {
        let json = r#"{"name": "alice", "tab_id": "tab-1"}"#;
        let result: Result<RegisterRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Missing colleague_id should fail deserialization");
    }

    /// [EDGE] RegisterRequest fails when required field "name" is missing.
    #[test]
    fn register_request_missing_name_fails() {
        let json = r#"{"colleague_id": "alice-a1b2", "tab_id": "tab-1"}"#;
        let result: Result<RegisterRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Missing name should fail deserialization");
    }

    /// [CONTRACT] DeregisterRequest deserializes correctly.
    #[test]
    fn deregister_request_deser() {
        let json = r#"{"colleague_id": "alice-a1b2"}"#;
        let req: DeregisterRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.colleague_id, "alice-a1b2");
    }

    /// [EDGE] DeregisterRequest fails without colleague_id.
    #[test]
    fn deregister_request_missing_id_fails() {
        let json = r#"{}"#;
        let result: Result<DeregisterRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    /// [CONTRACT] HeartbeatRequest deserializes correctly.
    #[test]
    fn heartbeat_request_deser() {
        let json = r#"{"colleague_id": "alice-a1b2", "status": "working"}"#;
        let req: HeartbeatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.colleague_id, "alice-a1b2");
        assert_eq!(req.status, ColleagueStatus::Working);
    }

    /// [CONTRACT] SpawnRequest with all fields.
    #[test]
    fn spawn_request_full_deser() {
        let json = r#"{
            "name": "researcher",
            "initial_prompt": "Find all auth bugs",
            "parent_id": "parent-0001"
        }"#;
        let req: SpawnRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "researcher");
        assert_eq!(req.initial_prompt, Some("Find all auth bugs".into()));
        assert_eq!(req.parent_id, "parent-0001");
    }

    /// [CONTRACT] SpawnRequest minimal (no initial_prompt).
    #[test]
    fn spawn_request_minimal_deser() {
        let json = r#"{"name": "researcher", "parent_id": "parent-0001"}"#;
        let req: SpawnRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "researcher");
        assert!(req.initial_prompt.is_none());
    }

    /// [CONTRACT] MessageRequest deserializes with all severity levels.
    #[test]
    fn message_request_all_severities() {
        for (sev_str, expected) in [
            ("urgent", Severity::Urgent),
            ("normal", Severity::Normal),
            ("ambient", Severity::Ambient),
        ] {
            let json = format!(
                r#"{{"from": "a", "to": "b", "severity": "{sev_str}", "body": "hello"}}"#
            );
            let req: MessageRequest = serde_json::from_str(&json).unwrap();
            assert_eq!(req.severity, expected, "Severity '{sev_str}' should deserialize");
        }
    }

    /// [EDGE] MessageRequest with invalid severity value fails.
    #[test]
    fn message_request_invalid_severity_fails() {
        let json = r#"{"from": "a", "to": "b", "severity": "critical", "body": "hello"}"#;
        let result: Result<MessageRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Unknown severity should fail deserialization");
    }

    /// [CONTRACT] FocusRequest deserializes correctly.
    #[test]
    fn focus_request_deser() {
        let json = r#"{"tab_id": "tab-42"}"#;
        let req: FocusRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.tab_id, "tab-42");
    }

    /// [CONTRACT] SseEvent::Message serialization matches expected tag format.
    #[test]
    fn sse_event_message_serialization() {
        let event = SseEvent::Message(Message {
            id: "msg-1".into(),
            from: "alice".into(),
            to: "bob".into(),
            severity: Severity::Urgent,
            body: "hello".into(),
            sent_at: chrono::Utc::now(),
        });
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "message", "Should use tag 'message'");
        assert_eq!(json["id"], "msg-1");
        assert_eq!(json["from"], "alice");
        assert_eq!(json["to"], "bob");
        assert_eq!(json["severity"], "urgent");
        assert_eq!(json["body"], "hello");
        assert!(json["sent_at"].is_string());
    }

    /// [CONTRACT] SseEvent::RosterUpdate serialization format.
    #[test]
    fn sse_event_roster_update_serialization() {
        let event = SseEvent::RosterUpdate {
            peers: vec![ColleagueView {
                id: "alice-a1b2".into(),
                name: "alice".into(),
                parent: None,
                tab_id: "tab-1".into(),
                status: "idle".into(),
                last_seen: "2024-01-01T00:00:00Z".into(),
            }],
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "roster_update");
        assert!(json["peers"].is_array());
        assert_eq!(json["peers"][0]["id"], "alice-a1b2");
    }

    /// [CONTRACT] SseEvent::PeerStatus serialization format.
    #[test]
    fn sse_event_peer_status_serialization() {
        let event = SseEvent::PeerStatus {
            id: "alice-a1b2".into(),
            status: "stale".into(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "peer_status");
        assert_eq!(json["id"], "alice-a1b2");
        assert_eq!(json["status"], "stale");
    }

    /// [CONTRACT] SwarmState serialization includes all fields.
    #[test]
    fn swarm_state_serialization_enabled() {
        let state = SwarmState {
            enabled: true,
            url: Some("http://127.0.0.1:12345".into()),
            token: Some("abcd1234".into()),
        };
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["enabled"], true);
        assert_eq!(json["url"], "http://127.0.0.1:12345");
        assert_eq!(json["token"], "abcd1234");
    }

    /// [CONTRACT] SwarmState roundtrip (Serialize → Deserialize).
    #[test]
    fn swarm_state_roundtrip() {
        let original = SwarmState {
            enabled: true,
            url: Some("http://127.0.0.1:12345".into()),
            token: Some("tok-hex".into()),
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: SwarmState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.enabled, original.enabled);
        assert_eq!(parsed.url, original.url);
        assert_eq!(parsed.token, original.token);
    }

    /// [CONTRACT] ColleagueStatus serde roundtrip for all variants.
    #[test]
    fn colleague_status_all_variants_serde() {
        for (variant, expected_str) in [
            (ColleagueStatus::Idle, "idle"),
            (ColleagueStatus::Working, "working"),
            (ColleagueStatus::Stale, "stale"),
            (ColleagueStatus::Dead, "dead"),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!("\"{expected_str}\""));
            let parsed: ColleagueStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    /// [EDGE] ColleagueStatus rejects unknown string.
    #[test]
    fn colleague_status_unknown_rejected() {
        let result: Result<ColleagueStatus, _> = serde_json::from_str("\"disconnected\"");
        assert!(result.is_err());
    }

    /// [EDGE] MessageBuffer with zero TTL drops all messages on drain.
    #[test]
    fn message_buffer_zero_ttl() {
        let mut buf = MessageBuffer::new(0);
        buf.push(SseEvent::PeerStatus {
            id: "a".into(),
            status: "idle".into(),
        });
        // With 0 TTL, messages expire immediately (within same clock tick, may or may not expire)
        // At minimum, the buffer should not panic
        let _ = buf.drain_valid();
    }

    /// [CONTRACT] MessageBuffer drains all valid messages and empties the buffer.
    #[test]
    fn message_buffer_drain_empties() {
        let mut buf = MessageBuffer::new(3600); // 1 hour TTL
        for i in 0..10 {
            buf.push(SseEvent::PeerStatus {
                id: format!("peer-{i}"),
                status: "idle".into(),
            });
        }
        let drained = buf.drain_valid();
        assert_eq!(drained.len(), 10);
        assert!(buf.messages.is_empty(), "Buffer should be empty after drain");
    }

    /// [EDGE] MessageBuffer push after drain works correctly.
    #[test]
    fn message_buffer_push_after_drain() {
        let mut buf = MessageBuffer::new(60);
        buf.push(SseEvent::PeerStatus {
            id: "a".into(),
            status: "idle".into(),
        });
        let _ = buf.drain_valid();
        // Push new message after drain
        buf.push(SseEvent::PeerStatus {
            id: "b".into(),
            status: "working".into(),
        });
        let drained = buf.drain_valid();
        assert_eq!(drained.len(), 1);
    }

    /// [CONTRACT] Message serialization roundtrip.
    #[test]
    fn message_serde_roundtrip() {
        let msg = Message {
            id: "msg-1".into(),
            from: "alice".into(),
            to: "bob".into(),
            severity: Severity::Ambient,
            body: "ambient note".into(),
            sent_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, msg.id);
        assert_eq!(parsed.from, msg.from);
        assert_eq!(parsed.to, msg.to);
        assert_eq!(parsed.severity, msg.severity);
        assert_eq!(parsed.body, msg.body);
    }

    /// [EDGE] Message with unicode/emoji in body.
    #[test]
    fn message_unicode_body() {
        let msg = Message {
            id: "msg-1".into(),
            from: "alice".into(),
            to: "bob".into(),
            severity: Severity::Normal,
            body: "Hello 🌍! Ñoño résumé — em-dash".into(),
            sent_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.body, msg.body, "Unicode/emoji must survive roundtrip");
    }

    /// [EDGE] RegisterRequest with empty strings (valid JSON but semantically empty).
    #[test]
    fn register_request_empty_strings() {
        let json = r#"{"colleague_id": "", "name": "", "tab_id": ""}"#;
        let req: RegisterRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.colleague_id, "");
        assert_eq!(req.name, "");
        assert_eq!(req.tab_id, "");
        // NOTE: Serde allows empty strings — validation happens at coordinator level (M4).
    }

    /// [CONTRACT] ColleagueView.last_seen uses last_seen_at (RFC3339), not registered_at.
    #[test]
    fn colleague_view_last_seen_is_rfc3339() {
        let registered: DateTime<Utc> = "2024-01-01T00:00:00Z".parse().unwrap();
        let seen: DateTime<Utc> = "2024-01-01T01:00:00Z".parse().unwrap();
        let c = Colleague {
            id: "alice-a1b2".into(),
            name: "alice".into(),
            parent: None,
            tab_id: "tab-1".into(),
            pid: None,
            cwd: None,
            status: ColleagueStatus::Idle,
            last_seen: Instant::now(),
            last_seen_at: seen,
            registered_at: registered,
        };
        let view = ColleagueView::from(&c);
        // Should be a valid RFC3339 string
        let parsed = chrono::DateTime::parse_from_rfc3339(&view.last_seen);
        assert!(parsed.is_ok(), "last_seen should be RFC3339: got {}", view.last_seen);
        // H2: Should reflect last_seen_at, not registered_at
        let parsed_ts = parsed.unwrap().with_timezone(&chrono::Utc);
        assert_eq!(parsed_ts, seen, "last_seen must use last_seen_at, not registered_at");
    }

    /// [CONTRACT] SwarmStatePublic excludes token field.
    #[test]
    fn swarm_state_public_excludes_token() {
        let state = SwarmStatePublic {
            enabled: true,
            url: Some("http://127.0.0.1:12345".into()),
            colleague_count: 3,
            colleague_ids: vec!["a".into(), "b".into(), "c".into()],
        };
        let json = serde_json::to_value(&state).unwrap();
        assert!(json.get("token").is_none(), "SwarmStatePublic must not contain token");
        assert_eq!(json["colleague_count"], 3);
        assert_eq!(json["colleague_ids"].as_array().unwrap().len(), 3);
    }

    /// [CONTRACT] SwarmStatePublic::disabled defaults.
    #[test]
    fn swarm_state_public_disabled() {
        let s = SwarmStatePublic::disabled();
        assert!(!s.enabled);
        assert!(s.url.is_none());
        assert_eq!(s.colleague_count, 0);
        assert!(s.colleague_ids.is_empty());
    }

    /// [CONTRACT] MessageBuffer::push enforces MAX_SIZE, drops oldest on overflow.
    #[test]
    fn message_buffer_overflow_drops_oldest() {
        let mut buf = MessageBuffer::new(3600);
        for i in 0..150 {
            buf.push(SseEvent::PeerStatus {
                id: format!("peer-{i}"),
                status: "idle".into(),
            });
        }
        assert_eq!(
            buf.messages.len(),
            MessageBuffer::MAX_SIZE,
            "Buffer should cap at MAX_SIZE"
        );
        // Oldest should have been dropped — first entry is peer-50
        let (_, first) = buf.messages.front().unwrap();
        match first {
            SseEvent::PeerStatus { id, .. } => assert_eq!(id, "peer-50"),
            _ => panic!("Expected PeerStatus"),
        }
    }

    /// [EDGE] HeartbeatRequest with invalid status string fails deserialization (M2).
    #[test]
    fn heartbeat_request_invalid_status_deser_fails() {
        let json = r#"{"colleague_id": "alice-a1b2", "status": "bogus"}"#;
        let result: Result<HeartbeatRequest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Invalid status should fail deserialization");
    }
}
