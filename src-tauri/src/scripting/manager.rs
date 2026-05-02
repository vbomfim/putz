/// Script manager — CRUD for scripts + execution lifecycle.
///
/// Manages saved scripts on disk, runs scripts in sandboxed boa contexts,
/// tracks active runners, and handles script recording.
///
/// Storage layout:
/// ```text
/// ~/.config/putz/scripts/
/// ├── scripts-index.json      # Metadata index
/// ├── backup-config.js        # Script files
/// ├── login-router.js
/// └── ...
/// ```
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use super::engine::{self, OutputBuffer, ScriptCommand, ScriptContext};
use super::error::ScriptError;
use super::models::*;
use super::recorder::ScriptRecorder;
use super::validation;

/// Index filename for script metadata.
const INDEX_FILENAME: &str = "scripts-index.json";

/// Active script runner handle.
struct RunnerHandle {
    /// Cancellation flag.
    cancelled: Arc<AtomicBool>,
    /// Tokio task handle for the async wrapper.
    task: tokio::task::JoinHandle<()>,
    /// Run result (populated when the script finishes).
    result: Arc<TokioMutex<ScriptRunResult>>,
}

/// Script manager — owns the script library and execution state.
///
/// Registered as Tauri managed state via `.manage(ScriptManager::new())`.
pub struct ScriptManager {
    /// On-disk script metadata (behind std Mutex for sync access).
    store: Mutex<ScriptStore>,
    /// Active script runners (behind tokio Mutex for async access).
    runners: Arc<TokioMutex<HashMap<String, RunnerHandle>>>,
    /// Active script recorders (behind std Mutex).
    recorders: Mutex<HashMap<String, ScriptRecorder>>,
    /// Directory for script files.
    config_dir: PathBuf,
}

impl ScriptManager {
    /// Creates a new manager, loading scripts from the default config dir.
    pub fn new() -> Self {
        let config_dir = default_scripts_directory();
        let store = Self::load_store(&config_dir);
        Self {
            store: Mutex::new(store),
            runners: Arc::new(TokioMutex::new(HashMap::new())),
            recorders: Mutex::new(HashMap::new()),
            config_dir,
        }
    }

