/// JavaScript scripting engine — sandboxed `boa_engine` runtime with Putz API.
///
/// Executes user scripts in a sandboxed JavaScript environment with only
/// the `putz` API available. Uses channels for async communication with
/// the Tauri runtime instead of nested `block_on` calls.
///
/// Architecture:
/// - Script runs in `tokio::task::spawn_blocking` (boa is synchronous)
/// - Async operations (send/waitFor) use `std::sync::mpsc` channels
///   to communicate with an async handler task on the tokio runtime
/// - Output capture uses polling with short intervals
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use boa_engine::property::Attribute;
use boa_engine::{Context, JsNativeError, JsResult, JsValue, NativeFunction, Source};
use regex::Regex;

use super::error::ScriptError;
use super::models::{LogLevel, ScriptLogEntry};

/// Maximum output buffer size (1 MB). Older output is trimmed with overlap.
const MAX_BUFFER_SIZE: usize = 1_048_576;

/// Overlap size when trimming the buffer (8 KB).
const OVERLAP_SIZE: usize = 8192;

/// Default timeout for `waitFor` (30 seconds).
const DEFAULT_WAIT_TIMEOUT_MS: u64 = 30_000;

/// Poll interval for `waitFor`.
const WAIT_POLL_INTERVAL_MS: u64 = 50;

/// Commands sent from the boa thread to the async handler.
#[derive(Debug)]
pub enum ScriptCommand {
    /// Send data to the session.
    Send {
        session_id: String,
        data: String,
        result_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
    /// Disconnect the session.
    Disconnect {
        session_id: String,
        result_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
    /// Retrieve a vault credential by name.
    VaultGet {
        credential_name: String,
        result_tx: std::sync::mpsc::SyncSender<Result<Option<String>, String>>,
    },
    /// Log a message to the script output panel.
    Log { entry: ScriptLogEntry },
}

/// Sliding window output buffer that caps memory usage.
#[derive(Debug)]
pub struct OutputBuffer {
    data: String,
}

impl OutputBuffer {
    pub fn new() -> Self {
        Self { data: String::new() }
    }

    pub fn append(&mut self, new_data: &str) {
        self.data.push_str(new_data);
        if self.data.len() > MAX_BUFFER_SIZE {
            let keep_from = self.data.len().saturating_sub(MAX_BUFFER_SIZE - OVERLAP_SIZE);
            let safe_from = self.data.ceil_char_boundary(keep_from);
            self.data = self.data[safe_from..].to_string();
        }
    }

    pub fn search(&self, pattern: &str, is_regex: bool) -> Option<String> {
        if is_regex {
            Regex::new(pattern)
                .ok()
                .and_then(|re| re.find(&self.data).map(|m| m.as_str().to_string()))
        } else if self.data.contains(pattern) {
            Some(pattern.to_string())
        } else {
            None
        }
    }

    pub fn last_lines(&self, n: usize) -> String {
        let lines: Vec<&str> = self.data.lines().collect();
        let start = lines.len().saturating_sub(n);
        lines[start..].join("\n")
    }

    pub fn content(&self) -> &str {
        &self.data
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }
}

/// Shared context for a script execution.
pub struct ScriptContext {
    pub session_id: String,
    pub output_buffer: Arc<Mutex<OutputBuffer>>,
    pub output_notify: Arc<tokio::sync::Notify>,
    pub command_tx: std::sync::mpsc::SyncSender<ScriptCommand>,
    pub cancelled: Arc<AtomicBool>,
    pub log_entries: Arc<Mutex<Vec<ScriptLogEntry>>>,
}

impl ScriptContext {
    fn check_cancelled(&self) -> Result<(), ScriptError> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err(ScriptError::ScriptStopped("Script execution was stopped".into()))
        } else {
            Ok(())
        }
    }

    fn add_log(&self, level: LogLevel, message: String) {
        let entry = ScriptLogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: level.clone(),
            message,
        };
        if let Ok(mut logs) = self.log_entries.lock() {
            logs.push(entry.clone());
        }
        let _ = self.command_tx.send(ScriptCommand::Log { entry });
    }
}

/// Helper to create a JsNativeError with a message.
fn js_error(msg: impl Into<String>) -> boa_engine::JsError {
    let s: String = msg.into();
    JsNativeError::error().with_message(s).into()
}

