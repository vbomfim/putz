//! Wire protocol for the swarm IPC transport.
//!
//! Frames are length-prefixed JSON: a 4-byte big-endian unsigned length,
//! followed by that many bytes of UTF-8 JSON. The JSON object is tagged
//! by `type` (serde adjacently-tagged enum) — see [`Frame`].
//!
//! Bound: a single frame may not exceed [`MAX_FRAME_BYTES`] (1 MiB). Larger
//! prefixes are rejected without reading the payload (SEC-004 in the spec).
//!
//! This module is the contract between the Rust coordinator and the Node
//! Copilot CLI extension. It deliberately has zero dependency on the
//! coordinator's runtime state — it can be unit-tested with no I/O.
use std::io;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::types::{ClaimView, ColleagueView, Severity};

/// Maximum bytes in a single frame payload (excluding the 4-byte length).
/// Spec FR-003 / SEC-004 — guards against memory-exhaustion via crafted
/// oversized frames. Connections that announce a larger frame are closed.
pub const MAX_FRAME_BYTES: u32 = 1 << 20; // 1 MiB

/// All frames exchanged on the swarm socket. Tagged by `type` for forward
/// compatibility — the Node side uses the same shape.
///
/// `deny_unknown_fields` ensures a typo on either side is a hard error
/// rather than a silent semantic drift.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Frame {
    /// client → server. First frame on every connection. The coordinator
    /// closes the connection if no `register` arrives within 1 s
    /// (FR / register-or-die).
    Register {
        tab_id: String,
        colleague_id: String,
        name: String,
        #[serde(default)]
        parent: Option<String>,
        #[serde(default)]
        pid: Option<u32>,
    },
    /// server → client. Confirms a successful register and ships the
    /// current roster so the new colleague can render peers.
    RegisterAck {
        colleague_id: String,
        roster: Vec<ColleagueView>,
        /// T5: snapshot of currently-held resource claims so a freshly
        /// joined colleague immediately knows about active freezes
        /// without needing a separate `list_claims` round-trip.
        /// `#[serde(default)]` keeps wire compat with pre-T5 senders.
        ///
        /// @privacy Tier-2 — `ClaimView.message` may carry user content.
        #[serde(default)]
        claims: Vec<ClaimView>,
    },
    /// client → server. Liveness ping. Status must be `idle` or `working`.
    Heartbeat {
        colleague_id: String,
        #[serde(default)]
        status: Option<String>,
    },
    /// client → server. Unread-worthy event surfaced in the Cmd+J inbox.
    Notify {
        colleague_id: String,
        /// Defaults to [`Severity::Normal`] when omitted by the client (FR-015).
        #[serde(default)]
        severity: Severity,
        /// @privacy Tier-2 PII — never log, never persist, never forward to telemetry.
        /// May contain user prompts, secrets, or session content. See PRI-001/002.
        message: String,
    },
    /// client → server. Cross-colleague routed message.
    SendTo {
        from: String,
        to: String,
        /// @privacy Tier-2 PII — never log, never persist, never forward to telemetry.
        /// Opaque payload routed between colleagues; may contain user prompts or secrets.
        /// See PRI-001/002.
        payload: serde_json::Value,
    },
    /// server → client. Delivered cross-colleague message.
    RecvFrom {
        from: String,
        /// @privacy Tier-2 PII — never log, never persist, never forward to telemetry.
        /// See PRI-001/002.
        payload: serde_json::Value,
    },
    /// server → client. Push of the full colleague roster after one or
    /// more colleagues' OSC-derived status / cwd / last-command fields
    /// changed (T3 / FR-011). Sent debounced — see
    /// [`crate::swarm::coordinator::SwarmCoordinator::update_status`].
    ///
    /// @privacy Tier-2 — contains `cwd` inside each `ColleagueView`.
    /// NEVER debug-log this frame in full (PRI-002). The coordinator's
    /// observability calls log identity (`colleague_id`) only, never
    /// the frame body.
    ///
    /// The full roster is sent (not a delta) for two reasons:
    /// (1) consumers stay stateless — they overwrite their local view
    ///     without merging deltas, eliminating an entire class of
    ///     "did I miss an update?" sync bugs;
    /// (2) at the spec's scale (≤10 colleagues per machine) the wire
    ///     cost is negligible (<1 KiB per broadcast).
    RosterUpdate { colleagues: Vec<ColleagueView> },
    /// server → client. Coordinator-routed inbound notify. Used when one
    /// colleague (or the Putz UI itself, with `from = "putz"`) sends a
    /// notify *to* this colleague. Distinct from the client-to-server
    /// `Notify` so the receiver can't confuse outbound and inbound.
    /// The receiver typically surfaces the message in its session log.
    /// @privacy Tier-2 PII — `message` is user/agent-authored content.
    RecvNotify {
        from: String,
        message: String,
        #[serde(default)]
        severity: Severity,
    },
    /// bidirectional. Clean shutdown. The coordinator emits this when it
    /// evicts a duplicate `register` for the same `tab_id`.
    Disconnect {
        colleague_id: String,
        #[serde(default)]
        reason: Option<String>,
    },

    // ─── T5: swarm coordination tools (claims + tool RPC) ─────────────
    //
    // Frames below implement the Copilot-CLI-extension-callable tools
    // (claim/release/check/list_claims/broadcast). Pattern: client sends
    // `*_req` with a `request_id`; coordinator answers with a single
    // `tool_response` frame correlated by the same `request_id`.
    // Independent `claim` / `release` broadcasts notify all colleagues
    // when the claim table changes (incl. the requester themselves so
    // every node converges on the same cache).
    /// server → client broadcast. New or refreshed claim — receivers
    /// upsert into their local claim cache.
    /// @privacy Tier-2 — `message` is holder-authored.
    Claim {
        resource: String,
        holder: String,
        message: String,
        expires_at_ms: u64,
    },
    /// server → client broadcast. Claim released (explicitly or via
    /// TTL sweep) — receivers remove from their local claim cache.
    Release { resource: String, holder: String },
    /// client → server. Try to claim `resource` for `ttl_ms`.
    /// Idempotent if already held by self (refreshes TTL + message).
    /// @privacy Tier-2 — `message` is user-authored.
    ClaimReq {
        request_id: String,
        resource: String,
        ttl_ms: u64,
        #[serde(default)]
        message: Option<String>,
    },
    /// client → server. Release a claim early. No-op if not held by self.
    ReleaseReq {
        request_id: String,
        resource: String,
    },
    /// client → server. Snapshot of all active claims.
    ListClaimsReq { request_id: String },
    /// client → server. Acknowledged 1:1 message — like [`Frame::SendTo`]
    /// but routed through the same validate→sanitize→cap pipeline as
    /// [`Frame::Notify`] / [`Frame::BroadcastReq`], and answered with a
    /// [`Frame::ToolResponse`] so the sender learns whether delivery
    /// succeeded (`unknown_target`, `message_too_long`, `back_channel_full`).
    /// @privacy Tier-2 — `message` is user-authored.
    SendReq {
        request_id: String,
        target_colleague_id: String,
        message: String,
        #[serde(default)]
        severity: Severity,
    },
    /// client → server. One-to-many notify to every other colleague.
    /// @privacy Tier-2 — `message` is user-authored.
    BroadcastReq {
        request_id: String,
        message: String,
        #[serde(default)]
        severity: Severity,
    },
    /// server → client. Reply to any `*_req` correlated by `request_id`.
    /// `payload` is tool-specific (see coordinator handlers). `error`
    /// is `Some(code)` when `ok = false`.
    /// @privacy Tier-2 — `payload` may carry holder messages.
    ToolResponse {
        request_id: String,
        ok: bool,
        #[serde(default)]
        payload: serde_json::Value,
        #[serde(default)]
        error: Option<String>,
    },
}

