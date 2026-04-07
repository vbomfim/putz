/**
 * Type definitions for the change window compliance IPC layer.
 *
 * These types mirror the Rust backend's compliance models.
 * Keep in sync with src-tauri/src/compliance/models.rs.
 */

/** A maintenance/change window definition. */
export interface ChangeWindow {
  id: string;
  name: string;
  /** Day-of-week: 0 = Sunday, 6 = Saturday. Empty = all days. */
  days: number[];
  /** Start hour (0–23) in local time. */
  startHour: number;
  /** End hour (0–23) in local time. */
  endHour: number;
  /** Device group patterns. Empty = all devices. */
  deviceGroups: string[];
  /** Whether this window is currently enabled. */
  enabled: boolean;
}

/** Result of checking a command against the change window policy. */
export interface ChangeWindowCheckResult {
  /** Whether the command is allowed right now. */
  allowed: boolean;
  /** Human-readable reason for the decision. */
  reason: string;
  /** Name of the active window (if any). */
  windowName?: string;
}

/** Input for creating or updating a change window. */
export interface SetChangeWindowInput {
  /** If provided, updates existing. If omitted, creates new. */
  id?: string;
  name: string;
  days: number[];
  startHour: number;
  endHour: number;
  deviceGroups: string[];
  enabled: boolean;
}
