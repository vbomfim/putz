//! Standalone PTY spawn-time measurement harness.
//!
//! Measures the time from PTY spawn initiation to first byte received
//! from the shell. Runs N iterations (default 20) and outputs structured
//! JSON with per-sample data and aggregate statistics.
//!
//! Usage:
//!   cargo run --bin measure_spawn [-- --samples N --shell /bin/zsh]
//!
//! Output (stdout): JSON with platform info, samples, and stats.
//! Errors go to stderr so JSON output stays clean.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::time::Instant;

/// Default number of measurement samples.
const DEFAULT_SAMPLES: usize = 20;

/// Read buffer size — matches the main app's reader.
const READ_BUFFER_SIZE: usize = 4096;

/// Timeout for waiting for first byte (seconds).
const FIRST_BYTE_TIMEOUT_SECS: u64 = 10;

/// Single spawn timing measurement.
#[derive(Clone)]
struct SpawnSample {
    /// Time from spawn start to command spawned (ms).
    spawn_to_ready_ms: f64,
    /// Time from spawn start to first byte read (ms).
    spawn_to_first_byte_ms: f64,
}

/// Aggregate statistics over N samples.
struct Stats {
    min: f64,
    max: f64,
    p50: f64,
    p95: f64,
    p99: f64,
    mean: f64,
    stddev: f64,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = p / 100.0 * (sorted.len() as f64 - 1.0);
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    if lower == upper || upper >= sorted.len() {
        sorted[lower.min(sorted.len() - 1)]
    } else {
        let frac = rank - lower as f64;
        sorted[lower] * (1.0 - frac) + sorted[upper] * frac
    }
}

fn compute_stats(values: &[f64]) -> Stats {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
    let stddev = variance.sqrt();

    Stats {
        min: sorted[0],
        max: *sorted.last().unwrap(),
        p50: percentile(&sorted, 50.0),
        p95: percentile(&sorted, 95.0),
        p99: percentile(&sorted, 99.0),
        mean,
        stddev,
    }
}

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

