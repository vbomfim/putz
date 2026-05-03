//! Cross-platform local IPC transport for the swarm.
//!
//! Owns the listening endpoint (Unix domain socket on macOS/Linux,
//! Windows named pipe on Windows) and the per-connection accept/dispatch
//! loop. State (the colleague registry, message routing) lives in
//! [`super::coordinator::SwarmCoordinator`] — this module only moves bytes.
//!
//! Authentication is purely OS-level:
//!   * Unix: socket file `chmod 600` after bind. Same-UID processes only.
//!   * Windows: default named-pipe ACL grants the creator's SID;
//!     other users cannot open the pipe.
//!
//! Per-instance path: each Putz process gets a pid-suffixed path so two
//! Putz instances for the same user do not collide (spec §4 edge cases).
use std::io;
use std::path::PathBuf;
use std::time::Duration;

use interprocess::local_socket::{
    tokio::{prelude::*, Stream as LocalStream},
    GenericFilePath, ListenerOptions, Name, ToFsName,
};
#[cfg(windows)]
use interprocess::local_socket::{GenericNamespaced, ToNsName};
#[cfg(test)]
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::coordinator::{ConnectionId, SwarmCoordinator};
use super::wire::{read_frame, write_frame, Frame, FrameError};

/// How long we wait for the first `register` frame before closing the
/// connection. Spec FR — register-or-die handshake.
const REGISTER_DEADLINE: Duration = Duration::from_secs(1);

/// Capacity of the per-connection back-channel (server → client). Bounded
/// to defend against a slow client wedging the coordinator.
const BACKCHANNEL_CAPACITY: usize = 256;

/// Resolve the socket / pipe path for the current process.
///
/// Pure function — no filesystem side effects. Returns the path that
/// [`Listener::bind`] will create.
///
/// Layout (matches spec §4):
///   * Linux: `$XDG_RUNTIME_DIR/putz/swarm-<pid>.sock`
///     fallback: `${TMPDIR:-/tmp}/putz-swarm-<pid>.sock`
///   * macOS: `${TMPDIR:-/tmp}/putz-swarm-<pid>.sock`
///   * Windows: `\\.\pipe\putz-swarm-<pid>` (returned as just
///     `putz-swarm-<pid>`; the namespace prefix is added by the binder)
pub fn resolve_socket_path(pid: u32) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        // Windows named pipes use a flat namespace name; the binder
        // adds the `\\.\pipe\` prefix via GenericNamespaced.
        return PathBuf::from(format!("putz-swarm-{pid}"));
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_RUNTIME_DIR") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg)
                    .join("putz")
                    .join(format!("swarm-{pid}.sock"));
            }
        }
        tmp_fallback(pid)
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        tmp_fallback(pid)
    }
    #[cfg(not(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    )))]
    {
        tmp_fallback(pid)
    }
}

#[cfg(unix)]
fn tmp_fallback(pid: u32) -> PathBuf {
    let dir = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(dir).join(format!("putz-swarm-{pid}.sock"))
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn tmp_fallback(pid: u32) -> PathBuf {
    PathBuf::from(std::env::temp_dir()).join(format!("putz-swarm-{pid}.sock"))
}

/// A bound listener that accepts connections and dispatches each to the
/// coordinator. Returned by [`Listener::bind`].
pub struct Listener {
    path: PathBuf,
    inner: interprocess::local_socket::tokio::Listener,
}

impl Listener {
    /// Bind a fresh listener at `path`. On Unix, removes any stale socket
    /// file at `path` before binding (a prior crashed Putz may have left
    /// one — spec §4 edge cases). Then `chmod 600`s it.
    ///
    /// On Windows, `path` is a flat pipe name (no `\\.\pipe\` prefix) and
    /// the OS enforces "creator-SID-only" via the default DACL.
    pub fn bind(path: PathBuf) -> io::Result<Self> {
        // Make parent dir on Unix (XDG_RUNTIME_DIR/putz).
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
            // Best-effort removal of a stale socket from a prior crash.
            // Ignored if the path doesn't exist; bubbles real errors.
            match std::fs::remove_file(&path) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }

        let name = path_to_name(&path)?;
        let inner = ListenerOptions::new().name(name).create_tokio()?;

        #[cfg(unix)]
        chmod_600(&path)?;

        Ok(Self { path, inner })
    }

    /// Path the listener is bound to. Used to populate `PUTZ_SWARM_PATH`
    /// in spawned PTY environments.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// Run the accept loop until `cancel` fires. Each accepted connection
    /// is spawned as an independent tokio task — slow / hung clients do
    /// not block other colleagues.
    pub async fn run(self, coordinator: SwarmCoordinator, cancel: CancellationToken) {
        let path = self.path.clone();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                accepted = self.inner.accept() => {
                    match accepted {
                        Ok(stream) => {
                            let coord = coordinator.clone();
                            let cancel = cancel.clone();
                            tokio::spawn(async move {
                                handle_connection(stream, coord, cancel).await;
                            });
                        }
                        Err(e) => {
                            tracing_warn(&format!("swarm accept error: {e}"));
                            // Brief backoff to avoid a tight error loop on
                            // pathological FS conditions.
                            tokio::time::sleep(Duration::from_millis(50)).await;
                        }
                    }
                }
            }
        }
        // Best-effort cleanup of the socket file on Unix shutdown.
        #[cfg(unix)]
        let _ = std::fs::remove_file(&path);
        #[cfg(not(unix))]
        let _ = path; // suppress unused on Windows
    }
}

