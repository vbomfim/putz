/**
 * Type definitions for the command history IPC layer.
 *
 * These types mirror the Rust backend's history models.
 * Keep in sync with src-tauri/src/history/models.rs.
 */

/** A single command history entry. */
export interface CommandEntry {
  id: number;
  sessionName: string;
  host: string;
  command: string;
  timestamp: string;
  sessionId: string;
}

/** Input for adding a command to history. */
export interface AddCommandInput {
  sessionName: string;
  host: string;
  command: string;
  sessionId: string;
}

/** Input for searching command history. */
export interface SearchHistoryInput {
  query: string;
  sessionId?: string;
  limit?: number;
}

/** Input for getting recent commands. */
export interface GetRecentInput {
  sessionId: string;
  limit?: number;
}
