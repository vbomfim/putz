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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use interprocess::local_socket::{
    tokio::{prelude::*, Stream as LocalStream},
    GenericFilePath, ListenerOptions, Name, ToFsName,
};
#[cfg(windows)]
use interprocess::local_socket::{GenericNamespaced, ToNsName};
#[cfg(windows)]
use interprocess::os::windows::{
    local_socket::ListenerOptionsExt, security_descriptor::SecurityDescriptor,
};
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

/// Per-frame write timeout. If the client TCP/pipe buffer is full and the
/// peer isn't reading, we abandon the write rather than wedge the writer
/// task forever. Pairs with the per-connection cancel token (see
/// [`handle_connection`]). Spec SEC-002 (resource exhaustion defense).
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Maximum simultaneously-accepted-but-not-yet-registered connections.
/// Once exceeded, new accepts are immediately closed. Defends against
/// a flood of half-open connections wedging memory before the
/// register-or-die deadline reaps them. Spec SEC-002.
const MAX_INFLIGHT_PRE_REGISTER: usize = 256;

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
    /// one — spec §4 edge cases) and binds **with `umask(0o077)` set
    /// across the bind call** so the socket file is created with mode
    /// 0o600 atomically — no TOCTOU window between bind and chmod.
    /// `chmod 600` is also re-applied as belt-and-braces in case a kernel
    /// or filesystem (e.g., FAT) ignores the umask.
    ///
    /// On Windows, `path` is a flat pipe name (no `\\.\pipe\` prefix).
    /// The pipe is created with an **explicit DACL granting Generic All
    /// only to the current user's SID** (issue #149 / spec SEC-008) —
    /// the default named-pipe DACL on Windows is the creator's token's
    /// default DACL, which on some configurations (e.g., systems where
    /// the user is in extra groups, or where a tweaked default DACL
    /// has been pushed via group policy) can grant unwanted access.
    /// Building our own SDDL `D:P(A;;GA;;;<sid>)` removes that
    /// uncertainty: Discretionary, Protected (no inherit), Allow
    /// Generic All to the queried current-user SID — and nothing else.
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

        // Bind with strict umask scoped only across the bind call.
        // This closes the TOCTOU window where another process could
        // open the socket between bind() and chmod().
        #[cfg(unix)]
        let inner = {
            let _umask_guard = UmaskGuard::strict();
            ListenerOptions::new().name(name).create_tokio()?
        };
        #[cfg(windows)]
        let inner = {
            // SEC-008: explicit DACL → current-user SID only, no inheritance.
            let sd = current_user_sd()?;
            ListenerOptions::new()
                .name(name)
                .security_descriptor(sd)
                .create_tokio()?
        };
        #[cfg(not(any(unix, windows)))]
        let inner = ListenerOptions::new().name(name).create_tokio()?;

        // Belt-and-braces: even with umask, re-apply 0o600 explicitly.
        // (Some filesystems ignore umask — e.g., FAT — and bind itself
        // may set group/other bits depending on libc. This is now an
        // assertion of state, not the *only* enforcement.)
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
    ///
    /// Inflight (accepted but not yet registered) connections are capped
    /// at [`MAX_INFLIGHT_PRE_REGISTER`]; excess accepts are immediately
    /// closed. Defends against a flood overwhelming RAM before the
    /// register-or-die deadline reaps them (spec SEC-002).
    pub async fn run(self, coordinator: SwarmCoordinator, cancel: CancellationToken) {
        let path = self.path.clone();
        let inflight = Arc::new(AtomicUsize::new(0));
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                accepted = self.inner.accept() => {
                    match accepted {
                        Ok(stream) => {
                            // Inflight cap (SEC-002). Increment first, drop on overflow.
                            let n = inflight.fetch_add(1, Ordering::AcqRel) + 1;
                            if n > MAX_INFLIGHT_PRE_REGISTER {
                                inflight.fetch_sub(1, Ordering::AcqRel);
                                tracing_warn(&format!(
                                    "swarm: inflight cap reached ({MAX_INFLIGHT_PRE_REGISTER}), \
                                     dropping new connection"
                                ));
                                drop(stream);
                                continue;
                            }
                            let coord = coordinator.clone();
                            let cancel = cancel.clone();
                            let inflight = inflight.clone();
                            tokio::spawn(async move {
                                handle_connection(stream, coord, cancel, inflight).await;
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

/// Build a `SecurityDescriptor` whose DACL grants Generic All only to
/// the current user's SID — and is marked Protected (`P` flag) so it
/// will not silently inherit ACEs from any container.
///
/// Implements spec SEC-008 / issue #149. The "default DACL on the
/// process token" approach was rejected because that DACL is
/// configurable system-wide and we cannot guarantee it won't grant
/// access to other principals.
///
/// SDDL grammar reminder: `D:P(A;;GA;;;<sid>)`
///   * `D:` — DACL section
///   * `P` — Protected (do not inherit)
///   * `(A;;GA;;;<sid>)` — Allow ACE, no flags, Generic All rights,
///     no object guid, no inherit-object guid, principal = `<sid>`
#[cfg(windows)]
fn current_user_sd() -> io::Result<SecurityDescriptor> {
    use std::ffi::c_void;
    use std::mem::MaybeUninit;
    use std::ptr;
    use widestring::U16CString;
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, FALSE, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // 1. Open the current process token (read-only).
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: GetCurrentProcess returns a pseudo-handle (no close needed);
    // OpenProcessToken writes a real handle into `token`, which we close below.
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if ok == FALSE {
        return Err(io::Error::last_os_error());
    }
    // RAII close for `token` even on the error paths below.
    struct TokenGuard(HANDLE);
    impl Drop for TokenGuard {
        fn drop(&mut self) {
            // SAFETY: `self.0` was returned by OpenProcessToken above.
            unsafe { CloseHandle(self.0) };
        }
    }
    let _token_guard = TokenGuard(token);

    // 2. Probe for required buffer length, then read the TokenUser struct.
    let mut needed: u32 = 0;
    // SAFETY: passing null buffer with len=0 — Win32 returns FALSE and writes
    // the required length into `needed`. The "ERROR_INSUFFICIENT_BUFFER"
    // result is the documented contract here.
    unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed) };
    if needed == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut buf = vec![0u8; needed as usize];
    // SAFETY: buf is `needed` bytes, large enough per the prior probe.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buf.as_mut_ptr() as *mut c_void,
            needed,
            &mut needed,
        )
    };
    if ok == FALSE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: TOKEN_USER is the documented layout for the TokenUser class.
    let token_user_ptr = buf.as_ptr() as *const TOKEN_USER;
    let sid_ptr = unsafe { (*token_user_ptr).User.Sid };
    if sid_ptr.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "TokenUser returned null SID",
        ));
    }

    // 3. Convert SID → SDDL string ("S-1-5-21-...").
    let mut sid_str_ptr: *mut u16 = ptr::null_mut();
    // SAFETY: ConvertSidToStringSidW allocates with LocalAlloc; we LocalFree below.
    let ok = unsafe { ConvertSidToStringSidW(sid_ptr, &mut sid_str_ptr) };
    if ok == FALSE || sid_str_ptr.is_null() {
        return Err(io::Error::last_os_error());
    }
    struct SidStrGuard(*mut u16);
    impl Drop for SidStrGuard {
        fn drop(&mut self) {
            // SAFETY: pointer was returned by ConvertSidToStringSidW (LocalAlloc).
            unsafe { LocalFree(self.0 as *mut c_void) };
        }
    }
    let _sid_str_guard = SidStrGuard(sid_str_ptr);

    // Read the wide-string SID (NUL-terminated).
    let sid_string = {
        let mut len = 0usize;
        // SAFETY: pointer is valid and NUL-terminated per ConvertSidToStringSidW.
        while unsafe { *sid_str_ptr.add(len) } != 0 {
            len += 1;
        }
        let slice = unsafe { std::slice::from_raw_parts(sid_str_ptr, len) };
        String::from_utf16(slice).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?
    };

    // 4. Build the SDDL and hand it to interprocess.
    let sddl = format!("D:P(A;;GA;;;{sid_string})");
    let wide =
        U16CString::from_str(&sddl).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    SecurityDescriptor::deserialize(&wide)
}

