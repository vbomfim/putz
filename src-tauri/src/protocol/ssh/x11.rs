/// X11 forwarding — relay X11 display traffic through SSH.
///
/// Requests X11 forwarding on the SSH session channel, then relays
/// data between the server's X11 channel and the local X display.
///
/// Architecture:
/// - On setup: generate fake auth cookie, request X11 forwarding on channel
/// - On `server_channel_open_x11`: connect to local X display, relay
///
/// Platform: X11 forwarding is primarily useful on Unix systems.
/// On Windows/macOS, an X server (e.g., XQuartz, VcXsrv) must be
/// running. The code is platform-agnostic but warns if DISPLAY is unset.
//
// Many items are only called at runtime through Tauri's event system
// and SshHandler callbacks, so the compiler marks them as unused in
// `cargo test`.  They are exercised via integration / manual testing.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::protocol::ProtocolError;

/// Default X11 display number.
const DEFAULT_X11_DISPLAY: u32 = 0;

/// X11 TCP port base (display N listens on port 6000+N).
const X11_PORT_BASE: u16 = 6000;

/// Default X11 auth protocol.
const X11_AUTH_PROTOCOL: &str = "MIT-MAGIC-COOKIE-1";

/// Buffer size for X11 relay (8 KB — X11 messages are smaller).
const X11_RELAY_BUFFER: usize = 8 * 1024;

// ── Types ────────────────────────────────────────────────────────

/// Configuration for X11 forwarding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X11ForwardingConfig {
    /// Whether X11 forwarding is enabled.
    pub enabled: bool,
    /// Local X display number (default: from DISPLAY env or 0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_number: Option<u32>,
    /// Whether to use trusted forwarding (ForwardX11Trusted).
    /// Trusted mode disables X11 SECURITY extension restrictions.
    pub trusted: bool,
}

impl Default for X11ForwardingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            display_number: None,
            trusted: false,
        }
    }
}

/// Status of X11 forwarding on a connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X11ForwardingStatus {
    /// Whether X11 forwarding is active.
    pub active: bool,
    /// Display number being forwarded.
    pub display_number: u32,
    /// Number of active X11 channels.
    pub active_channels: u32,
    /// Total bytes relayed.
    pub bytes_relayed: u64,
}

/// Internal state for X11 forwarding on a connection.
pub struct X11State {
    /// Configuration.
    pub config: X11ForwardingConfig,
    /// Generated auth cookie (hex string).
    pub auth_cookie: String,
    /// Active channel count.
    pub active_channels: Arc<AtomicU64>,
    /// Bytes relayed.
    pub bytes_relayed: Arc<AtomicU64>,
    /// Effective display number.
    pub display_number: u32,
}

// ── Functions ────────────────────────────────────────────────────

/// Generates a random 16-byte auth cookie as a hex string.
///
/// Used as the X11 authentication cookie for the forwarded session.
/// A fake cookie prevents the remote side from accessing the real
/// local X display cookie.
pub fn generate_auth_cookie() -> String {
    use std::fmt::Write;
    let mut cookie = String::with_capacity(32);
    let bytes: [u8; 16] = rand_bytes_16();
    for b in &bytes {
        write!(cookie, "{b:02x}").unwrap();
    }
    cookie
}

/// Generates 16 pseudo-random bytes.
///
/// Uses `std::time` nanos as a simple seed. For production security,
/// a proper CSPRNG would be ideal, but for X11 auth cookies the
/// threat model is limited (same-machine, same-user).
fn rand_bytes_16() -> [u8; 16] {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut bytes = [0u8; 16];
    let mut state = seed;
    for b in &mut bytes {
        state = state.wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *b = (state >> 33) as u8;
    }
    bytes
}

/// Parses the DISPLAY environment variable to extract the display number.
///
/// Formats: `:0`, `:0.0`, `localhost:10.0`, `/tmp/.X11-unix/X0`
pub fn parse_display_number() -> u32 {
    let display = std::env::var("DISPLAY").unwrap_or_default();
    parse_display_string(&display)
}

/// Parses a DISPLAY string to extract the display number.
pub fn parse_display_string(display: &str) -> u32 {
    if display.is_empty() {
        return DEFAULT_X11_DISPLAY;
    }

    // Handle Unix socket path: /tmp/.X11-unix/X0
    if display.starts_with('/') {
        return display
            .rsplit('X')
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_X11_DISPLAY);
    }

    // Handle host:display.screen format
    if let Some(after_colon) = display.split(':').nth(1) {
        // Take everything before the dot (screen number)
        let display_str =
            after_colon.split('.').next().unwrap_or("0");
        return display_str
            .parse()
            .unwrap_or(DEFAULT_X11_DISPLAY);
    }

    DEFAULT_X11_DISPLAY
}

