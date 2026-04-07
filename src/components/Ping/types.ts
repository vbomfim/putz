/**
 * Type definitions for the Ping Dashboard.
 *
 * These types mirror the Rust backend's ping types.
 * Keep in sync with src-tauri/src/nettools/ping.rs.
 *
 * @module pingTypes
 */

/** Request to start a ping session. */
export interface PingRequest {
  /** List of hostnames or IP addresses to ping. */
  targets: string[];
  /** Number of pings per target (default: 4). */
  count?: number;
  /** Interval between pings in seconds (default: 1.0). */
  interval?: number;
}

/** A single ping reply result (emitted per response line). */
export interface PingResult {
  /** The ping session ID. */
  id: string;
  /** Target host that was pinged. */
  target: string;
  /** Sequence number of this reply. */
  seq: number;
  /** Round-trip time in milliseconds (null if timeout). */
  rttMs: number | null;
  /** Whether this reply timed out. */
  timedOut: boolean;
}

/** Summary statistics emitted when a ping target completes. */
export interface PingSummary {
  /** The ping session ID. */
  id: string;
  /** Target host. */
  target: string;
  /** Packets sent. */
  sent: number;
  /** Packets received. */
  received: number;
  /** Packet loss percentage (0-100). */
  lossPct: number;
  /** Minimum RTT in ms. */
  minMs: number | null;
  /** Average RTT in ms. */
  avgMs: number | null;
  /** Maximum RTT in ms. */
  maxMs: number | null;
  /** Whether the ping completed normally. */
  done: boolean;
}

/** Aggregated stats for a single target displayed in the table. */
export interface PingTargetStats {
  /** Target hostname or IP. */
  target: string;
  /** Current status. */
  status: "running" | "done" | "error";
  /** Packets sent so far. */
  sent: number;
  /** Packets received so far. */
  received: number;
  /** Packet loss percentage. */
  lossPct: number;
  /** Minimum RTT in ms. */
  minMs: number | null;
  /** Average RTT in ms. */
  avgMs: number | null;
  /** Maximum RTT in ms. */
  maxMs: number | null;
  /** Last RTT in ms. */
  lastMs: number | null;
}

/** Maximum number of targets per ping session. */
export const MAX_PING_TARGETS = 50;

/** Default ping count. */
export const DEFAULT_PING_COUNT = 4;

/** Default ping interval in seconds. */
export const DEFAULT_PING_INTERVAL = 1.0;
