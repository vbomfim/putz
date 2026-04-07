/// IPC commands for session logging operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// to control logging. Each command delegates to `LogManager`.
use tauri::State;

use crate::logging::{LogConfig, LogManager, LogStatus};

/// Starts logging for a terminal session.
///
/// Creates a log file and begins capturing terminal output.
/// Returns the path to the log file on success.
///
/// Security: The log directory is always set server-side to the default
/// `~/putz-logs/`. Frontend-supplied directory values are ignored to
/// prevent arbitrary file writes via a compromised webview.
#[tauri::command]
pub fn logging_start(
    state: State<'_, LogManager>,
    session_id: String,
    mut config: LogConfig,
) -> Result<String, String> {
    // SECURITY: Always override directory to prevent arbitrary file write.
    // A compromised webview could pass any path — we force the safe default.
    config.directory = crate::logging::config::default_log_directory();
    state
        .start_logging(&session_id, config)
        .map_err(|e| e.to_string())
}

/// Stops logging for a terminal session.
///
/// Flushes remaining data and closes the log file.
#[tauri::command]
pub fn logging_stop(
    state: State<'_, LogManager>,
    session_id: String,
) -> Result<(), String> {
    state
        .stop_logging(&session_id)
        .map_err(|e| e.to_string())
}

/// Returns the logging status for a terminal session.
#[tauri::command]
pub fn logging_status(
    state: State<'_, LogManager>,
    session_id: String,
) -> LogStatus {
    state.get_status(&session_id)
}

#[cfg(test)]
mod tests {
    use crate::logging::LogError;

    #[test]
    fn log_error_to_string_format() {
        let err = LogError::NotFound("abc-123".into());
        let msg = err.to_string();
        assert!(msg.contains("abc-123"));
        assert!(msg.contains("No active logger"));
    }
}
