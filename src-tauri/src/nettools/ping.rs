/// Cross-platform ping implementation using system `ping` command.
///
/// Shells out to the OS ping utility (avoids raw ICMP which requires
/// root/admin). Parses stdout line-by-line and emits results as
/// Tauri events for real-time frontend updates.
use std::collections::HashMap;
use std::sync::Mutex;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

/// Request to start a ping session.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    /// List of hostnames or IP addresses to ping.
    pub targets: Vec<String>,
    /// Number of pings per target (default: 4).
    pub count: Option<u32>,
    /// Interval between pings in seconds (default: 1.0).
    pub interval: Option<f64>,
}

/// A single ping result emitted per reply line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    /// The ping session ID.
    pub id: String,
    /// Target host that was pinged.
    pub target: String,
    /// Sequence number of this reply.
    pub seq: u32,
    /// Round-trip time in milliseconds (None if timeout).
    pub rtt_ms: Option<f64>,
    /// Whether this reply timed out.
    pub timed_out: bool,
}

/// Summary statistics emitted when a ping target completes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingSummary {
    /// The ping session ID.
    pub id: String,
    /// Target host.
    pub target: String,
    /// Packets sent.
    pub sent: u32,
    /// Packets received.
    pub received: u32,
    /// Packet loss percentage (0-100).
    pub loss_pct: f64,
    /// Minimum RTT in ms.
    pub min_ms: Option<f64>,
    /// Average RTT in ms.
    pub avg_ms: Option<f64>,
    /// Maximum RTT in ms.
    pub max_ms: Option<f64>,
    /// Whether the ping completed normally.
    pub done: bool,
}

/// Manages running ping sessions and their background tasks.
pub struct PingManager {
    /// Map of session ID → abort handles for running pings.
    tasks: Mutex<HashMap<String, Vec<JoinHandle<()>>>>,
}

impl PingManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Registers task handles for a ping session.
    pub fn register(&self, id: &str, handles: Vec<JoinHandle<()>>) {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.insert(id.to_string(), handles);
    }

    /// Stops a running ping session by aborting all its tasks.
    pub fn stop(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.lock().unwrap();
        match tasks.remove(id) {
            Some(handles) => {
                for h in handles {
                    h.abort();
                }
                Ok(())
            }
            None => Err(format!("No ping session found with id: {id}")),
        }
    }

    /// Removes a completed session from the task map.
    pub fn cleanup(&self, id: &str) {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.remove(id);
    }
}

/// Validates a ping target (hostname or IP address).
///
/// Allows:
/// - IPv4: `192.168.1.1`
/// - IPv6: `::1`, `fe80::1`
/// - Hostname: `router1.example.com`, `switch-01`
///
/// Rejects shell metacharacters to prevent command injection.
pub fn validate_target(target: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("Target cannot be empty".into());
    }
    if target.len() > 253 {
        return Err("Target too long (max 253 characters)".into());
    }

    // Reject shell metacharacters — prevent command injection
    let forbidden = [';', '&', '|', '$', '`', '(', ')', '{', '}', '<', '>', '!', '\\', '"', '\'', '\n', '\r', '\t', ' '];
    for ch in forbidden {
        if target.contains(ch) {
            return Err(format!(
                "Target contains forbidden character: '{ch}'"
            ));
        }
    }

    // Must match hostname or IP pattern
    let hostname_re = Regex::new(
        r"^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$"
    ).unwrap();
    let ipv6_re = Regex::new(
        r"^[0-9a-fA-F:]+$"
    ).unwrap();

    if !hostname_re.is_match(target) && !ipv6_re.is_match(target) {
        return Err(format!(
            "Invalid target: '{target}'. Must be a hostname or IP address."
        ));
    }

    Ok(())
}

/// Validates ping request parameters.
pub fn validate_request(req: &PingRequest) -> Result<(), String> {
    if req.targets.is_empty() {
        return Err("At least one target is required".into());
    }
    if req.targets.len() > 50 {
        return Err("Too many targets (max 50)".into());
    }
    for target in &req.targets {
        validate_target(target)?;
    }
    if let Some(count) = req.count {
        if count == 0 || count > 1000 {
            return Err("Count must be between 1 and 1000".into());
        }
    }
    if let Some(interval) = req.interval {
        if interval < 0.1 || interval > 60.0 {
            return Err("Interval must be between 0.1 and 60 seconds".into());
        }
    }
    Ok(())
}

