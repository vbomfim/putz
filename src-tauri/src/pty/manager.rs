/// PTY session manager — spawns, manages, and cleans up PTY sessions.
///
/// Each terminal tab gets its own `PtySession` identified by a UUID v4.
/// The manager uses OS threads (not tokio tasks) for the blocking read
/// loop, since `portable-pty` uses synchronous `std::io::Read`.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::error::PtyError;
use crate::logging::SessionLogger;

/// Output buffer size for reading from the PTY.
const READ_BUFFER_SIZE: usize = 4096;

/// Maximum number of concurrent PTY sessions.
const MAX_SESSIONS: usize = 64;

/// Allowed shell paths on Unix systems.
#[cfg(unix)]
const ALLOWED_SHELLS_UNIX: &[&str] = &[
    "/bin/bash",
    "/bin/zsh",
    "/bin/sh",
    "/bin/fish",
    "/usr/bin/bash",
    "/usr/bin/zsh",
    "/usr/bin/fish",
    "/usr/local/bin/bash",
    "/usr/local/bin/zsh",
    "/usr/local/bin/fish",
];

/// Allowed shell names on Windows (case-insensitive comparison).
#[cfg(windows)]
const ALLOWED_SHELLS_WINDOWS: &[&str] = &[
    "powershell.exe",
    "pwsh.exe",
    "cmd.exe",
    "bash.exe",
    "wsl.exe",
    "nu.exe",
];

/// Allowed CLI argument prefixes by shell category.
/// Only arguments starting with these prefixes are passed to the PTY.
const ALLOWED_ARG_PREFIXES_COPILOT: &[&str] = &["--yolo", "--experimental", "--debug"];
const ALLOWED_ARG_PREFIXES_POWERSHELL: &[&str] =
    &["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-File"];
/// Explicit deny list for PowerShell (checked before prefix allow).
const DENIED_ARG_PREFIXES_POWERSHELL: &[&str] = &["-EncodedCommand", "-e ", "-ec "];
const ALLOWED_ARG_PREFIXES_BASH: &[&str] = &["-c", "-i", "-l"];

/// Allowed environment variable name patterns.
/// Only these prefixes/exact names may be passed to the PTY.
const ALLOWED_ENV_NAMES: &[&str] = &[
    "TERM",
    "LANG",
    "COLORTERM",
    "EDITOR",
    "VISUAL",
    "PAGER",
    "TZ",
];
const ALLOWED_ENV_PREFIXES: &[&str] = &["LC_", "PUTZ_", "COPILOT_"];

/// Holds the resources for a single PTY session.
struct PtySession {
    /// Writer handle for sending input to the PTY.
    writer: Box<dyn Write + Send>,
    /// Master side of the PTY (needed for resize).
    master: Box<dyn MasterPty + Send>,
    /// Child process handle (needed for wait/kill).
    #[allow(dead_code)]
    child: Box<dyn Child + Send + Sync>,
    /// PID of the child shell process (for CWD lookup).
    pid: Option<u32>,
}