/// Errors from frame I/O. Kept narrow on purpose — every variant maps to
/// "log + close the connection".
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("frame too large: {0} bytes (max {})", MAX_FRAME_BYTES)]
    TooLarge(u32),
    /// Length prefix is structurally invalid (currently: zero). Distinct from
    /// [`FrameError::TooLarge`] so callers can treat protocol-violation vs
    /// resource-exhaustion separately in metrics/logs.
    #[error("invalid frame length: {0}")]
    InvalidLength(u32),
    #[error("invalid utf-8 in frame body")]
    InvalidUtf8,
    // NOTE: serde_json::Error::Display does not echo input bytes. If the parser
    // is swapped (e.g., simd-json), audit before logging this variant — the
    // wire payload may carry user prompts / secrets (PRI-002).
    #[error("invalid json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Read one frame from `reader`. Returns `Ok(None)` on clean EOF before
/// any bytes are consumed — the caller treats that as a normal disconnect.
///
/// On any error (including oversized prefix), the caller MUST drop the
/// connection. We never partially-consume a frame and resume.
pub async fn read_frame<R>(reader: &mut R) -> Result<Option<Frame>, FrameError>
where
    R: AsyncRead + Unpin,
{
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_be_bytes(len_buf);
    if len == 0 {
        return Err(FrameError::InvalidLength(len));
    }
    if len > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(len));
    }
    let mut body = vec![0u8; len as usize];
    reader.read_exact(&mut body).await?;
    let s = std::str::from_utf8(&body).map_err(|_| FrameError::InvalidUtf8)?;
    let frame = serde_json::from_str(s)?;
    Ok(Some(frame))
}

