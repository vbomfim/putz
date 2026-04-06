/// PTY session manager — spawns, manages, and cleans up PTY sessions.
///
/// Each terminal tab gets its own `PtySession` identified by a UUID v4.
/// The manager uses OS threads (not tokio tasks) for the blocking read
/// loop, since `portable-pty` uses synchronous `std::io::Read`.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::error::PtyError;

/// Output buffer size for reading from the PTY.
const READ_BUFFER_SIZE: usize = 4096;

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
    pub fn spawn(
        &self,
        app: &AppHandle,
        shell: Option<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        env: Option<HashMap<String, String>>,
    ) -> Result<String, PtyError> {
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

        let shell_path = shell.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&shell_path);

        // Set working directory if provided
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // Set environment variables if provided
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
    fn start_reader_thread(
        &self,
        app: AppHandle,
        session_id: String,
        mut reader: Box<dyn Read + Send>,
    ) {
        let sessions = self.sessions.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; READ_BUFFER_SIZE];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child process exited
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let event_name = format!("pty-output-{session_id}");
                        let _ = app.emit(&event_name, data);
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