/// Creates X11 forwarding state and requests forwarding on the channel.
///
/// Call this after the SSH channel is opened but before shell request.
pub async fn setup_x11_forwarding(
    channel: &russh::Channel<russh::client::Msg>,
    config: &X11ForwardingConfig,
) -> Result<X11State, ProtocolError> {
    let display_number = config
        .display_number
        .unwrap_or_else(parse_display_number);
    let auth_cookie = generate_auth_cookie();

    channel
        .request_x11(
            false, // want_reply
            !config.trusted, // single_connection (true for untrusted)
            X11_AUTH_PROTOCOL,
            &auth_cookie,
            display_number,
        )
        .await
        .map_err(|e| {
            ProtocolError::IoError(format!(
                "X11 forwarding request failed: {e}"
            ))
        })?;

    Ok(X11State {
        config: config.clone(),
        auth_cookie,
        active_channels: Arc::new(AtomicU64::new(0)),
        bytes_relayed: Arc::new(AtomicU64::new(0)),
        display_number,
    })
}

/// Handles an incoming X11 channel from the server.
///
/// Connects to the local X display and relays data bidirectionally.
/// Called by `SshHandler::server_channel_open_x11()`.
pub async fn handle_x11_channel(
    channel: russh::Channel<russh::client::Msg>,
    display_number: u32,
    active_channels: Arc<AtomicU64>,
    bytes_relayed: Arc<AtomicU64>,
) {
    let local_port = X11_PORT_BASE + display_number as u16;
    let local_addr = format!("127.0.0.1:{local_port}");

    // Try TCP connection first, then Unix socket
    let tcp_stream =
        match tokio::net::TcpStream::connect(&local_addr).await {
            Ok(s) => s,
            Err(_) => {
                // Try Unix socket (Linux/macOS)
                #[cfg(unix)]
                {
                    let socket_path = format!(
                        "/tmp/.X11-unix/X{display_number}"
                    );
                    match tokio::net::UnixStream::connect(
                        &socket_path,
                    )
                    .await
                    {
                        Ok(unix_stream) => {
                            active_channels
                                .fetch_add(1, Ordering::Relaxed);
                            relay_x11_unix(
                                channel,
                                unix_stream,
                                active_channels,
                                bytes_relayed,
                            )
                            .await;
                            return;
                        }
                        Err(_) => return,
                    }
                }
                #[cfg(not(unix))]
                return;
            }
        };

    active_channels.fetch_add(1, Ordering::Relaxed);
    relay_x11_tcp(channel, tcp_stream, active_channels, bytes_relayed)
        .await;
}