/// Manages all active PTY sessions.
///
/// Thread-safe via `Arc<Mutex<>>` — accessed from IPC command handlers
/// (main thread) and reader threads (OS threads).
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    /// Creates a new empty PTY manager.
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawns a new PTY session with the given parameters.
    ///
    /// Returns the UUID session ID on success. Starts a background OS thread
    /// that reads PTY output and emits Tauri events.
    ///
    /// Validates shell path, working directory, and environment variables
    /// before spawning.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        app: &AppHandle,
        shell: Option<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        env: Option<HashMap<String, String>>,
        log_loggers: Arc<Mutex<HashMap<String, Arc<SessionLogger>>>>,
        args: Option<Vec<String>>,
    ) -> Result<String, PtyError> {
        // Check session limit before doing anything else
        {
            let sessions = self
                .sessions
                .lock()
                .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;
            if sessions.len() >= MAX_SESSIONS {
                return Err(PtyError::SessionLimitReached);
            }
        }

        // Validate and resolve shell path
        let shell_path = match shell {
            Some(ref path) if path == "copilot" => {
                // Resolve copilot binary from PATH to an absolute path
                resolve_copilot_binary()?
            }
            Some(path) => {
                validate_shell(&path)?;
                path
            }
            None => default_shell(),
        };

        // Validate CLI arguments against per-shell allowlist
        if let Some(ref extra_args) = args {
            validate_args(&shell_path, extra_args)?;
        }

        // Validate working directory
        if let Some(ref dir) = cwd {
            validate_working_directory(dir)?;
        }

        // Validate environment variables
        if let Some(ref vars) = env {
            validate_env_vars(vars)?;
        }

        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&shell_path);

        // Spawn as login shell so it sources ~/.zprofile / ~/.bash_profile
        // This ensures the full PATH is available (Homebrew, cargo, nvm, etc.)
        // Without this, macOS GUI apps get a minimal PATH (/usr/bin:/bin only)
        #[cfg(unix)]
        cmd.arg("-l");

        // Windows: inject OSC 7 cwd notification into PowerShell so the
        // frontend can track `cd` reliably. PowerShell does NOT sync the
        // Win32 PEB CurrentDirectory on Set-Location, so reading cwd via
        // NtQueryInformationProcess returns stale values. OSC 7 lets the
        // shell itself authoritatively announce its cwd before every prompt.
        //
        // Strategy: skip auto-profile loading, manually dot-source all four
        // profile paths (so Oh-My-Posh etc. still install their prompt),
        // then wrap the user's `prompt` function with an OSC 7 emitter.
        #[cfg(windows)]
        {
            let shell_lower = shell_path.to_lowercase();
            if shell_lower.ends_with("powershell.exe") || shell_lower.ends_with("pwsh.exe") {
                let script = r#"foreach ($p in @($PROFILE.AllUsersAllHosts, $PROFILE.AllUsersCurrentHost, $PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost)) { if ($p -and (Test-Path $p)) { . $p } }; $global:__putzOrigPrompt = $function:prompt; function global:prompt { try { [Console]::Write([char]27 + ']7;file://' + [System.Net.Dns]::GetHostName() + ($PWD.ProviderPath -replace '\\','/') + [char]27 + '\') } catch {}; & $global:__putzOrigPrompt }"#;
                cmd.arg("-NoLogo");
                cmd.arg("-NoProfile");
                cmd.arg("-NoExit");
                cmd.arg("-Command");
                cmd.arg(script);
            }
        }

        // Set TERM so the shell knows how to handle terminal features
        cmd.env("TERM", "xterm-256color");

        // Set working directory if provided (already validated)
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // Set environment variables if provided (already validated)
        if let Some(vars) = env {
            for (key, value) in vars {
                cmd.env(key, value);
            }
        }

        // Append extra CLI arguments (e.g. --yolo for Copilot CLI colleagues)
        if let Some(extra_args) = args {
            for arg in extra_args {
                cmd.arg(arg);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        // Drop the slave — we only need the master side
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let session_id = Uuid::new_v4().to_string();
        let pid = child.process_id();

        let session = PtySession {
            writer,
            master: pair.master,
            child,
            pid,
        };

        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;
            sessions.insert(session_id.clone(), session);
        }

        // Start the output reader on an OS thread (blocking I/O).
        // This thread lives until the PTY process exits (reader returns EOF).
        self.start_reader_thread(app.clone(), session_id.clone(), reader, log_loggers);

        Ok(session_id)
    }

    /// Writes input bytes to a PTY session.
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), PtyError> {
        validate_session_id(session_id)?;

        let t_start = std::time::Instant::now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;
        let t_lock = t_start.elapsed().as_micros();

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;

        let t_write_start = std::time::Instant::now();
        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;
        let t_write = t_write_start.elapsed().as_micros();

        if t_lock > 5_000 || t_write > 5_000 {
            crate::perf::log(&format!(
                "manager.write session={} lock_wait_us={} write_flush_us={}",
                &session_id[..8.min(session_id.len())],
                t_lock,
                t_write
            ));
        }

        Ok(())
    }

    /// Resizes a PTY session to the given dimensions.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        validate_session_id(session_id)?;

        let sessions = self
            .sessions
            .lock()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        session
            .master
            .resize(size)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        Ok(())
    }

    /// Gets the current working directory of a PTY session's child process.
    ///
    /// On macOS, uses `proc_pidinfo` via lsof fallback. On Linux, reads `/proc/PID/cwd`.
    pub fn get_cwd(&self, session_id: &str) -> Result<String, PtyError> {
        validate_session_id(session_id)?;

        let t_start = std::time::Instant::now();
        let pid = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

            let session = sessions
                .get(session_id)
                .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;

            session.pid.ok_or_else(|| {
                PtyError::WriteFailed("No PID available for this session".to_string())
            })?
        };
        let t_lock = t_start.elapsed().as_micros();

        let t_probe = std::time::Instant::now();
        let result = get_process_cwd(pid);
        let t_probe_us = t_probe.elapsed().as_micros();

        if t_lock > 5_000 || t_probe_us > 20_000 {
            crate::perf::log(&format!(
                "manager.get_cwd session={} pid={} lock_wait_us={} probe_us={}",
                &session_id[..8.min(session_id.len())],
                pid,
                t_lock,
                t_probe_us
            ));
        }

        result
    }

    /// Like `get_cwd` but returns Err when the PEB read fails instead of
    /// falling back to USERPROFILE. Use for cwd-tracking (per-line registry)
    /// so stale/fallback values don't get recorded as real cwd changes.
    pub fn get_cwd_strict(&self, session_id: &str) -> Result<String, PtyError> {
        validate_session_id(session_id)?;

        let pid = {
            let sessions = self
                .sessions
                .lock()
                .map_err(|e| PtyError::WriteFailed(e.to_string()))?;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;
            session.pid.ok_or_else(|| {
                PtyError::WriteFailed("No PID available for this session".to_string())
            })?
        };

        get_process_cwd_strict(pid)
    }

    /// Closes a PTY session and removes it from the manager.
    ///
    /// The child process is killed, and the reader thread will
    /// exit naturally when it detects EOF.
    pub fn close(&self, session_id: &str) -> Result<(), PtyError> {
        validate_session_id(session_id)?;

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        let mut session = sessions
            .remove(session_id)
            .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;

        // Kill the child process — the reader thread will detect
        // EOF and clean up. We intentionally ignore errors here
        // since the process may have already exited.
        let _ = session.child.kill();

        Ok(())
    }

    /// Closes all active PTY sessions.
    ///
    /// Called during graceful app shutdown to send SIGHUP to all child
    /// processes, ensuring they clean up (e.g., flush logs, release locks).
    /// Errors from individual sessions are silently ignored since the app
    /// is exiting anyway.
    pub fn close_all(&self) {
        let mut sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(_) => return, // Poisoned mutex — nothing we can do
        };

        for (_id, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }

    /// Starts an OS thread that reads PTY output and emits Tauri events.
    ///
    /// Uses `std::thread::spawn` instead of `tokio::spawn` because
    /// `portable-pty` uses synchronous `std::io::Read`. A tokio task
    /// would block the async runtime.
    ///
    /// Output bytes are base64-encoded before emission to avoid the
    /// overhead of serializing Vec<u8> as a JSON array of numbers.
    ///
    /// If a session logger is active, raw output bytes are also written
    /// to the log file via the shared logger registry.
    fn start_reader_thread(
        &self,
        app: AppHandle,
        session_id: String,
        mut reader: Box<dyn Read + Send>,
        log_loggers: Arc<Mutex<HashMap<String, Arc<SessionLogger>>>>,
    ) {
        let sessions = self.sessions.clone();
        let b64_engine = base64::engine::general_purpose::STANDARD;

        std::thread::spawn(move || {
            let mut buf = [0u8; READ_BUFFER_SIZE];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child process exited
                    Ok(n) => {
                        let data = &buf[..n];

                        // Emit to frontend (base64-encoded)
                        let encoded = b64_engine.encode(data);
                        let event_name = format!("pty-output-{session_id}");
                        let _ = app.emit(&event_name, encoded);

                        // Write to session logger if active (non-blocking lookup)
                        if let Ok(loggers) = log_loggers.lock() {
                            if let Some(logger) = loggers.get(&session_id) {
                                let logger = logger.clone(); // Arc clone — release HashMap lock
                                drop(loggers);
                                let _ = logger.write_data(data);
                            }
                        }
                    }
                    Err(e) => {
                        // I/O error — log minimally (no content!) and exit
                        eprintln!("PTY read error for session {session_id}: {e}");
                        break;
                    }
                }
            }

            // Child exited — try to get exit code and emit exit event.
            // Lock briefly to remove the session and get the child handle.
            let exit_code = {
                let mut sessions = match sessions.lock() {
                    Ok(s) => s,
                    Err(_) => return, // Mutex poisoned — nothing we can do
                };

                if let Some(mut session) = sessions.remove(&session_id) {
                    // Wait for the child to fully exit and get the status
                    match session.child.wait() {
                        Ok(status) => {
                            // ExitStatus in portable-pty: success() for 0
                            if status.success() {
                                0i32
                            } else {
                                1i32
                            }
                        }
                        Err(_) => -1i32,
                    }
                } else {
                    // Session was already removed (e.g., by close())
                    0i32
                }
            };

            let exit_event = format!("pty-exit-{session_id}");
            let _ = app.emit(&exit_event, serde_json::json!({ "code": exit_code }));
        });
    }
}

