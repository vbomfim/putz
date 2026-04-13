/// Log manager — coordinates session loggers across PTY sessions.
///
/// Manages the lifecycle of `SessionLogger` instances. Each active
/// logging session is stored in a thread-safe HashMap, accessible
/// from PTY reader threads via cloned Arc references.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::config::{LogConfig, LogStatus};
use super::error::LogError;
use super::session_logger::SessionLogger;

/// Thread-safe registry of active session loggers.
///
/// Registered via Tauri `.manage()` and accessed as `State<LogManager>`
/// in IPC handlers. The inner Arc is cloned and passed to PTY reader
/// threads for concurrent access without holding the outer State borrow.
pub struct LogManager {
    loggers: Arc<Mutex<HashMap<String, Arc<SessionLogger>>>>,
}

impl LogManager {
    /// Creates a new empty log manager.
    pub fn new() -> Self {
        Self {
            loggers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns a clone of the inner Arc for use in reader threads.
    ///
    /// PTY reader threads capture this Arc to check for active loggers
    /// on each read cycle without holding a reference to the LogManager.
    pub fn get_loggers(&self) -> Arc<Mutex<HashMap<String, Arc<SessionLogger>>>> {
        self.loggers.clone()
    }

    /// Starts logging for a session with the given configuration.
    ///
    /// Creates a new log file and registers the logger. Returns an error
    /// if logging is already active for this session.
    pub fn start_logging(&self, session_id: &str, config: LogConfig) -> Result<String, LogError> {
        let mut loggers = self
            .loggers
            .lock()
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;

        if loggers.contains_key(session_id) {
            return Err(LogError::AlreadyActive(session_id.to_string()));
        }

        let logger = SessionLogger::new(config)?;
        let file_path = logger.file_path().to_string_lossy().to_string();
        loggers.insert(session_id.to_string(), Arc::new(logger));

        Ok(file_path)
    }

    /// Stops logging for a session.
    ///
    /// Flushes remaining data and removes the logger. The log file
    /// remains on disk for the user to access.
    pub fn stop_logging(&self, session_id: &str) -> Result<(), LogError> {
        let mut loggers = self
            .loggers
            .lock()
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;

        let logger = loggers
            .remove(session_id)
            .ok_or_else(|| LogError::NotFound(session_id.to_string()))?;

        // Flush before dropping
        logger.flush()?;

        Ok(())
    }

    /// Returns the logging status for a session.
    pub fn get_status(&self, session_id: &str) -> LogStatus {
        let loggers = self.loggers.lock().unwrap_or_else(|e| e.into_inner());

        match loggers.get(session_id) {
            Some(logger) => logger.status(),
            None => LogStatus {
                active: false,
                file_path: None,
                bytes_written: 0,
                rotation_count: 0,
            },
        }
    }

    /// Checks if logging is active for a session.
    #[allow(dead_code)]
    pub fn is_active(&self, session_id: &str) -> bool {
        let loggers = self.loggers.lock().unwrap_or_else(|e| e.into_inner());
        loggers.contains_key(session_id)
    }

    /// Stops logging for all sessions. Called during shutdown.
    pub fn stop_all(&self) {
        let mut loggers = match self.loggers.lock() {
            Ok(l) => l,
            Err(_) => return,
        };

        for (_id, logger) in loggers.drain() {
            let _ = logger.flush();
        }
    }
}

impl Drop for LogManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(dir: &std::path::Path) -> LogConfig {
        LogConfig {
            directory: dir.to_path_buf(),
            session_name: "test".into(),
            timestamps: false,
            strip_ansi: false,
            max_file_size: 100 * 1024 * 1024,
            flush_interval_ms: 0,
        }
    }

    #[test]
    fn start_logging_creates_logger() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        let result = manager.start_logging("session-1", test_config(dir.path()));
        assert!(result.is_ok());
        assert!(manager.is_active("session-1"));
    }

    #[test]
    fn start_logging_returns_file_path() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        let path = manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();
        assert!(path.ends_with(".log"));
        assert!(path.contains("test"));
    }

    #[test]
    fn start_logging_rejects_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();
        let result = manager.start_logging("session-1", test_config(dir.path()));
        assert!(result.is_err());
    }

    #[test]
    fn stop_logging_removes_logger() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();
        assert!(manager.is_active("session-1"));

        manager.stop_logging("session-1").unwrap();
        assert!(!manager.is_active("session-1"));
    }

    #[test]
    fn stop_logging_not_found() {
        let manager = LogManager::new();
        let result = manager.stop_logging("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn get_status_active_session() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();

        let status = manager.get_status("session-1");
        assert!(status.active);
        assert!(status.file_path.is_some());
        assert_eq!(status.bytes_written, 0);
    }

    #[test]
    fn get_status_inactive_session() {
        let manager = LogManager::new();
        let status = manager.get_status("nonexistent");
        assert!(!status.active);
        assert!(status.file_path.is_none());
    }

    #[test]
    fn get_loggers_returns_shared_arc() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();

        let loggers_arc = manager.get_loggers();

        // Simulate what the reader thread does
        let loggers = loggers_arc.lock().unwrap();
        let logger = loggers.get("session-1");
        assert!(logger.is_some());
    }

    #[test]
    fn reader_thread_sees_dynamically_added_loggers() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();

        // Get the Arc BEFORE starting logging
        let loggers_arc = manager.get_loggers();

        // No logger yet
        {
            let loggers = loggers_arc.lock().unwrap();
            assert!(loggers.get("session-1").is_none());
        }

        // Start logging
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();

        // Now the Arc sees the logger
        {
            let loggers = loggers_arc.lock().unwrap();
            assert!(loggers.get("session-1").is_some());
        }
    }

    #[test]
    fn reader_thread_can_write_via_arc() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();
        manager
            .start_logging("session-1", test_config(dir.path()))
            .unwrap();

        let loggers_arc = manager.get_loggers();

        // Simulate reader thread writing
        let logger = {
            let loggers = loggers_arc.lock().unwrap();
            loggers.get("session-1").cloned()
        };

        if let Some(logger) = logger {
            logger.write_data(b"from reader thread\n").unwrap();
            logger.flush().unwrap();

            let status = logger.status();
            assert_eq!(status.bytes_written, 19);
        } else {
            panic!("Logger should exist");
        }
    }

    #[test]
    fn multiple_sessions_independent() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();

        let mut config1 = test_config(dir.path());
        config1.session_name = "session-a".into();
        let mut config2 = test_config(dir.path());
        config2.session_name = "session-b".into();

        manager.start_logging("s1", config1).unwrap();
        manager.start_logging("s2", config2).unwrap();

        assert!(manager.is_active("s1"));
        assert!(manager.is_active("s2"));

        manager.stop_logging("s1").unwrap();
        assert!(!manager.is_active("s1"));
        assert!(manager.is_active("s2"));
    }

    #[test]
    fn stop_all_clears_everything() {
        let dir = tempfile::tempdir().unwrap();
        let manager = LogManager::new();

        let mut config1 = test_config(dir.path());
        config1.session_name = "a".into();
        let mut config2 = test_config(dir.path());
        config2.session_name = "b".into();

        manager.start_logging("s1", config1).unwrap();
        manager.start_logging("s2", config2).unwrap();

        manager.stop_all();
        assert!(!manager.is_active("s1"));
        assert!(!manager.is_active("s2"));
    }
}