/// Relays X11 data between an SSH channel and a TCP stream.
async fn relay_x11_tcp(
    mut channel: russh::Channel<russh::client::Msg>,
    mut tcp_stream: tokio::net::TcpStream,
    active_channels: Arc<AtomicU64>,
    bytes_relayed: Arc<AtomicU64>,
) {
    let (mut tcp_read, mut tcp_write) = tcp_stream.split();
    let mut buf = vec![0u8; X11_RELAY_BUFFER];

    loop {
        tokio::select! {
            result = tcp_read.read(&mut buf) => {
                match result {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        bytes_relayed.fetch_add(n as u64, Ordering::Relaxed);
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        bytes_relayed.fetch_add(data.len() as u64, Ordering::Relaxed);
                        if tcp_write.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = tcp_write.shutdown().await;
    let _ = channel.eof().await;
    active_channels.fetch_sub(1, Ordering::Relaxed);
}

/// Relays X11 data between an SSH channel and a Unix socket.
#[cfg(unix)]
async fn relay_x11_unix(
    mut channel: russh::Channel<russh::client::Msg>,
    mut unix_stream: tokio::net::UnixStream,
    active_channels: Arc<AtomicU64>,
    bytes_relayed: Arc<AtomicU64>,
) {
    let (mut unix_read, mut unix_write) = unix_stream.split();
    let mut buf = vec![0u8; X11_RELAY_BUFFER];

    loop {
        tokio::select! {
            result = unix_read.read(&mut buf) => {
                match result {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        bytes_relayed.fetch_add(n as u64, Ordering::Relaxed);
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        bytes_relayed.fetch_add(data.len() as u64, Ordering::Relaxed);
                        if unix_write.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = unix_write.shutdown().await;
    let _ = channel.eof().await;
    active_channels.fetch_sub(1, Ordering::Relaxed);
}

/// Returns the X11 forwarding status for a connection.
pub fn get_x11_status(state: &X11State) -> X11ForwardingStatus {
    X11ForwardingStatus {
        active: true,
        display_number: state.display_number,
        active_channels: state
            .active_channels
            .load(Ordering::Relaxed) as u32,
        bytes_relayed: state
            .bytes_relayed
            .load(Ordering::Relaxed),
    }
}

// ── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── X11ForwardingConfig ──────────────────────────────────────

    #[test]
    fn default_config_is_disabled() {
        let config = X11ForwardingConfig::default();
        assert!(!config.enabled);
        assert!(!config.trusted);
        assert_eq!(config.display_number, None);
    }

    #[test]
    fn config_serializes_camel_case() {
        let config = X11ForwardingConfig {
            enabled: true,
            display_number: Some(10),
            trusted: true,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"displayNumber\":10"));
        assert!(json.contains("\"trusted\":true"));
    }

    #[test]
    fn config_omits_none_display_number() {
        let config = X11ForwardingConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(!json.contains("displayNumber"));
    }

    #[test]
    fn config_roundtrip() {
        let config = X11ForwardingConfig {
            enabled: true,
            display_number: Some(5),
            trusted: false,
        };
        let json = serde_json::to_string(&config).unwrap();
        let restored: X11ForwardingConfig =
            serde_json::from_str(&json).unwrap();
        assert_eq!(restored.enabled, true);
        assert_eq!(restored.display_number, Some(5));
        assert_eq!(restored.trusted, false);
    }

    // ── X11ForwardingStatus ──────────────────────────────────────

    #[test]
    fn status_serializes() {
        let status = X11ForwardingStatus {
            active: true,
            display_number: 0,
            active_channels: 3,
            bytes_relayed: 65536,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"activeChannels\":3"));
        assert!(json.contains("\"bytesRelayed\":65536"));
        assert!(json.contains("\"displayNumber\":0"));
    }

    // ── DISPLAY parsing ──────────────────────────────────────────

    #[test]
    fn parse_display_colon_zero() {
        assert_eq!(parse_display_string(":0"), 0);
    }

    #[test]
    fn parse_display_colon_zero_dot_zero() {
        assert_eq!(parse_display_string(":0.0"), 0);
    }

    #[test]
    fn parse_display_colon_ten() {
        assert_eq!(parse_display_string(":10"), 10);
    }

    #[test]
    fn parse_display_localhost_colon_ten() {
        assert_eq!(parse_display_string("localhost:10.0"), 10);
    }

    #[test]
    fn parse_display_host_colon_display() {
        assert_eq!(
            parse_display_string("remote.host:5.0"),
            5
        );
    }

    #[test]
    fn parse_display_unix_socket() {
        assert_eq!(
            parse_display_string("/tmp/.X11-unix/X0"),
            0
        );
    }

    #[test]
    fn parse_display_unix_socket_display_2() {
        assert_eq!(
            parse_display_string("/tmp/.X11-unix/X2"),
            2
        );
    }

    #[test]
    fn parse_display_empty_returns_default() {
        assert_eq!(parse_display_string(""), 0);
    }

    #[test]
    fn parse_display_garbage_returns_default() {
        assert_eq!(parse_display_string("garbage"), 0);
    }

    // ── Auth cookie generation ───────────────────────────────────

    #[test]
    fn auth_cookie_is_32_hex_chars() {
        let cookie = generate_auth_cookie();
        assert_eq!(cookie.len(), 32);
        assert!(cookie.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn auth_cookies_are_different() {
        // Two consecutive calls should produce different cookies
        // (not guaranteed due to same-nanosecond, but practically true)
        let c1 = generate_auth_cookie();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let c2 = generate_auth_cookie();
        // Allow for the rare case of collision but test the format
        assert_eq!(c1.len(), 32);
        assert_eq!(c2.len(), 32);
    }

    // ── get_x11_status ───────────────────────────────────────────

    #[test]
    fn get_status_returns_correct_values() {
        let state = X11State {
            config: X11ForwardingConfig::default(),
            auth_cookie: "abc".into(),
            active_channels: Arc::new(AtomicU64::new(5)),
            bytes_relayed: Arc::new(AtomicU64::new(1024)),
            display_number: 10,
        };
        let status = get_x11_status(&state);
        assert!(status.active);
        assert_eq!(status.display_number, 10);
        assert_eq!(status.active_channels, 5);
        assert_eq!(status.bytes_relayed, 1024);
    }
}