/// Returns the default shell for the current OS.
fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
}

/// Validates that a session ID is a valid UUID v4 format.
fn validate_session_id(session_id: &str) -> Result<(), PtyError> {
    Uuid::parse_str(session_id).map_err(|_| PtyError::InvalidSessionId(session_id.to_string()))?;
    Ok(())
}

/// Validates that the shell path is in the platform allowlist.
fn validate_shell(shell: &str) -> Result<(), PtyError> {
    #[cfg(unix)]
    {
        if !ALLOWED_SHELLS_UNIX.contains(&shell) {
            return Err(PtyError::InvalidShell(shell.to_string()));
        }
    }
    #[cfg(windows)]
    {
        let lower = shell.to_lowercase();
        if !ALLOWED_SHELLS_WINDOWS
            .iter()
            .any(|allowed| lower == *allowed)
        {
            return Err(PtyError::InvalidShell(shell.to_string()));
        }
    }
    Ok(())
}

/// Validates that the working directory exists and is a directory.
fn validate_working_directory(dir: &str) -> Result<(), PtyError> {
    let canonical = std::fs::canonicalize(dir)
        .map_err(|_| PtyError::InvalidWorkingDirectory(dir.to_string()))?;

    if !canonical.is_dir() {
        return Err(PtyError::InvalidWorkingDirectory(dir.to_string()));
    }

    Ok(())
}

/// Validates that all environment variable names are in the allowlist.
fn validate_env_vars(vars: &HashMap<String, String>) -> Result<(), PtyError> {
    for key in vars.keys() {
        let upper = key.to_uppercase();
        let is_exact_match = ALLOWED_ENV_NAMES.iter().any(|name| upper == *name);
        let is_prefix_match = ALLOWED_ENV_PREFIXES
            .iter()
            .any(|prefix| upper.starts_with(prefix));

        if !is_exact_match && !is_prefix_match {
            return Err(PtyError::InvalidEnvironment(key.clone()));
        }
    }
    Ok(())
}

/// Resolve the `copilot` binary to an absolute path by searching PATH.
///
/// On Windows, prefers `.cmd` → `.exe` → bare name.
/// On Unix, searches for `copilot` in each PATH directory.
/// Returns the resolved absolute path or an error if not found.
pub fn resolve_copilot_binary() -> Result<String, PtyError> {
    let path_var = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    let separator = ';';
    #[cfg(unix)]
    let separator = ':';

    #[cfg(windows)]
    let candidates = &["copilot.cmd", "copilot.exe"];
    #[cfg(unix)]
    let candidates = &["copilot"];

    for dir in path_var.split(separator) {
        if dir.is_empty() {
            continue;
        }
        let dir_path = std::path::Path::new(dir);
        for candidate in candidates {
            let full = dir_path.join(candidate);
            if full.is_file() {
                return full
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| PtyError::InvalidShell("copilot path is not valid UTF-8".into()));
            }
        }
    }

    Err(PtyError::InvalidShell(
        "copilot binary not found in PATH".into(),
    ))
}

/// Returns true if the resolved shell path is a copilot binary.
fn is_copilot_shell(shell: &str) -> bool {
    let lower = shell.to_lowercase();
    let name = std::path::Path::new(&lower)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    matches!(name, "copilot" | "copilot.exe" | "copilot.cmd" | "copilot.bat")
}