#[cfg(unix)]
fn chmod_600(path: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perms)
}

/// RAII guard that sets `umask(0o077)` on construction and restores the
/// previous value on `Drop`. Replaces the prior `with_strict_umask`
/// closure helper so that a panic inside the bind call cannot leave a
/// strict umask leaking process-wide for the rest of the process
/// lifetime (Sec pass-2 N1 / CR-Opus pass-2 N2).
///
/// SAFETY: `umask(2)` is a process-global, non-thread-safe POSIX call.
/// The unsafe blocks here cannot cause undefined behaviour — they
/// simply mutate a process-wide value. The race window is purely a
/// "permissions-of-other-files-created-concurrently" concern, not a
/// memory-safety one. Production callers serialize bind through the
/// coordinator's `lifecycle` mutex; tests that bind in parallel are
/// also protected because each call's prev-value is captured atomically
/// by `umask()` itself, so the worst case is brief, fail-safe-tighter
/// inheritance, never a fail-open one (we *narrow* permissions, never
/// widen). The Drop fires even on panic — that is the whole point.
#[cfg(unix)]
struct UmaskGuard {
    prev: libc::mode_t,
}

#[cfg(unix)]
impl UmaskGuard {
    fn strict() -> Self {
        // SAFETY: see type-level SAFETY comment.
        let prev = unsafe { libc::umask(0o077) };
        Self { prev }
    }
}