#[cfg(unix)]
fn path_to_name(path: &std::path::Path) -> io::Result<Name<'_>> {
    path.to_fs_name::<GenericFilePath>()
}

#[cfg(windows)]
fn path_to_name(path: &std::path::Path) -> io::Result<Name<'_>> {
    let s = path
        .as_os_str()
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "non-utf8 pipe name"))?;
    s.to_ns_name::<GenericNamespaced>()
}

#[cfg(unix)]
fn chmod_600(path: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perms)
}

/// Handle one accepted connection: enforce register-or-die, then spin up
/// the read/write tasks and bridge them through the coordinator.
async fn handle_connection(
    stream: LocalStream,
    coordinator: SwarmCoordinator,
    cancel: CancellationToken,
) {
    let (mut reader, mut writer) = tokio::io::split(stream);

    // ── Register-or-die handshake ────────────────────────────────
    let register = match tokio::time::timeout(REGISTER_DEADLINE, read_frame(&mut reader)).await {
        Ok(Ok(Some(Frame::Register {
            tab_id,
            colleague_id,
            name,
            parent,
            pid,
        }))) => (tab_id, colleague_id, name, parent, pid),
        Ok(Ok(Some(_))) => {
            // First frame wasn't Register — protocol violation.
            return;
        }
        Ok(Ok(None)) => return, // clean EOF
        Ok(Err(e)) => {
            tracing_warn(&format!("swarm: bad register frame: {e}"));
            return;
        }
        Err(_) => {
            // Timeout — slow-loris defense.
            return;
        }
    };

    // ── Bind connection to coordinator ───────────────────────────
    let (tx, mut rx) = mpsc::channel::<Frame>(BACKCHANNEL_CAPACITY);
    let (conn_id, ack) = match coordinator
        .register(
            register.0, register.1, register.2, register.3, register.4, tx,
        )
        .await
    {
        Ok(pair) => pair,
        Err(e) => {
            tracing_warn(&format!("swarm: register rejected: {e}"));
            return;
        }
    };

    // Send the ack synchronously so the client sees roster on return.
    if write_frame(&mut writer, &ack).await.is_err() {
        coordinator.disconnect(&conn_id).await;
        return;
    }

    // ── Writer task: drain backchannel → socket ──────────────────
    let writer_cancel = cancel.clone();
    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = writer_cancel.cancelled() => break,
                msg = rx.recv() => {
                    let Some(frame) = msg else { break };
                    if write_frame(&mut writer, &frame).await.is_err() {
                        break;
                    }
                }
            }
        }
        // Best-effort half-close to flush any kernel buffers.
        let _ = writer.shutdown().await;
    });

    // ── Reader task: socket → coordinator dispatch ───────────────
    let reader_conn = conn_id.clone();
    let reader_coord = coordinator.clone();
    let reader_cancel = cancel.clone();
    let reader_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = reader_cancel.cancelled() => break,
                frame = read_frame(&mut reader) => {
                    match frame {
                        Ok(Some(f)) => {
                            if dispatch_frame(&reader_coord, &reader_conn, f).await.should_break() {
                                break;
                            }
                        }
                        Ok(None) => break, // peer closed
                        Err(FrameError::TooLarge(n)) => {
                            tracing_warn(&format!(
                                "swarm: oversized frame from {reader_conn:?}: {n} bytes"
                            ));
                            break;
                        }
                        Err(e) => {
                            tracing_warn(&format!(
                                "swarm: bad frame from {reader_conn:?}: {e}"
                            ));
                            break;
                        }
                    }
                }
            }
        }
    });

    // Either side ending = the connection is done.
    let _ = reader_task.await;
    coordinator.disconnect(&conn_id).await;
    // Cancel the writer once disconnect has dropped its sender; rx.recv()
    // will return None and the writer exits.
    let _ = writer_task.await;
}

