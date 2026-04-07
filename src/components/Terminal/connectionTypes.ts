/**
 * Type definitions for the protocol connection IPC layer.
 *
 * These types mirror the Rust backend's connection IPC commands.
 * Keep in sync with src-tauri/src/ipc/connection.rs.
 */

/** Protocol type for connection_open. */
export type ConnectionProtocol = "ssh" | "telnet" | "serial" | "local";

/** Arguments for the connection_open IPC command. */
export interface ConnectionOpenInput {
  /** Hostname or IP address to connect to. */
  host?: string;
  /** Port number (defaults to protocol default). */
  port?: number;
  /** Protocol to use for the connection. */
  protocol: ConnectionProtocol;
  /** Username for authentication (optional). */
  username?: string;
  /** Terminal width in columns. */
  cols: number;
  /** Terminal height in rows. */
  rows: number;
  /** Vault credential ID for SSH password/passphrase retrieval. */
  credentialId?: string;
  /** Path to an SSH private key file. */
  keyPath?: string;
}

/** Arguments for the connection_write IPC command. */
export interface ConnectionWriteArgs {
  /** Connection ID from connection_open. */
  connectionId: string;
  /** Base64-encoded bytes to write. */
  data: string;
}

/** Arguments for the connection_resize IPC command. */
export interface ConnectionResizeArgs {
  /** Connection ID from connection_open. */
  connectionId: string;
  /** New terminal width in columns. */
  cols: number;
  /** New terminal height in rows. */
  rows: number;
}

/** Arguments for the connection_close IPC command. */
export interface ConnectionCloseArgs {
  /** Connection ID from connection_open. */
  connectionId: string;
}

/** Connection status values emitted by the backend. */
export type ConnectionStatusType =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/** Payload for connection-status-{connectionId} events. */
export interface ConnectionStatusPayload {
  /** Current connection status. */
  status: ConnectionStatusType;
  /** Optional message with details (e.g., error description). */
  message?: string;
}

/** Payload for connection-hostkey-{connectionId} events. */
export interface HostKeyPayload {
  /** Remote hostname. */
  host: string;
  /** Remote port. */
  port: number;
  /** SSH key type (e.g., "ssh-ed25519"). */
  keyType: string;
  /** SHA256 fingerprint of the server's host key. */
  fingerprint: string;
  /** Action: "new" for first connection, "changed" for MITM warning. */
  action: "new" | "changed";
  /** Expected fingerprint (only for "changed" action). */
  expectedFingerprint?: string;
}

/** Payload for connection-auth-prompt-{connectionId} events. */
export interface AuthPromptPayload {
  /** Username being authenticated. */
  username: string;
  /** Available authentication methods. */
  methods: string[];
}