/// Determines the shell category for arg validation.
enum ShellCategory {
    Copilot,
    PowerShell,
    Bash,
    Other,
}

fn classify_shell(shell: &str) -> ShellCategory {
    if is_copilot_shell(shell) {
        return ShellCategory::Copilot;
    }
    let lower = shell.to_lowercase();
    let name = std::path::Path::new(&lower)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if name.contains("powershell") || name.contains("pwsh") {
        ShellCategory::PowerShell
    } else if matches!(name, "bash" | "bash.exe" | "zsh" | "sh" | "fish") {
        ShellCategory::Bash
    } else {
        ShellCategory::Other
    }
}

/// Validates that CLI arguments are in the per-shell allowlist.
///
/// Rejects arguments containing NUL bytes or newlines, and enforces
/// prefix-based allowlists specific to each shell category.
fn validate_args(shell: &str, args: &[String]) -> Result<(), PtyError> {
    // Reject dangerous characters in any arg
    for arg in args {
        if arg.contains('\0') || arg.contains('\n') || arg.contains('\r') {
            return Err(PtyError::InvalidArgs(
                "argument contains NUL or newline".into(),
            ));
        }
    }

    let allowed_prefixes = match classify_shell(shell) {
        ShellCategory::Copilot => ALLOWED_ARG_PREFIXES_COPILOT,
        ShellCategory::PowerShell => {
            // Check explicit deny list first (case-insensitive)
            for arg in args {
                let lower = arg.to_lowercase();
                for denied in DENIED_ARG_PREFIXES_POWERSHELL {
                    if lower.starts_with(&denied.to_lowercase()) {
                        return Err(PtyError::InvalidArgs(format!(
                            "denied for PowerShell: {arg}"
                        )));
                    }
                }
                // Also block bare "-e" and "-ec" (shorthand for -EncodedCommand)
                if lower == "-e" || lower == "-ec" {
                    return Err(PtyError::InvalidArgs(format!(
                        "denied for PowerShell: {arg}"
                    )));
                }
            }
            ALLOWED_ARG_PREFIXES_POWERSHELL
        }
        ShellCategory::Bash => ALLOWED_ARG_PREFIXES_BASH,
        ShellCategory::Other => {
            // Unknown shells get no args through
            if !args.is_empty() {
                return Err(PtyError::InvalidArgs(
                    "arguments not allowed for this shell".into(),
                ));
            }
            return Ok(());
        }
    };

    for arg in args {
        let matches_prefix = allowed_prefixes
            .iter()
            .any(|prefix| arg.starts_with(prefix));
        if !matches_prefix {
            return Err(PtyError::InvalidArgs(format!(
                "{arg} not allowed for {}",
                std::path::Path::new(shell)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(shell)
            )));
        }
    }

    Ok(())
}

/// Gets the current working directory of a process by PID.
/// On Windows, falls back to `USERPROFILE` if the PEB read fails — this keeps
/// the UI (breadcrumb) functional even when we can't read the true cwd. For
/// callers that need to distinguish "real cwd" from "fallback", use
/// `get_process_cwd_strict` instead.
fn get_process_cwd(_pid: u32) -> Result<String, PtyError> {
    let result = get_process_cwd_strict(_pid);
    #[cfg(windows)]
    {
        if result.is_err() {
            return std::env::var("USERPROFILE").map_err(|_| {
                PtyError::WriteFailed("Could not determine CWD on Windows".to_string())
            });
        }
    }
    result
}