enum Flow {
    Continue,
    Break,
}

impl Flow {
    fn should_break(&self) -> bool {
        matches!(self, Flow::Break)
    }
}

async fn dispatch_frame(
    coordinator: &SwarmCoordinator,
    conn_id: &ConnectionId,
    frame: Frame,
) -> Flow {
    match frame {
        Frame::Register { .. } => {
            // Re-register on an existing connection is a protocol error.
            Flow::Break
        }
        Frame::Heartbeat {
            colleague_id,
            status,
        } => {
            coordinator
                .heartbeat(conn_id, &colleague_id, status.as_deref())
                .await;
            Flow::Continue
        }
        Frame::Notify {
            colleague_id,
            severity,
            message,
        } => {
            coordinator
                .notify(conn_id, &colleague_id, severity, message)
                .await;
            Flow::Continue
        }
        Frame::SendTo { from, to, payload } => {
            coordinator.send_to(conn_id, &from, &to, payload).await;
            Flow::Continue
        }
        Frame::Disconnect { .. } => Flow::Break,
        // server-only frames — clients should never send these.
        Frame::RegisterAck { .. } | Frame::RecvFrom { .. } => Flow::Break,
    }
}

/// Connect a client to a listener — used by integration tests inside
/// this crate. Production clients are the Node extension, not Rust.
#[cfg(test)]
pub async fn connect(path: &std::path::Path) -> io::Result<LocalStream> {
    let name = path_to_name(path)?;
    LocalStream::connect(name).await
}