/// Executes a JavaScript script in a sandboxed boa_engine context.
pub fn execute_script(script: &str, ctx: Arc<ScriptContext>) -> Result<(), ScriptError> {
    ctx.check_cancelled()?;
    ctx.add_log(LogLevel::Info, "Script execution started".into());

    let mut context = Context::default();

    remove_dangerous_globals(&mut context);
    register_putz_api(&mut context, ctx.clone())
        .map_err(|e| ScriptError::EngineError(e.to_string()))?;

    let wrapped = format!("'use strict';\n{script}");
    let result = context.eval(Source::from_bytes(wrapped.as_bytes()));

    match result {
        Ok(_) => {
            ctx.add_log(LogLevel::Info, "Script completed successfully".into());
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            if ctx.cancelled.load(Ordering::SeqCst) || msg.contains("Script execution was stopped")
            {
                ctx.add_log(LogLevel::Warn, "Script was stopped by user".into());
                Err(ScriptError::ScriptStopped(msg))
            } else {
                ctx.add_log(LogLevel::Error, format!("Script error: {msg}"));
                Err(ScriptError::EngineError(msg))
            }
        }
    }
}

fn remove_dangerous_globals(context: &mut Context) {
    let global = context.global_object();
    let _ = global.delete_property_or_throw(boa_engine::js_string!("Function"), context);
    let _ = global.delete_property_or_throw(boa_engine::js_string!("eval"), context);
}

fn looks_like_regex(pattern: &str) -> bool {
    pattern.contains('\\')
        || pattern.contains('[')
        || pattern.contains('(')
        || pattern.contains('*')
        || pattern.contains('+')
        || pattern.contains('?')
        || pattern.contains('{')
        || pattern.contains('^')
        || pattern.contains('$')
        || pattern.contains('|')
}

