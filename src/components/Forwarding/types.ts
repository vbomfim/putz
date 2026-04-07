/**
 * Type definitions for SSH port forwarding IPC layer.
 *
 * These types mirror the Rust backend's forwarding types.
 * Keep in sync with src-tauri/src/protocol/ssh/forwarding.rs.
 *
 * @module forwardingTypes
 */

/** Type of port forwarding tunnel. */
export type ForwardingType = "local" | "remote" | "dynamic";

/** Current status of a forwarding tunnel. */
export type TunnelStatus = "starting" | "active" | "stopped" | "error";

/** Input for adding a forwarding rule via IPC. */
export interface ForwardingRuleInput {
  /** Type of forwarding (local, remote, dynamic). */
  forwardingType: ForwardingType;
  /** Local port to bind (local/dynamic) or connect to (remote). */
  localPort: number;
  /** Remote host (required for local/remote, unused for dynamic). */
  remoteHost?: string;
  /** Remote port (required for local/remote, unused for dynamic). */
  remotePort?: number;
  /** Bind address (default: "127.0.0.1"). "0.0.0.0" triggers security warning. */
  bindAddress?: string;
}

/** Runtime status of a forwarding tunnel from the backend. */
export interface ForwardingStatus {
  /** Unique tunnel identifier. */
  id: string;
  /** SSH connection this tunnel belongs to. */
  connectionId: string;
  /** Type of forwarding. */
  forwardingType: ForwardingType;
  /** Local port the listener is bound to. */
  localPort: number;
  /** Remote host (for local/remote forwarding). */
  remoteHost?: string;
  /** Remote port (for local/remote forwarding). */
  remotePort?: number;
  /** Bind address for the local listener. */
  bindAddress: string;
  /** Total bytes transmitted through this tunnel. */
  bytesTx: number;
  /** Total bytes received through this tunnel. */
  bytesRx: number;
  /** Number of active relay connections. */
  activeConnections: number;
  /** Current tunnel status. */
  status: TunnelStatus;
  /** Error message if status is "error". */
  error?: string;
}

/** X11 forwarding configuration. */
export interface X11ForwardingConfig {
  /** Whether X11 forwarding is enabled. */
  enabled: boolean;
  /** Local X display number. */
  displayNumber?: number;
  /** Whether to use trusted forwarding. */
  trusted: boolean;
}

/** Human-readable labels for forwarding types. */
export const FORWARDING_TYPE_LABELS: Record<ForwardingType, string> = {
  local: "Local (-L)",
  remote: "Remote (-R)",
  dynamic: "Dynamic (-D)",
};

/** Default ports for common forwarding use cases. */
export const COMMON_FORWARDING_PORTS = [
  { label: "HTTP", port: 80 },
  { label: "HTTPS", port: 443 },
  { label: "MySQL", port: 3306 },
  { label: "PostgreSQL", port: 5432 },
  { label: "Redis", port: 6379 },
  { label: "MongoDB", port: 27017 },
  { label: "VNC", port: 5900 },
  { label: "SOCKS5", port: 1080 },
] as const;

/** Formats byte count in human-readable units. */
export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;

  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Returns a display string for a forwarding rule. */
export function formatForwardingRule(rule: ForwardingRuleInput): string {
  const bind = rule.bindAddress ?? "127.0.0.1";
  switch (rule.forwardingType) {
    case "local":
      return `${bind}:${rule.localPort} → ${rule.remoteHost}:${rule.remotePort}`;
    case "remote":
      return `${rule.remoteHost}:${rule.remotePort} → ${bind}:${rule.localPort}`;
    case "dynamic":
      return `${bind}:${rule.localPort} (SOCKS5)`;
  }
}

/** Returns a status indicator emoji for a tunnel. */
export function statusIndicator(status: TunnelStatus): string {
  switch (status) {
    case "starting":
      return "⏳";
    case "active":
      return "🟢";
    case "stopped":
      return "⚪";
    case "error":
      return "🔴";
  }
}
