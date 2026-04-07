/**
 * Type definitions for the Scripting IPC layer.
 *
 * These types mirror the Rust backend's scripting types.
 * Keep in sync with src-tauri/src/scripting/models.rs and src-tauri/src/ipc/scripting.rs.
 *
 * @module scriptingTypes
 */

/** Metadata for a saved script. Stored in the scripts index. */
export interface ScriptMeta {
  /** Unique identifier (UUID v4). */
  id: string;
  /** User-facing display name. */
  name: string;
  /** Optional description of what the script does. */
  description: string;
  /** Filename on disk (e.g., `backup-config.js`). */
  filename: string;
  /** Whether this script runs automatically on session connect. */
  isLoginScript: boolean;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-modified timestamp. */
  updatedAt: string;
}

/** Full script data (metadata + content) returned by `script_get`. */
export interface ScriptWithContent {
  /** Script metadata. */
  meta: ScriptMeta;
  /** JavaScript source code. */
  content: string;
}

/** Severity level for script log entries. */
export type LogLevel = "info" | "warn" | "error" | "output";

/** A single log entry from script execution. */
export interface ScriptLogEntry {
  /** ISO 8601 timestamp of the log entry. */
  timestamp: string;
  /** Severity level. */
  level: LogLevel;
  /** Log message content. */
  message: string;
}

/** Status of a script execution. */
export type ScriptStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

/** Result of a script execution, returned by `script_status`. */
export interface ScriptRunResult {
  /** Unique run identifier. */
  runId: string;
  /** ID of the script that was run. */
  scriptId: string;
  /** ID of the session it ran against. */
  sessionId: string;
  /** Current execution status. */
  status: ScriptStatus;
  /** Log output from the script. */
  output: ScriptLogEntry[];
  /** ISO 8601 start timestamp. */
  startedAt: string;
  /** ISO 8601 completion timestamp (null if still running). */
  finishedAt: string | null;
  /** Error message if status is "failed". */
  error: string | null;
}

/** IPC input for saving a script (create or update). */
export interface SaveScriptInput {
  /** Script ID for updates; undefined for new scripts. */
  id?: string;
  /** User-facing display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** JavaScript source code. */
  content: string;
  /** Whether this is a login script. */
  isLoginScript?: boolean;
}

/** IPC input for running a script against a single session. */
export interface RunScriptInput {
  /** ID of the script to run. */
  scriptId: string;
  /** ID of the target session (PTY or connection). */
  sessionId: string;
}

/** IPC input for running a script across multiple sessions. */
export interface RunMultiInput {
  /** ID of the script to run. */
  scriptId: string;
  /** IDs of target sessions. */
  sessionIds: string[];
}

/** Default script template for new scripts. */
export const DEFAULT_SCRIPT_CONTENT = `// Putz Automation Script
// API: send(cmd), waitFor(pattern, timeoutMs?), sendAndCapture(cmd, pattern, timeoutMs?)
//      sleep(ms), log(msg), disconnect(), vault.get(name)

send("show version");
const output = waitFor("#", 5000);
log("Captured: " + output);
`;

/** Maximum script content size in bytes. */
export const MAX_SCRIPT_SIZE = 512_000;

/** Maximum script name length. */
export const MAX_SCRIPT_NAME_LENGTH = 100;