fn register_putz_api(context: &mut Context, ctx: Arc<ScriptContext>) -> JsResult<()> {
    let putz_obj = boa_engine::object::ObjectInitializer::new(context).build();

    // ── putz.send(text) ────────────────────────────────────────
    {
        let ctx = ctx.clone();
        // SAFETY: The closure captures an Arc which is Send+Sync and safe to share.
        let send_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                if ctx.cancelled.load(Ordering::SeqCst) {
                    return Err(js_error("Script execution was stopped"));
                }
                let text = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();

                let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
                ctx.command_tx
                    .send(ScriptCommand::Send {
                        session_id: ctx.session_id.clone(),
                        data: text.clone(),
                        result_tx,
                    })
                    .map_err(|e| js_error(format!("Failed to send command: {e}")))?;

                match result_rx.recv() {
                    Ok(Ok(())) => {
                        ctx.add_log(LogLevel::Info, format!("Sent: {text}"));
                        Ok(JsValue::undefined())
                    }
                    Ok(Err(e)) => Err(js_error(e)),
                    Err(e) => Err(js_error(format!("Channel error: {e}"))),
                }
            })
        };
        putz_obj.set(
            boa_engine::js_string!("send"),
            send_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.waitFor(pattern, timeoutMs?) ──────────────────────
    {
        let ctx = ctx.clone();
        let wait_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                if ctx.cancelled.load(Ordering::SeqCst) {
                    return Err(js_error("Script execution was stopped"));
                }
                let pattern = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();

                let timeout_ms = if let Some(v) = args.get(1) {
                    v.to_number(context)? as u64
                } else {
                    DEFAULT_WAIT_TIMEOUT_MS
                };

                ctx.add_log(
                    LogLevel::Info,
                    format!("Waiting for pattern: '{}' (timeout: {}ms)", pattern, timeout_ms),
                );

                if let Ok(mut buf) = ctx.output_buffer.lock() {
                    buf.clear();
                }

                let deadline = Instant::now() + Duration::from_millis(timeout_ms);
                let is_regex = looks_like_regex(&pattern);

                loop {
                    if ctx.cancelled.load(Ordering::SeqCst) {
                        return Err(js_error("Script execution was stopped"));
                    }
                    if let Ok(buf) = ctx.output_buffer.lock() {
                        if let Some(matched) = buf.search(&pattern, is_regex) {
                            ctx.add_log(LogLevel::Info, format!("Pattern found: '{matched}'"));
                            return Ok(JsValue::from(boa_engine::js_string!(matched.as_str())));
                        }
                    }
                    if Instant::now() >= deadline {
                        let last_output = ctx
                            .output_buffer
                            .lock()
                            .map(|b| b.last_lines(10))
                            .unwrap_or_default();
                        let msg = format!(
                            "waitFor('{}') timed out after {}ms. Last output:\n{}",
                            pattern, timeout_ms, last_output
                        );
                        ctx.add_log(LogLevel::Error, msg.clone());
                        return Err(js_error(msg));
                    }
                    std::thread::sleep(Duration::from_millis(WAIT_POLL_INTERVAL_MS));
                }
            })
        };
        putz_obj.set(
            boa_engine::js_string!("waitFor"),
            wait_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.sendAndCapture(text, endPattern, timeoutMs?) ──────
    {
        let ctx = ctx.clone();
        let sac_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                if ctx.cancelled.load(Ordering::SeqCst) {
                    return Err(js_error("Script execution was stopped"));
                }
                let text = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();

                let end_pattern = args
                    .get(1)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();

                let timeout_ms = if let Some(v) = args.get(2) {
                    v.to_number(context)? as u64
                } else {
                    DEFAULT_WAIT_TIMEOUT_MS
                };

                if let Ok(mut buf) = ctx.output_buffer.lock() {
                    buf.clear();
                }

                let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
                ctx.command_tx
                    .send(ScriptCommand::Send {
                        session_id: ctx.session_id.clone(),
                        data: text.clone(),
                        result_tx,
                    })
                    .map_err(|e| js_error(format!("Failed to send command: {e}")))?;

                match result_rx.recv() {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => return Err(js_error(e)),
                    Err(e) => return Err(js_error(format!("Channel error: {e}"))),
                }

                ctx.add_log(
                    LogLevel::Info,
                    format!("Sent: {text}, capturing until: {end_pattern}"),
                );

                let deadline = Instant::now() + Duration::from_millis(timeout_ms);
                let is_regex = looks_like_regex(&end_pattern);

                loop {
                    if ctx.cancelled.load(Ordering::SeqCst) {
                        return Err(js_error("Script execution was stopped"));
                    }
                    if let Ok(buf) = ctx.output_buffer.lock() {
                        if buf.search(&end_pattern, is_regex).is_some() {
                            let captured = buf.content().to_string();
                            ctx.add_log(
                                LogLevel::Output,
                                format!("Captured {} bytes", captured.len()),
                            );
                            return Ok(JsValue::from(boa_engine::js_string!(captured.as_str())));
                        }
                    }
                    if Instant::now() >= deadline {
                        let last_output = ctx
                            .output_buffer
                            .lock()
                            .map(|b| b.last_lines(10))
                            .unwrap_or_default();
                        let msg = format!(
                            "sendAndCapture timed out after {}ms. Last output:\n{}",
                            timeout_ms, last_output
                        );
                        ctx.add_log(LogLevel::Error, msg.clone());
                        return Err(js_error(msg));
                    }
                    std::thread::sleep(Duration::from_millis(WAIT_POLL_INTERVAL_MS));
                }
            })
        };
        putz_obj.set(
            boa_engine::js_string!("sendAndCapture"),
            sac_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.sleep(ms) ─────────────────────────────────────────
    {
        let ctx = ctx.clone();
        let sleep_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                if ctx.cancelled.load(Ordering::SeqCst) {
                    return Err(js_error("Script execution was stopped"));
                }
                let ms = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_number(context)? as u64;

                let ms = ms.min(300_000);
                ctx.add_log(LogLevel::Info, format!("Sleeping for {ms}ms"));

                let deadline = Instant::now() + Duration::from_millis(ms);
                while Instant::now() < deadline {
                    if ctx.cancelled.load(Ordering::SeqCst) {
                        return Err(js_error("Script execution was stopped"));
                    }
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    std::thread::sleep(remaining.min(Duration::from_millis(100)));
                }
                Ok(JsValue::undefined())
            })
        };
        putz_obj.set(
            boa_engine::js_string!("sleep"),
            sleep_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.log(message) ──────────────────────────────────────
    {
        let ctx = ctx.clone();
        let log_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                let msg = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();
                ctx.add_log(LogLevel::Info, msg);
                Ok(JsValue::undefined())
            })
        };
        putz_obj.set(
            boa_engine::js_string!("log"),
            log_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.disconnect() ──────────────────────────────────────
    {
        let ctx = ctx.clone();
        let dc_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _context| {
                let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
                ctx.command_tx
                    .send(ScriptCommand::Disconnect {
                        session_id: ctx.session_id.clone(),
                        result_tx,
                    })
                    .map_err(|e| js_error(format!("Failed to send disconnect: {e}")))?;

                match result_rx.recv() {
                    Ok(Ok(())) => {
                        ctx.add_log(LogLevel::Info, "Disconnected".into());
                        Ok(JsValue::undefined())
                    }
                    Ok(Err(e)) => Err(js_error(e)),
                    Err(e) => Err(js_error(format!("Channel error: {e}"))),
                }
            })
        };
        putz_obj.set(
            boa_engine::js_string!("disconnect"),
            dc_fn.to_js_function(context.realm()),
            false,
            context,
        )?;
    }

    // ── putz.vault (sub-object) ────────────────────────────────
    {
        let vault_obj = boa_engine::object::ObjectInitializer::new(context).build();

        let ctx_vault = ctx.clone();
        let vault_get_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, context| {
                if ctx_vault.cancelled.load(Ordering::SeqCst) {
                    return Err(js_error("Script execution was stopped"));
                }
                let name = args
                    .get(0)
                    .cloned()
                    .unwrap_or(JsValue::undefined())
                    .to_string(context)?
                    .to_std_string_escaped();

                let (result_tx, result_rx) = std::sync::mpsc::sync_channel(1);
                ctx_vault
                    .command_tx
                    .send(ScriptCommand::VaultGet {
                        credential_name: name,
                        result_tx,
                    })
                    .map_err(|e| js_error(format!("Failed to send vault command: {e}")))?;

                match result_rx.recv() {
                    Ok(Ok(Some(secret))) => {
                        Ok(JsValue::from(boa_engine::js_string!(secret.as_str())))
                    }
                    Ok(Ok(None)) => Ok(JsValue::null()),
                    Ok(Err(e)) => Err(js_error(e)),
                    Err(e) => Err(js_error(format!("Channel error: {e}"))),
                }
            })
        };

        vault_obj.set(
            boa_engine::js_string!("get"),
            vault_get_fn.to_js_function(context.realm()),
            false,
            context,
        )?;

        putz_obj.set(
            boa_engine::js_string!("vault"),
            vault_obj,
            false,
            context,
        )?;
    }

    // ── Register putz as read-only global ──────────────────────
    context.register_global_property(
        boa_engine::js_string!("putz"),
        putz_obj,
        Attribute::READONLY | Attribute::NON_ENUMERABLE | Attribute::PERMANENT,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_append_and_search_literal() {
        let mut buf = OutputBuffer::new();
        buf.append("Hello world\nRouter>");
        assert_eq!(buf.search("Router>", false), Some("Router>".to_string()));
    }

    #[test]
    fn buffer_search_not_found() {
        let mut buf = OutputBuffer::new();
        buf.append("Hello world");
        assert_eq!(buf.search("Router>", false), None);
    }

    #[test]
    fn buffer_search_regex() {
        let mut buf = OutputBuffer::new();
        buf.append("Interface GigabitEthernet0/0 is up");
        assert!(buf.search(r"Interface \S+ is (up|down)", true).is_some());
    }

    #[test]
    fn buffer_search_regex_not_found() {
        let mut buf = OutputBuffer::new();
        buf.append("Interface is unknown");
        assert!(buf.search(r"Interface \S+ is (up|down)", true).is_none());
    }

    #[test]
    fn buffer_trims_when_exceeding_max() {
        let mut buf = OutputBuffer::new();
        let chunk = "x".repeat(100_000);
        for _ in 0..15 {
            buf.append(&chunk);
        }
        assert!(buf.len() <= MAX_BUFFER_SIZE);
    }

    #[test]
    fn buffer_preserves_recent_data_after_trim() {
        let mut buf = OutputBuffer::new();
        let filler = "x".repeat(MAX_BUFFER_SIZE);
        buf.append(&filler);
        buf.append("FINDME");
        assert!(buf.search("FINDME", false).is_some());
    }

    #[test]
    fn buffer_last_lines() {
        let mut buf = OutputBuffer::new();
        buf.append("line1\nline2\nline3\nline4\nline5\n");
        let last3 = buf.last_lines(3);
        assert!(last3.contains("line3"));
        assert!(last3.contains("line4"));
        assert!(last3.contains("line5"));
    }

    #[test]
    fn buffer_last_lines_fewer_than_requested() {
        let mut buf = OutputBuffer::new();
        buf.append("only one line");
        let last10 = buf.last_lines(10);
        assert_eq!(last10, "only one line");
    }

    #[test]
    fn buffer_clear() {
        let mut buf = OutputBuffer::new();
        buf.append("some data");
        buf.clear();
        assert_eq!(buf.len(), 0);
        assert_eq!(buf.content(), "");
    }

    #[test]
    fn sandbox_removes_function_constructor() {
        let mut context = Context::default();
        remove_dangerous_globals(&mut context);
        let result = context.eval(Source::from_bytes(b"typeof Function"));
        match result {
            Ok(val) => {
                let s = val.to_string(&mut context).unwrap().to_std_string_escaped();
                assert_eq!(s, "undefined");
            }
            Err(_) => {}
        }
    }

    #[test]
    fn sandbox_removes_eval() {
        let mut context = Context::default();
        remove_dangerous_globals(&mut context);
        let result = context.eval(Source::from_bytes(b"typeof eval"));
        match result {
            Ok(val) => {
                let s = val.to_string(&mut context).unwrap().to_std_string_escaped();
                assert_eq!(s, "undefined");
            }
            Err(_) => {}
        }
    }

    #[test]
    fn script_context_check_cancelled_ok() {
        let (tx, _rx) = std::sync::mpsc::sync_channel(10);
        let ctx = ScriptContext {
            session_id: "test".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        };
        assert!(ctx.check_cancelled().is_ok());
    }

    #[test]
    fn script_context_check_cancelled_err() {
        let (tx, _rx) = std::sync::mpsc::sync_channel(10);
        let ctx = ScriptContext {
            session_id: "test".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(true)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        };
        assert!(ctx.check_cancelled().is_err());
    }

    #[test]
    fn script_context_add_log() {
        let (tx, _rx) = std::sync::mpsc::sync_channel(10);
        let ctx = ScriptContext {
            session_id: "test".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        };
        ctx.add_log(LogLevel::Info, "test message".into());
        let logs = ctx.log_entries.lock().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].message, "test message");
        assert_eq!(logs[0].level, LogLevel::Info);
    }

    #[test]
    fn execute_simple_log_script() {
        let (tx, rx) = std::sync::mpsc::sync_channel(100);
        let ctx = Arc::new(ScriptContext {
            session_id: "test-session".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        });
        let _drain = std::thread::spawn(move || {
            while rx.recv().is_ok() {}
        });
        let result = execute_script("putz.log('Hello from script');", ctx.clone());
        assert!(result.is_ok());
        let logs = ctx.log_entries.lock().unwrap();
        assert!(logs.iter().any(|l| l.message == "Hello from script"));
    }

    #[test]
    fn execute_script_syntax_error() {
        let (tx, rx) = std::sync::mpsc::sync_channel(100);
        let ctx = Arc::new(ScriptContext {
            session_id: "test-session".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        });
        let _drain = std::thread::spawn(move || {
            while rx.recv().is_ok() {}
        });
        let result = execute_script("this is not valid javascript {{{", ctx);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ScriptError::EngineError(_)));
    }

    #[test]
    fn execute_cancelled_script() {
        let (tx, _rx) = std::sync::mpsc::sync_channel(100);
        let ctx = Arc::new(ScriptContext {
            session_id: "test-session".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(true)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        });
        let result = execute_script("putz.log('hello');", ctx);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ScriptError::ScriptStopped(_)));
    }

    #[test]
    fn execute_script_with_send_command() {
        let (tx, rx) = std::sync::mpsc::sync_channel(100);
        let ctx = Arc::new(ScriptContext {
            session_id: "test-session".into(),
            output_buffer: Arc::new(Mutex::new(OutputBuffer::new())),
            output_notify: Arc::new(tokio::sync::Notify::new()),
            command_tx: tx,
            cancelled: Arc::new(AtomicBool::new(false)),
            log_entries: Arc::new(Mutex::new(Vec::new())),
        });
        let handler = std::thread::spawn(move || {
            while let Ok(cmd) = rx.recv_timeout(Duration::from_secs(5)) {
                match cmd {
                    ScriptCommand::Send { result_tx, .. } => {
                        let _ = result_tx.send(Ok(()));
                    }
                    ScriptCommand::Log { .. } => {}
                    _ => {}
                }
            }
        });
        let result = execute_script("putz.send('show version');", ctx);
        assert!(result.is_ok());
        let _ = handler.join();
    }
}