    /// Creates a manager with a custom config directory (for testing).
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let store = Self::load_store(&config_dir);
        Self {
            store: Mutex::new(store),
            runners: Arc::new(TokioMutex::new(HashMap::new())),
            recorders: Mutex::new(HashMap::new()),
            config_dir,
        }
    }

    // ── CRUD operations ────────────────────────────────────────

    /// Lists all saved scripts (metadata only).
    pub fn list(&self) -> Vec<ScriptMeta> {
        self.lock_store()
            .map(|s| s.scripts.clone())
            .unwrap_or_default()
    }

    /// Gets script metadata + content by ID.
    pub fn get(&self, id: &str) -> Result<ScriptWithContent, ScriptError> {
        validation::validate_uuid(id)?;
        let store = self.lock_store()?;
        let meta = store
            .scripts
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| ScriptError::NotFound(id.into()))?
            .clone();
        drop(store);

        let content = self.read_script_file(&meta.filename)?;
        Ok(ScriptWithContent { meta, content })
    }

    /// Saves a script (create or update). Returns the script ID.
    pub fn save(&self, input: SaveScriptInput) -> Result<String, ScriptError> {
        validation::validate_name(&input.name)?;
        validation::validate_content(&input.content)?;

        let mut store = self.lock_store()?;

        let now = chrono::Utc::now().to_rfc3339();
        let is_login = input.is_login_script.unwrap_or(false);

        if let Some(ref id) = input.id {
            // ── Update existing script ─────────────────────────
            validation::validate_uuid(id)?;

            // Check for duplicate name (excluding self)
            if store
                .scripts
                .iter()
                .any(|s| s.id != *id && s.name.to_lowercase() == input.name.trim().to_lowercase())
            {
                return Err(ScriptError::DuplicateName(input.name.clone()));
            }

            let meta = store
                .scripts
                .iter_mut()
                .find(|s| s.id == *id)
                .ok_or_else(|| ScriptError::NotFound(id.clone()))?;

            meta.name = input.name.trim().to_string();
            meta.description = input.description.unwrap_or_default();
            meta.is_login_script = is_login;
            meta.updated_at = now;

            let filename = meta.filename.clone();
            let id = id.clone();
            self.write_script_file(&filename, &input.content)?;
            self.save_store(&store)?;
            Ok(id)
        } else {
            // ── Create new script ──────────────────────────────
            if store.scripts.len() >= validation::MAX_SCRIPTS {
                return Err(ScriptError::LimitExceeded(format!(
                    "Maximum {} scripts reached",
                    validation::MAX_SCRIPTS
                )));
            }

            // Check for duplicate name
            if store
                .scripts
                .iter()
                .any(|s| s.name.to_lowercase() == input.name.trim().to_lowercase())
            {
                return Err(ScriptError::DuplicateName(input.name.clone()));
            }

            let id = Uuid::new_v4().to_string();
            let filename = self.generate_unique_filename(&input.name, &store);

            let meta = ScriptMeta {
                id: id.clone(),
                name: input.name.trim().to_string(),
                description: input.description.unwrap_or_default(),
                filename: filename.clone(),
                is_login_script: is_login,
                created_at: now.clone(),
                updated_at: now,
            };

            self.write_script_file(&filename, &input.content)?;
            store.scripts.push(meta);
            self.save_store(&store)?;
            Ok(id)
        }
    }

    /// Deletes a script by ID.
    pub fn delete(&self, id: &str) -> Result<(), ScriptError> {
        validation::validate_uuid(id)?;
        let mut store = self.lock_store()?;

        let idx = store
            .scripts
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| ScriptError::NotFound(id.into()))?;

        let meta = store.scripts.remove(idx);

        // Delete the script file (best effort)
        let file_path = self.config_dir.join(&meta.filename);
        let _ = fs::remove_file(file_path);

        self.save_store(&store)?;
        Ok(())
    }

    // ── Script execution ───────────────────────────────────────

    /// Starts a script execution. Returns the run ID.
    ///
    /// The script runs asynchronously. Use `get_run_status` to check progress.
    /// The `command_handler` is an async function that processes
    /// `ScriptCommand`s from the boa thread.
    pub async fn run(
        &self,
        input: RunScriptInput,
        command_handler: impl Fn(ScriptCommand) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
            + Send
            + Sync
            + 'static,
        app: tauri::AppHandle,
    ) -> Result<String, ScriptError> {
        validation::validate_uuid(&input.script_id)?;

        // Check concurrent run limit
        {
            let runners = self.runners.lock().await;
            if runners.len() >= validation::MAX_CONCURRENT_RUNS {
                return Err(ScriptError::LimitExceeded(format!(
                    "Maximum {} concurrent scripts reached",
                    validation::MAX_CONCURRENT_RUNS
                )));
            }
        }

        // Load script content
        let script_data = self.get(&input.script_id)?;
        let content = script_data.content;
        let session_id = input.session_id.clone();

        let run_id = Uuid::new_v4().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));

        let result = Arc::new(TokioMutex::new(ScriptRunResult {
            run_id: run_id.clone(),
            script_id: input.script_id.clone(),
            session_id: session_id.clone(),
            status: ScriptStatus::Running,
            output: vec![],
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            error: None,
        }));

        let result_clone = result.clone();
        let cancelled_clone = cancelled.clone();

        // Create channels for script ↔ async communication
        let (cmd_tx, cmd_rx) = std::sync::mpsc::sync_channel::<ScriptCommand>(256);

        // Create output buffer and listener
        let output_buffer = Arc::new(Mutex::new(OutputBuffer::new()));
        let output_notify = Arc::new(tokio::sync::Notify::new());

        // Register output listener BEFORE starting script
        let buffer_clone = output_buffer.clone();
        let notify_clone = output_notify.clone();
        let event_name_pty = format!("pty-output-{}", session_id);
        let event_name_conn = format!("connection-output-{}", session_id);

        let listener_pty = app.clone();
        let listener_conn = app.clone();
        let buffer_pty = buffer_clone.clone();
        let buffer_conn = buffer_clone.clone();
        let notify_pty = notify_clone.clone();
        let notify_conn = notify_clone.clone();

        // Listen for PTY output
        let unlisten_pty = tauri::Listener::listen(&listener_pty, &event_name_pty, move |event| {
            // PTY output is base64-encoded
            let payload = event.payload();
            if let Some(data) = decode_output_payload(payload) {
                if let Ok(mut buf) = buffer_pty.lock() {
                    buf.append(&data);
                }
                notify_pty.notify_one();
            }
        });

        // Listen for connection output
        let unlisten_conn =
            tauri::Listener::listen(&listener_conn, &event_name_conn, move |event| {
                let payload = event.payload();
                if let Some(data) = decode_output_payload(payload) {
                    if let Ok(mut buf) = buffer_conn.lock() {
                        buf.append(&data);
                    }
                    notify_conn.notify_one();
                }
            });

        // Create script context
        let ctx = Arc::new(ScriptContext {
            session_id: session_id.clone(),
            output_buffer,
            output_notify,
            command_tx: cmd_tx,
            cancelled: cancelled_clone.clone(),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        });

        // Spawn async command handler
        let handler_task = tokio::spawn(async move {
            while let Ok(cmd) = tokio::task::block_in_place(|| {
                cmd_rx.recv_timeout(std::time::Duration::from_millis(100))
            }) {
                command_handler(cmd).await;
            }
        });

        // Spawn script execution in blocking thread
        let ctx_clone = ctx.clone();
        let task = tokio::spawn(async move {
            let exec_result =
                tokio::task::spawn_blocking(move || engine::execute_script(&content, ctx_clone))
                    .await;

            // Update result
            let mut res = result_clone.lock().await;
            res.finished_at = Some(chrono::Utc::now().to_rfc3339());

            // Collect logs
            if let Ok(logs) = ctx.log_entries.lock() {
                res.output = logs.clone();
            }

            match exec_result {
                Ok(Ok(())) => {
                    res.status = ScriptStatus::Completed;
                }
                Ok(Err(ScriptError::ScriptStopped(msg))) => {
                    res.status = ScriptStatus::Stopped;
                    res.error = Some(msg);
                }
                Ok(Err(e)) => {
                    res.status = ScriptStatus::Failed;
                    res.error = Some(e.to_string());
                }
                Err(e) => {
                    res.status = ScriptStatus::Failed;
                    res.error = Some(format!("Task panicked: {e}"));
                }
            }

            // Clean up listeners
            tauri::Listener::unlisten(&listener_pty, unlisten_pty);
            tauri::Listener::unlisten(&listener_conn, unlisten_conn);

            // Abort the command handler
            handler_task.abort();

            // Emit completion event
            let _ = tauri::Emitter::emit(
                &app,
                &format!("script-completed-{}", res.run_id),
                serde_json::to_value(&*res).unwrap_or_default(),
            );
        });

        // Store the runner
        {
            let mut runners = self.runners.lock().await;
            runners.insert(
                run_id.clone(),
                RunnerHandle {
                    cancelled,
                    task,
                    result,
                },
            );
        }

        Ok(run_id)
    }

    /// Gets the current status of a running/completed script.
    pub async fn get_run_status(&self, run_id: &str) -> Result<ScriptRunResult, ScriptError> {
        let runners = self.runners.lock().await;
        let handle = runners
            .get(run_id)
            .ok_or_else(|| ScriptError::NotFound(run_id.into()))?;
        let result = handle.result.lock().await;
        Ok(result.clone())
    }

    /// Stops a running script.
    pub async fn stop(&self, run_id: &str) -> Result<(), ScriptError> {
        let runners = self.runners.lock().await;
        let handle = runners
            .get(run_id)
            .ok_or_else(|| ScriptError::NotFound(run_id.into()))?;

        handle.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }

    // ── Recording ──────────────────────────────────────────────

    /// Starts recording keystrokes for a session.
    pub fn record_start(&self, session_id: &str) -> Result<(), ScriptError> {
        let mut recorders = self
            .recorders
            .lock()
            .map_err(|e| ScriptError::LockError(format!("Recorder lock: {e}")))?;

        if recorders.contains_key(session_id) {
            return Err(ScriptError::AlreadyRunning(format!(
                "Already recording session: {session_id}"
            )));
        }

        recorders.insert(session_id.to_string(), ScriptRecorder::new(session_id));
        Ok(())
    }

    /// Records a keystroke for an active recording session.
    pub fn record_keystroke(&self, session_id: &str, data: &str) -> Result<(), ScriptError> {
        let mut recorders = self
            .recorders
            .lock()
            .map_err(|e| ScriptError::LockError(format!("Recorder lock: {e}")))?;

        let recorder = recorders.get_mut(session_id).ok_or_else(|| {
            ScriptError::NotFound(format!("No active recording for session: {session_id}"))
        })?;

        recorder.record_keystroke(data);
        Ok(())
    }

    /// Stops recording and returns the generated script content.
    pub fn record_stop(&self, session_id: &str) -> Result<String, ScriptError> {
        let mut recorders = self
            .recorders
            .lock()
            .map_err(|e| ScriptError::LockError(format!("Recorder lock: {e}")))?;

        let recorder = recorders.remove(session_id).ok_or_else(|| {
            ScriptError::NotFound(format!("No active recording for session: {session_id}"))
        })?;

        Ok(recorder.generate_script())
    }

    // ── Private helpers ────────────────────────────────────────

    fn lock_store(&self) -> Result<std::sync::MutexGuard<'_, ScriptStore>, ScriptError> {
        self.store
            .lock()
            .map_err(|e| ScriptError::LockError(format!("Script store mutex poisoned: {e}")))
    }

    fn load_store(config_dir: &Path) -> ScriptStore {
        let path = config_dir.join(INDEX_FILENAME);
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            ScriptStore::default()
        }
    }

    fn save_store(&self, store: &ScriptStore) -> Result<(), ScriptError> {
        fs::create_dir_all(&self.config_dir)?;
        let json = serde_json::to_string_pretty(store)?;
        let path = self.config_dir.join(INDEX_FILENAME);

        // Atomic write: write to temp file, then rename
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, &json)?;
        fs::rename(&tmp_path, &path)?;

        // Set permissions on Unix (owner read/write only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }

    fn read_script_file(&self, filename: &str) -> Result<String, ScriptError> {
        let path = self.config_dir.join(filename);
        fs::read_to_string(&path).map_err(|e| {
            ScriptError::IoError(format!("Failed to read script file {filename}: {e}"))
        })
    }

    fn write_script_file(&self, filename: &str, content: &str) -> Result<(), ScriptError> {
        fs::create_dir_all(&self.config_dir)?;
        let path = self.config_dir.join(filename);
        fs::write(&path, content)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }

    fn generate_unique_filename(&self, name: &str, store: &ScriptStore) -> String {
        let base = validation::sanitize_filename(name);
        let stem = base.trim_end_matches(".js");

        // Check if filename already exists
        let existing: Vec<&str> = store.scripts.iter().map(|s| s.filename.as_str()).collect();

        if !existing.contains(&base.as_str()) {
            return base;
        }

        // Append a counter
        for i in 2..1000 {
            let candidate = format!("{stem}-{i}.js");
            if !existing.contains(&candidate.as_str()) {
                return candidate;
            }
        }

        format!("{stem}-{}.js", Uuid::new_v4())
    }
}

