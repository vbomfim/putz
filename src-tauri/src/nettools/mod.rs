/// Network tools module — ping, backup, and diagnostic utilities.
///
/// Provides cross-platform network diagnostic capabilities:
/// - `ping`: concurrent ICMP ping via system command with real-time results
/// - `backup`: save device configurations to local filesystem
pub mod backup;
pub mod ping;