#[cfg(unix)]
impl Drop for UmaskGuard {
    fn drop(&mut self) {
        // SAFETY: see type-level SAFETY comment.
        unsafe {
            libc::umask(self.prev);
        }
    }
}

/// RAII guard for the pre-register inflight counter. Increments the
/// caller-supplied counter on construction (caller must have already
/// reserved a slot via `fetch_add`) and decrements on `Drop` unless
/// `disarm()` is called first. This replaces the prior bool + closure
/// pattern with one that survives an unexpected panic in the
/// pre-register window — without it, a panic between `fetch_add` and
/// the manual decrement would leak the slot forever and, over many
/// panics, saturate the inflight cap into a silent listener DoS
/// (Sec pass-2 N2 / CR-Opus pass-2 N3, defense-in-depth — no obvious
/// panic source today).
///
/// Usage: construct *after* a successful `fetch_add` on the counter.
/// Call `disarm()` once the connection has graduated out of the
/// pre-register window (i.e., register succeeded and the long-lived
/// per-connection tasks own their own lifecycle); otherwise let Drop
/// fire on every early-return / panic path to settle the counter.
struct InflightGuard {
    counter: Arc<AtomicUsize>,
    armed: bool,
}

impl InflightGuard {
    fn new(counter: Arc<AtomicUsize>) -> Self {
        Self {
            counter,
            armed: true,
        }
    }
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        if self.armed {
            self.counter.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

/// Handle one accepted connection: enforce register-or-die, then spin up
/// the read/write tasks and bridge them through the coordinator.
///
/// `inflight` is decremented exactly once via [`InflightGuard`] — when
/// this connection's register-or-die outcome is decided (success or
/// failure, including panic). Inflight accounting only covers the
/// pre-register window; once registered, the MAX_COLLEAGUES cap takes
/// over and the guard is `disarm()`ed.
async fn handle_connection(
    stream: LocalStream,
    coordinator: SwarmCoordinator,
    cancel: CancellationToken,
    inflight: Arc<AtomicUsize>,
) {
    let (mut reader, mut writer) = tokio::io::split(stream);
    // RAII: decrement inflight on every early-return / panic until we
    // explicitly disarm after a successful register.
    let mut inflight_guard = InflightGuard::new(inflight);

    // ── Register-or-die handshake ────────────────────────────────
    let register = match tokio::time::timeout(REGISTER_DEADLINE, read_frame(&mut reader)).await {
        Ok(Ok(Some(Frame::Register {
            tab_id,
            colleague_id,
            name,
            parent,
            pid,
        }))) => (tab_id, colleague_id, name, parent, pid),
        Ok(Ok(Some(_))) => return,
        Ok(Ok(None)) => return,
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

    // Successful register — exit the pre-register window. Drop the
    // guard's responsibility to settle the counter (long-lived
    // per-connection state takes over from here).
    inflight_guard.disarm();
    drop(inflight_guard);

    // Send the ack synchronously so the client sees roster on return.
    if write_frame(&mut writer, &ack).await.is_err() {
        coordinator.disconnect(&conn_id).await;
        return;
    }

    // Per-connection cancel — child of the global cancel. Reader cancels
    // it on exit so the writer doesn't wedge waiting on rx.recv() when
    // the peer is gone but the coordinator's sender hasn't been dropped
    // yet. Spec SEC-002 + CR-Opus #3.
    let conn_cancel = cancel.child_token();

    // ── Writer task: drain backchannel → socket ──────────────────
    let writer_conn_cancel = conn_cancel.clone();
    let writer_global_cancel = cancel.clone();
    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = writer_global_cancel.cancelled() => break,
                _ = writer_conn_cancel.cancelled() => break,
                msg = rx.recv() => {
                    let Some(frame) = msg else { break };
                    // Per-write timeout: a slow / hung client cannot pin
                    // this task forever. Belt to the per-conn cancel's
                    // braces — a wedged TCP-buffer-full peer is reaped
                    // by the timeout even before the reader notices EOF.
                    match tokio::time::timeout(WRITE_TIMEOUT, write_frame(&mut writer, &frame)).await {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => break,
                        Err(_) => {
                            tracing_warn("swarm: writer timeout, abandoning connection");
                            break;
                        }
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
    let reader_global_cancel = cancel.clone();
    let reader_conn_cancel = conn_cancel.clone();
    let reader_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = reader_global_cancel.cancelled() => break,
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
        // Wake the writer task even if the coordinator's sender clones
        // are still alive somewhere (e.g., a pending send_to closure).
        reader_conn_cancel.cancel();
    });

    // Either side ending = the connection is done.
    let _ = reader_task.await;
    coordinator.disconnect(&conn_id).await;
    // After disconnect, the coordinator drops its sender; combined with
    // the per-conn cancel the reader fired, the writer exits promptly.
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
        Frame::RegisterAck { .. } | Frame::RecvFrom { .. } | Frame::RosterUpdate { .. } => {
            Flow::Break
        }
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

    /// SEC-008 / issue #149: the bound named pipe must have an explicit
    /// DACL with a single ACE (the current user). Default-DACL behavior
    /// (which can grant access to multiple principals depending on the
    /// process token's default DACL) is what we are guarding against.
    ///
    /// We verify by binding, opening the pipe, calling `GetSecurityInfo`
    /// for `DACL_SECURITY_INFORMATION`, and asserting the DACL is
    /// non-NULL with `AceCount == 1`. We deliberately do not parse the
    /// ACE struct — the SDDL we built (`D:P(A;;GA;;;<sid>)`) only
    /// produces one ACE, and ACL header layout traversal in raw FFI is
    /// brittle. Equality on AceCount is sufficient evidence.
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_pipe_dacl_is_current_user_only() {
        use std::ptr;
        use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE};
        use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
        use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION};
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
        };

        let pipe_name = format!("putz-swarm-test-{}", std::process::id());
        let _listener = Listener::bind(PathBuf::from(&pipe_name)).expect("bind");

        let full = format!(r"\\.\pipe\{pipe_name}");
        let wide: Vec<u16> = full.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: Win32 FFI; arguments match documented contract.
        let h = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                ptr::null_mut(),
            )
        };
        assert!(
            !h.is_null(),
            "CreateFileW failed: {}",
            std::io::Error::last_os_error()
        );

        let mut dacl_ptr: *mut ACL = ptr::null_mut();
        let mut sd_ptr: *mut std::ffi::c_void = ptr::null_mut();
        // SAFETY: out-pointers are valid stack locations.
        let rc = unsafe {
            GetSecurityInfo(
                h,
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut dacl_ptr,
                ptr::null_mut(),
                &mut sd_ptr,
            )
        };
        // SAFETY: handle was opened above; close it regardless of rc.
        unsafe { CloseHandle(h) };
        assert_eq!(rc, 0, "GetSecurityInfo failed: rc={rc}");
        assert!(
            !dacl_ptr.is_null(),
            "DACL is NULL (= grants Everyone full access). SEC-008 violation."
        );
        // SAFETY: dacl_ptr non-null per assertion above.
        let ace_count = unsafe { (*dacl_ptr).AceCount };
        assert_eq!(
            ace_count, 1,
            "expected exactly one ACE (current-user-only), got {ace_count}"
        );
        // sd_ptr is owned by the SD allocator; LocalFree on process exit is fine
        // for a unit test. Skipping explicit free to keep the FFI surface small.
        let _ = sd_ptr;
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

    /// [EDGE] Client writes a length prefix then disconnects mid-frame.
    /// The listener must NOT panic — the per-connection task closes
    /// cleanly and the listener keeps accepting.
    #[tokio::test]
    async fn partial_frame_then_eof_does_not_crash_listener() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = dir.path().join("partial.sock");
        #[cfg(windows)]
        let path = PathBuf::from(format!("putz-swarm-partial-{}", std::process::id()));
        let _ = &dir;

        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        // Client 1: send length=64 then only 8 bytes, then drop.
        let mut bad = connect(&path).await.unwrap();
        bad.write_all(&64u32.to_be_bytes()).await.unwrap();
        bad.write_all(b"only8byt").await.unwrap();
        bad.flush().await.unwrap();
        drop(bad); // mid-frame disconnect

        // Client 2: a well-behaved connection must still succeed —
        // proves the listener didn't crash or stop accepting.
        let mut good = connect(&path).await.unwrap();
        write_frame(
            &mut good,
            &Frame::Register {
                tab_id: "ok".into(),
                colleague_id: "ok-1".into(),
                name: "ok".into(),
                parent: None,
                pid: None,
            },
        )
        .await
        .unwrap();
        let ack = tokio::time::timeout(Duration::from_secs(2), read_frame(&mut good))
            .await
            .expect("listener stopped accepting after partial-frame client")
            .unwrap()
            .unwrap();
        assert!(matches!(ack, Frame::RegisterAck { .. }));

        cancel.cancel();
        drop(good);
        let _ = server.await;
    }

    /// [AC-1] After the listener's run loop exits (cancel fired), the
    /// Unix socket file is unlinked. Covers AC1 "removed at shutdown".
    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_removes_socket_file() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shutdown.sock");

        let listener = Listener::bind(path.clone()).unwrap();
        assert!(path.exists(), "socket file must exist after bind");
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        // Give accept loop a moment to enter select!.
        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel.cancel();
        let _ = server.await;
        assert!(
            !path.exists(),
            "socket file must be unlinked on shutdown, still present at {path:?}"
        );
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

    /// CR-Opus #3 + Sec #2: The writer task must NOT wedge forever when
    /// the peer stops reading (TCP/pipe buffers fill, mpsc fills, the
    /// coordinator's sender clones may still be alive). Per-conn cancel
    /// + per-write timeout must terminate the writer within WRITE_TIMEOUT.
    #[cfg(unix)]
    #[tokio::test]
    async fn writer_terminates_when_client_stops_reading() {
        // Smaller-budget version: with the per-conn cancel firing on
        // reader exit, when the client drops without reading, the reader
        // task observes EOF and cancels the per-conn token; the writer
        // exits its select! immediately rather than blocking on rx.recv()
        // for a coordinator clone that may still hold a sender.
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wedge.sock");
        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        // Connect, register, then stop reading and disconnect.
        let mut client = connect(&path).await.unwrap();
        write_frame(
            &mut client,
            &Frame::Register {
                tab_id: "wedge".into(),
                colleague_id: "wedge-1".into(),
                name: "wedge".into(),
                parent: None,
                pid: None,
            },
        )
        .await
        .unwrap();
        let _ack = read_frame(&mut client).await.unwrap().unwrap();

        // Drop the client — peer goes away. The server-side reader task
        // observes EOF, cancels the per-conn token, and the writer must
        // exit even if no frames are ever queued. The coordinator's
        // disconnect handler also drops its sender as a backstop.
        drop(client);

        // Within a small bound, the roster should clear (proves the
        // server-side connection tasks tore down — including the writer
        // which previously could have wedged).
        let cleared = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if coord.roster().await.is_empty() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        assert!(
            cleared.is_ok(),
            "writer/reader did not terminate within timeout — wedge regression"
        );

        cancel.cancel();
        let _ = server.await;
    }

    /// Sec #1: Bind under a permissive umask MUST still produce a
    /// 0o600-mode socket file — proves the umask scope around bind closes
    /// the TOCTOU window between bind() and chmod(). We assert mode
    /// strictly equals 0o600.
    ///
    /// CR-Opus pass-2 N1: serialized because this test mutates the
    /// process-global umask; running it in parallel with other bind
    /// tests (each of which sets/restores umask via `UmaskGuard`) could
    /// otherwise produce read-back races even though the file mode
    /// itself is fixed up by the explicit `chmod_600` belt-and-braces.
    #[cfg(unix)]
    #[tokio::test]
    #[serial_test::serial]
    async fn bind_under_permissive_umask_still_chmod_600() {
        use std::os::unix::fs::PermissionsExt;
        // Set a wide-open umask (allow all bits — would otherwise produce
        // 0o777 - umask = 0o755 or similar on most filesystems).
        let prev = unsafe { libc::umask(0o000) };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("umask.sock");
        let listener = Listener::bind(path.clone()).unwrap();
        // Restore caller umask immediately.
        unsafe { libc::umask(prev) };

        let meta = std::fs::metadata(listener.path()).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "even with caller umask 0o000, socket must be 0o600 (got {mode:o})"
        );
    }

    /// Sec #3: Inflight (accepted-but-unregistered) connections are capped.
    /// Open MANY silent connections; once the cap is reached, additional
    /// accepts must be closed promptly (server-side stream drop → client
    /// observes EOF). We don't measure exact threshold (brittle on macOS
    /// listen-backlog defaults) — just that overflow eventually closes.
    #[cfg(unix)]
    #[tokio::test]
    async fn inflight_pre_register_cap_drops_excess_connections() {
        let coord = SwarmCoordinator::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("flood.sock");
        let listener = Listener::bind(path.clone()).unwrap();
        let cancel = CancellationToken::new();
        let server = tokio::spawn({
            let coord = coord.clone();
            let cancel = cancel.clone();
            async move { listener.run(coord, cancel).await }
        });

        // Saturate the inflight cap with silent conns. Yield between
        // connects so the server's accept loop processes each — this
        // ensures the inflight counter actually reaches the cap before
        // we test the overflow path.
        let mut held = Vec::new();
        for _ in 0..MAX_INFLIGHT_PRE_REGISTER {
            match connect(&path).await {
                Ok(c) => {
                    held.push(c);
                    tokio::task::yield_now().await;
                }
                Err(_) => break,
            }
        }
        // Give the accept loop a generous moment to process the queue.
        tokio::time::sleep(Duration::from_millis(200)).await;

        // Now flood with extras and look for ANY one that gets closed
        // promptly. With cap = MAX_INFLIGHT_PRE_REGISTER and that many
        // silent conns held, every excess connection must hit the drop
        // path and close server-side.
        let mut overflow_observed = false;
        for _ in 0..16 {
            let mut excess = match connect(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            let mut buf = [0u8; 1];
            // Cap-rejected streams are dropped server-side immediately
            // (no register-or-die wait), so EOF should arrive far
            // sooner than REGISTER_DEADLINE (1s).
            let read =
                tokio::time::timeout(Duration::from_millis(250), excess.read_exact(&mut buf)).await;
            if matches!(read, Ok(Err(_))) {
                overflow_observed = true;
                break;
            }
        }
        assert!(
            overflow_observed,
            "expected at least one excess connection to be closed promptly by the inflight cap"
        );

        cancel.cancel();
        drop(held);
        let _ = server.await;
    }

    /// Sec pass-2 N1 / CR-Opus pass-2 N2: `UmaskGuard` MUST restore the
    /// previous umask even when the protected scope panics. Without the
    /// RAII restoration, a panic between bind setup and `Drop` would
    /// leak `umask(0o077)` process-wide for the rest of the process —
    /// fail-safe (more restrictive) but a correctness regression.
    ///
    /// Serialized because we mutate the process-global umask.
    #[cfg(unix)]
    #[tokio::test]
    #[serial_test::serial]
    async fn umask_guard_restores_on_panic() {
        // Capture caller's current umask by setting a known wide value
        // and re-reading it (umask() returns the previous value).
        let original = unsafe { libc::umask(0o022) };
        let baseline = unsafe { libc::umask(0o022) };
        assert_eq!(baseline, 0o022, "test setup: failed to seed umask");

        let result = std::panic::catch_unwind(|| {
            let _guard = UmaskGuard::strict();
            // Inside the guard, umask is 0o077.
            let now = unsafe { libc::umask(0o077) };
            assert_eq!(now, 0o077, "guard should have set umask to 0o077");
            panic!("simulated panic inside guarded scope");
        });
        assert!(result.is_err(), "test scaffolding: panic should propagate");

        // After the panic + Drop, umask must be back to the seeded value.
        let after = unsafe { libc::umask(0o022) };
        assert_eq!(
            after, 0o022,
            "UmaskGuard::Drop must restore prev umask even on panic (got {after:o})"
        );

        // Restore caller's true original umask.
        unsafe { libc::umask(original) };
    }

    /// Sec pass-2 N2 / CR-Opus pass-2 N3: `InflightGuard` MUST decrement
    /// the counter on Drop unless explicitly disarmed. Direct unit test
    /// of the guard primitive — the production path that benefits from
    /// this (a panic inside `handle_connection`'s pre-register window)
    /// is hard to trigger without dependency injection, so we exercise
    /// the guard contract directly here. The guard is correct ⇒ the
    /// production usage is correct.
    #[test]
    fn inflight_guard_decrements_on_drop() {
        let counter = Arc::new(AtomicUsize::new(0));
        // Simulate the production fetch_add that precedes guard
        // construction.
        counter.fetch_add(1, Ordering::AcqRel);
        assert_eq!(counter.load(Ordering::Acquire), 1);

        {
            let _g = InflightGuard::new(counter.clone());
            assert_eq!(
                counter.load(Ordering::Acquire),
                1,
                "guard ctor should NOT mutate the counter"
            );
        }
        assert_eq!(
            counter.load(Ordering::Acquire),
            0,
            "Drop must decrement the counter when armed"
        );
    }

    #[test]
    fn inflight_guard_does_not_decrement_when_disarmed() {
        let counter = Arc::new(AtomicUsize::new(0));
        counter.fetch_add(1, Ordering::AcqRel);
        {
            let mut g = InflightGuard::new(counter.clone());
            g.disarm();
        }
        assert_eq!(
            counter.load(Ordering::Acquire),
            1,
            "disarmed guard must NOT decrement on Drop (long-lived owner takes over)"
        );
    }

    /// The panic-safety story for `InflightGuard`. Wraps a closure that
    /// constructs the guard and then panics — Drop must still fire and
    /// settle the counter. Defends against a future refactor that
    /// accidentally regresses to a manual-decrement pattern.
    #[test]
    fn inflight_guard_decrements_on_panic() {
        let counter = Arc::new(AtomicUsize::new(0));
        counter.fetch_add(1, Ordering::AcqRel);
        let counter_for_panic = counter.clone();
        let result = std::panic::catch_unwind(move || {
            let _g = InflightGuard::new(counter_for_panic);
            panic!("simulated panic in pre-register window");
        });
        assert!(result.is_err(), "panic should propagate");
        assert_eq!(
            counter.load(Ordering::Acquire),
            0,
            "Drop on panic must decrement the counter — otherwise repeated panics would saturate the inflight cap and silently DoS the listener"
        );
    }
}