/// Builds the platform-specific ping command for a single target.
pub fn build_ping_command(target: &str, count: u32, interval: f64) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("ping");

    #[cfg(unix)]
    {
        cmd.arg("-c").arg(count.to_string());
        // macOS uses -i for interval in seconds (float)
        // Linux ping -i also accepts float
        cmd.arg("-i").arg(format!("{interval:.1}"));
    }

    #[cfg(windows)]
    {
        cmd.arg("-n").arg(count.to_string());
        // Windows ping uses -w for timeout in ms, no interval flag
        // We use -w to set timeout per ping
        let timeout_ms = ((interval * 1000.0) as u32).max(1000);
        cmd.arg("-w").arg(timeout_ms.to_string());
    }

    cmd.arg(target);

    // Prevent inheriting stdin, capture stdout/stderr
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    cmd
}

/// Parses a single ping reply line to extract RTT.
///
/// Handles formats:
/// - macOS/Linux: `64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.3 ms`
/// - Windows: `Reply from 8.8.8.8: bytes=32 time=12ms TTL=118`
/// - Timeout: `Request timeout for icmp_seq 1` / `Request timed out.`
pub fn parse_reply_line(line: &str) -> Option<(u32, Option<f64>)> {
    // Check for timeout first
    if line.contains("Request timeout") || line.contains("Request timed out") || line.contains("timed out") {
        // Try to extract seq from timeout line
        let seq_re = Regex::new(r"icmp_seq[= ](\d+)").unwrap();
        let seq = seq_re.captures(line)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<u32>().ok())
            .unwrap_or(0);
        return Some((seq, None));
    }

    // Unix format: time=12.3 ms, icmp_seq=1
    let unix_time_re = Regex::new(r"time[=<](\d+\.?\d*)\s*ms").unwrap();
    let unix_seq_re = Regex::new(r"icmp_seq[= ](\d+)").unwrap();

    if let Some(time_cap) = unix_time_re.captures(line) {
        let rtt: f64 = time_cap.get(1)?.as_str().parse().ok()?;
        let seq = unix_seq_re.captures(line)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<u32>().ok())
            .unwrap_or(0);
        return Some((seq, Some(rtt)));
    }

    // Windows format: Reply from x.x.x.x: bytes=32 time=12ms TTL=118
    let win_time_re = Regex::new(r"time[=<](\d+)\s*ms").unwrap();
    if line.starts_with("Reply from") {
        if let Some(time_cap) = win_time_re.captures(line) {
            let rtt: f64 = time_cap.get(1)?.as_str().parse().ok()?;
            return Some((0, Some(rtt)));
        }
    }

    None
}

/// Parses the ping summary line to extract loss percentage.
///
/// Handles:
/// - Unix: `4 packets transmitted, 4 received, 0% packet loss`
/// - Windows: `Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)`
pub fn parse_summary_line(line: &str) -> Option<(u32, u32, f64)> {
    // Unix format
    let unix_re = Regex::new(
        r"(\d+) packets? transmitted, (\d+) (?:packets? )?received.*?(\d+\.?\d*)% (?:packet )?loss"
    ).unwrap();
    if let Some(caps) = unix_re.captures(line) {
        let sent: u32 = caps.get(1)?.as_str().parse().ok()?;
        let received: u32 = caps.get(2)?.as_str().parse().ok()?;
        let loss: f64 = caps.get(3)?.as_str().parse().ok()?;
        return Some((sent, received, loss));
    }

    // Windows format
    let win_re = Regex::new(
        r"Sent = (\d+), Received = (\d+), Lost = (\d+)"
    ).unwrap();
    if let Some(caps) = win_re.captures(line) {
        let sent: u32 = caps.get(1)?.as_str().parse().ok()?;
        let received: u32 = caps.get(2)?.as_str().parse().ok()?;
        let lost: u32 = caps.get(3)?.as_str().parse().ok()?;
        let loss_pct = if sent > 0 {
            (lost as f64 / sent as f64) * 100.0
        } else {
            0.0
        };
        return Some((sent, received, loss_pct));
    }

    None
}