fn tracing_warn(msg: &str) {
    // Keep dependency surface narrow — `tracing` isn't yet pulled in
    // tree. Switch to `tracing::warn!` once it is. NEVER include frame
    // contents (PRI-002): may carry user prompts / secrets.
    eprintln!("[swarm] {msg}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_socket_path_is_pid_unique() {
        let a = resolve_socket_path(1234);
        let b = resolve_socket_path(5678);
        assert_ne!(a, b);
        let s = a.to_string_lossy();
        assert!(s.contains("1234"), "path missing pid: {s}");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_path_uses_xdg_runtime_dir_when_set() {
        let prev = std::env::var_os("XDG_RUNTIME_DIR");
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        let p = resolve_socket_path(42);
        assert_eq!(
            p,
            PathBuf::from("/run/user/1000/putz/swarm-42.sock"),
            "got {p:?}"
        );
        if let Some(v) = prev {
            std::env::set_var("XDG_RUNTIME_DIR", v);
        } else {
            std::env::remove_var("XDG_RUNTIME_DIR");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_path_uses_tmpdir() {
        let p = resolve_socket_path(99);
        let s = p.to_string_lossy();
        assert!(s.contains("putz-swarm-99.sock"), "got {s}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_path_is_flat_pipe_name() {
        let p = resolve_socket_path(7);
        assert_eq!(p, PathBuf::from("putz-swarm-7"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bind_creates_socket_with_chmod_600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.sock");
        let listener = Listener::bind(path.clone()).unwrap();
        let meta = std::fs::metadata(listener.path()).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "expected mode 0o600, got {mode:o}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bind_replaces_stale_socket_file() {
        // A leftover regular file at the path must not block bind —
        // spec §4 edge case (prior crashed Putz).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stale.sock");
        std::fs::write(&path, b"junk").unwrap();
        assert!(path.exists());
        let _listener = Listener::bind(path.clone()).unwrap();
        // bind succeeded — that's the assertion.
    }

    /// Connect → register → ack roundtrip with a single in-process client.
    #[tokio::test]
    async fn end_to_end_register_and_ack() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = dir.path().join("e2e.sock");
        #[cfg(windows)]
        let path = PathBuf::from(format!("putz-swarm-test-{}", std::process::id()));
        let _ = &dir; // keep tempdir alive on Windows

        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        let mut client = connect(&path).await.unwrap();
        let reg = Frame::Register {
            tab_id: "t1".into(),
            colleague_id: "alice".into(),
            name: "alice".into(),
            parent: None,
            pid: None,
        };
        write_frame(&mut client, &reg).await.unwrap();
        let ack = read_frame(&mut client).await.unwrap().unwrap();
        match ack {
            Frame::RegisterAck { colleague_id, .. } => assert_eq!(colleague_id, "alice"),
            other => panic!("expected RegisterAck, got {other:?}"),
        }

        // Roster contains the colleague.
        assert_eq!(coord.roster().await.len(), 1);

        // Client disconnects → coordinator must drop the registration.
        drop(client);
        // Give the read loop time to observe EOF.
        for _ in 0..50 {
            if coord.roster().await.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(coord.roster().await.len(), 0, "disconnect cleanup failed");

        cancel.cancel();
        let _ = server.await;
    }

    /// Two registered colleagues; A sends to B; B receives.
    #[tokio::test]
    async fn end_to_end_send_to_routes_message() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = dir.path().join("route.sock");
        #[cfg(windows)]
        let path = PathBuf::from(format!("putz-swarm-route-{}", std::process::id()));
        let _ = &dir;

        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        // Connect and register A.
        let mut a = connect(&path).await.unwrap();
        write_frame(
            &mut a,
            &Frame::Register {
                tab_id: "ta".into(),
                colleague_id: "alice".into(),
                name: "alice".into(),
                parent: None,
                pid: None,
            },
        )
        .await
        .unwrap();
        let _ = read_frame(&mut a).await.unwrap().unwrap(); // ack

        // Connect and register B.
        let mut b = connect(&path).await.unwrap();
        write_frame(
            &mut b,
            &Frame::Register {
                tab_id: "tb".into(),
                colleague_id: "bob".into(),
                name: "bob".into(),
                parent: None,
                pid: None,
            },
        )
        .await
        .unwrap();
        let _ = read_frame(&mut b).await.unwrap().unwrap(); // ack

        // A → B
        write_frame(
            &mut a,
            &Frame::SendTo {
                from: "alice".into(),
                to: "bob".into(),
                payload: serde_json::json!({"k": "hello"}),
            },
        )
        .await
        .unwrap();

        let received = tokio::time::timeout(Duration::from_secs(2), read_frame(&mut b))
            .await
            .expect("send_to delivery timed out")
            .unwrap()
            .unwrap();
        match received {
            Frame::RecvFrom { from, payload } => {
                assert_eq!(from, "alice");
                assert_eq!(payload, serde_json::json!({"k": "hello"}));
            }
            other => panic!("expected RecvFrom, got {other:?}"),
        }

        cancel.cancel();
        drop(a);
        drop(b);
        let _ = server.await;
    }

    /// Connection that never sends `register` is closed by the deadline.
    #[tokio::test]
    async fn register_or_die_closes_silent_connection() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = dir.path().join("silent.sock");
        #[cfg(windows)]
        let path = PathBuf::from(format!("putz-swarm-silent-{}", std::process::id()));
        let _ = &dir;

        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        let mut client = connect(&path).await.unwrap();
        // Wait past the register deadline.
        tokio::time::sleep(REGISTER_DEADLINE + Duration::from_millis(200)).await;

        // Reading should now hit EOF (server closed us).
        let mut buf = [0u8; 4];
        let res = client.read_exact(&mut buf).await;
        assert!(res.is_err(), "expected EOF after register-or-die deadline");

        cancel.cancel();
        let _ = server.await;
    }
}