/// Decodes a Tauri event output payload.
///
/// PTY output is base64-encoded; connection output may be raw or base64.
/// Tries base64 decode first, falls back to raw string.
fn decode_output_payload(payload: &str) -> Option<String> {
    // Strip surrounding quotes if present (JSON string)
    let cleaned = payload.trim_matches('"');
    if cleaned.is_empty() {
        return None;
    }

    // Try base64 decode
    use base64::Engine;
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(cleaned) {
        return Some(String::from_utf8_lossy(&bytes).to_string());
    }

    // Fall back to raw string
    Some(cleaned.to_string())
}

/// Returns the default scripts directory (`~/.config/putz/scripts/`).
fn default_scripts_directory() -> PathBuf {
    directories::ProjectDirs::from("", "", "putz")
        .map(|dirs| dirs.config_dir().join("scripts"))
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
                .join("putz")
                .join("scripts")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manager() -> (ScriptManager, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let manager = ScriptManager::with_config_dir(dir.path().to_path_buf());
        (manager, dir)
    }

    fn sample_input() -> SaveScriptInput {
        SaveScriptInput {
            id: None,
            name: "Test Script".into(),
            description: Some("A test script".into()),
            content: "putz.log('hello');".into(),
            is_login_script: None,
        }
    }

    // ─── CRUD tests ────────────────────────────────────────────

    #[test]
    fn list_empty_store() {
        let (mgr, _dir) = test_manager();
        assert!(mgr.list().is_empty());
    }

    #[test]
    fn save_and_list() {
        let (mgr, _dir) = test_manager();
        let id = mgr.save(sample_input()).unwrap();
        let scripts = mgr.list();
        assert_eq!(scripts.len(), 1);
        assert_eq!(scripts[0].id, id);
        assert_eq!(scripts[0].name, "Test Script");
    }

    #[test]
    fn save_and_get() {
        let (mgr, _dir) = test_manager();
        let id = mgr.save(sample_input()).unwrap();
        let result = mgr.get(&id).unwrap();
        assert_eq!(result.meta.name, "Test Script");
        assert_eq!(result.content, "putz.log('hello');");
    }

    #[test]
    fn save_update_existing() {
        let (mgr, _dir) = test_manager();
        let id = mgr.save(sample_input()).unwrap();

        let update = SaveScriptInput {
            id: Some(id.clone()),
            name: "Updated Script".into(),
            description: Some("Updated".into()),
            content: "putz.log('updated');".into(),
            is_login_script: Some(true),
        };
        let result_id = mgr.save(update).unwrap();
        assert_eq!(result_id, id);

        let result = mgr.get(&id).unwrap();
        assert_eq!(result.meta.name, "Updated Script");
        assert_eq!(result.content, "putz.log('updated');");
        assert!(result.meta.is_login_script);
    }

    #[test]
    fn save_duplicate_name_rejected() {
        let (mgr, _dir) = test_manager();
        mgr.save(sample_input()).unwrap();

        let dup = SaveScriptInput {
            id: None,
            name: "Test Script".into(),
            description: None,
            content: "putz.log('dup');".into(),
            is_login_script: None,
        };
        let err = mgr.save(dup).unwrap_err();
        assert!(matches!(err, ScriptError::DuplicateName(_)));
    }

    #[test]
    fn save_duplicate_name_case_insensitive() {
        let (mgr, _dir) = test_manager();
        mgr.save(sample_input()).unwrap();

        let dup = SaveScriptInput {
            id: None,
            name: "TEST SCRIPT".into(),
            description: None,
            content: "putz.log('dup');".into(),
            is_login_script: None,
        };
        let err = mgr.save(dup).unwrap_err();
        assert!(matches!(err, ScriptError::DuplicateName(_)));
    }

    #[test]
    fn delete_script() {
        let (mgr, _dir) = test_manager();
        let id = mgr.save(sample_input()).unwrap();
        assert_eq!(mgr.list().len(), 1);

        mgr.delete(&id).unwrap();
        assert!(mgr.list().is_empty());
    }

    #[test]
    fn delete_nonexistent_script() {
        let (mgr, _dir) = test_manager();
        let err = mgr
            .delete("550e8400-e29b-41d4-a716-446655440000")
            .unwrap_err();
        assert!(matches!(err, ScriptError::NotFound(_)));
    }

    #[test]
    fn get_nonexistent_script() {
        let (mgr, _dir) = test_manager();
        let err = mgr.get("550e8400-e29b-41d4-a716-446655440000").unwrap_err();
        assert!(matches!(err, ScriptError::NotFound(_)));
    }

    #[test]
    fn save_validates_name() {
        let (mgr, _dir) = test_manager();
        let input = SaveScriptInput {
            id: None,
            name: "".into(),
            description: None,
            content: "putz.log('x');".into(),
            is_login_script: None,
        };
        let err = mgr.save(input).unwrap_err();
        assert!(matches!(err, ScriptError::InvalidInput(_)));
    }

    #[test]
    fn save_validates_content() {
        let (mgr, _dir) = test_manager();
        let input = SaveScriptInput {
            id: None,
            name: "Valid Name".into(),
            description: None,
            content: "".into(),
            is_login_script: None,
        };
        let err = mgr.save(input).unwrap_err();
        assert!(matches!(err, ScriptError::InvalidInput(_)));
    }

    #[test]
    fn persistence_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let id;
        {
            let mgr = ScriptManager::with_config_dir(dir.path().to_path_buf());
            id = mgr.save(sample_input()).unwrap();
        }
        // Reload from same directory
        {
            let mgr = ScriptManager::with_config_dir(dir.path().to_path_buf());
            let scripts = mgr.list();
            assert_eq!(scripts.len(), 1);
            assert_eq!(scripts[0].id, id);
        }
    }

    #[test]
    fn generates_unique_filenames() {
        let (mgr, _dir) = test_manager();

        let id1 = mgr
            .save(SaveScriptInput {
                id: None,
                name: "My Script".into(),
                description: None,
                content: "putz.log('1');".into(),
                is_login_script: None,
            })
            .unwrap();

        // Save another with a different name
        let id2 = mgr
            .save(SaveScriptInput {
                id: None,
                name: "Other Script".into(),
                description: None,
                content: "putz.log('2');".into(),
                is_login_script: None,
            })
            .unwrap();

        let s1 = mgr.get(&id1).unwrap();
        let s2 = mgr.get(&id2).unwrap();
        assert_ne!(s1.meta.filename, s2.meta.filename);
    }

    // ─── Recording tests ───────────────────────────────────────

    #[test]
    fn recording_start_and_stop() {
        let (mgr, _dir) = test_manager();
        mgr.record_start("sess-1").unwrap();
        mgr.record_keystroke("sess-1", "h").unwrap();
        mgr.record_keystroke("sess-1", "i").unwrap();
        mgr.record_keystroke("sess-1", "\r").unwrap();

        let script = mgr.record_stop("sess-1").unwrap();
        assert!(script.contains("putz.send"));
        assert!(script.contains("putz.waitFor"));
    }

    #[test]
    fn recording_duplicate_session_rejected() {
        let (mgr, _dir) = test_manager();
        mgr.record_start("sess-1").unwrap();
        let err = mgr.record_start("sess-1").unwrap_err();
        assert!(matches!(err, ScriptError::AlreadyRunning(_)));
    }

    #[test]
    fn recording_keystroke_no_session() {
        let (mgr, _dir) = test_manager();
        let err = mgr.record_keystroke("sess-1", "x").unwrap_err();
        assert!(matches!(err, ScriptError::NotFound(_)));
    }

    #[test]
    fn recording_stop_no_session() {
        let (mgr, _dir) = test_manager();
        let err = mgr.record_stop("sess-1").unwrap_err();
        assert!(matches!(err, ScriptError::NotFound(_)));
    }

    // ─── decode_output_payload tests ───────────────────────────

    #[test]
    fn decode_base64_payload() {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode("Hello, world!");
        let result = decode_output_payload(&b64);
        assert_eq!(result, Some("Hello, world!".to_string()));
    }

    #[test]
    fn decode_quoted_payload() {
        let result = decode_output_payload("\"some raw text\"");
        // After stripping quotes, "some raw text" is not valid base64,
        // so it falls back to raw
        assert!(result.is_some());
    }

    #[test]
    fn decode_empty_payload() {
        assert_eq!(decode_output_payload(""), None);
        assert_eq!(decode_output_payload("\"\""), None);
    }
}
