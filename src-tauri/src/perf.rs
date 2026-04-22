//! Lightweight performance tracing that survives Windows release builds.
//!
//! Release builds detach from the console (`windows_subsystem = "windows"`)
//! so `eprintln!` is invisible. This module appends timestamped lines to
//! `<temp>/putz-perf.log` which can be tailed while the app runs.
//!
//! Zero allocation on the hot path when the file handle is cached; we
//! lazily open on the first call and reuse a Mutex<File> thereafter.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: OnceLock<Mutex<File>> = OnceLock::new();
static ENABLED: OnceLock<bool> = OnceLock::new();

fn log_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push("putz-perf.log");
    p
}

/// Perf logging is opt-in. Enable by setting `PUTZ_PERF=1` (or any non-empty,
/// non-`0`/`false` value) in the environment before launching putz.
pub fn is_enabled() -> bool {
    *ENABLED.get_or_init(|| match std::env::var("PUTZ_PERF") {
        Ok(v) => {
            let v = v.trim();
            !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false")
        }
        Err(_) => false,
    })
}

fn handle() -> Option<&'static Mutex<File>> {
    if !is_enabled() {
        return None;
    }
    Some(LOG.get_or_init(|| {
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path())
            .expect("open putz-perf.log");
        Mutex::new(f)
    }))
}

/// Append a perf log line. No-op unless `PUTZ_PERF` is set.
pub fn log(line: &str) {
    if !is_enabled() {
        return;
    }
    if let Some(mu) = handle() {
        if let Ok(mut f) = mu.lock() {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let _ = writeln!(f, "{ts} {line}");
            let _ = f.flush();
        }
    }
}

/// Returns the absolute path of the perf log for diagnostics.
pub fn path_string() -> String {
    log_path().to_string_lossy().to_string()
}
