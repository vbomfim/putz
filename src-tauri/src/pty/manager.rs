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
const ALLOWED_SHELLS_WINDOWS: &[&str] = &["powershell.exe", "pwsh.exe", "cmd.exe"];

/// Allowed environment variable name patterns.
/// Only these prefixes/exact names may be passed to the PTY.
const ALLOWED_ENV_NAMES: &[&str] = &[
    "TERM", "LANG", "COLORTERM", "EDITOR", "VISUAL", "PAGER", "TZ",
];
const ALLOWED_ENV_PREFIXES: &[&str] = &["LC_", "PUTZ_"];

/// Holds the resources for a single PTY session.
struct PtySession {
    /// Writer handle for sending input to the PTY.
    writer: Box<dyn Write + Send>,
    /// Master side of the PTY (needed for resize).
    master: Box<dyn MasterPty + Send>,
    /// Child process handle (needed for wait/kill).
    #[allow(dead_code)]
    child: Box<dyn Child + Send + Sync>,
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
    pub fn spawn(
        &self,
        app: &AppHandle,
        shell: Option<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        env: Option<HashMap<String, String>>,
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
            Some(path) => {
                validate_shell(&path)?;
                path
            }
            None => default_shell(),
        };

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

        let session = PtySession {
            writer,
            master: pair.master,
            child,
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
        self.start_reader_thread(app.clone(), session_id.clone(), reader);

        Ok(session_id)
    }

    /// Writes input bytes to a PTY session.
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), PtyError> {
        validate_session_id(session_id)?;

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| PtyError::NotFound(session_id.to_string()))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

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

    /// Starts an OS thread that reads PTY output and emits Tauri events.
    ///
    /// Uses `std::thread::spawn` instead of `tokio::spawn` because
    /// `portable-pty` uses synchronous `std::io::Read`. A tokio task
    /// would block the async runtime.
    ///
    /// Output bytes are base64-encoded before emission to avoid the
    /// overhead of serializing Vec<u8> as a JSON array of numbers.
    fn start_reader_thread(
        &self,
        app: AppHandle,
        session_id: String,
        mut reader: Box<dyn Read + Send>,
    ) {
        let sessions = self.sessions.clone();
        let b64_engine = base64::engine::general_purpose::STANDARD;

        std::thread::spawn(move || {
            let mut buf = [0u8; READ_BUFFER_SIZE];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child process exited
                    Ok(n) => {
                        let encoded = b64_engine.encode(&buf[..n]);
                        let event_name = format!("pty-output-{session_id}");
                        let _ = app.emit(&event_name, encoded);
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
    Uuid::parse_str(session_id)
        .map_err(|_| PtyError::InvalidSessionId(session_id.to_string()))?;
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
        let result =
            validate_working_directory("/definitely/nonexistent/path/xyz123");
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
}