fn measure_single_spawn(shell: &str, login_shell: bool) -> Result<SpawnSample, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    let t_spawn_start = Instant::now();

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(shell);

    // Note: we intentionally skip -l (login shell) for measurement by default.
    // The main app uses -l so shell profiles are sourced (PATH, nvm, etc.),
    // but that adds user-specific profile startup time to the measurement.
    // The metric we target is core PTY spawn overhead, not user shell config.
    // To measure login-shell startup: use --login flag.
    if login_shell {
        #[cfg(unix)]
        cmd.arg("-l");
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn_command failed: {e}"))?;

    let t_pty_ready = Instant::now();

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;

    // Take the writer to properly split the master (matches main app behavior)
    let _writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    // Wait for first byte with a timeout using a channel
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUFFER_SIZE];
        let result = reader.read(&mut buf);
        let _ = tx.send(result);
    });

    let timeout = std::time::Duration::from_secs(FIRST_BYTE_TIMEOUT_SECS);
    let first_byte_result = rx
        .recv_timeout(timeout)
        .map_err(|_| "timeout waiting for first byte".to_string())?;

    let t_first_read = Instant::now();

    // Check if we got data
    match first_byte_result {
        Ok(n) if n > 0 => { /* success — got first byte */ }
        Ok(_) => return Err("PTY returned EOF before first byte".to_string()),
        Err(e) => return Err(format!("read error: {e}")),
    }

    // Clean up: kill the child process
    let _ = child.kill();
    let _ = child.wait();

    let spawn_to_ready_ms = t_pty_ready.duration_since(t_spawn_start).as_secs_f64() * 1000.0;
    let spawn_to_first_byte_ms = t_first_read.duration_since(t_spawn_start).as_secs_f64() * 1000.0;

    Ok(SpawnSample {
        spawn_to_ready_ms,
        spawn_to_first_byte_ms,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut samples_count = DEFAULT_SAMPLES;
    let mut shell = default_shell();
    let mut login_shell = false;

    // Simple arg parsing (no external deps)
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--samples" | "-n" => {
                i += 1;
                if i < args.len() {
                    samples_count = args[i].parse().unwrap_or_else(|_| {
                        eprintln!("Invalid sample count: {}", args[i]);
                        std::process::exit(1);
                    });
                }
            }
            "--shell" | "-s" => {
                i += 1;
                if i < args.len() {
                    shell = args[i].clone();
                }
            }
            "--login" | "-l" => {
                login_shell = true;
            }
            "--help" | "-h" => {
                eprintln!("Usage: measure_spawn [--samples N] [--shell /path/to/shell] [--login]");
                eprintln!("  --samples, -n  Number of spawn cycles (default: 20)");
                eprintln!("  --shell, -s    Shell to spawn (default: $SHELL or /bin/sh)");
                eprintln!("  --login, -l    Spawn as login shell (-l flag, matches main app)");
                std::process::exit(0);
            }
            other => {
                eprintln!("Unknown argument: {other}");
                std::process::exit(1);
            }
        }
        i += 1;
    }

    eprintln!(
        "Measuring PTY spawn time: shell={shell}, samples={samples_count}, login={login_shell}"
    );

    let mut samples: Vec<SpawnSample> = Vec::with_capacity(samples_count);
    let mut errors = 0;

    for i in 0..samples_count {
        eprint!("  [{}/{}] ", i + 1, samples_count);
        match measure_single_spawn(&shell, login_shell) {
            Ok(sample) => {
                eprintln!(
                    "spawn_to_first_byte={:.2}ms (pty_ready={:.2}ms)",
                    sample.spawn_to_first_byte_ms, sample.spawn_to_ready_ms
                );
                samples.push(sample);
            }
            Err(e) => {
                eprintln!("ERROR: {e}");
                errors += 1;
            }
        }
    }

    if samples.is_empty() {
        eprintln!("No successful samples collected!");
        std::process::exit(1);
    }

    let first_byte_values: Vec<f64> = samples.iter().map(|s| s.spawn_to_first_byte_ms).collect();
    let ready_values: Vec<f64> = samples.iter().map(|s| s.spawn_to_ready_ms).collect();

    let fb_stats = compute_stats(&first_byte_values);
    let ready_stats = compute_stats(&ready_values);

    // Gather platform info
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "unknown"
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "unknown"
    };

    // Get shell version
    let shell_version = get_shell_version(&shell);

    // Get OS version
    let os_version = get_os_version();

    let now = chrono::Utc::now().to_rfc3339();

    // Build JSON output
    let samples_json: Vec<serde_json::Value> = samples
        .iter()
        .map(|s| {
            serde_json::json!({
                "spawnToReadyMs": round2(s.spawn_to_ready_ms),
                "spawnToFirstByteMs": round2(s.spawn_to_first_byte_ms),
            })
        })
        .collect();

    let output = serde_json::json!({
        "platform": platform,
        "arch": arch,
        "osVersion": os_version,
        "shell": shell,
        "shellVersion": shell_version,
        "loginShell": login_shell,
        "putzVersion": "0.4.0",
        "capturedAt": now,
        "sampleCount": samples.len(),
        "errors": errors,
        "samples": samples_json,
        "stats": {
            "spawnToFirstByte": {
                "min": round2(fb_stats.min),
                "p50": round2(fb_stats.p50),
                "p95": round2(fb_stats.p95),
                "p99": round2(fb_stats.p99),
                "max": round2(fb_stats.max),
                "mean": round2(fb_stats.mean),
                "stddev": round2(fb_stats.stddev),
            },
            "spawnToReady": {
                "min": round2(ready_stats.min),
                "p50": round2(ready_stats.p50),
                "p95": round2(ready_stats.p95),
                "p99": round2(ready_stats.p99),
                "max": round2(ready_stats.max),
                "mean": round2(ready_stats.mean),
                "stddev": round2(ready_stats.stddev),
            },
        },
    });

    // Pretty-print JSON to stdout
    println!("{}", serde_json::to_string_pretty(&output).unwrap());

    if errors > 0 {
        eprintln!("\n{errors} sample(s) failed — see errors above.");
    }

    eprintln!("\nSummary (spawn-to-first-byte):");
    eprintln!(
        "  min={:.2}ms p50={:.2}ms p95={:.2}ms p99={:.2}ms max={:.2}ms stddev={:.2}ms",
        fb_stats.min, fb_stats.p50, fb_stats.p95, fb_stats.p99, fb_stats.max, fb_stats.stddev
    );
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn get_shell_version(shell: &str) -> String {
    std::process::Command::new(shell)
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let combined = if stdout.trim().is_empty() {
                stderr.to_string()
            } else {
                stdout.to_string()
            };
            combined.lines().next().map(|l| l.trim().to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn get_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| {
                        l.trim_start_matches("PRETTY_NAME=")
                            .trim_matches('"')
                            .to_string()
                    })
            })
            .unwrap_or_else(|| "unknown".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "ver"])
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_single_value() {
        assert_eq!(percentile(&[42.0], 50.0), 42.0);
        assert_eq!(percentile(&[42.0], 99.0), 42.0);
    }

    #[test]
    fn percentile_two_values() {
        let sorted = vec![10.0, 20.0];
        assert_eq!(percentile(&sorted, 0.0), 10.0);
        assert_eq!(percentile(&sorted, 50.0), 15.0);
        assert_eq!(percentile(&sorted, 100.0), 20.0);
    }

    #[test]
    fn percentile_ten_values() {
        let sorted: Vec<f64> = (1..=10).map(|v| v as f64).collect();
        let p50 = percentile(&sorted, 50.0);
        assert!((p50 - 5.5).abs() < 0.01);
    }

    #[test]
    fn percentile_empty_returns_zero() {
        assert_eq!(percentile(&[], 50.0), 0.0);
    }

    #[test]
    fn compute_stats_basic() {
        let values = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let stats = compute_stats(&values);
        assert_eq!(stats.min, 10.0);
        assert_eq!(stats.max, 50.0);
        assert_eq!(stats.mean, 30.0);
        assert_eq!(stats.p50, 30.0);
        assert!(stats.stddev > 0.0);
    }

    #[test]
    fn compute_stats_identical_values() {
        let values = vec![42.0, 42.0, 42.0];
        let stats = compute_stats(&values);
        assert_eq!(stats.min, 42.0);
        assert_eq!(stats.max, 42.0);
        assert_eq!(stats.mean, 42.0);
        assert_eq!(stats.stddev, 0.0);
        assert_eq!(stats.p50, 42.0);
        assert_eq!(stats.p95, 42.0);
    }

    #[test]
    fn round2_precision() {
        assert_eq!(round2(3.14659), 3.15);
        assert_eq!(round2(0.0), 0.0);
        assert_eq!(round2(100.005), 100.01);
    }

    #[test]
    fn default_shell_returns_non_empty() {
        let shell = default_shell();
        assert!(!shell.is_empty());
    }

    #[test]
    fn measure_single_spawn_succeeds() {
        let shell = default_shell();
        let result = measure_single_spawn(&shell, false);
        assert!(result.is_ok(), "spawn failed: {:?}", result.err());

        let sample = result.unwrap();
        assert!(sample.spawn_to_ready_ms > 0.0);
        assert!(sample.spawn_to_first_byte_ms > 0.0);
        assert!(sample.spawn_to_first_byte_ms >= sample.spawn_to_ready_ms);
    }

    #[test]
    fn measure_single_spawn_invalid_shell_fails() {
        let result = measure_single_spawn("/nonexistent/shell", false);
        assert!(result.is_err());
    }
}
