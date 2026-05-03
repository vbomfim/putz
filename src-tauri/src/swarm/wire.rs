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

use super::types::{ColleagueView, Severity};

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
        severity: Severity,
        message: String,
    },
    /// client → server. Cross-colleague routed message.
    SendTo {
        from: String,
        to: String,
        payload: serde_json::Value,
    },
    /// server → client. Delivered cross-colleague message.
    RecvFrom {
        from: String,
        payload: serde_json::Value,
    },
    /// bidirectional. Clean shutdown. The coordinator emits this when it
    /// evicts a duplicate `register` for the same `tab_id`.
    Disconnect {
        colleague_id: String,
        #[serde(default)]
        reason: Option<String>,
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
    #[error("invalid utf-8 in frame body")]
    InvalidUtf8,
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
    if len == 0 || len > MAX_FRAME_BYTES {
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
        assert!(matches!(err, FrameError::TooLarge(0)));
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
}
