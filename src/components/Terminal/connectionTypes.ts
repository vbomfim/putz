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
  // -- Serial-specific fields (only when protocol = "serial") --
  /** Baud rate for serial connections (default: 9600). */
  baudRate?: number;
  /** Data bits: "five", "six", "seven", "eight" (default: "eight"). */
  dataBits?: SerialDataBits;
  /** Parity: "none", "even", "odd" (default: "none"). */
  parity?: SerialParity;
  /** Stop bits: "one", "two" (default: "one"). */
  stopBits?: SerialStopBits;
  /** Flow control: "none", "hardware", "software" (default: "none"). */
  flowControl?: SerialFlowControl;
}

/** Serial data bits setting. */
export type SerialDataBits = "five" | "six" | "seven" | "eight";

/** Serial parity setting. */
export type SerialParity = "none" | "even" | "odd";

/** Serial stop bits setting. */
export type SerialStopBits = "one" | "two";

/** Serial flow control setting. */
export type SerialFlowControl = "none" | "hardware" | "software";

/** Information about an available serial port. */
export interface SerialPortInfo {
  /** System port name (e.g., "/dev/ttyUSB0", "COM3"). */
  name: string;
  /** Human-readable description of the port. */
  description: string;
  /** Manufacturer name (USB devices only). */
  manufacturer?: string;
  /** Device serial number (USB devices only). */
  serialNumber?: string;
  /** Port type: "USB", "PCI", "Bluetooth", or "Unknown". */
  portType: string;
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

/** All serial config values for the configuration panel. */
export interface SerialConfigValues {
  port: string;
  baudRate: number;
  dataBits: SerialDataBits;
  parity: SerialParity;
  stopBits: SerialStopBits;
  flowControl: SerialFlowControl;
}

/** Default serial configuration (9600/8/N/1 — standard Cisco console). */
export const DEFAULT_SERIAL_CONFIG: SerialConfigValues = {
  port: "",
  baudRate: 9600,
  dataBits: "eight",
  parity: "none",
  stopBits: "one",
  flowControl: "none",
};

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