/// Parses the RTT statistics line.
///
/// Handles:
/// - Unix: `round-trip min/avg/max/stddev = 11.123/12.456/13.789/0.5 ms`
/// - Windows: `Minimum = 11ms, Maximum = 13ms, Average = 12ms`
pub fn parse_rtt_stats_line(line: &str) -> Option<(f64, f64, f64)> {
    // Unix format: min/avg/max/stddev = 1.2/3.4/5.6/0.1 ms
    let unix_re = Regex::new(
        r"=\s*(\d+\.?\d*)/(\d+\.?\d*)/(\d+\.?\d*)"
    ).unwrap();
    if let Some(caps) = unix_re.captures(line) {
        let min: f64 = caps.get(1)?.as_str().parse().ok()?;
        let avg: f64 = caps.get(2)?.as_str().parse().ok()?;
        let max: f64 = caps.get(3)?.as_str().parse().ok()?;
        return Some((min, avg, max));
    }

    // Windows format
    let win_re = Regex::new(
        r"Minimum = (\d+)ms.*Maximum = (\d+)ms.*Average = (\d+)ms"
    ).unwrap();
    if let Some(caps) = win_re.captures(line) {
        let min: f64 = caps.get(1)?.as_str().parse().ok()?;
        let max: f64 = caps.get(2)?.as_str().parse().ok()?;
        let avg: f64 = caps.get(3)?.as_str().parse().ok()?;
        return Some((min, avg, max));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── validate_target ──────────────────────────────────────

    #[test]
    fn validate_target_accepts_ipv4() {
        assert!(validate_target("192.168.1.1").is_ok());
        assert!(validate_target("8.8.8.8").is_ok());
        assert!(validate_target("10.0.0.1").is_ok());
    }

    #[test]
    fn validate_target_accepts_ipv6() {
        assert!(validate_target("::1").is_ok());
        assert!(validate_target("fe80::1").is_ok());
        assert!(validate_target("2001:db8::1").is_ok());
    }

    #[test]
    fn validate_target_accepts_hostname() {
        assert!(validate_target("router1").is_ok());
        assert!(validate_target("switch-01.example.com").is_ok());
        assert!(validate_target("core-rtr.lab.local").is_ok());
    }

    #[test]
    fn validate_target_rejects_empty() {
        assert!(validate_target("").is_err());
    }

    #[test]
    fn validate_target_rejects_shell_metacharacters() {
        assert!(validate_target("host;rm -rf /").is_err());
        assert!(validate_target("host&whoami").is_err());
        assert!(validate_target("host|cat /etc/passwd").is_err());
        assert!(validate_target("$(whoami)").is_err());
        assert!(validate_target("`id`").is_err());
        assert!(validate_target("host name").is_err());
    }

    #[test]
    fn validate_target_rejects_too_long() {
        let long = "a".repeat(254);
        assert!(validate_target(&long).is_err());
    }

    // ─── validate_request ─────────────────────────────────────

    #[test]
    fn validate_request_accepts_valid() {
        let req = PingRequest {
            targets: vec!["8.8.8.8".into()],
            count: Some(4),
            interval: Some(1.0),
        };
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn validate_request_rejects_empty_targets() {
        let req = PingRequest {
            targets: vec![],
            count: None,
            interval: None,
        };
        assert!(validate_request(&req).is_err());
    }

    #[test]
    fn validate_request_rejects_too_many_targets() {
        let req = PingRequest {
            targets: (0..51).map(|i| format!("10.0.0.{}", i % 255)).collect(),
            count: None,
            interval: None,
        };
        assert!(validate_request(&req).is_err());
    }

    #[test]
    fn validate_request_rejects_invalid_count() {
        let req = PingRequest {
            targets: vec!["8.8.8.8".into()],
            count: Some(0),
            interval: None,
        };
        assert!(validate_request(&req).is_err());

        let req2 = PingRequest {
            targets: vec!["8.8.8.8".into()],
            count: Some(1001),
            interval: None,
        };
        assert!(validate_request(&req2).is_err());
    }

    #[test]
    fn validate_request_rejects_invalid_interval() {
        let req = PingRequest {
            targets: vec!["8.8.8.8".into()],
            count: None,
            interval: Some(0.05),
        };
        assert!(validate_request(&req).is_err());

        let req2 = PingRequest {
            targets: vec!["8.8.8.8".into()],
            count: None,
            interval: Some(61.0),
        };
        assert!(validate_request(&req2).is_err());
    }

    // ─── parse_reply_line ─────────────────────────────────────

    #[test]
    fn parse_reply_macos() {
        let line = "64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.3 ms";
        let (seq, rtt) = parse_reply_line(line).unwrap();
        assert_eq!(seq, 1);
        assert!((rtt.unwrap() - 12.3).abs() < 0.01);
    }

    #[test]
    fn parse_reply_linux() {
        let line = "64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=0.456 ms";
        let (seq, rtt) = parse_reply_line(line).unwrap();
        assert_eq!(seq, 3);
        assert!((rtt.unwrap() - 0.456).abs() < 0.001);
    }

    #[test]
    fn parse_reply_timeout_macos() {
        let line = "Request timeout for icmp_seq 2";
        let (seq, rtt) = parse_reply_line(line).unwrap();
        assert_eq!(seq, 2);
        assert!(rtt.is_none());
    }

    #[test]
    fn parse_reply_timeout_windows() {
        let line = "Request timed out.";
        let (_, rtt) = parse_reply_line(line).unwrap();
        assert!(rtt.is_none());
    }

    #[test]
    fn parse_reply_ignores_header() {
        let line = "PING 8.8.8.8 (8.8.8.8): 56 data bytes";
        assert!(parse_reply_line(line).is_none());
    }

    // ─── parse_summary_line ───────────────────────────────────

    #[test]
    fn parse_summary_unix() {
        let line = "4 packets transmitted, 4 received, 0% packet loss, time 3004ms";
        let (sent, recv, loss) = parse_summary_line(line).unwrap();
        assert_eq!(sent, 4);
        assert_eq!(recv, 4);
        assert!((loss - 0.0).abs() < 0.01);
    }

    #[test]
    fn parse_summary_unix_with_loss() {
        let line = "4 packets transmitted, 2 received, 50% packet loss";
        let (sent, recv, loss) = parse_summary_line(line).unwrap();
        assert_eq!(sent, 4);
        assert_eq!(recv, 2);
        assert!((loss - 50.0).abs() < 0.01);
    }

    #[test]
    fn parse_summary_windows() {
        let line = "    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss)";
        let (sent, recv, loss) = parse_summary_line(line).unwrap();
        assert_eq!(sent, 4);
        assert_eq!(recv, 3);
        assert!((loss - 25.0).abs() < 0.01);
    }

    // ─── parse_rtt_stats_line ─────────────────────────────────

    #[test]
    fn parse_rtt_stats_unix() {
        let line = "round-trip min/avg/max/stddev = 11.123/12.456/13.789/0.5 ms";
        let (min, avg, max) = parse_rtt_stats_line(line).unwrap();
        assert!((min - 11.123).abs() < 0.001);
        assert!((avg - 12.456).abs() < 0.001);
        assert!((max - 13.789).abs() < 0.001);
    }

    #[test]
    fn parse_rtt_stats_windows() {
        let line = "    Minimum = 11ms, Maximum = 13ms, Average = 12ms";
        let (min, avg, max) = parse_rtt_stats_line(line).unwrap();
        assert!((min - 11.0).abs() < 0.01);
        assert!((avg - 12.0).abs() < 0.01);
        assert!((max - 13.0).abs() < 0.01);
    }

    #[test]
    fn parse_rtt_stats_ignores_non_stats() {
        assert!(parse_rtt_stats_line("PING 8.8.8.8").is_none());
    }

    // ─── PingManager ──────────────────────────────────────────

    #[test]
    fn ping_manager_stop_nonexistent_returns_error() {
        let mgr = PingManager::new();
        assert!(mgr.stop("nonexistent").is_err());
    }

    #[test]
    fn ping_manager_cleanup_nonexistent_is_noop() {
        let mgr = PingManager::new();
        mgr.cleanup("nonexistent"); // should not panic
    }
}