/// Write one frame to `writer`. Caller is responsible for flushing if a
/// timely delivery is required.
pub async fn write_frame<W>(writer: &mut W, frame: &Frame) -> Result<(), FrameError>
where
    W: AsyncWrite + Unpin,
{
    let body = serde_json::to_vec(frame)?;
    let len = u32::try_from(body.len()).map_err(|_| FrameError::TooLarge(u32::MAX))?;
    if len > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(len));
    }
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&body).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    fn sample_register() -> Frame {
        Frame::Register {
            tab_id: "tab-1".into(),
            colleague_id: "alice-abcd".into(),
            name: "alice".into(),
            parent: Some("self".into()),
            pid: Some(4242),
        }
    }

    #[tokio::test]
    async fn roundtrip_register_frame() {
        let (mut a, mut b) = duplex(8192);
        let frame = sample_register();
        write_frame(&mut a, &frame).await.unwrap();
        let got = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(got, frame);
    }

    #[tokio::test]
    async fn roundtrip_send_to_with_arbitrary_payload() {
        let (mut a, mut b) = duplex(8192);
        let frame = Frame::SendTo {
            from: "alice".into(),
            to: "bob".into(),
            payload: serde_json::json!({ "kind": "ping", "n": 42 }),
        };
        write_frame(&mut a, &frame).await.unwrap();
        let got = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(got, frame);
    }

    #[tokio::test]
    async fn clean_eof_returns_none() {
        let (a, mut b) = duplex(64);
        drop(a);
        let got = read_frame(&mut b).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn oversized_prefix_rejected_without_reading_body() {
        // Write a length prefix beyond MAX_FRAME_BYTES but no body.
        // Reader must reject on the prefix alone — proves we don't try
        // to allocate or read the (potentially malicious) payload.
        let (mut a, mut b) = duplex(64);
        let bogus = (MAX_FRAME_BYTES + 1).to_be_bytes();
        a.write_all(&bogus).await.unwrap();
        a.flush().await.unwrap();
        // Don't write any body. Don't drop the writer. The read must error.
        let err = read_frame(&mut b).await.unwrap_err();
        assert!(matches!(err, FrameError::TooLarge(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn zero_length_prefix_rejected() {
        let (mut a, mut b) = duplex(64);
        a.write_all(&[0, 0, 0, 0]).await.unwrap();
        a.flush().await.unwrap();
        let err = read_frame(&mut b).await.unwrap_err();
        assert!(
            matches!(err, FrameError::InvalidLength(0)),
            "expected InvalidLength(0), got {err:?}"
        );
    }

    /// FR-015: clients may omit `severity` in a `notify` frame; the decoder
    /// must default it to `Severity::Normal` rather than reject the frame.
    #[tokio::test]
    async fn notify_severity_defaults_to_normal_when_omitted() {
        let (mut a, mut b) = duplex(256);
        let body = br#"{"type":"notify","colleague_id":"x","message":"hi"}"#;
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let frame = read_frame(&mut b).await.unwrap().unwrap();
        match frame {
            Frame::Notify {
                severity, message, ..
            } => {
                assert_eq!(severity, Severity::Normal);
                assert_eq!(message, "hi");
            }
            other => panic!("expected Notify, got {other:?}"),
        }
    }

    #[test]
    fn severity_default_is_normal() {
        assert_eq!(Severity::default(), Severity::Normal);
    }

    #[tokio::test]
    async fn invalid_json_rejected() {
        let (mut a, mut b) = duplex(64);
        let body = b"not json at all";
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let err = read_frame(&mut b).await.unwrap_err();
        assert!(matches!(err, FrameError::Json(_)));
    }

    #[tokio::test]
    async fn unknown_frame_field_rejected() {
        // deny_unknown_fields must reject typoed / injected fields.
        let (mut a, mut b) = duplex(64);
        let body = br#"{"type":"heartbeat","colleague_id":"x","extra":1}"#;
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let err = read_frame(&mut b).await.unwrap_err();
        assert!(matches!(err, FrameError::Json(_)));
    }

    /// T3: roster_update frame round-trips with the full ColleagueView
    /// shape (incl. the new optional command_status / cwd / last_*
    /// fields).
    #[tokio::test]
    async fn roundtrip_roster_update_frame() {
        use crate::swarm::types::CommandStatus;
        let (mut a, mut b) = duplex(8192);
        let frame = Frame::RosterUpdate {
            colleagues: vec![ColleagueView {
                id: "alice-aaaa".into(),
                name: "alice".into(),
                tab_id: "tab-1".into(),
                status: "idle".into(),
                parent: None,
                command_status: Some(CommandStatus::Running),
                cwd: Some("/home/alice/proj".into()),
                last_command_exit: Some(0),
                last_command_started_at: Some(1_700_000_000_000),
                last_ten_exit_codes: vec![Some(0), Some(0), Some(1), None],
            }],
        };
        write_frame(&mut a, &frame).await.unwrap();
        let got = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(got, frame);
    }

    /// T3: roster_update with a colleague missing the new optional
    /// fields parses cleanly (back-compat with pre-T3 senders).
    #[tokio::test]
    async fn roster_update_accepts_legacy_colleague_shape() {
        let (mut a, mut b) = duplex(8192);
        let body = br#"{"type":"roster_update","colleagues":[{"id":"a","name":"a","tab_id":"t","status":"idle"}]}"#;
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let frame = read_frame(&mut b).await.unwrap().unwrap();
        match frame {
            Frame::RosterUpdate { colleagues } => {
                assert_eq!(colleagues.len(), 1);
                assert!(colleagues[0].command_status.is_none());
                assert!(colleagues[0].cwd.is_none());
                assert!(colleagues[0].last_command_exit.is_none());
                assert!(colleagues[0].last_command_started_at.is_none());
                assert!(colleagues[0].last_ten_exit_codes.is_empty());
            }
            other => panic!("expected RosterUpdate, got {other:?}"),
        }
    }

    /// T5: register_ack without `claims` parses cleanly (pre-T5
    /// coordinator wire compat).
    #[tokio::test]
    async fn register_ack_accepts_missing_claims_field() {
        let (mut a, mut b) = duplex(8192);
        let body = br#"{"type":"register_ack","colleague_id":"alice","roster":[]}"#;
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let frame = read_frame(&mut b).await.unwrap().unwrap();
        match frame {
            Frame::RegisterAck { claims, .. } => assert!(claims.is_empty()),
            other => panic!("expected RegisterAck, got {other:?}"),
        }
    }

    /// T5: roundtrip a Claim broadcast frame.
    #[tokio::test]
    async fn roundtrip_claim_frame() {
        let (mut a, mut b) = duplex(8192);
        let frame = Frame::Claim {
            resource: "deploy-prod".into(),
            holder: "alice-aaaa".into(),
            message: "freeze".into(),
            expires_at_ms: 1_700_000_000_000,
        };
        write_frame(&mut a, &frame).await.unwrap();
        let got = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(got, frame);
    }

    /// T5: roundtrip a tool_response frame with arbitrary payload.
    #[tokio::test]
    async fn roundtrip_tool_response_frame() {
        let (mut a, mut b) = duplex(8192);
        let frame = Frame::ToolResponse {
            request_id: "req-1".into(),
            ok: false,
            payload: serde_json::json!({"holder": "bob"}),
            error: Some("held_by_other".into()),
        };
        write_frame(&mut a, &frame).await.unwrap();
        let got = read_frame(&mut b).await.unwrap().unwrap();
        assert_eq!(got, frame);
    }

    /// T5: claim_req with omitted `message` defaults to None.
    #[tokio::test]
    async fn claim_req_message_is_optional() {
        let (mut a, mut b) = duplex(256);
        let body = br#"{"type":"claim_req","request_id":"r1","resource":"x","ttl_ms":60000}"#;
        let len = (body.len() as u32).to_be_bytes();
        a.write_all(&len).await.unwrap();
        a.write_all(body).await.unwrap();
        a.flush().await.unwrap();
        let frame = read_frame(&mut b).await.unwrap().unwrap();
        match frame {
            Frame::ClaimReq { message, .. } => assert!(message.is_none()),
            other => panic!("expected ClaimReq, got {other:?}"),
        }
    }
}