/// Gets the current working directory of a process by PID — strict variant.
/// Returns Err if the real cwd can't be determined (no fallback). Callers
/// that record the value for later use (e.g. per-line cwd registry) should
/// prefer this over `get_process_cwd` so stale/fallback values don't pollute
/// history.
fn get_process_cwd_strict(_pid: u32) -> Result<String, PtyError> {
    #[cfg(target_os = "linux")]
    {
        let link = format!("/proc/{}/cwd", _pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| {
                PtyError::WriteFailed(format!("Failed to read CWD for PID {}: {}", _pid, e))
            })
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, use lsof to find the CWD (-a = AND the filters)
        let output = std::process::Command::new("lsof")
            .args(["-a", "-p", &_pid.to_string(), "-d", "cwd", "-Fn"])
            .output()
            .map_err(|e| PtyError::WriteFailed(format!("lsof failed: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        // lsof output: "p<pid>\nfcwd\nn<path>\n"
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix('n') {
                if path.starts_with('/') {
                    return Ok(path.to_string());
                }
            }
        }
        Err(PtyError::WriteFailed(format!(
            "Could not determine CWD for PID {}",
            _pid
        )))
    }

    #[cfg(windows)]
    {
        use std::ffi::c_void;
        use std::mem;
        use std::ptr;

        // Win32 FFI declarations for reading remote process CWD
        type HANDLE = *mut c_void;
        type NTSTATUS = i32;
        type HMODULE = *mut c_void;

        const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
        const PROCESS_VM_READ: u32 = 0x0010;

        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> HANDLE;
            fn CloseHandle(h: HANDLE) -> i32;
            fn ReadProcessMemory(proc: HANDLE, base: *const c_void, buf: *mut c_void, size: usize, read: *mut usize) -> i32;
            fn LoadLibraryA(name: *const u8) -> HMODULE;
            fn GetProcAddress(module: HMODULE, name: *const u8) -> *const c_void;
        }

        type NtQueryFn = unsafe extern "system" fn(HANDLE, u32, *mut c_void, u32, *mut u32) -> NTSTATUS;

        #[allow(non_snake_case)]
        #[repr(C)]
        struct PROCESS_BASIC_INFORMATION {
            _r1: usize, PebBaseAddress: usize, _r2: [usize; 2], _r3: usize, _r4: usize,
        }

        #[allow(non_snake_case)]
        #[repr(C)]
        struct UNICODE_STRING {
            Length: u16, MaximumLength: u16, _pad: u32, Buffer: u64,
        }

        // Find the child shell PID (conpty spawns conhost → shell)
        // Use CreateToolhelp32Snapshot to avoid slow wmic/powershell
        extern "system" {
            fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> HANDLE;
        }

        #[repr(C)]
        struct PROCESSENTRY32W {
            dw_size: u32,
            _cnt_usage: u32,
            th32_process_id: u32,
            _r1: usize,
            _r2: usize,
            cnt_threads: u32,
            th32_parent_process_id: u32,
            _pri_class_base: i32,
            _flags: u32,
            _sz_exe_file: [u16; 260],
        }

        extern "system" {
            fn Process32FirstW(snap: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
            fn Process32NextW(snap: HANDLE, entry: *mut PROCESSENTRY32W) -> i32;
        }

        let target_pid = {
            let snap = unsafe { CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0) };
            let mut child_pid = _pid;
            if !snap.is_null() && snap as isize != -1 {
                let mut entry: PROCESSENTRY32W = unsafe { mem::zeroed() };
                entry.dw_size = mem::size_of::<PROCESSENTRY32W>() as u32;
                if unsafe { Process32FirstW(snap, &mut entry) } != 0 {
                    loop {
                        if entry.th32_parent_process_id == _pid {
                            child_pid = entry.th32_process_id;
                            break;
                        }
                        if unsafe { Process32NextW(snap, &mut entry) } == 0 { break; }
                    }
                }
                unsafe { CloseHandle(snap); }
            }
            child_pid
        };

        let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, target_pid) };
        if handle.is_null() {
            return Err(PtyError::WriteFailed("Could not open process".to_string()));
        }

        let result = (|| -> Result<String, PtyError> {
            let ntdll = unsafe { LoadLibraryA(b"ntdll.dll\0".as_ptr()) };
            if ntdll.is_null() { return Err(PtyError::WriteFailed("no ntdll".into())); }
            let func = unsafe { GetProcAddress(ntdll, b"NtQueryInformationProcess\0".as_ptr()) };
            if func.is_null() { return Err(PtyError::WriteFailed("no NtQIP".into())); }
            let nt_query: NtQueryFn = unsafe { mem::transmute(func) };

            let mut pbi: PROCESS_BASIC_INFORMATION = unsafe { mem::zeroed() };
            let st = unsafe { nt_query(handle, 0, &mut pbi as *mut _ as *mut c_void, mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32, ptr::null_mut()) };
            if st != 0 || pbi.PebBaseAddress == 0 { return Err(PtyError::WriteFailed("NtQIP failed".into())); }

            // Read ProcessParameters pointer from PEB (offset 0x20 on x64)
            let params_ptr_addr = pbi.PebBaseAddress + 0x20;
            let mut params_ptr: u64 = 0;
            let mut br: usize = 0;
            if unsafe { ReadProcessMemory(handle, params_ptr_addr as *const c_void, &mut params_ptr as *mut _ as *mut c_void, 8, &mut br) } == 0 {
                return Err(PtyError::WriteFailed("read PEB failed".into()));
            }

            // CurrentDirectory.DosPath is a UNICODE_STRING at offset 0x38 in RTL_USER_PROCESS_PARAMETERS
            let cwd_ustr_addr = params_ptr + 0x38;
            let mut ustr: UNICODE_STRING = unsafe { mem::zeroed() };
            if unsafe { ReadProcessMemory(handle, cwd_ustr_addr as *const c_void, &mut ustr as *mut _ as *mut c_void, mem::size_of::<UNICODE_STRING>(), &mut br) } == 0 {
                return Err(PtyError::WriteFailed("read UNICODE_STRING failed".into()));
            }

            let char_count = ustr.Length as usize / 2;
            if char_count == 0 || ustr.Buffer == 0 { return Err(PtyError::WriteFailed("empty CWD".into())); }
            let mut buf: Vec<u16> = vec![0u16; char_count];
            if unsafe { ReadProcessMemory(handle, ustr.Buffer as *const c_void, buf.as_mut_ptr() as *mut c_void, char_count * 2, &mut br) } == 0 {
                return Err(PtyError::WriteFailed("read CWD string failed".into()));
            }

            let cwd = String::from_utf16_lossy(&buf).trim_end_matches('\\').to_string();
            Ok(cwd)
        })();

        unsafe { CloseHandle(handle); }

        match result {
            Ok(cwd) if !cwd.is_empty() && std::path::Path::new(&cwd).exists() => Ok(cwd),
            Ok(_) => Err(PtyError::WriteFailed("PEB returned empty or non-existent CWD".into())),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // Session ID validation tests
    // ====================================================================

    #[test]
    fn validate_session_id_accepts_valid_uuid() {
        let uuid = Uuid::new_v4().to_string();
        assert!(validate_session_id(&uuid).is_ok());
    }

    #[test]
    fn validate_session_id_rejects_empty_string() {
        let result = validate_session_id("");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidSessionId(id) => assert_eq!(id, ""),
            other => panic!("Expected InvalidSessionId, got: {other:?}"),
        }
    }

    #[test]
    fn validate_session_id_rejects_random_string() {
        let result = validate_session_id("not-a-uuid");
        assert!(result.is_err());
    }

    #[test]
    fn validate_session_id_rejects_partial_uuid() {
        let result = validate_session_id("550e8400-e29b-41d4");
        assert!(result.is_err());
    }

    // ====================================================================
    // Shell validation tests — [SECURITY]
    // ====================================================================

    #[cfg(unix)]
    #[test]
    fn validate_shell_accepts_bin_bash() {
        assert!(validate_shell("/bin/bash").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_accepts_bin_zsh() {
        assert!(validate_shell("/bin/zsh").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_accepts_bin_sh() {
        assert!(validate_shell("/bin/sh").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_accepts_usr_local_bin_fish() {
        assert!(validate_shell("/usr/local/bin/fish").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_rejects_arbitrary_path() {
        let result = validate_shell("/usr/bin/evil");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidShell(path) => assert_eq!(path, "/usr/bin/evil"),
            other => panic!("Expected InvalidShell, got: {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_rejects_relative_path() {
        assert!(validate_shell("bash").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_shell_rejects_path_traversal() {
        assert!(validate_shell("/bin/../usr/bin/python").is_err());
    }

    // ====================================================================
    // Environment variable validation tests — [SECURITY]
    // ====================================================================

    #[test]
    fn validate_env_allows_term() {
        let mut vars = HashMap::new();
        vars.insert("TERM".into(), "xterm-256color".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_allows_lang() {
        let mut vars = HashMap::new();
        vars.insert("LANG".into(), "en_US.UTF-8".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_allows_lc_prefix() {
        let mut vars = HashMap::new();
        vars.insert("LC_ALL".into(), "C".into());
        vars.insert("LC_CTYPE".into(), "UTF-8".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_allows_putz_prefix() {
        let mut vars = HashMap::new();
        vars.insert("PUTZ_THEME".into(), "dark".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_allows_colorterm() {
        let mut vars = HashMap::new();
        vars.insert("COLORTERM".into(), "truecolor".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_allows_editor() {
        let mut vars = HashMap::new();
        vars.insert("EDITOR".into(), "vim".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_rejects_ld_preload() {
        let mut vars = HashMap::new();
        vars.insert("LD_PRELOAD".into(), "/tmp/evil.so".into());
        let result = validate_env_vars(&vars);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidEnvironment(var) => assert_eq!(var, "LD_PRELOAD"),
            other => panic!("Expected InvalidEnvironment, got: {other:?}"),
        }
    }

    #[test]
    fn validate_env_rejects_path() {
        let mut vars = HashMap::new();
        vars.insert("PATH".into(), "/tmp/evil".into());
        assert!(validate_env_vars(&vars).is_err());
    }

    #[test]
    fn validate_env_rejects_home() {
        let mut vars = HashMap::new();
        vars.insert("HOME".into(), "/tmp".into());
        assert!(validate_env_vars(&vars).is_err());
    }

    #[test]
    fn validate_env_rejects_dyld_insert_libraries() {
        let mut vars = HashMap::new();
        vars.insert("DYLD_INSERT_LIBRARIES".into(), "/tmp/evil.dylib".into());
        assert!(validate_env_vars(&vars).is_err());
    }

    #[test]
    fn validate_env_is_case_insensitive() {
        let mut vars = HashMap::new();
        vars.insert("term".into(), "xterm".into());
        assert!(validate_env_vars(&vars).is_ok());
    }

    #[test]
    fn validate_env_empty_is_ok() {
        let vars = HashMap::new();
        assert!(validate_env_vars(&vars).is_ok());
    }

    // ====================================================================
    // Working directory validation tests — [SECURITY]
    // ====================================================================

    #[test]
    fn validate_cwd_accepts_existing_dir() {
        // /tmp always exists on Unix
        #[cfg(unix)]
        assert!(validate_working_directory("/tmp").is_ok());
        #[cfg(windows)]
        assert!(validate_working_directory("C:\\").is_ok());
    }

    #[test]
    fn validate_cwd_rejects_nonexistent_dir() {
        let result = validate_working_directory("/definitely/nonexistent/path/xyz123");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidWorkingDirectory(_) => {}
            other => panic!("Expected InvalidWorkingDirectory, got: {other:?}"),
        }
    }

    #[test]
    fn validate_cwd_rejects_file_as_dir() {
        // /etc/hosts is a file, not a directory
        #[cfg(unix)]
        {
            if std::path::Path::new("/etc/hosts").exists() {
                let result = validate_working_directory("/etc/hosts");
                assert!(result.is_err());
                match result.unwrap_err() {
                    PtyError::InvalidWorkingDirectory(_) => {}
                    other => {
                        panic!("Expected InvalidWorkingDirectory, got: {other:?}")
                    }
                }
            }
        }
    }

    // ====================================================================
    // Session limit test
    // ====================================================================

    #[test]
    fn session_limit_constant_is_64() {
        assert_eq!(MAX_SESSIONS, 64);
    }

    // ====================================================================
    // Manager tests
    // ====================================================================

    #[test]
    fn default_shell_returns_non_empty() {
        let shell = default_shell();
        assert!(!shell.is_empty());
    }

    #[test]
    fn pty_manager_new_creates_empty() {
        let manager = PtyManager::new();
        let sessions = manager.sessions.lock().unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn write_to_nonexistent_session_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.write(&uuid, b"hello");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn resize_nonexistent_session_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.resize(&uuid, 80, 24);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn close_nonexistent_session_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.close(&uuid);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn write_with_invalid_session_id_returns_invalid() {
        let manager = PtyManager::new();
        let result = manager.write("bad-id", b"hello");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidSessionId(id) => assert_eq!(id, "bad-id"),
            other => panic!("Expected InvalidSessionId, got: {other:?}"),
        }
    }

    #[test]
    fn resize_with_invalid_session_id_returns_invalid() {
        let manager = PtyManager::new();
        let result = manager.resize("bad-id", 80, 24);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidSessionId(id) => assert_eq!(id, "bad-id"),
            other => panic!("Expected InvalidSessionId, got: {other:?}"),
        }
    }

    #[test]
    fn close_with_invalid_session_id_returns_invalid() {
        let manager = PtyManager::new();
        let result = manager.close("bad-id");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidSessionId(id) => assert_eq!(id, "bad-id"),
            other => panic!("Expected InvalidSessionId, got: {other:?}"),
        }
    }

    // ====================================================================
    // Edge case tests — [EDGE] [SECURITY]
    // ====================================================================

    #[test]
    fn validate_session_id_rejects_path_traversal() {
        let result = validate_session_id("../../etc/passwd");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidSessionId(_) => {}
            other => panic!("Expected InvalidSessionId, got: {other:?}"),
        }
    }

    #[test]
    fn validate_session_id_rejects_newline_injection() {
        let result = validate_session_id("valid-uuid\npty-output-other");
        assert!(result.is_err());
    }

    #[test]
    fn validate_session_id_rejects_null_bytes() {
        let result = validate_session_id("550e8400\0-e29b-41d4-a716-446655440000");
        assert!(result.is_err());
    }

    #[test]
    fn validate_session_id_rejects_sql_injection() {
        let result = validate_session_id("'; DROP TABLE sessions; --");
        assert!(result.is_err());
    }

    #[test]
    fn write_empty_data_to_nonexistent_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.write(&uuid, b"");
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn resize_zero_dimensions_to_nonexistent_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.resize(&uuid, 0, 0);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn resize_max_dimensions_to_nonexistent_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let result = manager.resize(&uuid, u16::MAX, u16::MAX);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn double_close_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let first = manager.close(&uuid);
        assert!(first.is_err());
        let second = manager.close(&uuid);
        assert!(second.is_err());
        match second.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn close_then_write_returns_not_found() {
        let manager = PtyManager::new();
        let uuid = Uuid::new_v4().to_string();
        let _ = manager.close(&uuid);
        let write_result = manager.write(&uuid, b"hello");
        assert!(write_result.is_err());
        match write_result.unwrap_err() {
            PtyError::NotFound(id) => assert_eq!(id, uuid),
            other => panic!("Expected NotFound, got: {other:?}"),
        }
    }

    #[test]
    fn multiple_managers_are_independent() {
        let manager1 = PtyManager::new();
        let manager2 = PtyManager::new();
        let sessions1 = manager1.sessions.lock().unwrap();
        let sessions2 = manager2.sessions.lock().unwrap();
        assert!(sessions1.is_empty());
        assert!(sessions2.is_empty());
        assert!(!std::sync::Arc::ptr_eq(
            &manager1.sessions,
            &manager2.sessions
        ));
    }

    #[test]
    fn validate_session_id_rejects_very_long_string() {
        let long_id = "a".repeat(10_000);
        let result = validate_session_id(&long_id);
        assert!(result.is_err());
    }

    #[test]
    fn default_shell_returns_valid_path() {
        let shell = default_shell();
        assert!(!shell.is_empty());
        #[cfg(unix)]
        {
            assert!(
                shell.starts_with('/') || shell == "sh" || shell == "bash" || shell == "zsh",
                "Unexpected shell path: {shell}"
            );
        }
        #[cfg(windows)]
        {
            let lower = shell.to_lowercase();
            assert!(
                lower.contains("powershell") || lower.contains("cmd"),
                "Unexpected shell: {shell}"
            );
        }
    }

    // ====================================================================
    // Copilot binary resolution tests — [C1]
    // ====================================================================

    #[test]
    fn is_copilot_shell_recognizes_copilot_variants() {
        assert!(is_copilot_shell("copilot"));
        assert!(is_copilot_shell("copilot.exe"));
        assert!(is_copilot_shell("copilot.cmd"));
        assert!(is_copilot_shell("copilot.bat"));
        assert!(is_copilot_shell("COPILOT.EXE"));
        assert!(is_copilot_shell("COPILOT.CMD"));
    }

    #[test]
    fn is_copilot_shell_rejects_non_copilot() {
        assert!(!is_copilot_shell("bash"));
        assert!(!is_copilot_shell("powershell.exe"));
        assert!(!is_copilot_shell("cmd.exe"));
        assert!(!is_copilot_shell("copilot-helper.exe"));
    }

    #[test]
    fn is_copilot_shell_with_full_path() {
        #[cfg(windows)]
        assert!(is_copilot_shell(r"C:\Users\someone\AppData\Local\npm\copilot.cmd"));
        #[cfg(unix)]
        assert!(is_copilot_shell("/usr/local/bin/copilot"));
    }

    #[test]
    fn resolve_copilot_binary_returns_error_with_empty_path() {
        // Temporarily override PATH to empty to test failure
        let orig = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", "");
        let result = resolve_copilot_binary();
        std::env::set_var("PATH", &orig);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidShell(msg) => {
                assert!(msg.contains("not found"), "Expected 'not found' in: {msg}");
            }
            other => panic!("Expected InvalidShell, got: {other:?}"),
        }
    }

    // ====================================================================
    // Shell classification tests
    // ====================================================================

    #[test]
    fn classify_shell_copilot() {
        assert!(matches!(classify_shell("copilot"), ShellCategory::Copilot));
        assert!(matches!(classify_shell("copilot.exe"), ShellCategory::Copilot));
        assert!(matches!(classify_shell("copilot.cmd"), ShellCategory::Copilot));
    }

    #[test]
    fn classify_shell_powershell() {
        assert!(matches!(classify_shell("powershell.exe"), ShellCategory::PowerShell));
        assert!(matches!(classify_shell("pwsh.exe"), ShellCategory::PowerShell));
        assert!(matches!(classify_shell("pwsh"), ShellCategory::PowerShell));
    }

    #[test]
    fn classify_shell_bash() {
        assert!(matches!(classify_shell("bash"), ShellCategory::Bash));
        assert!(matches!(classify_shell("bash.exe"), ShellCategory::Bash));
        assert!(matches!(classify_shell("zsh"), ShellCategory::Bash));
        assert!(matches!(classify_shell("sh"), ShellCategory::Bash));
        assert!(matches!(classify_shell("fish"), ShellCategory::Bash));
    }

    #[test]
    fn classify_shell_other() {
        assert!(matches!(classify_shell("cmd.exe"), ShellCategory::Other));
        assert!(matches!(classify_shell("nu.exe"), ShellCategory::Other));
    }

    // ====================================================================
    // Argument validation tests — [H1] [SECURITY]
    // ====================================================================

    #[test]
    fn validate_args_copilot_allows_yolo() {
        assert!(validate_args("copilot", &["--yolo".into()]).is_ok());
    }

    #[test]
    fn validate_args_copilot_allows_experimental() {
        assert!(validate_args("copilot", &["--experimental".into()]).is_ok());
    }

    #[test]
    fn validate_args_copilot_allows_debug() {
        assert!(validate_args("copilot", &["--debug".into()]).is_ok());
    }

    #[test]
    fn validate_args_copilot_rejects_unknown() {
        let result = validate_args("copilot", &["--evil".into()]);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidArgs(msg) => assert!(msg.contains("--evil")),
            other => panic!("Expected InvalidArgs, got: {other:?}"),
        }
    }

    #[test]
    fn validate_args_copilot_rejects_encoded_command() {
        let result = validate_args("copilot.exe", &["-EncodedCommand".into(), "base64data".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_powershell_allows_noprofile() {
        assert!(validate_args("powershell.exe", &["-NoProfile".into()]).is_ok());
    }

    #[test]
    fn validate_args_powershell_allows_nologo() {
        assert!(validate_args("powershell.exe", &["-NoLogo".into()]).is_ok());
    }

    #[test]
    fn validate_args_powershell_rejects_encoded_command() {
        let result = validate_args("powershell.exe", &["-EncodedCommand".into(), "YQBiAGMA".into()]);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidArgs(msg) => {
                assert!(msg.contains("denied"), "Expected 'denied' in: {msg}");
            }
            other => panic!("Expected InvalidArgs, got: {other:?}"),
        }
    }

    #[test]
    fn validate_args_powershell_rejects_encoded_command_case_insensitive() {
        let result = validate_args("powershell.exe", &["-encodedcommand".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_powershell_rejects_e_shorthand() {
        assert!(validate_args("powershell.exe", &["-e".into()]).is_err());
        assert!(validate_args("powershell.exe", &["-ec".into()]).is_err());
    }

    #[test]
    fn validate_args_pwsh_rejects_encoded_command() {
        let result = validate_args("pwsh.exe", &["-EncodedCommand".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_bash_allows_c() {
        assert!(validate_args("bash", &["-c".into()]).is_ok());
    }

    #[test]
    fn validate_args_bash_allows_interactive() {
        assert!(validate_args("bash", &["-i".into()]).is_ok());
    }

    #[test]
    fn validate_args_bash_allows_login() {
        assert!(validate_args("bash", &["-l".into()]).is_ok());
    }

    #[test]
    fn validate_args_bash_rejects_unknown() {
        let result = validate_args("bash", &["--evil".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_other_shell_rejects_any_args() {
        let result = validate_args("cmd.exe", &["/c".into()]);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidArgs(msg) => {
                assert!(msg.contains("not allowed"), "Expected 'not allowed' in: {msg}");
            }
            other => panic!("Expected InvalidArgs, got: {other:?}"),
        }
    }

    #[test]
    fn validate_args_other_shell_allows_empty() {
        assert!(validate_args("cmd.exe", &[]).is_ok());
    }

    #[test]
    fn validate_args_rejects_nul_bytes() {
        let result = validate_args("copilot", &["--yolo\0evil".into()]);
        assert!(result.is_err());
        match result.unwrap_err() {
            PtyError::InvalidArgs(msg) => {
                assert!(msg.contains("NUL"), "Expected 'NUL' in: {msg}");
            }
            other => panic!("Expected InvalidArgs, got: {other:?}"),
        }
    }

    #[test]
    fn validate_args_rejects_newlines() {
        let result = validate_args("bash", &["-c\nrm -rf /".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_rejects_carriage_return() {
        let result = validate_args("copilot", &["--yolo\revil".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn validate_args_empty_is_ok() {
        assert!(validate_args("copilot", &[]).is_ok());
        assert!(validate_args("powershell.exe", &[]).is_ok());
        assert!(validate_args("bash", &[]).is_ok());
    }

    #[test]
    fn validate_args_multiple_valid() {
        assert!(validate_args("copilot", &["--yolo".into(), "--experimental".into()]).is_ok());
    }

    #[test]
    fn validate_args_mixed_valid_invalid() {
        let result = validate_args("copilot", &["--yolo".into(), "--evil".into()]);
        assert!(result.is_err());
    }

    // L3: Full-path copilot shell with arg validation
    #[cfg(windows)]
    #[test]
    fn validate_args_copilot_full_path_allows_yolo() {
        assert!(validate_args(r"C:\npm\copilot.cmd", &["--yolo".into()]).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn validate_args_copilot_full_path_rejects_unknown() {
        let result = validate_args(r"C:\npm\copilot.cmd", &["--malicious".into()]);
        assert!(result.is_err());
    }
}
